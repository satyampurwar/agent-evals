<!--
  Route: /experiments/:id — live status, start button, trial table, CSV export.

  `defineProps` receives `:id` from the router (`props: true` in router.ts).
  While status is "running", a timer polls the API; `onBeforeUnmount` clears it
  so navigation away does not leak intervals.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { Config, Experiment } from '@agent-evals/domain';
import { api, type ExperimentStatus, type TrialView } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { TRIAL_CSV_COLUMNS, toCsv, trialCsvRows } from '../lib/csv';
import { count, ms, shortId, when } from '../lib/format';
import { OUTCOME_TEXT, outcomeOf } from '../lib/trial';

const props = defineProps<{ id: string }>();

const POLL_MS = 3000;

const experiment = ref<Experiment | null>(null);
const status = ref<ExperimentStatus | null>(null);
const trials = ref<TrialView[]>([]);
const configs = ref<Config[]>([]);
const error = ref<string | null>(null);
const starting = ref(false);
const startNotice = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | undefined;

const configName = computed(() => {
  const map = new Map(configs.value.map((c) => [c.id, `${c.name} v${c.version}`]));
  return (id: string) => map.get(id) ?? shortId(id);
});

const canStart = computed(() => status.value?.status === 'pending');
const isRunning = computed(() => status.value?.status === 'running');
const compareLink = computed(() => (experiment.value?.configIds.length ?? 0) >= 2);

async function refresh() {
  try {
    const [exp, st, list] = await Promise.all([
      api.getExperiment(props.id),
      api.experimentStatus(props.id),
      api.listTrials(props.id),
    ]);
    experiment.value = exp;
    status.value = st;
    trials.value = list;
    error.value = null;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function start() {
  starting.value = true;
  startNotice.value = null;
  try {
    const res = await api.startExperiment(props.id);
    startNotice.value = `Queued ${res.queued} trial(s).`;
    await refresh();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    starting.value = false;
  }
}

function exportCsv() {
  const csv = toCsv(TRIAL_CSV_COLUMNS, trialCsvRows(trials.value));
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `experiment-${shortId(props.id)}-trials.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function startPolling() {
  stopPolling();
  timer = setInterval(() => {
    if (isRunning.value) void refresh();
  }, POLL_MS);
}

function stopPolling() {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

onMounted(async () => {
  try {
    configs.value = await api.listConfigs();
  } catch (err) {
    error.value = errorMessage(err);
  }
  await refresh();
  startPolling();
});

watch(
  () => props.id,
  async () => {
    await refresh();
  },
);

onBeforeUnmount(stopPolling);
</script>

<template>
  <p v-if="error" class="error">{{ error }}</p>

  <template v-if="experiment && status">
    <h1>{{ experiment.name }}</h1>
    <p v-if="experiment.hypothesis" class="muted">Hypothesis: {{ experiment.hypothesis }}</p>

    <div class="panel">
      <dl class="kv">
        <dt>Status</dt>
        <dd>
          <span class="badge">{{ status.status }}</span>
          <span v-if="isRunning" class="muted"> refreshing every 3 s</span>
        </dd>
        <dt>Created</dt>
        <dd>{{ when(experiment.createdAt) }}</dd>
        <dt>Trials</dt>
        <dd>
          {{ status.trials.total }} total · {{ status.trials.queued }} queued · {{ status.trials.running }} running ·
          {{ status.trials.succeeded }} succeeded · {{ status.trials.timeout }} timed out ·
          {{ status.trials.failed }} infrastructure failed · {{ status.trials.cancelled }} cancelled
        </dd>
        <dt>Configs</dt>
        <dd>{{ experiment.configIds.map(configName).join(', ') }}</dd>
        <dt>Tasks</dt>
        <dd>{{ experiment.taskIds.length }} · {{ experiment.nTrials }} trial(s) per cell</dd>
      </dl>
      <div class="actions">
        <button :disabled="!canStart || starting" @click="start">{{ starting ? 'Starting…' : 'Start' }}</button>
        <button class="secondary" :disabled="!trials.length" @click="exportCsv">Export CSV</button>
        <RouterLink v-if="compareLink" :to="{ name: 'compare', params: { id: experiment.id } }">Compare configs →</RouterLink>
        <span v-if="startNotice" class="notice">{{ startNotice }}</span>
      </div>
    </div>

    <h2>Trials</h2>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Config</th>
            <th class="num">#</th>
            <th>Outcome</th>
            <th class="num">Latency</th>
            <th class="num">Tokens</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in trials" :key="t.id">
            <td>
              <RouterLink :to="{ name: 'trial', params: { id: t.id } }"><code>{{ t.taskId }}</code></RouterLink>
              <span class="muted"> v{{ t.taskVersion }}</span>
            </td>
            <td>{{ configName(t.configId) }}</td>
            <td class="num">{{ t.trialIndex }}</td>
            <td>
              <span class="badge" :class="outcomeOf(t)">{{ OUTCOME_TEXT[outcomeOf(t)] }}</span>
            </td>
            <td class="num">{{ ms(t.metrics.latencyMs) }}</td>
            <td class="num">{{ count(t.metrics.totalTokens) }}</td>
            <td class="muted">{{ t.error?.code ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!trials.length" class="muted">No trials yet. Press Start to queue them.</p>
    </div>
  </template>
</template>
