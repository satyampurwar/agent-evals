<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Task } from '@agent-evals/domain';
import { api, type TaskRow } from '../api/endpoints';
import { errorMessage } from '../api/client';

interface TaskLine {
  row: TaskRow;
  task: Task | null;
  error: string | null;
}

const lines = ref<TaskLine[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

/** Grader types of a task, each once, in the order they appear. */
function graderTypes(task: Task): string[] {
  return [...new Set(task.graders.map((g) => g.type))];
}

onMounted(async () => {
  try {
    const rows = await api.listTasks();
    // One document request per row. Tags and grader types live in the document, not the list.
    lines.value = await Promise.all(
      rows.map(async (row): Promise<TaskLine> => {
        try {
          return { row, task: await api.getTask(row.id, row.version), error: null };
        } catch (err) {
          return { row, task: null, error: errorMessage(err) };
        }
      }),
    );
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <h1>Tasks</h1>
  <p class="muted">
    Each row is one version of a task. A trial pins the latest version at the moment its experiment is
    created.
  </p>
  <p v-if="loading" class="muted">Loading…</p>
  <p v-if="error" class="error">{{ error }}</p>

  <div v-if="!loading && !error" class="panel">
    <table>
      <thead>
        <tr>
          <th>Task</th>
          <th>Version</th>
          <th>Name</th>
          <th>Tags</th>
          <th>Graders</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="line in lines" :key="`${line.row.id}@${line.row.version}`">
          <td><code>{{ line.row.id }}</code></td>
          <td>{{ line.row.version }}</td>
          <td>{{ line.task?.name ?? line.row.name }}</td>
          <td>
            <div v-if="line.task" class="chips">
              <span v-for="tag in line.task.tags" :key="tag" class="badge">{{ tag }}</span>
            </div>
            <span v-else class="muted">{{ line.error }}</span>
          </td>
          <td>
            <div v-if="line.task" class="chips">
              <span v-for="type in graderTypes(line.task)" :key="type" class="badge">{{ type }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="muted">{{ lines.length }} task version(s).</p>
  </div>
</template>
