import {
  listEvaluationModelCandidates,
  createValidation,
  createTask,
  getTask,
  cancelTask,
  listTaskResults,
  listTasks,
} from '../api/client';
import type {
  SimcoreEvaluationModelCandidate,
  Validation,
  Task,
  TaskStatus,
} from '../api/generated/types.gen';
import {
  parseSanitizedEvaluationResult,
  type SanitizedEvaluationResultData,
} from './evaluation-result';
import type { EvaluationArtifactItem } from '../api/generated/types.gen';

export interface EvaluationValidationParams {
  projectId: string;
  sourceTrainingTaskId: string;
  sourceArtifactId: string;
  episodes: number;
}

export interface CreateEvaluationTaskParams {
  projectId: string;
  validationId: string;
  idempotencyKey: string;
}

/**
 * Fetches all candidate evaluation models visible to the specified project.
 * Paginates safely up to 15 pages with cycle detection.
 */
export async function fetchEvaluationModelCandidates(
  projectId: string,
): Promise<SimcoreEvaluationModelCandidate[]> {
  if (!projectId || projectId.trim().length === 0) {
    throw new Error('projectId is required to fetch evaluation model candidates');
  }

  const allItems: SimcoreEvaluationModelCandidate[] = [];
  let cursor: string | undefined = undefined;
  const seenCursors = new Set<string>();
  let pageCount = 0;
  const maxPages = 15;

  while (pageCount < maxPages) {
    pageCount++;
    const query: { limit: number; cursor?: string } = {
      limit: 50,
    };
    if (cursor) {
      query.cursor = cursor;
    }

    const res = await listEvaluationModelCandidates({
      path: { projectId },
      query,
    });

    if (res.error || !res.data) {
      const err = res.error as { error?: { message?: string } } | undefined;
      throw new Error(
        err?.error?.message ||
          `Failed to fetch evaluation models (HTTP ${res.response?.status || 'network'})`,
      );
    }

    const items = res.data.items || [];
    allItems.push(...items);

    const nextCur = res.data.pageInfo?.nextCursor;
    const hasMore = Boolean(res.data.pageInfo?.hasMore);

    if (hasMore && typeof nextCur === 'string' && nextCur.length > 0) {
      if (seenCursors.has(nextCur)) {
        throw new Error(`Pagination cycle detected on cursor '${nextCur}'`);
      }
      seenCursors.add(nextCur);
      cursor = nextCur;
    } else {
      cursor = undefined;
      break;
    }
  }

  if (cursor !== undefined) {
    throw new Error(
      `Model candidates pagination exceeded safe maximum page depth (${maxPages} pages) with remaining items`,
    );
  }

  return allItems;
}

/**
 * Creates a platform Validation entity for Simcore evaluation.
 * Strictly asserts allowed fields, default/normalized episodes (1..100).
 */
export async function createEvaluationValidation(
  params: EvaluationValidationParams,
): Promise<Validation> {
  const { projectId, sourceTrainingTaskId, sourceArtifactId, episodes } = params;

  if (!sourceTrainingTaskId || sourceTrainingTaskId.trim().length === 0) {
    throw new Error('sourceTrainingTaskId is required');
  }
  if (!sourceArtifactId || sourceArtifactId.trim().length === 0) {
    throw new Error('sourceArtifactId is required');
  }
  if (!Number.isSafeInteger(episodes) || episodes < 1 || episodes > 100) {
    throw new Error('episodes must be an integer between 1 and 100');
  }

  const response = await createValidation({
    body: {
      projectId,
      actionKey: 'SIMCORE_EVALUATION',
      inputs: {},
      configSnapshot: {
        sourceTrainingTaskId: sourceTrainingTaskId.trim(),
        sourceArtifactId: sourceArtifactId.trim(),
        episodes,
      },
    },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string; code?: string } } | undefined;
    throw new Error(
      err?.error?.message ||
        `Failed to create evaluation validation (HTTP ${response.response?.status || 'error'})`,
    );
  }

  return response.data;
}

/**
 * Creates a platform Task entity for evaluation with an explicit Idempotency-Key.
 */
export async function createEvaluationTask(
  params: CreateEvaluationTaskParams,
): Promise<Task> {
  const { projectId, validationId, idempotencyKey } = params;

  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new Error('Idempotency-Key is required for task creation');
  }

  const response = await createTask({
    headers: {
      'Idempotency-Key': idempotencyKey.trim(),
    },
    body: {
      projectId,
      validationId,
      actionKey: 'SIMCORE_EVALUATION',
    },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string; code?: string } } | undefined;
    throw new Error(
      err?.error?.message ||
        `Failed to create evaluation task (HTTP ${response.response?.status || 'error'})`,
    );
  }

  return response.data;
}

export type EvaluationSubmissionPhase = 'idle' | 'validation' | 'task';

/**
 * Orchestrated Evaluation Submission Session.
 * Manages double-click protection, phase tracking, and idempotency key retention on retry.
 */
export class SimcoreEvaluationSubmissionSession {
  private activeValidationId: string | null = null;
  private activeIdempotencyKey: string | null = null;
  private isSubmitting = false;
  private currentPhase: EvaluationSubmissionPhase = 'idle';
  private lastFailedPhase: EvaluationSubmissionPhase | null = null;

  public isInFlight(): boolean {
    return this.isSubmitting;
  }

  public getActiveValidationId(): string | null {
    return this.activeValidationId;
  }

  public getIdempotencyKey(): string | null {
    return this.activeIdempotencyKey;
  }

  public getCurrentPhase(): EvaluationSubmissionPhase {
    return this.currentPhase;
  }

  public getLastFailedPhase(): EvaluationSubmissionPhase | null {
    return this.lastFailedPhase;
  }

  public canRetryTask(): boolean {
    return Boolean(this.activeValidationId && this.lastFailedPhase === 'task');
  }

  public resetNewRun(): void {
    if (this.isSubmitting || this.canRetryTask()) {
      throw new Error('评估提交结果尚未确认，请先复用原提交身份重试');
    }
    this.activeValidationId = null;
    this.activeIdempotencyKey = null;
    this.isSubmitting = false;
    this.currentPhase = 'idle';
    this.lastFailedPhase = null;
  }

  public async submit(
    params: EvaluationValidationParams,
    options?: { isRetry?: boolean; customIdempotencyKey?: string },
  ): Promise<Task> {
    if (this.isSubmitting) {
      throw new Error('Submission already in flight (double-click prevented)');
    }

    const retryUncertainTask = this.canRetryTask();
    this.isSubmitting = true;
    this.lastFailedPhase = null;

    try {
      const isRetry = retryUncertainTask || Boolean(options?.isRetry);

      // 1. Validation phase
      if (!isRetry || !this.activeValidationId) {
        this.currentPhase = 'validation';
        this.activeIdempotencyKey =
          options?.customIdempotencyKey ||
          (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `idemp_eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

        try {
          const validation = await createEvaluationValidation(params);
          this.activeValidationId = validation.id;
        } catch (err) {
          this.lastFailedPhase = 'validation';
          throw err;
        }
      }

      // 2. Task phase
      this.currentPhase = 'task';
      const validationId = this.activeValidationId;
      const idempotencyKey = this.activeIdempotencyKey!;

      try {
        const task = await createEvaluationTask({
          projectId: params.projectId,
          validationId,
          idempotencyKey,
        });
        this.currentPhase = 'idle';
        return task;
      } catch (err) {
        this.lastFailedPhase = 'task';
        throw err;
      }
    } finally {
      this.isSubmitting = false;
    }
  }
}

export interface ResumeEvaluationTaskParams {
  projectId: string;
  initialTaskId: string;
  getTaskFn?: (taskId: string) => Promise<Task>;
}

export type ResumeEvaluationTaskResult =
  | { status: 'resumed'; task: Task }
  | { status: 'mismatch'; task: Task; error: string }
  | { status: 'error'; error: string };

/**
 * Resumes an existing task when entering the evaluation page:
 * - Checks that the task exists
 * - Strictly matches current projectId
 * - Strictly matches actionKey === 'SIMCORE_EVALUATION' (no cross-action collision with training)
 */
export async function resumeSimcoreEvaluationTask({
  projectId,
  initialTaskId,
  getTaskFn = pollEvaluationTask,
}: ResumeEvaluationTaskParams): Promise<ResumeEvaluationTaskResult> {
  if (!initialTaskId || initialTaskId.trim().length === 0) {
    return {
      status: 'error',
      error: 'initialTaskId is required to resume task',
    };
  }

  try {
    const task = await getTaskFn(initialTaskId.trim());
    if (task.projectId !== projectId) {
      return {
        status: 'mismatch',
        task,
        error: `Task ${initialTaskId} belongs to project ${task.projectId}, not ${projectId}`,
      };
    }
    if (task.actionKey !== 'SIMCORE_EVALUATION') {
      return {
        status: 'mismatch',
        task,
        error: `Task ${initialTaskId} has actionKey '${task.actionKey}', expected 'SIMCORE_EVALUATION'`,
      };
    }
    return {
      status: 'resumed',
      task,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to retrieve task for resume';
    return {
      status: 'error',
      error: msg,
    };
  }
}

export async function pollEvaluationTask(taskId: string): Promise<Task> {
  const response = await getTask({
    path: { taskId },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string } } | undefined;
    throw new Error(
      err?.error?.message ||
        `Failed to get evaluation task status (HTTP ${response.response?.status || 'error'})`,
    );
  }

  return response.data;
}

export async function cancelEvaluationTask(taskId: string): Promise<Task> {
  const response = await cancelTask({ path: { taskId }, body: {} });
  if (response.error || !response.data) {
    const error = response.error as { error?: { message?: string } } | undefined;
    throw new Error(error?.error?.message || '取消评估任务失败，请刷新状态后重试');
  }
  return response.data;
}

export function isTerminalEvaluationStatus(status?: TaskStatus | null): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED';
}

export function reconcileEvaluationTask(current: Task | null, incoming: Task): Task {
  if (!current || current.id !== incoming.id) return incoming;
  if (
    isTerminalEvaluationStatus(current.status) ||
    Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt)
  ) {
    return current;
  }
  return incoming;
}

export function getEvaluationPollingIntervalMs(
  status?: TaskStatus | null,
  timeoutRetries = 0,
): number | null {
  if (!status || isTerminalEvaluationStatus(status)) {
    return null;
  }
  if (status === 'TIMEOUT') {
    return Math.min(60000, 10000 * 2 ** Math.max(0, timeoutRetries));
  }
  return 3000;
}

export interface SimcoreEvaluationPollingCallbacks {
  onUpdate: (task: Task) => void;
  onError: (error: string) => void;
  onTerminal?: (task: Task) => void;
}

export class SimcoreEvaluationPollingController {
  private currentGeneration = 0;
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private currentTaskId: string | null = null;
  private timeoutRetries = 0;

  public getGeneration(): number {
    return this.currentGeneration;
  }

  public getIsPolling(): boolean {
    return this.isPolling;
  }

  public getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  public cancel(): void {
    this.currentGeneration++;
    this.timeoutRetries = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isPolling = false;
    this.currentTaskId = null;
  }

  public start(
    taskId: string,
    initialStatus: TaskStatus | null | undefined,
    callbacks: SimcoreEvaluationPollingCallbacks,
    options?: {
      getTaskFn?: (taskId: string) => Promise<Task>;
      intervalProvider?: (status?: TaskStatus | null, timeoutRetries?: number) => number | null;
    },
  ): void {
    this.cancel();
    this.currentTaskId = taskId;
    const generation = this.currentGeneration;

    this.scheduleNext(taskId, initialStatus, generation, callbacks, options);
  }

  private scheduleNext(
    taskId: string,
    currentStatus: TaskStatus | null | undefined,
    generation: number,
    callbacks: SimcoreEvaluationPollingCallbacks,
    options?: {
      getTaskFn?: (taskId: string) => Promise<Task>;
      intervalProvider?: (status?: TaskStatus | null, timeoutRetries?: number) => number | null;
    },
  ): void {
    if (generation !== this.currentGeneration) {
      return;
    }

    const intervalCalculator = options?.intervalProvider || getEvaluationPollingIntervalMs;
    const interval = intervalCalculator(currentStatus, this.timeoutRetries);
    this.timeoutRetries = currentStatus === 'TIMEOUT' ? Math.min(3, this.timeoutRetries + 1) : 0;
    if (interval === null) {
      this.isPolling = false;
      return;
    }

    this.isPolling = true;
    this.timer = setTimeout(async () => {
      if (generation !== this.currentGeneration) {
        return;
      }

      const getTask = options?.getTaskFn || pollEvaluationTask;
      try {
        const updatedTask = await getTask(taskId);
        if (generation !== this.currentGeneration) {
          return;
        }

        callbacks.onUpdate(updatedTask);

        if (isTerminalEvaluationStatus(updatedTask.status)) {
          this.isPolling = false;
          callbacks.onTerminal?.(updatedTask);
        } else {
          this.scheduleNext(taskId, updatedTask.status, generation, callbacks, options);
        }
      } catch (err: unknown) {
        if (generation !== this.currentGeneration) {
          return;
        }

        const msg = err instanceof Error ? err.message : '轮询评估状态失败';
        callbacks.onError(msg);
        this.scheduleNext(taskId, 'TIMEOUT', generation, callbacks, options);
      }
    }, interval);
  }
}

/**
 * Fetches and parses sanitized evaluation results for a completed evaluation task.
 */
export async function fetchEvaluationResults(
  taskId: string,
): Promise<SanitizedEvaluationResultData[]> {
  const response = await listTaskResults({
    path: { taskId },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string } } | undefined;
    throw new Error(
      err?.error?.message ||
        `Failed to list evaluation results (HTTP ${response.response?.status || 'error'})`,
    );
  }

  const items = response.data.items || [];
  const parsedResults: SanitizedEvaluationResultData[] = [];

  for (const item of items) {
    if (item.sourceModule === 'simcore' && item.taskId === taskId) {
      const parsed = parseSanitizedEvaluationResult(item.data);
      if (parsed) {
        parsedResults.push(parsed);
      }
    }
  }

  return parsedResults;
}

/**
 * Lists history evaluation tasks for the given project.
 */
export async function listProjectEvaluationTasks(
  projectId: string,
  limit = 20,
): Promise<Task[]> {
  const tasks: Task[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = await listTasks({ query: { projectId, limit: 100, ...(cursor ? { cursor } : {}) } });
    if (response.error || !response.data) {
      const err = response.error as { error?: { message?: string } } | undefined;
      throw new Error(err?.error?.message || '获取评估历史失败，请重试');
    }
    tasks.push(...response.data.items.filter((t) => t.projectId === projectId && t.actionKey === 'SIMCORE_EVALUATION'));
    if (tasks.length >= limit || !response.data.pageInfo?.hasMore) break;
    const next = response.data.pageInfo.nextCursor;
    if (!next || seenCursors.has(next)) throw new Error('评估历史分页异常，请重试');
    seenCursors.add(next);
    cursor = next;
  } while (cursor);
  return tasks.slice(0, limit);
}

/**
 * Builds the safe download URL for evaluation CSV artifact.
 * Only returns a URL if the artifact is 'evaluation_steps.csv' and downloadAvailable is true.
 * NEVER builds URLs for summary.json, config_snapshot.json, or raw logs.
 */
export function getSafeEvaluationCsvDownloadUrl(
  taskId: string,
  requestId: string,
  artifact: EvaluationArtifactItem,
): string | null {
  if (
    !taskId ||
    !requestId ||
    !artifact ||
    artifact.name !== 'evaluation_steps.csv' ||
    artifact.downloadAvailable !== true
  ) {
    return null;
  }

  return `/api/v1/tasks/${encodeURIComponent(taskId)}/simcore/attempts/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/download`;
}
