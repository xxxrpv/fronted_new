import {
  getEmbodiKitAccessSession, postEmbodiKitAccessSession, deleteEmbodiKitAccessSession,
  getEmbodiKitAlgorithms, getEmbodiKitAlgorithmsAlgorithmRef, getEmbodiKitBalance,
  getEmbodiKitUsageSummary, getEmbodiKitSessions, getEmbodiKitTransactions,
  getEmbodiKitUsageTimeseries, getEmbodiKitUsageBreakdown, getEmbodiKitApiKeys,
  postEmbodiKitApiKeys, deleteEmbodiKitApiKeysKeyId, getEmbodiKitSessionsSessionId,
  getEmbodiKitSessionsSessionIdRequests, getEmbodiKitUsage,
} from '../api/client';
import type {
  KitAccessState, KitPublicAlgorithmList, KitPublicAlgorithm, KitPublicBalance,
  KitPublicUsageSummary, KitPublicSessionPage, KitPublicTransactionPage,
  KitPublicTimeseries, KitPublicBreakdown, KitPublicApiKeyPage, KitPublicSession,
  KitPublicRequestPage, KitPublicUsagePage, KitQueryStatus, KitPublicPricing,
} from '../api/generated/types.gen';

export const formatTokens = (value: number | undefined | null) => value == null ? '—' : value.toLocaleString('zh-CN');
export const formatTime = (value: string | undefined | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
export const sessionStatus = (status: KitQueryStatus) => ({ opening: '正在建立', active: '处理中', closed: '已完成', failed: '失败' })[status];
export function priceText(price: KitPublicPricing | null | undefined) {
  if (!price) return '尚未发布';
  return price.billing_type === 'fixed_request' && price.tokens_per_request != null
    ? `${formatTokens(price.tokens_per_request)} Token` : price.display_name;
}
export function usageWindow(range: string, algorithm: string, apiKey: string, now = Date.now()) {
  const days = ({ '24h': 1, '7d': 7, '30d': 30, '90d': 90 } as Record<string, number>)[range] ?? 30;
  return { created_from: new Date(now - days * 86400000).toISOString(), created_to: new Date(now).toISOString(),
    ...(algorithm !== 'all' ? { algorithm_ref: algorithm } : {}), ...(apiKey !== 'all' ? { api_key_id: apiKey } : {}) };
}
export function schemaFields(schema: Record<string, unknown> | undefined) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  return Object.entries(properties).map(([name, value]) => {
    const field = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return { name, required: required.has(name), type: typeof field.type === 'string' ? field.type : 'any', description: typeof field.description === 'string' ? field.description : '—' };
  });
}
export function algorithmExamples(item: KitPublicAlgorithm | null) {
  return Object.entries(item?.examples ?? {}).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const example = value as Record<string, unknown>;
    const source = typeof example.source === 'string' ? example.source : typeof example.code === 'string' ? example.code : '';
    const protocol = typeof example.protocol === 'string' ? example.protocol : key;
    return source ? [{ key, label: protocol === 'sdk' || protocol === 'python' ? 'Python SDK' : protocol === 'websocket' ? 'WebSocket' : protocol === 'http' ? 'HTTP' : protocol, source }] : [];
  });
}

class KitRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(errorText(code)); }
}
function errorText(code: string) {
  return ({
    AUTHENTICATION_REQUIRED: '请先登录 EmbodiX。', PROJECT_NOT_FOUND: 'Project 不存在或无权访问。',
    EMBODIKIT_UNBOUND: '请连接已有的 EmbodiKit 账户。', EMBODIKIT_SESSION_EXPIRED: 'EmbodiKit 会话已过期，请重新连接。',
    EMBODIKIT_INVALID_CREDENTIAL: '账户凭证无效或已失效。', EMBODIKIT_ACCOUNT_DISABLED: 'EmbodiKit 账户已停用。',
    EMBODIKIT_BINDING_CONFLICT: '该 EmbodiKit 账户已绑定其他用户。', EMBODIKIT_ACCOUNT_MISMATCH: '请使用当前已绑定账户的凭证。',
    EMBODIKIT_FORBIDDEN: '当前凭证无权执行此操作。', EMBODIKIT_IDEMPOTENCY_CONFLICT: '创建请求冲突，请核实 Key 列表。',
    EMBODIKIT_WRITE_OUTCOME_UNKNOWN: '操作结果尚未确认，请核实状态。', EMBODIKIT_RATE_LIMITED: '请求过于频繁，请稍后重试。',
    EMBODIKIT_NOT_FOUND: '记录不存在。', EMBODIKIT_NOT_CONFIGURED: 'EmbodiKit 连接尚未配置。',
    EMBODIKIT_UNAVAILABLE: 'EmbodiKit 服务暂时不可用。', EMBODIKIT_TIMEOUT: 'EmbodiKit 请求超时。',
    INVALID_REQUEST: '请求参数无效。', EMBODIKIT_INVALID_RESPONSE: 'EmbodiKit 返回数据无效。',
  } as Record<string, string>)[code] ?? '请求失败，请重试。';
}
async function data<T>(promise: Promise<{ data?: T; error?: unknown; response?: Response }>): Promise<T> {
  const result = await promise;
  if (result.error || (result.response && !result.response.ok)) {
    const error = result.error as { error?: { code?: string } } | undefined;
    throw new KitRequestError(error?.error?.code ?? 'REQUEST_FAILED', result.response?.status ?? 0);
  }
  if (result.data == null && result.response?.status !== 204) throw new KitRequestError('EMBODIKIT_INVALID_RESPONSE', 502);
  return result.data as T;
}
type Slot = 'access' | 'overview' | 'catalog' | 'detail' | 'usage' | 'keys' | 'billing' | 'session' | 'filters';
export interface KitWorkspaceState {
  access: KitAccessState | null; catalog: KitPublicAlgorithmList | null; detail: KitPublicAlgorithm | null;
  balance: KitPublicBalance | null; summary: KitPublicUsageSummary | null;
  recentSessions: KitPublicSessionPage | null; recentTransactions: KitPublicTransactionPage | null;
  sessions: KitPublicSessionPage | null; series: KitPublicTimeseries | null;
  algorithmBreakdown: KitPublicBreakdown | null; keyBreakdown: KitPublicBreakdown | null;
  keys: KitPublicApiKeyPage | null; transactions: KitPublicTransactionPage | null;
  session: KitPublicSession | null; requests: KitPublicRequestPage | null; usageRecords: KitPublicUsagePage | null;
  filterAlgorithms: KitPublicAlgorithmList['algorithms']; filterKeys: KitPublicApiKeyPage['api_keys'];
  errors: Partial<Record<Slot, string>>; loading: Partial<Record<Slot, boolean>>;
  busy: boolean; secret: string | null; pendingKeyName: string | null; actionError: string | null;
}
const emptyAccount = { balance: null, summary: null, recentSessions: null, recentTransactions: null, sessions: null, series: null,
  algorithmBreakdown: null, keyBreakdown: null, keys: null, transactions: null, session: null, requests: null, usageRecords: null, filterAlgorithms: [], filterKeys: [] };

// One controller per authenticated User + Project mount; no shared account state or persisted browser secrets.
export class KitWorkspace {
  state: KitWorkspaceState = { ...emptyAccount, access: null, catalog: null, detail: null, errors: {}, loading: {}, busy: false, secret: null, pendingKeyName: null, actionError: null };
  private disposed = false;
  private reads = new Map<Slot, AbortController>();
  private action = new AbortController();
  private keyRequest: { name: string; key: string } | null = null;
  private revealSecret = false;
  constructor(readonly projectId: string | undefined, private changed: (state: KitWorkspaceState) => void) {}
  private update(patch: Partial<KitWorkspaceState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.changed(this.state);
  }
  private query() { return this.projectId ? { projectId: this.projectId } : {}; }
  private failure(reason: unknown) {
    if (reason instanceof KitRequestError && ['AUTHENTICATION_REQUIRED', 'EMBODIKIT_SESSION_EXPIRED', 'EMBODIKIT_UNBOUND', 'EMBODIKIT_INVALID_CREDENTIAL', 'EMBODIKIT_ACCOUNT_DISABLED', 'PROJECT_NOT_FOUND'].includes(reason.code)) {
      for (const [slot, controller] of this.reads) if (!['catalog', 'detail', 'access'].includes(slot)) controller.abort();
      this.clearAccount();
      if (['AUTHENTICATION_REQUIRED', 'PROJECT_NOT_FOUND'].includes(reason.code)) {
        for (const controller of this.reads.values()) controller.abort();
        this.update({ catalog: null, detail: null });
      }
      if (reason.code === 'EMBODIKIT_UNBOUND') this.update({ access: { state: 'UNBOUND', account_id: null, profile: null } });
      else this.update({ access: null });
    }
    return reason instanceof KitRequestError ? reason.message : '网络请求失败，请重试。';
  }
  private clearAccount() { this.keyRequest = null; this.revealSecret = false; this.update({ ...emptyAccount, secret: null, pendingKeyName: null }); }
  private async read(slot: Slot, clear: Partial<KitWorkspaceState>, request: (signal: AbortSignal) => Promise<Partial<KitWorkspaceState>>) {
    this.reads.get(slot)?.abort();
    const controller = new AbortController(); this.reads.set(slot, controller);
    this.update({ ...clear, loading: { ...this.state.loading, [slot]: true }, errors: { ...this.state.errors, [slot]: undefined } });
    try { const patch = await request(controller.signal); if (!controller.signal.aborted) this.update(patch); }
    catch (reason) { if (!controller.signal.aborted) { const message = this.failure(reason); this.update({ errors: { ...this.state.errors, [slot]: message } }); } }
    finally { if (this.reads.get(slot) === controller) this.update({ loading: { ...this.state.loading, [slot]: false } }); }
  }
  async loadAccess() {
    this.clearAccount();
    for (const [slot, controller] of this.reads) if (!['catalog', 'detail'].includes(slot)) controller.abort();
    await this.read('access', { access: null, ...emptyAccount }, async signal => ({ access: await data(getEmbodiKitAccessSession({ query: this.query(), signal, cache: 'no-store' })) }));
  }
  async loadFilters() {
    await this.read('filters', { filterAlgorithms: [], filterKeys: [] }, async signal => {
      // ponytail: cap filter sources at 10,000 rows and fail visibly; use upstream facets for larger catalogs.
      const algorithms = async () => {
        const items: KitPublicAlgorithmList['algorithms'] = [];
        for (let page = 1; !signal.aborted; page++) {
          const result = await data(getEmbodiKitAlgorithms({ query: { ...this.query(), page, page_size: 100 }, signal, cache: 'no-store' }));
          if (result.has_more && (result.algorithms.length === 0 || page >= 100)) throw new KitRequestError('EMBODIKIT_INVALID_RESPONSE', 502);
          items.push(...result.algorithms); if (!result.has_more) break;
        } return items;
      };
      const keys = async () => {
        const items: KitPublicApiKeyPage['api_keys'] = [];
        for (let page = 1; !signal.aborted; page++) {
          const result = await data(getEmbodiKitApiKeys({ query: { ...this.query(), page, page_size: 100, include_disabled: true }, signal, cache: 'no-store' }));
          if (result.has_more && (result.api_keys.length === 0 || page >= 100)) throw new KitRequestError('EMBODIKIT_INVALID_RESPONSE', 502);
          items.push(...result.api_keys.filter(item => item.scopes.includes('inference'))); if (!result.has_more) break;
        } return items;
      };
      const [filterAlgorithms, filterKeys] = await Promise.all([algorithms(), keys()]);
      return { filterAlgorithms, filterKeys };
    });
  }
  async loadCatalog(keyword: string, robot: string, page: number) {
    await this.read('catalog', { catalog: null }, async signal => ({ catalog: await data(getEmbodiKitAlgorithms({ query: { ...this.query(), keyword: keyword || undefined, robot_type: robot === 'all' ? undefined : robot, page, page_size: 20 }, signal, cache: 'no-store' })) }));
  }
  async loadDetail(ref: string) {
    await this.read('detail', { detail: null }, async signal => ({ detail: await data(getEmbodiKitAlgorithmsAlgorithmRef({ query: this.query(), path: { algorithm_ref: ref }, signal, cache: 'no-store' })) }));
  }
  async loadOverview() {
    await this.read('overview', { balance: null, summary: null, recentSessions: null, recentTransactions: null }, async signal => {
      const options = { query: this.query(), signal, cache: 'no-store' as const };
      const [balance, summary, recentSessions, recentTransactions] = await Promise.all([
        data(getEmbodiKitBalance(options)), data(getEmbodiKitUsageSummary(options)),
        data(getEmbodiKitSessions({ ...options, query: { ...this.query(), page: 1, page_size: 5 } })),
        data(getEmbodiKitTransactions({ ...options, query: { ...this.query(), page: 1, page_size: 5 } })),
      ]);
      return { balance, summary, recentSessions, recentTransactions };
    });
  }
  async loadUsage(view: 'records' | 'trend', range: string, algorithm: string, apiKey: string, status: string, page: number, breakdownPage = 1) {
    await this.read('usage', { sessions: null, summary: null, series: null, algorithmBreakdown: null, keyBreakdown: null }, async signal => {
      const query = { ...this.query(), ...usageWindow(range, algorithm, apiKey) };
      const options = { signal, cache: 'no-store' as const };
      if (view === 'records') return { sessions: await data(getEmbodiKitSessions({ ...options, query: { ...query, page, page_size: 25, status: status === 'all' ? undefined : status as KitQueryStatus } })) };
      const [summary, series, algorithmBreakdown, keyBreakdown] = await Promise.all([
        data(getEmbodiKitUsageSummary({ ...options, query })),
        data(getEmbodiKitUsageTimeseries({ ...options, query: { ...query, bucket: 'day', timezone: 'Asia/Shanghai', group_by: 'none' } })),
        data(getEmbodiKitUsageBreakdown({ ...options, query: { ...query, group_by: 'algorithm', page: breakdownPage, page_size: 20 } })),
        data(getEmbodiKitUsageBreakdown({ ...options, query: { ...query, group_by: 'api_key', page: breakdownPage, page_size: 20 } })),
      ]); return { summary, series, algorithmBreakdown, keyBreakdown };
    });
  }
  async loadKeys(page: number) {
    await this.read('keys', { keys: null }, async signal => ({ keys: await data(getEmbodiKitApiKeys({ query: { ...this.query(), page, page_size: 20 }, signal, cache: 'no-store' })) }));
  }
  async loadBilling(page: number) {
    await this.read('billing', { balance: null, transactions: null }, async signal => {
      const [balance, transactions] = await Promise.all([
        data(getEmbodiKitBalance({ query: this.query(), signal, cache: 'no-store' })),
        data(getEmbodiKitTransactions({ query: { ...this.query(), page, page_size: 20 }, signal, cache: 'no-store' })),
      ]); return { balance, transactions };
    });
  }
  async loadSession(id: string, page = 1, usagePage = 1) {
    await this.read('session', { session: null, requests: null, usageRecords: null }, async signal => {
      const options = { query: this.query(), signal, cache: 'no-store' as const, path: { session_id: id } };
      const [session, requests, usageRecords] = await Promise.all([
        data(getEmbodiKitSessionsSessionId(options)),
        data(getEmbodiKitSessionsSessionIdRequests({ ...options, query: { ...this.query(), page, page_size: 20 } })),
        data(getEmbodiKitUsage({ signal, cache: 'no-store', query: { ...this.query(), session_id: id, page: usagePage, page_size: 20 } })),
      ]); return { session, requests, usageRecords };
    });
  }
  async connect(bootstrap: string) {
    if (this.state.busy || this.disposed) return false;
    for (const controller of this.reads.values()) controller.abort();
    this.clearAccount(); this.update({ busy: true, actionError: null });
    try {
      const access = await data(postEmbodiKitAccessSession({ query: this.query(), body: { api_key: bootstrap }, signal: this.action.signal }));
      if (this.disposed) return false;
      this.update({ access, errors: { ...this.state.errors, access: undefined } }); return true;
    } catch (reason) { this.update({ access: null, actionError: `${this.failure(reason)} 连接操作不会自动重试。` }); return false; }
    finally { this.update({ busy: false }); }
  }
  async disconnect() {
    if (this.state.busy || this.disposed) return;
    for (const controller of this.reads.values()) controller.abort();
    this.clearAccount(); this.update({ access: null, busy: true, actionError: null, loading: {} });
    try { await data(deleteEmbodiKitAccessSession({ query: this.query(), signal: this.action.signal })); if (!this.disposed) await this.loadAccess(); }
    catch (reason) { this.update({ actionError: `${this.failure(reason)} 本地展示已清除；远端撤销尚未确认，可以再次退出。` }); }
    finally { this.update({ busy: false }); }
  }
  async createKey(name: string) {
    if (this.state.busy || this.disposed) return false;
    const trimmed = name.trim();
    if (!trimmed || [...trimmed].length > 200) { this.update({ actionError: 'Key 名称需为 1–200 个字符。' }); return false; }
    this.keyRequest ??= { name: trimmed, key: crypto.randomUUID() };
    const request = this.keyRequest;
    this.revealSecret = true;
    this.update({ busy: true, actionError: null, secret: null, pendingKeyName: request.name });
    try {
      const created = await data(postEmbodiKitApiKeys({ query: this.query(), body: { name: request.name, scopes: ['inference'] }, headers: { 'Idempotency-Key': request.key }, signal: this.action.signal }));
      if (this.disposed) return false;
      this.keyRequest = null;
      this.update({ secret: this.revealSecret ? created.secret ?? null : null, pendingKeyName: null, actionError: created.secret && this.revealSecret ? null : '请求已处理，完整 Secret 无法再次查看。若未保存，请禁用该 Key 后重新创建。' });
      await this.loadKeys(1); return true;
    } catch (reason) {
      const definitive = reason instanceof KitRequestError && [400, 403, 404, 409].includes(reason.status);
      if (definitive) { this.keyRequest = null; this.update({ pendingKeyName: null }); }
      this.update({ actionError: `${this.failure(reason)} ${definitive ? '请调整操作后重试。' : '使用原名称直接重试，将保持同一个幂等请求。'}` }); return false;
    }
    finally { this.update({ busy: false }); }
  }
  async disableKey(id: string, page: number) {
    if (this.state.busy || this.disposed) return;
    this.update({ busy: true, actionError: null });
    try { await data(deleteEmbodiKitApiKeysKeyId({ query: this.query(), path: { key_id: id }, signal: this.action.signal })); if (!this.disposed) await this.loadKeys(page); }
    catch (reason) { this.update({ actionError: `${this.failure(reason)} 请刷新 Key 列表核实禁用状态。` }); }
    finally { this.update({ busy: false }); }
  }
  clearSecret() { this.revealSecret = false; this.update({ secret: null }); }
  cancel(slot: Slot) { this.reads.get(slot)?.abort(); this.reads.delete(slot); }
  invalidate(slot: 'catalog' | 'detail' | 'usage' | 'session' | 'keys' | 'billing') {
    this.cancel(slot);
    const clear = slot === 'catalog' ? { catalog: null } : slot === 'detail' ? { detail: null }
      : slot === 'usage' ? { sessions: null, summary: null, series: null, algorithmBreakdown: null, keyBreakdown: null }
      : slot === 'keys' ? { keys: null } : slot === 'billing' ? { balance: null, transactions: null }
      : { session: null, requests: null, usageRecords: null };
    this.update({ ...clear, loading: { ...this.state.loading, [slot]: true }, errors: { ...this.state.errors, [slot]: undefined } });
  }
  dispose() { this.disposed = true; this.action.abort(); for (const controller of this.reads.values()) controller.abort(); this.keyRequest = null; this.state = { ...this.state, ...emptyAccount, access: null, secret: null, pendingKeyName: null }; }
}
