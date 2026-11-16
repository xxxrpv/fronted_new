/**
 * 新版设计工作区的稳定数据模型，对应 platform-v1 增量接口契约。
 * 保留 Hub 的运行、版本和操作标识，避免将版本号或消息 ID 混作发布依据。
 * 会话正文只存在服务器及当前页面内存，不建立第二套浏览器历史数据库。
 * UI 状态与 HTTP 实现分离，版本列表、预览和发布共用同一份页面状态。
 * 原生工具消息保留结构，界面可以展示工具进度和历史结果。
 */
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message { id: string; role: 'user' | 'assistant' | 'tool'; content?: string | null; toolCallId?: string; toolCalls?: ToolCall[] }
export interface History { messages: Array<{ seq: number; run_id: string; created_at: string; message: Message }>; next_before: number | null }
export interface Version { version_id: string; number: number; created_at: string; summary: string }
export interface Failure { code: string; message: string }
export interface Run { run_id: string; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; error?: Failure | null }
export interface Operation {
  operation_id: string; kind: 'PREVIEW' | 'PUBLISH'; version_id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELED';
  phase: string | null; error: Failure | null; result: { asset_id?: string; artifact_id?: string; file_name?: string } | null;
}
export interface Preview { status: string; version_id: string | null; player_url: string | null; error: Failure | null }
export interface Proposal { versionId: string; number: number; runId: string }
export interface HubState {
  loading: boolean; sending: boolean; busy: boolean; paused: boolean; error: string | null;
  messages: Message[]; before: number | null; versions: Version[]; selected: string | null;
  run: Run | null; preview: Preview; proposal: Proposal | null;
  publication: Operation | null; publishing: boolean; pendingMessage: boolean; pendingPublication: string | null;
}
export function initialHubState(): HubState {
  return { loading: true, sending: false, busy: false, paused: false, error: null, messages: [], before: null,
    versions: [], selected: null, run: null, preview: { status: 'IDLE', version_id: null, player_url: null, error: null },
    proposal: null, publication: null, publishing: false, pendingMessage: false, pendingPublication: null };
}
