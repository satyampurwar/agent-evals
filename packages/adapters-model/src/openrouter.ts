import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type {
  ChatMessage,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolSpec,
} from './types.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterOptions {
  apiKey: string;
  baseURL?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** SDK-level retries for network errors, 429 and 5xx. */
  maxRetries?: number;
  /** Injected in tests to avoid real network calls. */
  fetch?: typeof globalThis.fetch;
  appTitle?: string;
}

/** Internal ChatMessage -> OpenAI wire format (OpenRouter is OpenAI-compatible). */
export function toWireMessage(m: ChatMessage): ChatCompletionMessageParam {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content };
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant':
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content === '' ? null : m.content,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        };
      }
      return { role: 'assistant', content: m.content };
    case 'tool':
      if (!m.toolCallId) {
        throw new Error('tool message is missing toolCallId');
      }
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
}

export function toWireTool(t: ToolSpec): ChatCompletionTool {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

/**
 * Models sometimes emit tool arguments that are not valid JSON. Keep the raw text
 * visible in the trace instead of dropping it. The tool then reports the missing
 * argument, and the model gets a chance to retry.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { __invalid_json: raw };
  } catch {
    return { __invalid_json: raw };
  }
}

export class OpenRouterAdapter implements ModelAdapter {
  readonly id = 'openrouter';
  private readonly client: OpenAI;

  constructor(opts: OpenRouterOptions) {
    if (!opts.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set (add it to .env)');
    }
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? OPENROUTER_BASE_URL,
      timeout: opts.timeoutMs ?? 60_000,
      maxRetries: opts.maxRetries ?? 2,
      fetch: opts.fetch,
      defaultHeaders: { 'X-Title': opts.appTitle ?? 'agent-evals' },
    });
  }

  async complete(modelId: string, req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.chat.completions.create({
      model: modelId,
      messages: req.messages.map(toWireMessage),
      ...(req.tools && req.tools.length > 0 ? { tools: req.tools.map(toWireTool) } : {}),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      ...(req.stop && req.stop.length > 0 ? { stop: req.stop } : {}),
    });

    const choice = res.choices[0];
    if (!choice) {
      throw new Error('openrouter returned no choices');
    }

    const toolCalls: ToolCall[] = [];
    for (const tc of choice.message.tool_calls ?? []) {
      if (tc.type === 'function') {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: parseToolArguments(tc.function.arguments),
        });
      }
    }

    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      },
      raw: res,
    };
  }
}
