/**
 * 封装浏览器到 EmbodiX 平台的新版 HTTP 接口，不直接访问 Hub 或 Embodex。
 * 仅使用原平台登录 Cookie，前端没有服务 Token、内部地址和用户身份请求头。
 * 所有写操作要求调用方提供稳定幂等键，本文件不会隐藏重试生成或发布请求。
 * JSON 请求限制等待时间，SSE 的生命周期由会话控制器决定。
 * 统一处理平台错误，使登录失效与上游服务错误能够分别展示和处理。
 */
import type { History, Version, Preview, Run, Operation } from './types';

export class HubApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export async function platformJson<T>(url: string, options: RequestInit = {}, transport: typeof fetch = fetch): Promise<T> {
  const response = await transport(url, { credentials: 'same-origin', cache: 'no-store', ...options,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new HubApiError(response.status, data?.error?.code || 'REQUEST_FAILED',
    typeof data?.error?.message === 'string' ? data.error.message.slice(0, 500) : '请求失败，请刷新状态后重试。');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HubApiError(502, 'PROTOCOL_ERROR', '服务响应格式异常。');
  return data as T;
}

export class HubApi {
  readonly base: string;
  constructor(projectId: string, private readonly transport: typeof fetch = fetch, private readonly signal?: AbortSignal) {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('无效的项目标识');
    this.base = `/api/v1/projects/${encodeURIComponent(projectId)}/embodex-hub`;
  }
  private get<T>(path: string) { return platformJson<T>(this.base + path, { signal: this.signal }, this.transport); }
  private post<T>(path: string, body: unknown, key: string) {
    return platformJson<T>(this.base + path, { method: 'POST', signal: this.signal,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }, this.transport);
  }
  state() { return this.get<{ status: string; active_run_id: string | null }>(''); }
  history(before?: number) { return this.get<History>(`/messages?limit=50${before ? `&before=${before}` : ''}`); }
  versions() { return this.get<{ versions: Version[] }>('/versions'); }
  async urdf(versionId: string, signal?: AbortSignal): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new HubApiError(400, 'INVALID_REQUEST', '无效的模型版本标识。');
    const signals = [AbortSignal.timeout(15000)];
    if (this.signal) signals.push(this.signal);
    if (signal) signals.push(signal);
    const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

    const response = await this.transport.call(globalThis, `${this.base}/versions/${encodeURIComponent(versionId)}/urdf`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/xml, text/xml' },
      signal: combinedSignal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new HubApiError(
        response.status,
        data?.error?.code || 'REQUEST_FAILED',
        typeof data?.error?.message === 'string' ? data.error.message.slice(0, 500) : '读取模型 URDF 失败，请刷新状态后重试。'
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/xml') && !contentType.includes('text/xml')) {
      throw new HubApiError(502, 'PROTOCOL_ERROR', '服务未返回 XML 格式内容。');
    }

    const MAX_URDF_SIZE = 4 * 1024 * 1024;
    const reader = response.body?.getReader();
    let rawBytes: Uint8Array;

    if (!reader) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_URDF_SIZE) {
        throw new HubApiError(502, 'PROTOCOL_ERROR', '模型 URDF 内容为空或超出大小限制。');
      }
      rawBytes = new Uint8Array(buffer);
    } else {
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_URDF_SIZE) {
            throw new HubApiError(502, 'PROTOCOL_ERROR', '模型 URDF 大小超出限制。');
          }
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof HubApiError) throw err;
        throw new HubApiError(502, 'PROTOCOL_ERROR', '读取模型 URDF 中断。');
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }

      if (size === 0) {
        throw new HubApiError(502, 'PROTOCOL_ERROR', '模型 URDF 内容为空。');
      }

      rawBytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        rawBytes.set(chunk, offset);
        offset += chunk.length;
      }
    }

    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBytes);
    } catch {
      throw new HubApiError(502, 'PROTOCOL_ERROR', '模型 URDF 文本不是合法的 UTF-8 编码。');
    }
  }
  preview() { return this.get<Preview>('/preview'); }
  run(rid: string) { return this.get<Run>(`/runs/${encodeURIComponent(rid)}`); }
  operation(oid: string) { return this.get<Operation>(`/operations/${encodeURIComponent(oid)}`); }
  send(content: string, key: string) { return this.post<Run>('/messages', { content }, key); }
  selectPreview(version_id: string, key: string) { return this.post<{ operation_id: string; status: string }>('/preview', { version_id }, key); }
  publish(version_id: string, key: string) { return this.post<{ operation_id: string; status: string }>('/publications', { version_id }, key); }
  events(rid: string, cursor: number, signal: AbortSignal) {
    // 浏览器原生 fetch 要求 Window 调用上下文，不能作为 HubApi 实例方法执行。
    return this.transport.call(globalThis, `${this.base}/runs/${encodeURIComponent(rid)}/events`, { credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'Last-Event-ID': String(cursor), Accept: 'text/event-stream' } });
  }
}
