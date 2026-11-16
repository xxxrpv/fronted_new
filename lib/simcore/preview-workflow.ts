import type { SimcorePreviewStatus } from '../api/generated/types.gen';

export interface PreviewViewState {
  status: SimcorePreviewStatus | null;
  pending: 'start' | 'stop' | null;
  unavailable: boolean;
  error: string | null;
}

class PreviewResponseError extends Error {}

const states = ['idle', 'starting', 'running', 'cancelling', 'busy', 'unknown'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function parsePreviewStatus(value: unknown, projectId: string): SimcorePreviewStatus {
  if (!object(value) || value.ok !== true || !states.includes(String(value.executionState)) ||
    typeof value.running !== 'boolean' || value.running !== (value.executionState === 'running')) {
    throw new PreviewResponseError('预览状态响应不符合契约，请重新查询。');
  }
  const session = value.session;
  if (session !== null) {
    if (!object(session) || typeof session.sessionId !== 'string' || !uuid.test(session.sessionId) ||
      session.projectId !== projectId || session.isCurrentProject !== true || session.isOwner !== true ||
      typeof session.templateId !== 'string' || !session.templateId || session.templateId.length > 128 ||
      typeof session.startedAt !== 'string' || !Number.isFinite(Date.parse(session.startedAt)) ||
      typeof session.expiresAt !== 'string' || !Number.isFinite(Date.parse(session.expiresAt)) ||
      !Number.isInteger(session.remainingSeconds) || Number(session.remainingSeconds) < 0 || (!session.isMonitoring && Number(session.remainingSeconds) > 600) ||
      typeof session.streamUrl !== 'string' || !session.streamUrl ||
      (session.isMonitoring !== undefined && typeof session.isMonitoring !== 'boolean')) {
      throw new PreviewResponseError('预览会话身份或播放器配置无效，请重新查询。');
    }
    let url: URL;
    try { url = new URL(session.streamUrl); } catch { throw new PreviewResponseError('预览播放器配置无效。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new PreviewResponseError('预览播放器配置无效。');
  }
  if ((value.running && session === null) || (['idle', 'busy'].includes(String(value.executionState)) && session !== null)) {
    throw new PreviewResponseError('预览状态与会话不一致，请重新查询。');
  }
  return value as SimcorePreviewStatus;
}

function requestError(value: unknown): string {
  const error = object(value) && object(value.error) ? value.error : value;
  const code = object(error) && typeof error.code === 'string' ? error.code : '';
  return ({
    PREVIEW_START_PENDING: '启动已提交，等待执行节点确认；请勿重复启动。',
    PREVIEW_STOP_PENDING: '取消已提交，尚未确认退出；继续查询当前会话。',
    PREVIEW_UNKNOWN: '执行状态未知，尚未确认退出；当前会话身份已保留。',
    PREVIEW_SESSION_REQUIRED: '当前预览会话未确认，请刷新状态后再停止。',
    PREVIEW_STALE_SESSION: '显示的会话已过期，请刷新状态；未停止其他会话。',
    PREVIEW_NOT_CONFIGURED: '预览播放器尚未配置，请联系部署负责人。',
    SIMCORE_NOT_CONFIGURED: 'Simcore 执行节点或播放器尚未配置。',
    AUTHENTICATION_REQUIRED: '请先登录 EmbodiX。',
    PROJECT_NOT_FOUND: '项目不存在或无权访问。',
  } as Record<string, string>)[code] ?? '预览请求失败，状态尚未确认；请重新查询。';
}

async function responseData(request: () => Promise<Response>): Promise<unknown> {
  const response = await request();
  const data: unknown = await response.json();
  if (response.status !== 200) throw new PreviewResponseError(requestError(data));
  return data;
}

export function previewPresentation(view: PreviewViewState) {
  const status = view.status;
  const executionState = view.unavailable ? 'unknown' : status?.executionState;
  const canStart = !view.pending && executionState === 'idle';
  const isMonitoring = Boolean(status?.session?.isMonitoring);
  const canStop = !view.pending && Boolean(status?.session?.sessionId && status.session.isCurrentProject && status.session.isOwner && !isMonitoring);
  const streamUrl = !view.unavailable && status?.running && executionState === 'running' ? status.session?.streamUrl ?? null : null;
  const label = view.pending === 'start' ? '启动中 · 等待确认' : view.pending === 'stop' ? '取消中 · 等待退出确认' : ({
    idle: '未启动 · 就绪', starting: '启动中 · 等待确认', running: isMonitoring ? '训练监控中 · 视频待验证' : '引擎已运行 · 视频待验证',
    cancelling: '取消中 · 等待退出确认', busy: '执行节点被占用', unknown: '状态未知 · 未确认退出',
  } as Record<string, string>)[executionState ?? ''] ?? '正在查询预览状态';
  return { canStart, canStop, streamUrl, label };
}

// Mirrors the existing training scope coordinator, with a displayed Preview session as the mutation fence.
export class PreviewWorkflow {
  view: PreviewViewState = { status: null, pending: null, unavailable: false, error: null };
  private generation = 0;
  private read = 0;
  private appliedRead = 0;
  private disposed = false;

  constructor(readonly projectId: string, private readonly changed: (view: PreviewViewState) => void) {}

  activate() { this.disposed = false; }
  dispose() { this.disposed = true; this.generation++; this.read++; }
  private current(generation: number) { return !this.disposed && generation === this.generation; }
  private update(patch: Partial<PreviewViewState>) { this.view = { ...this.view, ...patch }; this.changed(this.view); }
  dismissError() { this.update({ error: null }); }

  async refresh(request: () => Promise<Response>) {
    const generation = this.generation;
    const read = ++this.read;
    try {
      const status = parsePreviewStatus(await responseData(request), this.projectId);
      if (!this.current(generation) || read < this.appliedRead) return;
      this.appliedRead = read;
      // A new displayed session invalidates an old stop, including its finally/error callbacks.
      if (this.view.pending && status.session?.sessionId && status.session.sessionId !== this.view.status?.session?.sessionId) {
        this.generation++;
        this.update({ pending: null });
      }
      this.update({ status, unavailable: false, error: null });
    } catch (error) {
      if (this.current(generation) && read >= this.appliedRead) {
        this.appliedRead = read;
        this.update({ unavailable: true, error: error instanceof PreviewResponseError ? error.message : '查询预览状态失败；会话身份已保留。' });
      }
    }
  }

  async start(request: () => Promise<Response>) {
    if (this.disposed || !previewPresentation(this.view).canStart) return;
    const generation = ++this.generation;
    this.read++;
    this.update({ pending: 'start', error: null });
    try {
      const status = parsePreviewStatus(await responseData(request), this.projectId);
      if (!status.running || !status.session) throw new PreviewResponseError('启动尚未确认；请继续查询当前会话。');
      if (!this.current(generation)) return;
      // A status read may discover a newer session while start's response is in flight.
      if (this.view.status?.session && this.view.status.session.sessionId !== status.session?.sessionId) return;
      this.appliedRead = ++this.read;
      this.update({ status, unavailable: false });
    } catch (error) {
      if (this.current(generation)) this.update({ unavailable: true, error: error instanceof PreviewResponseError ? error.message : '启动结果未知，请查询状态。' });
    } finally {
      if (this.current(generation)) this.update({ pending: null });
    }
  }

  async stop(sessionId: string, request: () => Promise<Response>) {
    if (this.disposed) return;
    if (!previewPresentation(this.view).canStop || this.view.status?.session?.sessionId !== sessionId) {
      this.update({ error: '当前预览会话未确认，请刷新状态后再停止。' });
      return;
    }
    const generation = ++this.generation;
    this.read++;
    this.update({ pending: 'stop', error: null });
    try {
      const data = await responseData(request);
      if (!object(data) || data.ok !== true || data.running !== false || data.stopped !== true) throw new PreviewResponseError('退出尚未确认；当前会话身份已保留。');
      if (!this.current(generation) || this.view.status?.session?.sessionId !== sessionId) return;
      this.appliedRead = ++this.read;
      this.update({ status: { ok: true, running: false, executionState: 'idle', session: null }, unavailable: false });
    } catch (error) {
      if (this.current(generation)) this.update({ unavailable: true, error: error instanceof PreviewResponseError ? error.message : '取消结果未知；当前会话身份已保留。' });
    } finally {
      if (this.current(generation)) this.update({ pending: null });
    }
  }
}
