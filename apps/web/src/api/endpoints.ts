/**
 * Typed facade over Nest REST routes used by the Vue pages.
 *
 * Each method maps to one API path (e.g. `listExperiments` → GET /experiments).
 * Pages import `api` and never build URLs by hand. Response shapes mirror the
 * domain packages (`@agent-evals/domain`, `@agent-evals/stats`) plus a few
 * view-only types defined below for list/status payloads.
 */
import type { Config, ConfigInput, Experiment, ExperimentInput, Task, Trace, GradeResult } from '@agent-evals/domain';
import type { CompareResult } from '@agent-evals/stats';
import { get, post, type ApiResponse } from './client';

/** One row of GET /tasks. A task id can have several versions, each a separate row. */
export interface TaskRow {
  id: string;
  version: string;
  name: string;
  contentHash: string;
  createdAt: string;
}

/** Trial as returned by GET /trials and GET /trials/:id (the entity without the experiment relation). */
export interface TrialView {
  id: string;
  experimentId: string;
  taskId: string;
  taskVersion: string;
  configId: string;
  configContentHash: string;
  trialIndex: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  seed: number;
  score: number | null;
  passed: boolean | null;
  metrics: Partial<{
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    stepCount: number;
  }>;
  grade: GradeResult | null;
  error: { code: string; message: string; retryable: boolean } | null;
  traceUri: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  hasTrace: boolean;
}

export interface TrialCounts {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  timeout: number;
  cancelled: number;
}

export interface ExperimentStatus {
  experimentId: string;
  status: Experiment['status'];
  trials: TrialCounts;
}

export interface StartResult extends Experiment {
  queued: number;
}

export type CompareView = CompareResult & { experimentId: string };

export const api = {
  listTasks: () => get<TaskRow[]>('/tasks'),
  getTask: (id: string, version: string) => get<Task>(`/tasks/${encodeURIComponent(id)}?version=${encodeURIComponent(version)}`),

  listConfigs: () => get<Config[]>('/configs'),
  createConfig: (input: ConfigInput): Promise<ApiResponse<Config>> => post<Config>('/configs', input),

  listExperiments: () => get<Experiment[]>('/experiments'),
  getExperiment: (id: string) => get<Experiment>(`/experiments/${id}`),
  createExperiment: (input: ExperimentInput) => post<Experiment>('/experiments', input).then((r) => r.data),
  startExperiment: (id: string) => post<StartResult>(`/experiments/${id}/start`).then((r) => r.data),
  experimentStatus: (id: string) => get<ExperimentStatus>(`/experiments/${id}/status`),
  compare: (id: string, a: string, b: string) =>
    get<CompareView>(`/experiments/${id}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),

  listTrials: (experimentId: string) => get<TrialView[]>(`/trials?experimentId=${encodeURIComponent(experimentId)}`),
  getTrial: (id: string) => get<TrialView>(`/trials/${id}`),
  getTrace: (id: string) => get<Trace>(`/trials/${id}/trace`),
};
