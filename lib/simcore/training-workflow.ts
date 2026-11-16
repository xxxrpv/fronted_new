import {
  listProjectResources,
  createValidation,
  createTask,
  getTask,
  cancelTask,
  listTaskResults,
} from '../api/client';
import type {
  Resource,
  Validation,
  Task,
  TaskStatus,
} from '../api/generated/types.gen';
import {
  parseSimcoreTrainingResult,
  type SanitizedTrainingResultData,
} from './training-result';

export interface SimcoreResourceGroup {
  robots: Resource[];
  algorithms: Resource[];
}

export interface TrainingValidationParams {
  projectId: string;
  robotResourceId: string;
  algorithmResourceId: string;
  totalSteps: number;
  presentationMode: 'headless' | 'visible';
}

export interface CreateTrainingTaskParams {
  projectId: string;
  validationId: string;
  idempotencyKey: string;
}

/**
 * Helper to extract user-friendly display name for a Platform Resource.
 * Prefers displayMetadata.name/title/displayName, fallback to externalId.
 */
export function getResourceDisplayName(resource: Resource): string {
  const meta = resource.displayMetadata;
  if (meta && typeof meta === 'object') {
    const rec = meta as Record<string, unknown>;
    if (typeof rec.title === 'string' && rec.title.trim().length > 0) {
      return rec.title.trim();
    }
    if (typeof rec.name === 'string' && rec.name.trim().length > 0) {
      return rec.name.trim();
    }
    if (typeof rec.displayName === 'string' && rec.displayName.trim().length > 0) {
      return rec.displayName.trim();
    }
  }
  return resource.externalId;
}

const workspaceUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;

export function getTrainingRobotPublicationDiagnostic(resource: Resource): {
  status: string;
  stage?: string;
  code?: string;
  pendingArtifactId?: string;
} | null {
  if (resource.type !== 'ROBOT' || resource.sourceModule !== 'embodex') return null;
  const specs = resource.displayMetadata?.specifications;
  const status = specs?.workspacePublicationStatus;
  if (status === 'LOCATION_REGISTERED') {
    return { status: getTrainingRobotUnavailableReason(resource) || '发布登记完成，可用于训练' };
  }
  if (status !== 'PENDING' && status !== 'NEEDS_ATTENTION') {
    return { status: '尚未完成发布登记，暂不可用' };
  }
  const stage = specs?.workspacePublicationStage;
  const stages: Record<string, string> = {
    LOCAL_PUBLICATION: '本地发布',
    WORKSPACE_REGISTRATION: 'Workspace 登记',
    LOCATION_REGISTRATION: '文件位置登记',
  };
  const code = specs?.workspacePublicationCode;
  const codes = status === 'PENDING'
    ? ['PUBLICATION_PENDING', 'PUBLICATION_RESPONSE_UNCONFIRMED', 'PUBLICATION_SERVICE_UNAVAILABLE']
    : ['PUBLICATION_CONFIGURATION_INVALID', 'PUBLICATION_AUTHENTICATION_FAILED', 'PUBLICATION_CONFLICT',
      'PUBLICATION_RECEIPT_INVALID', 'PUBLICATION_FILE_INVALID'];
  const validStage = stage === 'WORKSPACE_REGISTRATION' || stage === 'LOCATION_REGISTRATION' ||
    (status === 'NEEDS_ATTENTION' && stage === 'LOCAL_PUBLICATION');
  const pendingId = specs?.workspacePendingArtifactId;
  return {
    status: status === 'PENDING' ? '发布登记中，暂不可用' : '模型生成已完成，发布需处理；已停止自动恢复，暂不可用',
    ...(validStage ? { stage: stages[stage] } : {}),
    ...(validStage && typeof code === 'string' && codes.includes(code) ? { code } : {}),
    ...(stage === 'LOCATION_REGISTRATION' && typeof pendingId === 'string' && workspaceUuidPattern.test(pendingId)
      ? { pendingArtifactId: pendingId } : {}),
  };
}

export function getTrainingRobotUnavailableReason(resource: Resource): string | null {
  if (resource.type !== 'ROBOT') return '资源不是机器人模型';
  if (resource.sourceModule === 'simcore') return null;
  if (resource.sourceModule !== 'embodex') return '模型来源不支持训练';
  const specs = resource.displayMetadata?.specifications;
  switch (specs?.workspacePublicationStatus) {
    case 'LOCATION_REGISTERED':
      return typeof specs.workspaceArtifactId === 'string' &&
        workspaceUuidPattern.test(specs.workspaceArtifactId)
        ? null : '发布回执无效，暂不可用';
    case 'PENDING': return '发布登记中，暂不可用';
    case 'NEEDS_ATTENTION': return '模型生成已完成，发布需处理，暂不可用';
    default: return '尚未完成发布登记，暂不可用';
  }
}

/**
 * Fetches all platform resources visible to the specified project,
 * traversing pages if nextCursor is present, and filtering for simcore training.
 * Uses seenCursors to detect loops and throws if pagination exceeds safe depth while hasMore is true.
 */
export async function fetchSimcoreResources(
  projectId: string,
): Promise<SimcoreResourceGroup> {
  if (!projectId || projectId.trim().length === 0) {
    throw new Error('projectId is required to fetch Simcore resources');
  }

  const allItems: Resource[] = [];
  let cursor: string | undefined = undefined;
  const seenCursors = new Set<string>();
  let pageCount = 0;
  const maxPages = 15; // Safe recursion guard

  while (pageCount < maxPages) {
    pageCount++;
    const query: { limit: number; cursor?: string } = {
      limit: 50,
    };
    if (cursor) {
      query.cursor = cursor;
    }

    const res = await listProjectResources({
      path: { projectId },
      query,
    });

    if (res.error || !res.data) {
      const err = res.error as { error?: { message?: string } } | undefined;
      throw new Error(
        err?.error?.message || `Failed to fetch resources (HTTP ${res.response?.status || 'network'})`,
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

  // F-06: Do NOT silently truncate if more resources remain
  if (cursor !== undefined) {
    throw new Error(
      `Resource pagination exceeded safe maximum page depth (${maxPages} pages) with remaining items`,
    );
  }

  const robots = allItems.filter((item) => item.type === 'ROBOT' &&
    (item.sourceModule === 'simcore' || item.sourceModule === 'embodex'));
  const algorithms = allItems.filter((item) => item.type === 'ALGORITHM' && item.sourceModule === 'simcore');

  const algorithmOrder = ['ppo', 'sac', 'td3'];
  algorithms.sort((a, b) => {
    const idxA = algorithmOrder.indexOf(a.externalId?.toLowerCase() || '');
    const idxB = algorithmOrder.indexOf(b.externalId?.toLowerCase() || '');
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  return { robots, algorithms };
}

export interface SimcoreResourceState {
  projectId: string;
  robots: Resource[];
  algorithms: Resource[];
  selectedRobotId: string;
  selectedAlgorithmId: string;
  loading: boolean;
  error: string | null;
}

/**
 * R3-01: Project-scoped Resource manager with generation invalidation and fail-closed validation.
 * Enforces:
 * - Immediate clearing of old resources, selections, and errors on projectId change.
 * - Monotonic generation invalidation so stale in-flight requests from old projects are completely discarded.
 * - Selections are strictly validated against loaded resources for the current project.
 * - Fail-closed check before submission to guarantee robotResourceId and algorithmResourceId belong to current project.
 */
export class SimcoreProjectResourceManager {
  private currentGeneration = 0;
  private currentProjectId = '';
  private state: SimcoreResourceState = {
    projectId: '',
    robots: [],
    algorithms: [],
    selectedRobotId: '',
    selectedAlgorithmId: '',
    loading: false,
    error: null,
  };
  private onStateChange?: (state: SimcoreResourceState) => void;

  constructor(initialProjectId = '', onStateChange?: (state: SimcoreResourceState) => void) {
    this.currentProjectId = initialProjectId;
    this.state.projectId = initialProjectId;
    this.onStateChange = onStateChange;
  }

  public getState(): SimcoreResourceState {
    return { ...this.state };
  }

  public getGeneration(): number {
    return this.currentGeneration;
  }

  public getCurrentProjectId(): string {
    return this.currentProjectId;
  }

  /**
   * Resets all resource state when switching project or unmounting, invalidating any in-flight loads.
   */
  public resetForProject(projectId: string): void {
    this.currentGeneration++;
    this.currentProjectId = projectId;
    this.state = {
      projectId,
      robots: [],
      algorithms: [],
      selectedRobotId: '',
      selectedAlgorithmId: '',
      loading: Boolean(projectId),
      error: null,
    };
    this.onStateChange?.(this.state);
  }

  public setSelectedRobotId(id: string): void {
    if (!id || this.state.robots.some((r) => r.id === id && !getTrainingRobotUnavailableReason(r))) {
      this.state.selectedRobotId = id;
      this.onStateChange?.(this.state);
    }
  }

  public setSelectedAlgorithmId(id: string): void {
    if (!id || this.state.algorithms.some((a) => a.id === id)) {
      this.state.selectedAlgorithmId = id;
      this.onStateChange?.(this.state);
    }
  }

  /**
   * Loads resources for target projectId, dropping any stale or mismatched responses.
   */
  public async load(
    projectId: string,
    fetchFn: (pid: string) => Promise<SimcoreResourceGroup> = fetchSimcoreResources,
  ): Promise<boolean> {
    if (!projectId) {
      this.resetForProject('');
      return false;
    }

    // Always reset selection and resources for the target project
    this.resetForProject(projectId);
    const generation = this.currentGeneration;

    try {
      const group = await fetchFn(projectId);

      // Invalidation check: if generation or project changed while in-flight, discard response!
      if (generation !== this.currentGeneration || projectId !== this.currentProjectId) {
        return false;
      }

      const robots = group.robots || [];
      const algorithms = group.algorithms || [];

      // Selection must strictly belong to current project's returned resources
      const selectedRobotId =
        robots.some((r) => r.id === this.state.selectedRobotId && !getTrainingRobotUnavailableReason(r))
          ? this.state.selectedRobotId
          : robots.find((r) => !getTrainingRobotUnavailableReason(r))?.id || '';

      const selectedAlgorithmId =
        algorithms.some((a) => a.id === this.state.selectedAlgorithmId)
          ? this.state.selectedAlgorithmId
          : algorithms.find((a) => a.externalId?.toLowerCase() === 'ppo')?.id || algorithms[0]?.id || '';

      this.state = {
        projectId,
        robots,
        algorithms,
        selectedRobotId,
        selectedAlgorithmId,
        loading: false,
        error: null,
      };

      this.onStateChange?.(this.state);
      return true;
    } catch (err: unknown) {
      if (generation !== this.currentGeneration || projectId !== this.currentProjectId) {
        return false;
      }

      const msg = err instanceof Error ? err.message : '获取训练资源失败';
      this.state = {
        projectId,
        robots: [],
        algorithms: [],
        selectedRobotId: '',
        selectedAlgorithmId: '',
        loading: false,
        error: msg,
      };
      this.onStateChange?.(this.state);
      return false;
    }
  }

  /**
   * Verifies that the currently selected IDs strictly belong to the active project's loaded resources.
   */
  public validateSelection(
    projectId = this.currentProjectId,
    robotId = this.state.selectedRobotId,
    algorithmId = this.state.selectedAlgorithmId,
  ): { valid: boolean; error?: string } {
    if (!projectId || projectId !== this.currentProjectId || this.state.loading || this.state.error) {
      return { valid: false, error: '当前项目资源尚未加载完成，请重新选择模型' };
    }
    if (!robotId || !algorithmId) {
      return { valid: false, error: '必须同时选择 Robot 和 Algorithm 资源' };
    }
    const robotMatch = this.state.robots.find((r) => r.id === robotId);
    if (!robotMatch) {
      return {
        valid: false,
        error: `选中的 Robot (${this.state.selectedRobotId}) 不属于当前项目 (${this.currentProjectId})`,
      };
    }
    const unavailableReason = getTrainingRobotUnavailableReason(robotMatch);
    if (unavailableReason) return { valid: false, error: unavailableReason };
    const algoMatch = this.state.algorithms.some((a) => a.id === algorithmId && a.type === 'ALGORITHM' && a.sourceModule === 'simcore');
    if (!algoMatch) {
      return {
        valid: false,
        error: `选中的 Algorithm (${this.state.selectedAlgorithmId}) 不属于当前项目 (${this.currentProjectId})`,
      };
    }
    return { valid: true };
  }
}

/**
 * Creates a platform Validation entity for Simcore training.
 * Strictly asserts allowed fields and safe integer values.
 */
export async function createTrainingValidation(
  params: TrainingValidationParams,
): Promise<Validation> {
  const { projectId, robotResourceId, algorithmResourceId, totalSteps, presentationMode } =
    params;

  if (!Number.isSafeInteger(totalSteps) || totalSteps <= 0) {
    throw new Error('totalSteps must be a positive safe integer >= 1');
  }

  if (presentationMode !== 'headless' && presentationMode !== 'visible') {
    throw new Error("presentationMode must be either 'headless' or 'visible'");
  }

  const response = await createValidation({
    body: {
      projectId,
      actionKey: 'SIMCORE_TRAINING',
      inputs: {
        robot: robotResourceId,
        algorithm: algorithmResourceId,
      },
      configSnapshot: {
        totalSteps,
        presentationMode,
      },
    },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string; code?: string } } | undefined;
    throw new Error(
      err?.error?.message || `Failed to create validation (HTTP ${response.response?.status || 'error'})`,
    );
  }

  return response.data;
}

/**
 * Creates a platform Task entity with an explicit Idempotency-Key.
 */
export async function createTrainingTask(
  params: CreateTrainingTaskParams,
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
      actionKey: 'SIMCORE_TRAINING',
    },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string; code?: string } } | undefined;
    throw new Error(
      err?.error?.message || `Failed to create task (HTTP ${response.response?.status || 'error'})`,
    );
  }

  return response.data;
}

export type SubmissionPhase = 'idle' | 'validation' | 'task';

/**
 * F-01 & F-02 & R2-03: Orchestrated Training Submission Session.
 * Manages the lifecycle of a single logical submission attempt:
 * - Enforces double-click protection (in-flight rejection)
 * - Persists validationId across retry attempts (NEVER creates a second validation on retry)
 * - Preserves Idempotency-Key across retry attempts
 * - Allocates new validation and new key ONLY on explicit new logical run
 * - R2-03: Tracks submission phases (validation vs task) and exposes whether task retry is valid
 */
export class SimcoreSubmissionSession {
  private activeValidationId: string | null = null;
  private activeIdempotencyKey: string | null = null;
  private isSubmitting = false;
  private currentPhase: SubmissionPhase = 'idle';
  private lastFailedPhase: SubmissionPhase | null = null;

  public isInFlight(): boolean {
    return this.isSubmitting;
  }

  public getValidationId(): string | null {
    return this.activeValidationId;
  }

  public getActiveValidationId(): string | null {
    return this.activeValidationId;
  }

  public getIdempotencyKey(): string | null {
    return this.activeIdempotencyKey;
  }

  public getCurrentPhase(): SubmissionPhase {
    return this.currentPhase;
  }

  public getLastFailedPhase(): SubmissionPhase | null {
    return this.lastFailedPhase;
  }

  /**
   * Returns true only when a validationId is successfully held and the last failure
   * occurred during the task creation phase (meaning retrying will reuse validation + key).
   */
  public canRetryTask(): boolean {
    return Boolean(this.activeValidationId && this.lastFailedPhase === 'task');
  }

  /**
   * Resets session to start a brand new logical run.
   */
  public resetNewRun(): void {
    this.activeValidationId = null;
    this.activeIdempotencyKey = null;
    this.isSubmitting = false;
    this.currentPhase = 'idle';
    this.lastFailedPhase = null;
  }

  /**
   * Submits training with proper idempotency and retry semantics.
   * If isRetry=true and an activeValidationId exists, skips createValidation and re-uses key!
   */
  public async submit(
    params: TrainingValidationParams,
    options?: { isRetry?: boolean; customIdempotencyKey?: string },
  ): Promise<Task> {
    if (this.isSubmitting) {
      throw new Error('Submission already in flight (double-click prevented)');
    }

    this.isSubmitting = true;
    this.lastFailedPhase = null;

    try {
      const isRetry = Boolean(options?.isRetry);

      // 1. Validation phase
      if (!isRetry || !this.activeValidationId) {
        this.currentPhase = 'validation';
        this.activeIdempotencyKey =
          options?.customIdempotencyKey ||
          (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

        try {
          const validation = await createTrainingValidation(params);
          this.activeValidationId = validation.id;
        } catch (err) {
          this.lastFailedPhase = 'validation';
          throw err;
        }
      }

      // 2. Task phase (uses the same validationId and same idempotencyKey on retry)
      this.currentPhase = 'task';
      const validationId = this.activeValidationId;
      const idempotencyKey = this.activeIdempotencyKey!;

      try {
        const task = await createTrainingTask({
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

export interface ResumeTaskParams {
  projectId: string;
  initialTaskId: string;
  getTaskFn?: (taskId: string) => Promise<Task>;
}

export type ResumeTaskResult =
  | { status: 'resumed'; task: Task }
  | { status: 'mismatch'; task: Task; error: string }
  | { status: 'error'; error: string };

/**
 * R2-02: Resumes an existing task when entering the page with initialTaskId:
 * - Checks that the task exists and strictly matches current projectId
 * - Never calls createValidation or createTask (no re-submission!)
 */
export async function resumeSimcoreTask({
  projectId,
  initialTaskId,
  getTaskFn = pollTrainingTask,
}: ResumeTaskParams): Promise<ResumeTaskResult> {
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

export type PollingIntervalProvider = (status?: TaskStatus | null, timeoutRetries?: number) => number | null;

export interface SimcorePollingCallbacks {
  onUpdate: (task: Task) => void;
  onError: (error: string) => void;
  onTerminal?: (task: Task) => void;
}

export interface SimcorePollingOptions {
  getTaskFn?: (taskId: string) => Promise<Task>;
  intervalProvider?: PollingIntervalProvider;
}

/**
 * R2-01: Lifecycle-safe polling controller with generation invalidation.
 * Guarantees that:
 * - Cancelling immediately cancels timer and invalidates generation.
 * - In-flight async requests that resolve/reject after cancellation or task/project switch
 *   will NOT trigger callbacks or schedule any subsequent poll loops.
 * - Switching task starts a new generation, dropping any stale responses from the previous task.
 */
export class SimcorePollingController {
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
    callbacks: SimcorePollingCallbacks,
    options?: SimcorePollingOptions,
  ): void {
    // Invalidate any previous polling loop and advance generation
    this.cancel();
    this.currentTaskId = taskId;
    const generation = this.currentGeneration;

    this.scheduleNext(taskId, initialStatus, generation, callbacks, options);
  }

  private scheduleNext(
    taskId: string,
    currentStatus: TaskStatus | null | undefined,
    generation: number,
    callbacks: SimcorePollingCallbacks,
    options?: SimcorePollingOptions,
  ): void {
    if (generation !== this.currentGeneration) {
      return;
    }

    const intervalCalculator = options?.intervalProvider || getPollingIntervalMs;
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

      const getTask = options?.getTaskFn || pollTrainingTask;
      try {
        const updatedTask = await getTask(taskId);
        if (generation !== this.currentGeneration) {
          return;
        }

        callbacks.onUpdate(updatedTask);

        if (isTerminalStatus(updatedTask.status)) {
          this.isPolling = false;
          callbacks.onTerminal?.(updatedTask);
        } else {
          this.scheduleNext(taskId, updatedTask.status, generation, callbacks, options);
        }
      } catch (err: unknown) {
        if (generation !== this.currentGeneration) {
          return;
        }

        const msg = err instanceof Error ? err.message : '轮询状态失败';
        callbacks.onError(msg);
        // Retry poll after timeout interval on failure
        this.scheduleNext(taskId, 'TIMEOUT', generation, callbacks, options);
      }
    }, interval);
  }
}

/**
 * Polls the current state of a task by ID.
 */
export async function pollTrainingTask(taskId: string): Promise<Task> {
  const response = await getTask({
    path: { taskId },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string } } | undefined;
    throw new Error(
      err?.error?.message || `Failed to get task status (HTTP ${response.response?.status || 'error'})`,
    );
  }

  return response.data;
}

export async function cancelTrainingTask(taskId: string): Promise<Task> {
  const response = await cancelTask({ path: { taskId }, body: {} });
  if (response.error || !response.data) {
    const error = response.error as { error?: { message?: string } } | undefined;
    throw new Error(error?.error?.message || '取消任务失败，请刷新状态后重试');
  }
  return response.data;
}

// Poll, manual refresh and cancel share this ordering rule; terminal evidence is never regressed.
export function reconcileTrainingTask(current: Task | null, incoming: Task): Task {
  if (!current || current.id !== incoming.id) return incoming;
  if (isTerminalStatus(current.status) || Date.parse(incoming.updatedAt) < Date.parse(current.updatedAt)) return current;
  return incoming;
}

/**
 * Fetches and parses terminal results for a completed task.
 */
export async function fetchTrainingResults(
  taskId: string,
): Promise<SanitizedTrainingResultData[]> {
  const response = await listTaskResults({
    path: { taskId },
  });

  if (response.error || !response.data) {
    const err = response.error as { error?: { message?: string } } | undefined;
    throw new Error(
      err?.error?.message || `Failed to list task results (HTTP ${response.response?.status || 'error'})`,
    );
  }

  const items = response.data.items || [];
  const parsedResults: SanitizedTrainingResultData[] = [];

  for (const item of items) {
    if (item.sourceModule === 'simcore' && item.taskId === taskId) {
      const parsed = parseSimcoreTrainingResult(item.data);
      if (parsed) {
        parsedResults.push(parsed);
      }
    }
  }

  return parsedResults;
}

/**
 * Checks if a TaskStatus indicates terminal state.
 */
export function isTerminalStatus(status?: TaskStatus | null): boolean {
  return (
    status === 'SUCCEEDED' ||
    status === 'FAILED' ||
    status === 'CANCELED'
  );
}

/**
 * Returns suggested polling interval in ms for each task state.
 * - PENDING, QUEUED, RUNNING: 3000ms
 * - TIMEOUT: 10s -> 20s -> 40s -> 60s (reset after recovery)
 * - Terminal: null (stop polling)
 */
export function getPollingIntervalMs(status?: TaskStatus | null, timeoutRetries = 0): number | null {
  if (!status || isTerminalStatus(status)) {
    return null;
  }
  if (status === 'TIMEOUT') {
    return Math.min(60000, 10000 * 2 ** Math.max(0, timeoutRetries));
  }
  return 3000;
}

/**
 * R4-01: Project- and Task-scoped asynchronous operation manager.
 * Guarantees that late-arriving responses or errors from manual task refresh
 * and terminal result fetch cannot write back to component state across
 * project changes, task changes, new training runs, or unmount.
 */
export class SimcoreAsyncScopeController {
  private scopeGeneration = 0;
  private taskRefreshOpGeneration = 0;
  private resultFetchOpGeneration = 0;
  private submissionOpGeneration = 0;
  private currentProjectId = '';
  private currentTaskId = '';

  constructor(initialProjectId = '', initialTaskId = '') {
    this.currentProjectId = initialProjectId;
    this.currentTaskId = initialTaskId;
  }

  public getScopeGeneration(): number {
    return this.scopeGeneration;
  }

  public getCurrentProjectId(): string {
    return this.currentProjectId;
  }

  public getCurrentTaskId(): string {
    return this.currentTaskId;
  }

  /**
   * Resets the entire scope (project change, new run, unmount), invalidating all in-flight reads and submissions.
   */
  public resetScope(projectId = '', taskId = ''): void {
    this.scopeGeneration++;
    this.taskRefreshOpGeneration++;
    this.resultFetchOpGeneration++;
    this.submissionOpGeneration++;
    this.currentProjectId = projectId;
    this.currentTaskId = taskId;
  }

  /**
   * Sets current taskId, invalidating in-flight reads tied to previous tasks.
   */
  public setTaskId(taskId: string): void {
    this.taskRefreshOpGeneration++;
    this.resultFetchOpGeneration++;
    this.currentTaskId = taskId;
  }

  /**
   * Runs a guarded training submission.
   * Invalidated if scope changes (project/task/new run/unmount) or if session instance is replaced.
   */
  public async runGuardedSubmission<T>(
    projectId: string,
    submitFn: () => Promise<T>,
    callbacks: {
      onStart?: () => void;
      onSuccess: (result: T) => void;
      onError: (errMsg: string) => void;
      onFinally?: () => void;
      isSessionCurrent?: () => boolean;
    },
  ): Promise<boolean> {
    const scopeGen = this.scopeGeneration;
    const subGen = ++this.submissionOpGeneration;

    callbacks.onStart?.();

    try {
      const result = await submitFn();
      if (
        scopeGen !== this.scopeGeneration ||
        subGen !== this.submissionOpGeneration ||
        projectId !== this.currentProjectId ||
        (callbacks.isSessionCurrent ? !callbacks.isSessionCurrent() : false)
      ) {
        return false;
      }
      callbacks.onSuccess(result);
      return true;
    } catch (err: unknown) {
      if (
        scopeGen !== this.scopeGeneration ||
        subGen !== this.submissionOpGeneration ||
        projectId !== this.currentProjectId ||
        (callbacks.isSessionCurrent ? !callbacks.isSessionCurrent() : false)
      ) {
        return false;
      }
      const msg = err instanceof Error ? err.message : '提交训练任务失败';
      callbacks.onError(msg);
      return false;
    } finally {
      if (
        scopeGen === this.scopeGeneration &&
        subGen === this.submissionOpGeneration &&
        projectId === this.currentProjectId &&
        (callbacks.isSessionCurrent ? callbacks.isSessionCurrent() : true)
      ) {
        callbacks.onFinally?.();
      }
    }
  }

  /**
   * Runs a guarded manual task refresh.
   * Returns true if applied, false if discarded due to stale scope or newer request.
   */
  public async runGuardedTaskRefresh(
    projectId: string,
    taskId: string,
    fetchFn: (tid: string) => Promise<Task>,
    callbacks: {
      onSuccess: (task: Task) => void;
      onError: (errMsg: string) => void;
    },
  ): Promise<boolean> {
    if (!this.currentTaskId) {
      this.currentTaskId = taskId;
    }
    const scopeGen = this.scopeGeneration;
    const opGen = ++this.taskRefreshOpGeneration;

    try {
      const updated = await fetchFn(taskId);
      if (
        scopeGen !== this.scopeGeneration ||
        opGen !== this.taskRefreshOpGeneration ||
        projectId !== this.currentProjectId ||
        taskId !== this.currentTaskId
      ) {
        return false;
      }
      callbacks.onSuccess(updated);
      return true;
    } catch (err: unknown) {
      if (
        scopeGen !== this.scopeGeneration ||
        opGen !== this.taskRefreshOpGeneration ||
        projectId !== this.currentProjectId ||
        taskId !== this.currentTaskId
      ) {
        return false;
      }
      const msg = err instanceof Error ? err.message : '手动刷新失败';
      callbacks.onError(msg);
      return false;
    }
  }

  /**
   * Runs a guarded result fetch.
   * Returns true if applied, false if discarded due to stale scope or newer request.
   */
  public async runGuardedResultFetch(
    projectId: string,
    taskId: string,
    fetchFn: (tid: string) => Promise<SanitizedTrainingResultData[]>,
    callbacks: {
      onStart?: () => void;
      onSuccess: (results: SanitizedTrainingResultData[]) => void;
      onError: (errMsg: string) => void;
      onFinally?: () => void;
    },
  ): Promise<boolean> {
    if (!this.currentTaskId) {
      this.currentTaskId = taskId;
    }
    const scopeGen = this.scopeGeneration;
    const opGen = ++this.resultFetchOpGeneration;

    callbacks.onStart?.();

    try {
      const results = await fetchFn(taskId);
      if (
        scopeGen !== this.scopeGeneration ||
        opGen !== this.resultFetchOpGeneration ||
        projectId !== this.currentProjectId ||
        taskId !== this.currentTaskId
      ) {
        return false;
      }
      callbacks.onSuccess(results);
      return true;
    } catch (err: unknown) {
      if (
        scopeGen !== this.scopeGeneration ||
        opGen !== this.resultFetchOpGeneration ||
        projectId !== this.currentProjectId ||
        taskId !== this.currentTaskId
      ) {
        return false;
      }
      const msg = err instanceof Error ? err.message : '获取训练结果失败';
      callbacks.onError(msg);
      return false;
    } finally {
      if (
        scopeGen === this.scopeGeneration &&
        opGen === this.resultFetchOpGeneration &&
        projectId === this.currentProjectId &&
        taskId === this.currentTaskId
      ) {
        callbacks.onFinally?.();
      }
    }
  }
}

/**
 * ResourceRequestCoordinator
 *
 * 用于协调 Resource Library 筛选/搜索等异步请求的世代管理（Generation Invalidation）
 * 彻底解决用户操作事件触发至 React passive useEffect / microtask 窗口期的在途旧请求竞态 (F-RE-01)。
 *
 * 关键设计：
 * 1. UI 交互事件（input onChange, click 等）同步调用 invalidate()，递增当前世代，使所有在途请求立即永久失去提交资格。
 * 2. 防抖定时器捕获当时世代，触发请求前与每次 await 之后通过 isCurrent(seq) 防御性核对。
 */
export class ResourceRequestCoordinator {
  private currentSeq = 0;

  /**
   * 同步递增请求序列，立即使用户交互前在途的所有异步请求失效。
   * 必须在任何触发筛选变更的 UI 事件回调（onChange, onClick）中同步调用。
   */
  public invalidate(): number {
    this.currentSeq += 1;
    return this.currentSeq;
  }

  /**
   * 获取当前最新有效的请求序列号。
   */
  public getCurrentSeq(): number {
    return this.currentSeq;
  }

  /**
   * 检查给定的请求序列号是否仍为当前最新有效序列号。
   */
  public isCurrent(seq: number): boolean {
    return seq === this.currentSeq;
  }

  /**
   * 重置序列号（用于初始化或彻底重置场景）。
   */
  public reset(): void {
    this.currentSeq = 0;
  }
}
