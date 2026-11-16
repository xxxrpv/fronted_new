/**
 * 管理新版页面的会话生命周期，网络细节与 React 渲染保持分离。
 * 页面只提交新消息；历史、摘要、版本和后台任务均以 Hub 返回结果为准。
 * SSE 断开后使用原运行及 Last-Event-ID 续读，绝不重新发送生成请求。
 * 发送或发布结果不明时保存原幂等意图，用户重试必须复用同一个键。
 * 浏览器只保存发布操作标识用于刷新恢复，不存聊天正文、Token 或模型文件。
 * 注销和项目切换时销毁订阅、轮询及未完成读取，阻止旧用户结果回写页面。
 */
import { registerConversationWriter } from '../embodex/conversation-storage';
import { HubApi, HubApiError } from './api';
import { mergeMessages, reduceMessages, readEvents, type Event } from './events';
import { initialHubState, type HubState, type History } from './types';

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Intent = { key: string; version: string };
const active = (status?: string) => status === 'QUEUED' || status === 'RUNNING' || status === 'UNKNOWN';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export class HubSession {
  state = initialHubState();
  private readonly lifecycle = new AbortController();
  private readonly api: HubApi;
  private disposed = false;
  private watching = false;
  private initializing = false;
  private refreshing = false;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: { key: string; content: string };
  private publicationIntent?: Intent;
  private previewIntent?: Intent;
  private storage?: StoragePort;
  private readonly storageKey: string;
  private readonly unregister: () => void;
  private readonly messageRuns = new Map<string, string>();

  constructor(readonly userId: string, readonly projectId: string, private readonly publishState: (state: HubState) => void,
    transport: typeof fetch = fetch, private readonly options: { pollMs?: number; storage?: StoragePort; onUnauthorized?: () => void } = {}) {
    this.api = new HubApi(projectId, transport, this.lifecycle.signal);
    this.storageKey = `embodix-hub:${userId}:${projectId}:publication`;
    try { this.storage = options.storage || globalThis.sessionStorage; } catch { /* 存储不可用不阻止服务器会话。 */ }
    this.unregister = registerConversationWriter(userId, () => {
      try { this.storage?.removeItem(this.storageKey); } catch { /* 注销不依赖浏览器存储权限。 */ }
      this.dispose(); this.publishState(initialHubState());
    });
  }

  private update(patch: Partial<HubState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.publishState(this.state);
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    if (error instanceof HubApiError && error.status === 401) this.options.onUnauthorized?.();
    this.update({ error: error instanceof Error ? error.message : '请求未完成，请刷新状态后核实。' });
  }
  private saveIntent(value: Intent | undefined) {
    try { if (value) this.storage?.setItem(this.storageKey, JSON.stringify(value)); else this.storage?.removeItem(this.storageKey); } catch { /* 隐私模式可以禁用 sessionStorage。 */ }
  }
  private readIntent() {
    try {
      const value = JSON.parse(this.storage?.getItem(this.storageKey) || 'null');
      if (uuid(value?.key) && uuid(value?.version)) this.publicationIntent = value;
    } catch { /* 无效的本地操作标识不能成为发布授权。 */ }
  }

  private history(value: History, replayRun?: string) {
    for (const row of value.messages) this.messageRuns.set(row.message.id, row.run_id);
    const rows = value.messages.filter(row => !replayRun || row.run_id !== replayRun || row.message.role === 'user');
    this.update({ messages: mergeMessages(this.state.messages, rows.map(row => row.message)), before: value.next_before });
  }

  async initialize() {
    if (this.initializing || this.disposed) return;
    this.initializing = true; this.update({ loading: true, error: null });
    try {
      const [history, versions, preview, project] = await Promise.all([this.api.history(), this.api.versions(), this.api.preview(), this.api.state()]);
      if (this.disposed) return;
      this.history(history, project.active_run_id || undefined);
      this.update({ versions: versions.versions, preview,
        selected: preview.version_id && versions.versions.some(v => v.version_id === preview.version_id) ? preview.version_id : versions.versions[0]?.version_id || null });
      this.readIntent();
      if (this.publicationIntent) await this.pollPublication();
      if (this.options.pollMs !== 0 && !this.timer) this.timer = setInterval(() => { void this.refresh(); }, this.options.pollMs || 2000);
      if (project.active_run_id) {
        const run = await this.api.run(project.active_run_id);
        this.update({ run, busy: active(run.status), paused: run.status === 'UNKNOWN' });
        if (run.status !== 'UNKNOWN') void this.watch(run.run_id);
      } else {
        // 已完成或失败的最近一轮也要恢复，避免刷新后失败变成无状态的用户消息。
        const latest = history.messages.at(-1)?.run_id;
        if (latest) {
          const run = await this.api.run(latest);
          this.update({ run, busy: active(run.status), paused: run.status === 'UNKNOWN',
            ...(run.error ? { error: run.error.message } : {}) });
        }
        // 普通追问不应抹掉先前的有效建议；按近期轮次恢复，不依赖模型文字判断。
        const recent = [...new Set(history.messages.map(row => row.run_id))].reverse().slice(0, 8);
        for (const rid of recent) {
          if (this.disposed) break;
          await this.restoreProposal(rid);
          if (this.state.proposal) break;
        }
      }
    } catch (error) { this.update({ loading: false }); this.fail(error); }
    finally { this.initializing = false; this.update({ loading: false }); }
  }

  async loadOlder() {
    if (this.state.before === null || this.disposed) return;
    try {
      const history = await this.api.history(this.state.before);
      for (const row of history.messages) this.messageRuns.set(row.message.id, row.run_id);
      this.update({ messages: mergeMessages(history.messages.map(row => row.message), this.state.messages), before: history.next_before });
    } catch (error) { this.fail(error); }
  }

  select(version: string) {
    if (this.state.versions.some(row => row.version_id === version)) this.update({ selected: version });
  }

  async refresh(clearError = false) {
    if (this.refreshing || this.disposed || this.initializing) return;
    if (clearError) this.update({ error: null });
    this.refreshing = true;
    try {
      const [versions, preview, project] = await Promise.all([this.api.versions(), this.api.preview(), this.api.state()]);
      // 新版本进入列表时选中它，与 Hub 自动切换的 UE 保持一致；没有新版本则保留手动选择。
      const latest = versions.versions.reduce<(typeof versions.versions)[number] | undefined>((a, b) => !a || b.number > a.number ? b : a, undefined);
      const newVersion = latest && !this.state.versions.some(v => v.version_id === latest.version_id);
      const selected = newVersion ? latest.version_id : versions.versions.some(v => v.version_id === this.state.selected) ? this.state.selected : latest?.version_id || null;
      const proposal = this.state.proposal && versions.versions.some(v => v.version_id === this.state.proposal?.versionId) ? this.state.proposal : null;
      this.update({ versions: versions.versions, preview, selected, proposal });
      await this.pollPublication();
      if (project.active_run_id && !this.watching) {
        const run = await this.api.run(project.active_run_id);
        const newRun = this.state.run?.run_id !== run.run_id;
        this.update({ run, busy: active(run.status), paused: true });
        if (newRun && run.status !== 'UNKNOWN') {
          // 从另一标签页发现的新运行，从零重放，先只保留该轮用户消息。
          const history = await this.api.history(); this.history(history, run.run_id); void this.watch(run.run_id);
        }
      } else if (!project.active_run_id && this.state.busy && !this.watching && this.state.run) {
        const run = await this.api.run(this.state.run.run_id);
        this.update({ run, busy: active(run.status), paused: run.status === 'UNKNOWN',
          ...(run.error ? { error: run.error.message } : {}) });
        this.history(await this.api.history());
      }
    } catch (error) { this.fail(error); }
    finally { this.refreshing = false; }
  }

  async send(content: string): Promise<boolean> {
    if (this.disposed || this.state.busy || this.state.sending || this.state.loading) return false;
    if (!this.pending) {
      if (!content.trim() || [...content].length > 16000) return false;
      this.pending = { key: crypto.randomUUID(), content: content.trim() };
    }
    this.update({ sending: true, error: null });
    try {
      const run = await this.api.send(this.pending.content, this.pending.key);
      if (run.run_id !== this.pending.key) throw new Error('运行标识与提交请求不一致。');
      this.pending = undefined;
      this.update({ pendingMessage: false, run, busy: active(run.status) });
      try { this.history(await this.api.history(), run.run_id); } catch (error) { this.fail(error); }
      void this.watch(run.run_id);
      return true;
    } catch (error) {
      if (error instanceof HubApiError && error.status < 500) this.pending = undefined;
      this.update({ pendingMessage: !!this.pending }); this.fail(error);
      if (error instanceof HubApiError && error.code === 'PROJECT_BUSY') await this.refresh();
      return false;
    } finally { this.update({ sending: false }); }
  }

  retryMessage() { return this.send(''); }

  async resume() {
    if (this.watching || this.disposed) return;
    this.update({ error: null });
    try {
      const project = await this.api.state();
      const rid = project.active_run_id || this.state.run?.run_id;
      if (rid) await this.watch(rid);
      else await this.refresh();
    } catch (error) { this.fail(error); }
  }

  private apply(event: Event, rid: string, customOnly = false): boolean {
    if (!customOnly && event.type === 'RUN_STARTED') {
      this.update({ run: { run_id: rid, status: 'RUNNING', error: null }, busy: true });
    }
    if (event.type === 'CUSTOM') {
      const value = event.value as { versionId?: unknown; number?: unknown } | undefined;
      if (event.name === 'ARTIFACT_PUBLICATION_PROPOSED' && uuid(value?.versionId) && Number.isSafeInteger(value?.number)
          && (!customOnly || this.state.versions.some(version => version.version_id === value.versionId))) {
        this.update({ proposal: { versionId: value.versionId, number: value!.number as number, runId: rid } });
      }
      if (event.name === 'ARTIFACT_VERSION_CREATED') void this.refresh();
    }
    if (!customOnly) {
      const before = new Set(this.state.messages.map(row => row.id));
      const messages = reduceMessages(this.state.messages, event);
      if (event.type !== 'MESSAGES_SNAPSHOT') for (const row of messages) if (!before.has(row.id)) this.messageRuns.set(row.id, rid);
      this.update({ messages });
    }
    return event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR';
  }

  private async restoreProposal(rid: string) {
    try {
      const response = await this.api.events(rid, 0, this.lifecycle.signal);
      if (response.ok) await readEvents(response, 0, event => this.apply(event, rid, true));
    } catch { /* 历史事件过期时仍可从版本列表发起用户确认发布。 */ }
  }

  private async watch(rid: string) {
    if (this.watching || this.disposed) return;
    this.watching = true; let cursor = 0;
    // 每次新订阅先从已保存历史中移除本轮助手片段，防止从零重放时重复拼接。
    this.update({ paused: false });
    try {
      const history = await this.api.history();
      for (const row of history.messages) this.messageRuns.set(row.message.id, row.run_id);
      this.update({ messages: this.state.messages.filter(row => row.role === 'user' || this.messageRuns.get(row.id) !== rid) });
      for (let attempt = 0; attempt < 5 && !this.disposed; attempt++) {
        try {
          const response = await this.api.events(rid, cursor, this.lifecycle.signal);
          if (response.status === 401) throw new HubApiError(401, 'AUTHENTICATION_REQUIRED', '登录状态已失效。');
          if (response.ok) cursor = await readEvents(response, cursor, (event, sequence) => {
            // 游标随成功消费的帧更新，后续网络异常也不会丢失已消费位置。
            const stop = this.apply(event, rid); cursor = sequence; return stop;
          });
          else if (response.status !== 410) throw new Error('事件订阅暂不可用。');
          const run = await this.api.run(rid);
          if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
            this.update({ run, busy: run.status === 'UNKNOWN', paused: run.status === 'UNKNOWN' });
            this.history(await this.api.history());
            if (run.error) this.update({ error: run.error.message });
            return;
          }
        } catch (error) {
          if (error instanceof HubApiError && error.status === 401) { this.fail(error); return; }
          if (attempt === 4) throw error;
        }
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); this.lifecycle.signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, 300 * (attempt + 1)); this.lifecycle.signal.addEventListener('abort', finish, { once: true });
        });
      }
      this.update({ paused: true, error: '事件连接已断开，可重新连接查看本轮结果；后台任务继续执行。' });
    } catch (error) { this.update({ paused: true }); this.fail(error); }
    finally { this.watching = false; void this.refresh(); }
  }

  async previewSelected(): Promise<boolean> {
    const version = this.state.selected;
    if (!version || this.disposed) return false;
    const intent = this.previewIntent?.version === version ? this.previewIntent : { key: crypto.randomUUID(), version };
    this.previewIntent = intent; this.update({ error: null });
    try {
      await this.api.selectPreview(version, intent.key);
      this.previewIntent = undefined;
      await this.refresh();
      return true;
    } catch (error) {
      if (error instanceof HubApiError && error.status < 500) this.previewIntent = undefined;
      this.fail(error);
      return false;
    }
  }

  async publishVersion(version: string): Promise<boolean> {
    if (this.disposed || this.state.publishing || active(this.state.publication?.status)) return false;
    if (!this.state.versions.some(v => v.version_id === version)) { this.update({ error: '该版本已不在列表中，请重新选择。' }); return false; }
    if (this.publicationIntent && this.publicationIntent.version !== version) {
      this.update({ error: '上一发布请求尚未确认，请先核实原版本的发布结果。' }); return false;
    }
    const intent = this.publicationIntent || { key: crypto.randomUUID(), version };
    this.publicationIntent = intent; this.saveIntent(intent);
    this.update({ publishing: true, pendingPublication: version, error: null });
    try {
      const accepted = await this.api.publish(version, intent.key);
      this.publicationIntent = { ...intent, key: accepted.operation_id }; this.saveIntent(this.publicationIntent);
      this.update({ pendingPublication: null }); await this.pollPublication();
      return true;
    } catch (error) {
      if (error instanceof HubApiError && error.status < 500) { this.publicationIntent = undefined; this.saveIntent(undefined); this.update({ pendingPublication: null }); }
      this.fail(error);
      return false;
    } finally { this.update({ publishing: false }); }
  }

  private async pollPublication() {
    const intent = this.publicationIntent;
    if (!intent) return;
    try {
      const op = await this.api.operation(intent.key);
      if (this.publicationIntent?.key !== intent.key) return;
      this.update({ publication: op, pendingPublication: null });
      // 保留最后的操作标识供页面刷新展示回执；终态不会继续阻塞新的显式发布。
      if (!active(op.status)) this.publicationIntent = undefined;
    } catch (error) {
      if (this.publicationIntent?.key !== intent.key) return;
      if (error instanceof HubApiError && error.status === 404) this.update({ pendingPublication: intent.version });
      else throw error;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.lifecycle.abort(); clearInterval(this.timer); this.unregister();
  }
}
