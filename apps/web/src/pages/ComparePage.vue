<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { Config, Experiment } from '@agent-evals/domain';
import { api, type CompareView } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { count, interval, ms, pct, pts, pValue, usd, VERDICT_TEXT, VERDICT_TONE } from '../lib/format';

const props = defineProps<{ id: string }>();

const experiment = ref<Experiment | null>(null);
const configs = ref<Config[]>([]);
const a = ref('');
const b = ref('');
const result = ref<CompareView | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const label = computed(() => {
  const map = new Map(configs.value.map((c) => [c.id, `${c.name} v${c.version}`]));
  return (id: string) => map.get(id) ?? id.slice(0, 8);
});

const sameConfig = computed(() => a.value !== '' && a.value === b.value);

async function load() {
  try {
    [experiment.value, configs.value] = await Promise.all([api.getExperiment(props.id), api.listConfigs()]);
    const ids = experiment.value.configIds;
    a.value = ids[0] ?? '';
    b.value = ids[1] ?? '';
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function run() {
  if (!a.value || !b.value || sameConfig.value) return;
  loading.value = true;
  error.value = null;
  try {
    result.value = await api.compare(props.id, a.value, b.value);
  } catch (err) {
    result.value = null;
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function deltaTone(delta: number): string {
  if (delta > 0) return 'good';
  if (delta < 0) return 'bad';
  return 'muted';
}

onMounted(load);
</script>

<template>
  <p><RouterLink :to="{ name: 'experiment', params: { id: props.id } }">← Back to experiment</RouterLink></p>
  <h1>Compare configs</h1>
  <p v-if="experiment" class="muted">{{ experiment.name }}</p>

  <div class="panel">
    <div class="grid-2">
      <div>
        <label for="cmp-a">Config A</label>
        <select id="cmp-a" v-model="a">
          <option v-for="id in experiment?.configIds ?? []" :key="id" :value="id">{{ label(id) }}</option>
        </select>
      </div>
      <div>
        <label for="cmp-b">Config B</label>
        <select id="cmp-b" v-model="b">
          <option v-for="id in experiment?.configIds ?? []" :key="id" :value="id">{{ label(id) }}</option>
        </select>
      </div>
    </div>
    <div class="actions">
      <button :disabled="loading || !a || !b || sameConfig" @click="run">
        {{ loading ? 'Comparing…' : 'Compare' }}
      </button>
      <span v-if="sameConfig" class="error">Pick two different configs.</span>
      <span class="muted">Delta is A minus B. Positive means A is better.</span>
    </div>
  </div>

  <p v-if="error" class="error">{{ error }}</p>

  <template v-if="result">
    <div class="panel">
      <div class="actions" style="margin-top: 0">
        <span class="badge" :class="VERDICT_TONE[result.verdict]">{{ VERDICT_TEXT[result.verdict] }}</span>
        <span v-if="result.noise" class="badge noise">noise: the 95% interval includes 0</span>
        <span class="muted">{{ result.commonTasks }} common task(s) · {{ result.pairedTrials }} paired trial(s)</span>
      </div>
      <p v-for="note in result.notes" :key="note" class="muted">{{ note }}</p>
    </div>

    <div class="grid-2">
      <section class="panel">
        <h2 style="margin-top: 0">A: {{ label(result.a.configId) }}</h2>
        <dl class="kv">
          <dt>Macro pass rate</dt>
          <dd>{{ pct(result.a.passRate, 1) }} <span class="muted">{{ interval(result.a.passRateCI) }}</span></dd>
          <dt>Scored trials</dt>
          <dd>{{ result.a.scoredTrials }}</dd>
          <dt>Excluded</dt>
          <dd>{{ result.a.excluded.failed }} infra · {{ result.a.excluded.cancelled }} cancelled · {{ result.a.excluded.pending }} pending</dd>
          <dt>Mean latency</dt>
          <dd>{{ ms(result.a.meanLatencyMs) }}</dd>
          <dt>Mean tokens</dt>
          <dd>{{ count(result.a.meanTotalTokens) }}</dd>
          <dt>Mean cost</dt>
          <dd>{{ usd(result.a.meanCostUsd) }}</dd>
        </dl>
      </section>

      <section class="panel">
        <h2 style="margin-top: 0">B: {{ label(result.b.configId) }}</h2>
        <dl class="kv">
          <dt>Macro pass rate</dt>
          <dd>{{ pct(result.b.passRate, 1) }} <span class="muted">{{ interval(result.b.passRateCI) }}</span></dd>
          <dt>Scored trials</dt>
          <dd>{{ result.b.scoredTrials }}</dd>
          <dt>Excluded</dt>
          <dd>{{ result.b.excluded.failed }} infra · {{ result.b.excluded.cancelled }} cancelled · {{ result.b.excluded.pending }} pending</dd>
          <dt>Mean latency</dt>
          <dd>{{ ms(result.b.meanLatencyMs) }}</dd>
          <dt>Mean tokens</dt>
          <dd>{{ count(result.b.meanTotalTokens) }}</dd>
          <dt>Mean cost</dt>
          <dd>{{ usd(result.b.meanCostUsd) }}</dd>
        </dl>
      </section>
    </div>

    <div class="panel">
      <h2 style="margin-top: 0">Difference (A minus B)</h2>
      <dl class="kv">
        <dt>Delta</dt>
        <dd :class="deltaTone(result.delta.value)"><strong>{{ pts(result.delta.value) }}</strong></dd>
        <dt>95% interval (tasks resampled)</dt>
        <dd>{{ interval(result.delta.ci) }}</dd>
        <dt>McNemar p-value</dt>
        <dd>{{ pValue(result.delta.pValue) }} <span class="muted">(trials treated as independent, so optimistic)</span></dd>
        <dt>Discordant trials</dt>
        <dd>A only: {{ result.delta.discordant.aOnly }} · B only: {{ result.delta.discordant.bOnly }}</dd>
      </dl>
    </div>

    <div class="panel">
      <h2 style="margin-top: 0">Per task</h2>
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th class="num">Trials A</th>
            <th class="num">Trials B</th>
            <th class="num">Pass A</th>
            <th class="num">Pass B</th>
            <th class="num">Delta</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in result.perTask" :key="t.taskId">
            <td><code>{{ t.taskId }}</code></td>
            <td class="num">{{ t.trialsA }}</td>
            <td class="num">{{ t.trialsB }}</td>
            <td class="num">{{ pct(t.passRateA) }}</td>
            <td class="num">{{ pct(t.passRateB) }}</td>
            <td class="num" :class="deltaTone(t.delta)">{{ pts(t.delta) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">
        Per-task deltas are descriptive. Each task has few trials, and there is no per-task significance test.
      </p>
    </div>
  </template>
</template>
