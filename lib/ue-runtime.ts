import { deployProjectUeRuntime, getProjectUeRuntime, listProjectResources } from './api/client';
import type { Resource, UeRuntimeState } from './api/generated/types.gen';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pollIntervalMs = 5000;
const pollWindowMs = 10 * 60 * 1000;
// Backend permits a configured 600s deadline; a client abort does not cancel UE.
const deployTimeoutMs = 615000;

export function trustedPlayerUrl(value: string, allowedUrls?: string | string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== '/player.html') return false;

  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;

  // Default loopback compatibility: 127.0.0.1 with explicit port 1..65535
  if (url.hostname === '127.0.0.1' && !!url.port) return true;

  // Configured allowlist check (NEXT_PUBLIC_UE_PLAYER_ALLOWED_URLS or allowedUrls argument)
  const envAllowed = process.env.NEXT_PUBLIC_UE_PLAYER_ALLOWED_URLS?.trim();
  const rawList: string[] = [];
  if (envAllowed) rawList.push(...envAllowed.split(','));
  if (allowedUrls) {
    if (Array.isArray(allowedUrls)) rawList.push(...allowedUrls);
    else rawList.push(...allowedUrls.split(','));
  }

  for (const item of rawList) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    try {
      const allowed = new URL(trimmed);
      if (
        allowed.protocol === url.protocol &&
        allowed.hostname.toLowerCase() === url.hostname.toLowerCase() &&
        allowed.port === url.port &&
        allowed.pathname === '/player.html' &&
        !allowed.search &&
        !allowed.hash &&
        !allowed.username &&
        !allowed.password
      ) {
        return true;
      }
    } catch {}
  }

  return false;
}

class RuntimeApiError extends Error {}

function apiData<T>(response: { data?: T; error?: { error?: { message?: string } } }): T {
  if (response.error || !response.data) throw new RuntimeApiError(response.error?.error?.message || '平台请求失败，请刷新后重试。');
  return response.data;
}

function requestSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

export async function fetchProjectRobots(projectId: string, signal: AbortSignal): Promise<Resource[]> {
  const bounded = requestSignal(signal, 30000);
  const robots = new Map<string, Resource>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 15; page++) {
    const result = apiData(await listProjectResources({ path: { projectId }, query: { limit: 50, ...(cursor ? { cursor } : {}) }, signal: bounded }));
    for (const resource of result.items) if (resource.type === 'ROBOT') robots.set(resource.id, resource);
    if (!result.pageInfo.hasMore) return [...robots.values()];
    const next = result.pageInfo.nextCursor;
    if (!next || cursors.has(next)) throw new Error('资源列表不完整：分页游标异常，请刷新资源。');
    cursors.add(next);
    cursor = next;
  }
  throw new Error('资源列表不完整：超过 15 页上限，暂不能选择加载，请缩小项目资源范围。');
}

function validateRuntime(value: UeRuntimeState, projectId: string): UeRuntimeState {
  if (value.projectId !== projectId || !uuid.test(value.revision)) throw new Error('运行状态身份不匹配，请刷新状态。');
  if (value.status === 'READY') {
    if (!uuid.test(value.robotResourceId) || !trustedPlayerUrl(value.playerUrl) || value.error !== null) throw new Error('播放器入口或模型状态无效，已隐藏画面。');
  } else {
    if (!['IDLE', 'DEPLOYING', 'FAILED', 'UNAVAILABLE', 'UNKNOWN'].includes(value.status) || value.playerUrl !== null) throw new Error('运行状态无效，已隐藏画面。');
    if (['FAILED', 'UNAVAILABLE', 'UNKNOWN'].includes(value.status) && (!value.error?.code || !value.error.message)) throw new Error('运行错误原因缺失，请刷新状态。');
  }
  return value;
}

async function readRuntime(projectId: string, signal: AbortSignal): Promise<UeRuntimeState> {
  return validateRuntime(apiData(await getProjectUeRuntime({ path: { projectId }, signal: requestSignal(signal, 10000) })), projectId);
}

export interface UeViewerState {
  projectId: string;
  robots: Resource[];
  resourcesComplete: boolean;
  loadingResources: boolean;
  selectedRobotId: string;
  runtime: UeRuntimeState | null;
  expectedRevision: string | null;
  deploying: boolean;
  checking: boolean;
  pollingPaused: boolean;
  error: string | null;
}

export function initialUeViewerState(projectId: string): UeViewerState {
  return { projectId, robots: [], resourcesComplete: false, loadingResources: true, selectedRobotId: '', runtime: null, expectedRevision: null, deploying: false, checking: false, pollingPaused: false, error: null };
}

export function currentPlayerUrl(state: UeViewerState): string | null {
  const runtime = state.runtime;
  return state.resourcesComplete && !state.error && !state.deploying && !state.pollingPaused && runtime?.status === 'READY'
    && runtime.projectId === state.projectId && runtime.robotResourceId === state.selectedRobotId
    && runtime.revision === state.expectedRevision && state.robots.some(robot => robot.id === runtime.robotResourceId)
    && trustedPlayerUrl(runtime.playerUrl) ? runtime.playerUrl : null;
}

/** One viewer's async lifetime; selection/unmount invalidates every earlier reply. */
export class UeViewerSession {
  state: UeViewerState;
  private generation = 0;
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(readonly projectId: string, private readonly onChange: (state: UeViewerState) => void) {
    this.state = initialUeViewerState(projectId);
  }

  private update(changes: Partial<UeViewerState>) {
    this.state = { ...this.state, ...changes };
    if (!this.disposed) this.onChange(this.state);
  }

  private begin(): number {
    this.controller.abort();
    this.controller = new AbortController();
    clearTimeout(this.timer);
    return ++this.generation;
  }

  private current(generation: number): boolean { return !this.disposed && generation === this.generation; }

  dispose() { this.disposed = true; this.begin(); }

  async loadResources(): Promise<void> {
    const generation = this.begin();
    this.update({ robots: [], resourcesComplete: false, loadingResources: true, selectedRobotId: '', runtime: null, expectedRevision: null, error: null, deploying: false, checking: false, pollingPaused: false });
    try {
      const [robots, runtime] = await Promise.all([fetchProjectRobots(this.projectId, this.controller.signal), readRuntime(this.projectId, this.controller.signal)]);
      if (this.current(generation)) this.update({ robots, resourcesComplete: true, loadingResources: false, runtime, expectedRevision: runtime.revision });
    } catch (error) {
      if (this.current(generation)) this.update({ loadingResources: false, resourcesComplete: false, robots: [], runtime: null, expectedRevision: null, error: `无法完整加载项目资源与运行状态：${error instanceof RuntimeApiError || error instanceof Error ? error.message : '请求失败'}` });
    }
  }

  select(robotId: string): void {
    this.begin();
    this.update({ selectedRobotId: robotId, runtime: null, expectedRevision: null, error: null, deploying: false, checking: false, pollingPaused: false });
    if (robotId) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.state.resourcesComplete) { await this.loadResources(); return; }
    const generation = this.begin();
    this.update({ runtime: null, expectedRevision: null, checking: true, error: null, pollingPaused: false });
    try {
      const runtime = await readRuntime(this.projectId, this.controller.signal);
      if (!this.current(generation)) return;
      this.update({ runtime, expectedRevision: runtime.revision, checking: false });
      this.poll(generation, Date.now() + pollWindowMs);
    } catch (error) {
      if (this.current(generation)) this.update({ checking: false, runtime: null, error: error instanceof RuntimeApiError ? error.message : '运行状态无法确认，画面已隐藏。请刷新状态；不要重复加载。' });
    }
  }

  async deploy(): Promise<void> {
    const { selectedRobotId, expectedRevision, resourcesComplete, deploying, runtime } = this.state;
    if (!resourcesComplete || deploying || !selectedRobotId || !expectedRevision || !runtime || ['UNKNOWN', 'DEPLOYING'].includes(runtime.status) || !this.state.robots.some(robot => robot.id === selectedRobotId)) return;
    const generation = this.begin();
    this.update({ deploying: true, runtime: null, expectedRevision: null, checking: false, error: null, pollingPaused: false });
    try {
      const response = apiData(await deployProjectUeRuntime({ path: { projectId: this.projectId }, body: { robotResourceId: selectedRobotId, expectedRevision }, signal: requestSignal(this.controller.signal, deployTimeoutMs) }));
      const verified = validateRuntime(response, this.projectId);
      if (!this.current(generation)) return;
      if (verified.status !== 'READY' || verified.robotResourceId !== selectedRobotId || verified.revision === expectedRevision) throw new Error('加载返回的模型或代次不匹配。');
      this.update({ deploying: false, runtime: verified, expectedRevision: verified.revision });
      this.poll(generation, Date.now() + pollWindowMs);
    } catch (error) {
      if (!this.current(generation)) return;
      const message = error instanceof RuntimeApiError ? error.message : '加载结果无法确认，已隐藏画面。请求中断不代表 UE 已停止；请刷新状态核验，不要重复提交。';
      this.update({ deploying: false, runtime: null, expectedRevision: null, error: message });
      // Observe after failure; never replay POST or revive an old rollback picture.
      try {
        const observed = await readRuntime(this.projectId, this.controller.signal);
        if (this.current(generation)) this.update({ runtime: observed, expectedRevision: observed.revision });
      } catch { /* Keep the safe uncertainty message and the player removed. */ }
    }
  }

  private poll(generation: number, deadline: number): void {
    if (!this.current(generation) || !this.state.selectedRobotId || !this.state.runtime || !['READY', 'DEPLOYING'].includes(this.state.runtime.status)) return;
    if (this.state.runtime.status === 'READY' && this.state.runtime.robotResourceId !== this.state.selectedRobotId) return;
    this.timer = setTimeout(async () => {
      if (!this.current(generation)) return;
      if (Date.now() >= deadline) { this.update({ runtime: null, expectedRevision: null, pollingPaused: true, error: '状态检查已到 10 分钟上限，画面已隐藏。请刷新状态继续。' }); return; }
      try {
        const expected = this.state.expectedRevision;
        const next = await readRuntime(this.projectId, this.controller.signal);
        if (!this.current(generation)) return;
        if (Date.now() >= deadline) { this.update({ runtime: null, expectedRevision: null, pollingPaused: true, error: '状态检查已到 10 分钟上限，画面已隐藏。请刷新状态继续。' }); return; }
        if (next.revision !== expected || (next.status === 'READY' && next.robotResourceId !== this.state.selectedRobotId)) {
          this.update({ runtime: null, expectedRevision: null, error: '运行模型或代次已改变，画面已隐藏。请刷新状态后确认选择。' });
          return;
        }
        this.update({ runtime: next, expectedRevision: next.revision });
        this.poll(generation, deadline);
      } catch (error) {
        if (this.current(generation)) this.update({ runtime: null, expectedRevision: null, error: error instanceof RuntimeApiError ? error.message : '无法核验当前模型，画面已隐藏。请刷新状态。' });
      }
    }, pollIntervalMs);
  }
}
