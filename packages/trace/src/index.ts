import { TraceSchema } from '@agent-evals/domain';
import type { Trace, TraceEvent } from '@agent-evals/domain';

export interface TraceBuffer {
  /** Live event list (append-only via `emit`). */
  readonly events: TraceEvent[];
  emit: (event: TraceEvent) => void;
  /** Copy of events so far; later emits do not mutate it. */
  snapshot: () => TraceEvent[];
}

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

export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

/** Parses and validates; throws ZodError on malformed traces. */
export function deserializeTrace(json: string): Trace {
  return TraceSchema.parse(JSON.parse(json));
}
