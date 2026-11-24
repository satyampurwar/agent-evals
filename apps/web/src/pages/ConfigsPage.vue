<!--
  Route: /configs — create and list immutable agent configs.

  A config is the treatment arm: harness (baseline | hermes), OpenRouter model
  (dropdown from priced MODEL_IDS), temperature, memory, tools/skills, budgets.
  Identical content returns the existing row (content hash); any change is a new
  version. Validation: `buildConfigInput` in lib/forms.ts → POST /configs.
-->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { Config } from '@agent-evals/domain';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { BASE_TOOLS, HARNESS_IDS, MODEL_IDS, SKILL_IDS, buildConfigInput, defaultConfigForm } from '../lib/forms';
import { shortId } from '../lib/format';

const configs = ref<Config[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const form = reactive(defaultConfigForm());
const errors = ref<string[]>([]);
const submitError = ref<string | null>(null);
const notice = ref<string | null>(null);
const saving = ref(false);

async function load() {
  loading.value = true;
  try {
    configs.value = await api.listConfigs();
    loadError.value = null;
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function save() {
  errors.value = [];
  submitError.value = null;
  notice.value = null;
  const built = buildConfigInput(form);
  if (!built.ok) {
    errors.value = built.errors;
    return;
  }
  saving.value = true;
  try {
    const { status, data } = await api.createConfig(built.input);
    notice.value =
      status === 201
        ? `Created ${data.name} version ${data.version}.`
        : `An identical config already exists as ${data.name} version ${data.version}. Nothing new was created.`;
    await load();
  } catch (err) {
    submitError.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}

function toggle(list: string[], value: string) {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
}

onMounted(load);
</script>

<template>
  <h1>Configs</h1>
  <p class="muted">
    A config is immutable. Changing any setting creates a new version. Saving the same settings again
    returns the existing version.
  </p>

  <div class="grid-2">
    <section class="panel">
      <h2 style="margin-top: 0">New config</h2>

      <label for="cfg-name">Name</label>
      <input id="cfg-name" v-model="form.name" type="text" placeholder="baseline-gpt-mini" />

      <label for="cfg-harness">Harness</label>
      <select id="cfg-harness" v-model="form.harnessId">
        <option v-for="id in HARNESS_IDS" :key="id" :value="id">{{ id }}</option>
      </select>
      <p v-if="form.harnessId === 'hermes'" class="muted">
        Hermes runs in the Python worker. Skills below are mapped to tools for baseline only; Hermes ignores skill ids.
      </p>
      <p v-if="form.harnessId === 'claude-agent'" class="muted">
        Claude Agent SDK runs Claude Code through OpenRouter. It is only dependable with Anthropic models, and only on
        Anthropic's own provider. Other models are best effort: tool calling may behave differently, so a lower score
        may reflect the harness and not the model. Use baseline or hermes to compare models.
      </p>

      <label for="cfg-model">Model (OpenRouter)</label>
      <select id="cfg-model" v-model="form.modelId">
        <option v-for="id in MODEL_IDS" :key="id" :value="id">{{ id }}</option>
      </select>
      <p class="muted">Priced models from <code>prices.json</code>. Add a price entry before offering a new id.</p>

      <label for="cfg-temp">Temperature (0 to 2)</label>
      <input id="cfg-temp" v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" />

      <h2>Memory and skills</h2>
      <label class="inline"><input v-model="form.memoryEnabled" type="checkbox" /> Memory on (adds memory_read and memory_write)</label>
      <div>
        <span class="muted">Skills (baseline maps these to tools; Hermes ignores them)</span>
        <div>
          <label v-for="skill in SKILL_IDS" :key="skill" class="inline">
            <input
              type="checkbox"
              :checked="form.skillsEnabled.includes(skill)"
              @change="toggle(form.skillsEnabled, skill)"
            />
            {{ skill }}
          </label>
        </div>
      </div>
      <div>
        <span class="muted">Base tools</span>
        <div>
          <label v-for="tool in BASE_TOOLS" :key="tool" class="inline">
            <input type="checkbox" :checked="form.tools.includes(tool)" @change="toggle(form.tools, tool)" />
            {{ tool }}
          </label>
        </div>
      </div>

      <h2>Budgets</h2>
      <div class="grid-2">
        <div>
          <label for="cfg-steps">Max steps</label>
          <input id="cfg-steps" v-model.number="form.maxSteps" type="number" min="1" max="50" />
        </div>
        <div>
          <label for="cfg-tokens">Max tokens</label>
          <input id="cfg-tokens" v-model.number="form.maxTokens" type="number" min="1" />
        </div>
      </div>
      <label for="cfg-timeout">Timeout (ms)</label>
      <input id="cfg-timeout" v-model.number="form.timeoutMs" type="number" min="1000" max="600000" />

      <div class="actions">
        <button :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save config' }}</button>
      </div>
      <div v-if="errors.length" class="error">{{ errors.join('\n') }}</div>
      <div v-if="submitError" class="error">{{ submitError }}</div>
      <div v-if="notice" class="notice">{{ notice }}</div>
    </section>

    <section>
      <h2 style="margin-top: 0">Saved configs</h2>
      <p v-if="loading" class="muted">Loading…</p>
      <p v-if="loadError" class="error">{{ loadError }}</p>
      <div v-if="!loading && !loadError" class="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Harness</th>
              <th>Model</th>
              <th class="num">Temp</th>
              <th>Memory</th>
              <th>Skills</th>
              <th>Tools</th>
              <th class="num">Steps</th>
              <th class="num">Tokens</th>
              <th class="num">Timeout</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in configs" :key="c.id">
              <td>{{ c.name }}</td>
              <td>{{ c.version }}</td>
              <td><code>{{ c.harness.id }}</code></td>
              <td><code>{{ c.model.modelId }}</code></td>
              <td class="num">{{ c.model.temperature }}</td>
              <td>
                <span class="badge" :class="c.harness.settings.memory.enabled ? 'good' : ''">
                  {{ c.harness.settings.memory.enabled ? 'on' : 'off' }}
                </span>
              </td>
              <td>{{ c.harness.settings.skillsEnabled.join(', ') || '—' }}</td>
              <td>{{ c.harness.settings.tools.join(', ') || '—' }}</td>
              <td class="num">{{ c.harness.settings.maxSteps }}</td>
              <td class="num">{{ c.harness.settings.maxTokens }}</td>
              <td class="num">{{ c.harness.settings.timeoutMs }}</td>
              <td><code :title="c.id">{{ shortId(c.contentHash) }}</code></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!configs.length" class="muted">No configs yet.</p>
      </div>
    </section>
  </div>
</template>
