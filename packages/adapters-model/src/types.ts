// Model adapter interface from implementation.md §6.1.

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: ToolCall[];
}

export interface ModelRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature: number;
  maxTokens: number;
  stop?: string[];
}

export interface ModelResponse {
  message: ChatMessage;
  usage: { promptTokens: number; completionTokens: number };
  raw?: unknown;
}

export interface ModelAdapter {
  readonly id: string;
  complete(modelId: string, req: ModelRequest): Promise<ModelResponse>;
}
