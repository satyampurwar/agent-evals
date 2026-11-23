<!--
  Route: /trials/:id — single trial detail: outcome, metrics, grader notes, trace timeline.

  Loads trial + optional trace from the API. Local notes are stored in
  localStorage only (never sent to the server). `timeline()` turns TraceEvent[]
  into display rows.
-->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { Trace } from '@agent-evals/domain';
import { api, type TrialView } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { count, ms, shortId, when } from '../lib/format';
import { timeline } from '../lib/trace';
import { OUTCOME_TEXT, outcomeOf } from '../lib/trial';

const props = defineProps<{ id: string }>();

const trial = ref<TrialView | null>(null);
const trace = ref<Trace | null>(null);
const traceNote = ref<string | null>(null);
const error = ref<string | null>(null);
const notes = ref('');

/** Notes stay in this browser, keyed by trial id. They are not sent to the API. */
const notesKey = (id: string) => `trial-notes:${id}`;

function loadNotes() {
  notes.value = localStorage.getItem(notesKey(props.id)) ?? '';
}

/** Saves on input, not in a watcher, so text can only land under the trial that was on screen. */
function onNotesInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  notes.value = value;
  localStorage.setItem(notesKey(props.id), value);
}

async function load() {
  error.value = null;
  trace.value = null;
  traceNote.value = null;
  loadNotes();
  try {
    trial.value = await api.getTrial(props.id);
  } catch (err) {
    error.value = errorMessage(err);
    return;
  }
  if (!trial.value.hasTrace) {
    traceNote.value = 'No trace has been recorded for this trial yet.';
    return;
  }
  try {
    trace.value = await api.getTrace(props.id);
  } catch (err) {
    traceNote.value = `Trace could not be loaded: ${errorMessage(err)}`;
  }
}

function json(x: unknown): string {
  return JSON.stringify(x, null, 2) ?? 'undefined';
}

onMounted(load);
watch(() => props.id, load);
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <template v-if="trial">
    <p>
      <RouterLink :to="{ name: 'experiment', params: { id: trial.experimentId } }">← Back to experiment</RouterLink>
    </p>
    <h1>
      Trial {{ trial.trialIndex }} · <code>{{ trial.taskId }}</code>
      <span class="muted">v{{ trial.taskVersion }}</span>
    </h1>

    <div class="grid-2">
      <section class="panel">
        <h2 style="margin-top: 0">Outcome</h2>
        <dl class="kv">
          <dt>Result</dt>
          <dd>
            <span class="badge" :class="outcomeOf(trial)">{{ OUTCOME_TEXT[outcomeOf(trial)] }}</span>
          </dd>
          <dt>Passed</dt>
          <dd>{{ trial.passed === null ? '—' : String(trial.passed) }}</dd>
          <dt>Score</dt>
          <dd>{{ trial.score ?? '—' }}</dd>
          <dt>Config</dt>
          <dd><code>{{ shortId(trial.configId) }}</code></dd>
          <dt>Seed</dt>
          <dd>{{ trial.seed }}</dd>
          <dt>Started</dt>
          <dd>{{ when(trial.startedAt) }}</dd>
          <dt>Finished</dt>
          <dd>{{ when(trial.finishedAt) }}</dd>
        </dl>
        <div v-if="trial.error" class="error">
          <strong>{{ trial.error.code }}</strong> {{ trial.error.message }}
          <span class="muted"> (retryable: {{ trial.error.retryable }})</span>
        </div>
      </section>

      <section class="panel">
        <h2 style="margin-top: 0">Metrics</h2>
        <dl class="kv">
          <dt>Latency</dt>
          <dd>{{ ms(trial.metrics.latencyMs) }}</dd>
          <dt>Prompt tokens</dt>
          <dd>{{ count(trial.metrics.promptTokens) }}</dd>
          <dt>Completion tokens</dt>
          <dd>{{ count(trial.metrics.completionTokens) }}</dd>
          <dt>Total tokens</dt>
          <dd>{{ count(trial.metrics.totalTokens) }}</dd>
          <dt>Steps</dt>
          <dd>{{ count(trial.metrics.stepCount) }}</dd>
        </dl>
        <p class="muted">Judge tokens are not included here. They appear under the grader details below.</p>
      </section>
    </div>

    <section class="panel">
      <h2 style="margin-top: 0">Grader results</h2>
      <p v-if="!trial.grade" class="muted">No grade. The trial did not reach the graders.</p>
      <template v-else>
        <p>
          Overall: <span class="badge" :class="trial.grade.passed ? 'passed' : 'failed'">{{ trial.grade.passed ? 'pass' : 'fail' }}</span>
          <span class="muted"> score {{ trial.grade.score }} · aggregate {{ trial.grade.aggregatePolicy }}</span>
        </p>
        <div v-for="(g, i) in trial.grade.graderResults" :key="i" class="panel" style="margin-bottom: 0.75rem">
          <strong>{{ g.graderType }}</strong>
          <span class="badge" :class="g.passed ? 'passed' : 'failed'" style="margin-left: 0.5rem">{{ g.passed ? 'pass' : 'fail' }}</span>
          <span class="muted"> score {{ g.score }}</span>
          <p v-if="g.reasoning"><strong>Reasoning.</strong> {{ g.reasoning }}</p>
          <details v-if="g.details">
            <summary class="muted">Details</summary>
            <pre>{{ json(g.details) }}</pre>
          </details>
        </div>
      </template>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Agent's final answer</h2>
      <pre v-if="trace?.finalAnswer">{{ trace.finalAnswer }}</pre>
      <p v-else class="muted">{{ traceNote ?? 'No final answer recorded.' }}</p>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Trace</h2>
      <p v-if="traceNote && !trace" class="muted">{{ traceNote }}</p>
      <ol v-if="trace" class="timeline" style="padding: 0">
        <li v-for="row in timeline(trace.events)" :key="row.index" :class="row.tone">
          <div class="head">
            <span class="time">{{ row.offsetMs === null ? '' : `+${(row.offsetMs / 1000).toFixed(2)} s` }}</span>
            <strong>{{ row.label }}</strong>
          </div>
          <pre v-if="row.detail">{{ row.detail }}</pre>
        </li>
      </ol>
      <p v-if="trace && !trace.events.length" class="muted">The trace has no events.</p>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Your notes</h2>
      <p class="muted">
        For the failed-trial drill: write what the agent did wrong. Notes are saved in this browser only.
      </p>
      <textarea :value="notes" placeholder="1. …&#10;2. …&#10;3. …" @input="onNotesInput"></textarea>
    </section>
  </template>
</template>
