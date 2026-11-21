import type { TraceEvent } from '@agent-evals/domain';

export type Tone = 'user' | 'assistant' | 'tool' | 'memory' | 'skill' | 'step' | 'error';

export interface TimelineRow {
  index: number;
  /** Milliseconds since the first event. Null when the timestamp does not parse. */
  offsetMs: number | null;
  label: string;
  detail: string;
  tone: Tone;
}

const DETAIL_LIMIT = 1200;

function clip(text: string): string {
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}… (${text.length} chars)` : text;
}

function json(x: unknown): string {
  try {
    return JSON.stringify(x) ?? 'undefined';
  } catch {
    return String(x);
  }
}

function describe(event: TraceEvent): Omit<TimelineRow, 'index' | 'offsetMs'> {
  switch (event.type) {
    case 'message':
      return { label: `${event.role} message`, detail: clip(event.content), tone: event.role === 'user' ? 'user' : 'assistant' };
    case 'tool_call':
      return { label: `tool call: ${event.name}`, detail: clip(json(event.args)), tone: 'tool' };
    case 'tool_result':
      return {
        label: event.ok ? 'tool result' : 'tool result (refused or failed)',
        detail: clip(json(event.result)),
        tone: event.ok ? 'tool' : 'error',
      };
    case 'memory_read':
      return { label: 'memory read', detail: `query "${event.query}" → ${event.hits.length} hit(s) ${clip(json(event.hits))}`, tone: 'memory' };
    case 'memory_write':
      return { label: 'memory write', detail: `${event.key} = ${clip(json(event.value))}`, tone: 'memory' };
    case 'skill_invoke':
      return { label: `skill: ${event.skillId}`, detail: event.input === undefined ? '' : clip(json(event.input)), tone: 'skill' };
    case 'step_boundary':
      return { label: `step ${event.step}`, detail: '', tone: 'step' };
    case 'error':
      return { label: `error${event.code ? ` (${event.code})` : ''}`, detail: clip(event.message), tone: 'error' };
  }
}

/** One row per trace event, in order, with the time offset from the first event. */
export function timeline(events: readonly TraceEvent[]): TimelineRow[] {
  const origin = events.length ? Date.parse(events[0]!.ts) : NaN;
  return events.map((event, index) => {
    const at = Date.parse(event.ts);
    const offsetMs = Number.isNaN(at) || Number.isNaN(origin) ? null : at - origin;
    return { index, offsetMs, ...describe(event) };
  });
}
