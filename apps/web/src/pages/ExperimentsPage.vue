<!--
  Route: /experiments — list experiments and create a new A×B×N trial matrix.

  An experiment picks task ids × config ids × nTrials. After create, the router
  navigates to the detail page. `computed` derives planned trial count and the
  latest-version task picker from reactive form state.
-->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import type { Config, Experiment } from '@agent-evals/domain';
import { api, type TaskRow } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { buildExperimentInput, MAX_PLANNED_TRIALS, selectionState, toggleAll } from '../lib/forms';
import { when } from '../lib/format';

const router = useRouter();

const experiments = ref<Experiment[]>([]);
const tasks = ref<TaskRow[]>([]);
const configs = ref<Config[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const form = reactive({ name: '', hypothesis: '', taskIds: [] as string[], configIds: [] as string[], nTrials: 1 });
const errors = ref<string[]>([]);
const submitError = ref<string | null>(null);
const saving = ref(false);

/** The API pins the latest version of each task, so the picker offers one row per task id. */
const taskChoices = computed(() => {
  const latest = new Map<string, TaskRow>();
  for (const row of tasks.value) {
    const seen = latest.get(row.id);
    if (!seen || row.createdAt > seen.createdAt) latest.set(row.id, row);
  }
  return [...latest.values()].sort((a, b) => a.id.localeCompare(b.id));
});

const planned = computed(() => form.taskIds.length * form.configIds.length * form.nTrials);

/** "Select all" reflects the task list: unchecked, partly checked (dash), or checked. */
const taskSelection = computed(() =>
  selectionState(
    form.taskIds,
    taskChoices.value.map((t) => t.id),
  ),
);

function toggleAllTasks() {
  form.taskIds = toggleAll(
    form.taskIds,
    taskChoices.value.map((t) => t.id),
  );
}

async function load() {
  loading.value = true;
  try {
    [experiments.value, tasks.value, configs.value] = await Promise.all([
      api.listExperiments(),
      api.listTasks(),
      api.listConfigs(),
    ]);
    loadError.value = null;
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function toggle(list: string[], value: string) {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
}

async function create() {
  errors.value = [];
  submitError.value = null;
  const built = buildExperimentInput(form);
  if (!built.ok) {
    errors.value = built.errors;
    return;
  }
  saving.value = true;
  try {
    const created = await api.createExperiment(built.input);
    // Creating does not start anything. The detail page has the Start button.
    await router.push({ name: 'experiment', params: { id: created.id } });
  } catch (err) {
    submitError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1>Experiments</h1>
  <p v-if="loading" class="muted">Loading…</p>
  <p v-if="loadError" class="error">{{ loadError }}</p>

  <div v-if="!loading && !loadError" class="grid-2">
    <section>
      <h2 style="margin-top: 0">Recent experiments</h2>
      <div class="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th class="num">Tasks</th>
              <th class="num">Configs</th>
              <th class="num">Trials per cell</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in experiments" :key="e.id">
              <td><RouterLink :to="{ name: 'experiment', params: { id: e.id } }">{{ e.name }}</RouterLink></td>
              <td><span class="badge">{{ e.status }}</span></td>
              <td class="num">{{ e.taskIds.length }}</td>
              <td class="num">{{ e.configIds.length }}</td>
              <td class="num">{{ e.nTrials }}</td>
              <td class="muted">{{ when(e.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!experiments.length" class="muted">No experiments yet. Create one on the right.</p>
      </div>
    </section>

    <section>
      <h2 style="margin-top: 0">New experiment</h2>
      <div class="panel">
        <label for="exp-name">Name</label>
        <input id="exp-name" v-model="form.name" type="text" />

        <label for="exp-hyp">Hypothesis (optional)</label>
        <input id="exp-hyp" v-model="form.hypothesis" type="text" />

        <label>Tasks</label>
        <div class="checklist">
          <label v-if="taskChoices.length" class="select-all">
            <input
              type="checkbox"
              :checked="taskSelection === 'all'"
              :indeterminate="taskSelection === 'some'"
              @change="toggleAllTasks"
            />
            <strong>Select all</strong>
            <span class="muted">({{ form.taskIds.length }} of {{ taskChoices.length }} selected)</span>
          </label>
          <label v-for="t in taskChoices" :key="t.id">
            <input type="checkbox" :checked="form.taskIds.includes(t.id)" @change="toggle(form.taskIds, t.id)" />
            <code>{{ t.id }}</code>
            <span class="muted">v{{ t.version }}</span>
          </label>
          <p v-if="!taskChoices.length" class="muted">No tasks. Seed them with npm run seed:tasks.</p>
        </div>

        <label>Configs</label>
        <div class="checklist">
          <label v-for="c in configs" :key="c.id">
            <input type="checkbox" :checked="form.configIds.includes(c.id)" @change="toggle(form.configIds, c.id)" />
            {{ c.name }} <span class="muted">v{{ c.version }}</span>
          </label>
          <p v-if="!configs.length" class="muted">No configs. Create one on the Configs page.</p>
        </div>

        <label for="exp-n">Trials per task and config</label>
        <input id="exp-n" v-model.number="form.nTrials" type="number" min="1" max="1000" />

        <p class="muted">
          This will create {{ planned }} trial(s). The limit is {{ MAX_PLANNED_TRIALS }}.
        </p>

        <div class="actions">
          <button :disabled="saving" @click="create">{{ saving ? 'Creating…' : 'Create experiment' }}</button>
        </div>
        <div v-if="errors.length" class="error">{{ errors.join('\n') }}</div>
        <div v-if="submitError" class="error">{{ submitError }}</div>
      </div>
    </section>
  </div>
</template>
