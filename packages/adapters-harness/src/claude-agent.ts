/**
 * `claude-agent` harness — the agent loop is the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * Like `hermes`, the SDK owns the model call and the tool loop, so `input.model` is unused. Unlike
 * `hermes` it runs in-process: `query()` spawns the Claude Code runtime as a child process and
 * streams messages back, which this adapter re-emits as the shared `TraceEvent`s.
 *
 * **Tools:** every built-in Claude Code tool (Bash, Read, Write, ...) is switched off (`tools: []`).
 * The trial's tools are offered through an in-process MCP server that calls the same `executeTool`
 * as the baseline harness, so path safety (`resolveInSandbox`), memory, and skills behave identically
 * and results stay comparable across harnesses.
 *
 * **Budgets:** `maxSteps` → SDK `maxTurns`; `timeoutMs` → an abort timer; `maxTokens` is checked
 * against streamed usage after each model call (the SDK has no per-request token cap).
 *
 * **Not honoured:** `temperature` / `topP` (the Agent SDK exposes no sampling controls).
 * **Models:** only `anthropic/*` ids (e.g. `anthropic/claude-haiku-4.5`); needs `ANTHROPIC_API_KEY`.
 * **Usage:** `promptTokens` counts input + cache-creation + cache-read tokens, all at list input price.
 */
import type { Options, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { TraceEvent } from '@agent-evals/domain';
import { executeTool, isSkillTool, TOOL_SPECS } from './tools.js';
import { CSV_OPS } from './skills.js';
import type { HarnessAdapter, HarnessRunInput, HarnessRunOutput, TrialContext } from './types.js';

/** Name of the in-process MCP server; the SDK exposes its tools as `mcp__<server>__<tool>`. */
const MCP_SERVER = 'evals';
const MCP_PREFIX = `mcp__${MCP_SERVER}__`;

const SYSTEM_PROMPT =
  'You are an agent working in a sandboxed directory. Use the provided tools to complete the task you are given.';

/** Environment the Claude Code child process gets. It replaces `process.env`, so secrets for other services stay out. */
const PASSTHROUGH_ENV = [
  'PATH',
  'HOME',
  'TMPDIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
] as const;

/** Input shape of each tool the trial can be offered. Descriptions come from `TOOL_SPECS`. */
const TOOL_SHAPES: Readonly<Record<string, Record<string, z.ZodType>>> = {
  write_file: { path: z.string(), content: z.string() },
  read_file: { path: z.string() },
  list_dir: { path: z.string() },
  memory_read: { query: z.string() },
  memory_write: { key: z.string(), value: z.string() },
  csv_summary: {
    path: z.string(),
    column: z.string(),
    op: z.enum(CSV_OPS),
    where: z.array(z.object({ column: z.string(), equals: z.string() })).optional(),
  },
};

type StopReason = HarnessRunOutput['stoppedReason'];

/** The part of the SDK's `query()` this adapter uses. Tests pass a fake; production uses the real one. */
export type ClaudeAgentQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeAgentHarnessOptions {
  /** Replaces the SDK's `query()`. Skips the `ANTHROPIC_API_KEY` check. */
  query?: ClaudeAgentQuery;
}

/** HarnessAdapter that runs each trial through the Claude Agent SDK. */
export class ClaudeAgentHarness implements HarnessAdapter {
  readonly id = 'claude-agent';
  readonly displayName = 'Claude Agent SDK';
  private readonly injectedQuery?: ClaudeAgentQuery;

  constructor(options: ClaudeAgentHarnessOptions = {}) {
    this.injectedQuery = options.query;
  }

  async run(input: HarnessRunInput): Promise<HarnessRunOutput> {
    const { task, modelId, context } = input;
    const { budgets, emit } = context;
    const now = () => new Date().toISOString();

    const model = toClaudeModel(modelId);
    if (!this.injectedQuery && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set (the claude-agent harness calls the Anthropic API directly)');
    }

    // Loaded here, not at module top, so a broken SDK install cannot break the other harnesses.
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const runQuery: ClaudeAgentQuery = this.injectedQuery ?? ((params) => sdk.query(params));

    const toolNames = context.toolIds.filter((id) => id in TOOL_SHAPES);
    const abort = new AbortController();
    const options: Options = {
      cwd: context.sandboxDir,
      model,
      maxTurns: budgets.maxSteps,
      abortController: abort,
      systemPrompt: SYSTEM_PROMPT,
      thinking: { type: 'disabled' },
      tools: [],
      allowedTools: toolNames.map((name) => `${MCP_PREFIX}${name}`),
      permissionMode: 'dontAsk',
      settingSources: [],
      persistSession: false,
      strictMcpConfig: true,
      env: passthroughEnv(),
      ...(toolNames.length > 0
        ? {
            mcpServers: {
              [MCP_SERVER]: sdk.createSdkMcpServer({
                name: MCP_SERVER,
                tools: toolNames.map((name) => buildTool(sdk.tool, name, context)),
              }),
            },
          }
        : {}),
    };

    // Set from the timer and the token check; an object avoids stale control-flow narrowing on the closure write.
    const state: { stopped?: StopReason } = {};
    const timer = setTimeout(() => {
      state.stopped ??= 'timeout';
      abort.abort();
    }, budgets.timeoutMs);

    const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
    const usageByMessage = new Map<string, { promptTokens: number; completionTokens: number }>();
    let step = 1;
    let lastText = '';
    let result: SDKResultMessage | undefined;
    let failure: string | undefined;

    emit({ ts: now(), type: 'step_boundary', step });
    emit({ ts: now(), type: 'message', role: 'user', content: task.prompt });

    try {
      for await (const msg of runQuery({ prompt: task.prompt, options })) {
        if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
          const { id, content, usage } = msg.message;
          if (!usageByMessage.has(id)) {
            if (usageByMessage.size > 0) {
              step += 1;
              emit({ ts: now(), type: 'step_boundary', step });
            }
          }
          usageByMessage.set(id, toUsage(usage));

          let text = '';
          let wantsTools = false;
          for (const block of content) {
            if (block.type === 'text') {
              text += (text ? '\n' : '') + block.text;
            } else if (block.type === 'tool_use') {
              wantsTools = true;
              const args = (block.input ?? {}) as Record<string, unknown>;
              const name = stripPrefix(block.name);
              calls.set(block.id, { name, args });
              emit({ ts: now(), type: 'tool_call', name, args, callId: block.id });
            }
          }
          if (text) {
            lastText = text;
            emit({ ts: now(), type: 'message', role: 'assistant', content: text });
          }

          // Same rule as the baseline loop: over budget only matters if the model wants to keep going.
          const total = sumUsage(usageByMessage.values());
          if (wantsTools && total.promptTokens + total.completionTokens > budgets.maxTokens) {
            state.stopped ??= 'max_tokens';
            abort.abort();
          }
        } else if (msg.type === 'user' && msg.parent_tool_use_id === null) {
          if (Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type === 'tool_result') {
                emitToolResult(block.tool_use_id, block.content, block.is_error === true, calls, emit, now());
              }
            }
          }
        } else if (msg.type === 'result') {
          result = msg;
        }
        if (state.stopped) break;
      }
    } catch (err) {
      // After our own abort the SDK may throw; the stop reason is already decided.
      if (!state.stopped) failure = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      abort.abort(); // ends the child process if the stream was left early
    }

    const stoppedReason = this.resolveStopReason(state.stopped, result, failure, emit, now());
    return {
      finalAnswer: result?.subtype === 'success' ? result.result : lastText,
      stoppedReason,
      usage: result ? toUsage(result.usage) : sumUsage(usageByMessage.values()),
      stepCount: step,
    };
  }

  /** Our own stop (timeout, token budget) wins; otherwise the SDK's result decides. Errors are traced. */
  private resolveStopReason(
    stopped: StopReason | undefined,
    result: SDKResultMessage | undefined,
    failure: string | undefined,
    emit: (event: TraceEvent) => void,
    ts: string,
  ): StopReason {
    if (stopped) return stopped;
    if (failure !== undefined) {
      emit({ ts, type: 'error', message: failure, code: 'agent_sdk_error' });
      return 'error';
    }
    if (!result) {
      emit({ ts, type: 'error', message: 'claude agent stream ended without a result', code: 'agent_sdk_error' });
      return 'error';
    }
    if (result.subtype === 'success') {
      if (!result.is_error) return 'completed';
      emit({ ts, type: 'error', message: result.result, code: 'agent_sdk_error' });
      return 'error';
    }
    if (result.subtype === 'error_max_turns') return 'max_steps';
    emit({ ts, type: 'error', message: result.errors.join('; ') || result.subtype, code: result.subtype });
    return 'error';
  }
}

/** `anthropic/claude-haiku-4.5` (the platform id) → `claude-haiku-4-5` (the Anthropic API id). */
function toClaudeModel(modelId: string): string {
  const match = /^anthropic\/(.+)$/.exec(modelId);
  if (!match) {
    throw new Error(`claude-agent harness only runs Anthropic models (anthropic/<model>), got "${modelId}"`);
  }
  return match[1]!.replaceAll('.', '-');
}

function passthroughEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

/** One MCP tool that runs the shared `executeTool` against the trial sandbox and memory. */
function buildTool(tool: SdkModule['tool'], name: string, context: TrialContext) {
  const description = TOOL_SPECS.find((spec) => spec.name === name)?.description ?? name;
  return tool(name, description, TOOL_SHAPES[name]!, async (args) => {
    const out = await executeTool(
      context.sandboxDir,
      { id: '', name, arguments: args as Record<string, unknown> },
      context.memory,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(out.result) }], isError: !out.ok };
  });
}

function stripPrefix(toolName: string): string {
  return toolName.startsWith(MCP_PREFIX) ? toolName.slice(MCP_PREFIX.length) : toolName;
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function toUsage(usage: RawUsage | undefined): { promptTokens: number; completionTokens: number } {
  return {
    promptTokens:
      (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0),
    completionTokens: usage?.output_tokens ?? 0,
  };
}

function sumUsage(items: Iterable<{ promptTokens: number; completionTokens: number }>) {
  const total = { promptTokens: 0, completionTokens: 0 };
  for (const item of items) {
    total.promptTokens += item.promptTokens;
    total.completionTokens += item.completionTokens;
  }
  return total;
}

/** Turns an SDK tool_result block into `tool_result` plus the memory / skill events the baseline also records. */
function emitToolResult(
  callId: string,
  content: unknown,
  isError: boolean,
  calls: Map<string, { name: string; args: Record<string, unknown> }>,
  emit: (event: TraceEvent) => void,
  ts: string,
): void {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part?.type === 'text' ? String(part.text) : '')).join('')
        : '';
  let result: unknown = text;
  try {
    result = JSON.parse(text);
  } catch {
    // Not JSON (e.g. an SDK permission error): keep the raw text.
  }
  emit({ ts, type: 'tool_result', callId, ok: !isError, result });
  if (isError) return;

  const call = calls.get(callId);
  if (!call) return;
  if (call.name === 'memory_read') {
    const hits = (result as { hits?: unknown[] } | null)?.hits ?? [];
    emit({ ts, type: 'memory_read', query: String(call.args.query ?? ''), hits });
  } else if (call.name === 'memory_write') {
    emit({ ts, type: 'memory_write', key: String(call.args.key ?? ''), value: call.args.value });
  } else if (isSkillTool(call.name)) {
    emit({ ts, type: 'skill_invoke', skillId: call.name, input: call.args });
  }
}
