/**
 * `@agent-evals/trace` — in-memory append-only event buffer for one trial.
 *
 * Harnesses emit `TraceEvent`s (messages, tool calls, memory, errors) via
 * `TrialContext.emit`. After the run, the Nest worker serializes a `Trace` and
 * writes it under `data/traces/<experimentId>/<trialId>.json` (see TraceStore).
 */

import { TraceSchema } from '@agent-evals/domain';
import type { Trace, TraceEvent } from '@agent-evals/domain';

/** In-memory sink the harness writes to via `TrialContext.emit`. */
export interface TraceBuffer {
  /** Live event list (append-only via `emit`). */
  readonly events: TraceEvent[];
  emit: (event: TraceEvent) => void;
  /** Copy of events so far; later emits do not mutate it. */
  snapshot: () => TraceEvent[];
}

/** Creates an empty buffer for one trial. */
export function createTraceBuffer(): TraceBuffer {
  const events: TraceEvent[] = [];
  return {
    events,
    emit: (event) => {
      events.push(event);
    },
    snapshot: () => events.map((e) => ({ ...e })),
  };
}

/** Pretty-print a trace for storage or debugging. */
export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

/** Parses and validates; throws ZodError on malformed traces. */
export function deserializeTrace(json: string): Trace {
  return TraceSchema.parse(JSON.parse(json));
}
