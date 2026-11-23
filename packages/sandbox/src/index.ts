/**
 * `@agent-evals/sandbox` — create an isolated temp directory per trial and safely resolve paths
 * inside it. Used by the runner (setup/cleanup), harness tools, and state-check graders.
 */

export { createSandbox, materializeFiles } from './sandbox.js';
export type { Sandbox } from './sandbox.js';
export { resolveInSandbox, SandboxPathError } from './paths.js';

