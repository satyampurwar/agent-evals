/**
 * `@agent-evals/adapters-model` — LLM provider adapters (`ModelAdapter`) used by harnesses and
 * the LLM judge. Production code typically uses OpenRouter; tests use mock / scripted adapters.
 */

export type {
  ChatMessage,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolSpec,
} from './types.js';
export { MockModelAdapter } from './mock.js';
export { ScriptedModelAdapter } from './scripted.js';
export { OpenRouterAdapter, OPENROUTER_BASE_URL, parseToolArguments, toWireMessage, toWireTool } from './openrouter.js';
export type { OpenRouterOptions } from './openrouter.js';
export { createModelAdapter, parseModelSpec } from './registry.js';
export type { ModelSpec } from './registry.js';
