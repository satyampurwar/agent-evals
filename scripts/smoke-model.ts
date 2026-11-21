/**
 * Phase 5 smoke test: one live call to OpenRouter.
 * Prints the reply, token usage and latency. Reads OPENROUTER_API_KEY from .env.
 *
 * Usage: npx tsx scripts/smoke-model.ts [modelId]
 */
import { OpenRouterAdapter } from '@agent-evals/adapters-model';
import { loadDotEnv } from './lib/env';

async function main() {
  loadDotEnv();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is not set. Add it to .env (see .env.example).');
    process.exit(2);
  }

  const modelId = process.argv[2] ?? 'openai/gpt-4.1-mini';
  const model = new OpenRouterAdapter({ apiKey });

  const started = Date.now();
  const res = await model.complete(modelId, {
    messages: [{ role: 'user', content: 'In one short sentence, what is the capital of France?' }],
    temperature: 0,
    maxTokens: 60,
  });
  const latencyMs = Date.now() - started;

  const { promptTokens, completionTokens } = res.usage;
  console.log(`model:   ${modelId}`);
  console.log(`reply:   ${res.message.content}`);
  console.log(`usage:   prompt=${promptTokens} completion=${completionTokens} total=${promptTokens + completionTokens}`);
  console.log(`latency: ${latencyMs} ms`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
