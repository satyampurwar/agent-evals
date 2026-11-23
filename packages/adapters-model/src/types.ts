/**
 * LLM provider interface for agent-evals (implementation.md §6.1).
 *
 * A **ModelAdapter** is the thin boundary between the agent loop (harness) and an LLM API.
 * The harness builds a chat history, optionally offers tools (JSON-schema function specs), and
 * calls `complete`. The adapter returns the assistant message — plain text and/or tool calls —
 * plus token usage for cost metering.
 *
 * In a tool-calling agent: model → (optional) tool calls → harness runs tools → results go back
 * into the conversation → model again. Different providers implement the same interface so configs
 * can swap `openrouter` / `mock` / `scripted` without changing the harness.
 */

/** One function call the model wants the harness to execute. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Tool description sent to the model (OpenAI-style function schema). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

/** One turn in the chat history, including tool results (`role: 'tool'`). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCall[];
}

/** Request payload for one model completion. */
export interface ModelRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature: number;
  maxTokens: number;
  stop?: string[];
  /** 'json' asks the provider for a JSON object reply (used by the LLM judge). */
  responseFormat?: 'json';
}

/** Normalized reply from any provider, including usage for cost metering. */
export interface ModelResponse {
  message: ChatMessage;
  usage: { promptTokens: number; completionTokens: number };
  raw?: unknown;
}

/**
 * Provider-agnostic LLM client. `id` is the provider name (e.g. `"openrouter"`);
 * `modelId` on each call selects the concrete model (e.g. `"openai/gpt-4.1-mini"`).
 */
export interface ModelAdapter {
  readonly id: string;
  complete(modelId: string, req: ModelRequest): Promise<ModelResponse>;
}
