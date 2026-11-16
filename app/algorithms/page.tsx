'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { KitWorkspace, formatTime, formatTokens, sessionStatus, priceText, schemaFields, algorithmExamples } from '../../lib/embodikit/workspace';
import { LoadState, Pager, dialogKeyDown } from '../../lib/embodikit/components';

export type EmbodiKitNav = 'overview' | 'catalog' | 'detail' | 'usage' | 'apikeys' | 'billing';

export default function AlgorithmsPage() {
  const params = useParams();
  const projectId = typeof params?.projectId === 'string' ? params.projectId : undefined;
  const auth = useAuth();
  if (auth.status !== 'authenticated') return <div className="ek-empty-state" role="status">{auth.status === 'loading' ? '正在验证登录…' : '请先登录 EmbodiX 后查看算法管理。'}</div>;
  return <AlgorithmsWorkspace key={`${auth.user?.id}:${projectId ?? ''}`} projectId={projectId} />;
}
function AlgorithmsWorkspace({ projectId }: { projectId?: string }) {
  const [workspace, setWorkspace] = useState<KitWorkspace | null>(null);
  const [, render] = useState(0);
  const [activeNav, changeActiveNav] = useState<EmbodiKitNav>('overview');
  const setActiveNav = (nav: EmbodiKitNav) => {
    if (nav === activeNav) return;
    workspace?.clearSecret(); workspace?.cancel(activeNav === 'apikeys' ? 'keys' : activeNav); workspace?.cancel('session');
    changeActiveNav(nav);
  };
  const [selectedRef, setSelectedRef] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogRobot, setCatalogRobot] = useState('all');
  const [catalogPage, setCatalogPage] = useState(1);
  const [robotOptions, setRobotOptions] = useState<string[]>([]);
  const [algorithmOptions, setAlgorithmOptions] = useState<Record<string, string>>({});
  const [usageTab, setUsageTab] = useState<'trend' | 'records'>('records');
  const [usageTimeFilter, setUsageTimeFilter] = useState('30d');
  const [usageAlgoFilter, setUsageAlgoFilter] = useState('all');
  const [usageKeyFilter, setUsageKeyFilter] = useState('all');
  const [usageStatusFilter, setUsageStatusFilter] = useState('all');
  const [recordsPage, setRecordsPage] = useState(1);
  const [breakdownPage, setBreakdownPage] = useState(1);
  const [keysPage, setKeysPage] = useState(1);
  const [billingPage, setBillingPage] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [requestsPage, setRequestsPage] = useState(1);
  const [usageRecordsPage, setUsageRecordsPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [codeType, setCodeType] = useState('');
  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [bootstrap, setBootstrap] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  useEffect(() => {
    const current = new KitWorkspace(projectId, () => render(value => value + 1));
    setWorkspace(current); void current.loadAccess();
    return () => current.dispose();
  }, [projectId]);
  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);
  const state = workspace?.state;
  const accessActive = state?.access?.state === 'ACTIVE';
  useEffect(() => {
    if (!workspace) return;
    const slot = activeNav === 'apikeys' ? 'keys' : activeNav;
    if (activeNav === 'catalog') {
      const timer = window.setTimeout(() => void workspace.loadCatalog(catalogSearch, catalogRobot, catalogPage), 180);
      return () => { window.clearTimeout(timer); workspace.cancel('catalog'); };
    }
    if (activeNav === 'detail' && selectedRef) void workspace.loadDetail(selectedRef);
    else if (accessActive && activeNav === 'overview') void workspace.loadOverview();
    else if (accessActive && activeNav === 'usage') void workspace.loadUsage(usageTab, usageTimeFilter, usageAlgoFilter, usageKeyFilter, usageStatusFilter, recordsPage, breakdownPage);
    else if (accessActive && activeNav === 'apikeys') void workspace.loadKeys(keysPage);
    else if (accessActive && activeNav === 'billing') void workspace.loadBilling(billingPage);
    return () => workspace.cancel(slot);
  }, [workspace, activeNav, selectedRef, catalogSearch, catalogRobot, catalogPage, accessActive, usageTab, usageTimeFilter, usageAlgoFilter, usageKeyFilter, usageStatusFilter, recordsPage, breakdownPage, keysPage, billingPage, refresh]);
  useEffect(() => {
    if (!workspace || !accessActive || activeNav !== 'usage') return;
    void workspace.loadFilters();
    return () => workspace.cancel('filters');
  }, [workspace, accessActive, activeNav]);
  useEffect(() => {
    if (!workspace || !accessActive || !sessionId || activeNav !== 'usage') return;
    void workspace.loadSession(sessionId, requestsPage, usageRecordsPage);
    return () => workspace.cancel('session');
  }, [workspace, accessActive, sessionId, requestsPage, usageRecordsPage, activeNav, refresh]);
  useEffect(() => {
    if (activeNav !== 'apikeys') { setIsCreateKeyModalOpen(false); workspace?.clearSecret(); }
    if (activeNav !== 'usage') setSessionId(null);
  }, [activeNav, workspace]);
  useEffect(() => {
    const catalog = state?.catalog;
    if (!catalog) return;
    setRobotOptions(previous => [...new Set([...previous, ...catalog.algorithms.flatMap(item => item.supported_robot_types)])].sort());
    setAlgorithmOptions(previous => ({ ...previous, ...Object.fromEntries(catalog.algorithms.map(item => [item.algorithm_ref, item.name])) }));
  }, [state?.catalog]);
  const showToast = (message: string) => setToastMessage(message);
  const handleCopyCode = async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast('✓ 已复制到剪贴板'); }
    catch { showToast('复制失败，请手动复制。'); }
  };
  const closeCreate = () => { setIsCreateKeyModalOpen(false); workspace?.clearSecret(); };
  const handleCreateApiKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await workspace?.createKey(workspace.state.pendingKeyName ?? newKeyName)) { setNewKeyName(''); setIsCreateKeyModalOpen(false); setKeysPage(1); }
  };
  const handleDeleteApiKey = (id: string, name: string) => {
    if (window.confirm(`禁用 ${name}？使用该 Key 的客户端会失去访问能力。`)) void workspace?.disableKey(id, keysPage);
  };
  const handleSyncData = () => { if (workspace && activeNav !== 'overview') workspace.invalidate(activeNav === 'apikeys' ? 'keys' : activeNav); setRefresh(value => value + 1); };
  const openSession = (id: string) => { workspace?.invalidate('session'); setSessionId(id); setRequestsPage(1); setUsageRecordsPage(1); };
  if (!workspace || !state) return <div className="ek-empty-state">正在加载…</div>;
  const selectedAlgo = state.detail;
  const examples = algorithmExamples(selectedAlgo);
  const activeExample = examples.find(item => item.key === codeType) ?? examples[0];
  const apiKeys = (state.keys?.api_keys ?? []).filter(item => item.enabled && item.scopes.includes('inference'));
  const filteredRecords = (state.sessions?.sessions ?? []).map(item => ({ id: item.session_id, time: formatTime(item.created_at), algorithm: algorithmOptions[item.algorithm_ref] ?? item.algorithm_ref, type: item.protocol === 'http' ? 'HTTP' : 'WebSocket', requestCount: item.successful_requests + item.failed_requests, successCount: item.successful_requests, failCount: item.failed_requests, status: sessionStatus(item.status), tokens: item.charged_tokens }));
  const isSyncing = Boolean(state.loading.usage);
  const catalogGroups = Object.entries((state.catalog?.algorithms ?? []).reduce<Record<string, NonNullable<typeof state.catalog>['algorithms']>>((groups, item) => { (groups[item.category || '其他算法'] ??= []).push(item); return groups; }, {}));
  const slot = activeNav === 'apikeys' ? 'keys' : activeNav;
  const accountView = !['catalog', 'detail'].includes(activeNav);
  const accountReady = !accountView || accessActive;
  const usageAlgorithms = [...new Set([...state.filterAlgorithms.map(item => item.algorithm_ref), ...Object.keys(algorithmOptions), ...(state.sessions?.sessions ?? []).map(item => item.algorithm_ref), ...(state.algorithmBreakdown?.items ?? []).flatMap(item => item.algorithm_ref ? [item.algorithm_ref] : [])])];
  const usageKeys = [...new Map([...state.filterKeys, ...(state.keyBreakdown?.items.flatMap(item => item.api_key ? [item.api_key] : []) ?? [])].map(item => [item.key_id, item])).values()];
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: '#ffffff' }}>

      {/* Toast 提示浮层 */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            color: '#ffffff',
            padding: '10px 22px',
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 9999,
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* 工作台主体 */}
      <div className="ek-layout">
        {/* 左侧侧边栏 (严格对标 概览.jpg / 算法目录.jpg) */}
        <aside className="ek-sidebar">
          <div className="ek-sidebar-top">
            <nav className="ek-nav-list">
              {/* 1. 概览 */}
              <button
                type="button"
                className={`ek-nav-item ${activeNav === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveNav('overview')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <span>概览</span>
              </button>

              {/* 2. 算法 */}
              <button
                type="button"
                className={`ek-nav-item ${activeNav === 'catalog' || activeNav === 'detail' ? 'active' : ''}`}
                onClick={() => setActiveNav('catalog')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span>算法</span>
              </button>

              {/* 3. 用量信息 */}
              <button
                type="button"
                className={`ek-nav-item ${activeNav === 'usage' ? 'active' : ''}`}
                onClick={() => setActiveNav('usage')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span>用量信息</span>
              </button>

              {/* 4. API Keys */}
              <button
                type="button"
                className={`ek-nav-item ${activeNav === 'apikeys' ? 'active' : ''}`}
                onClick={() => setActiveNav('apikeys')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5L11 9l-1.5-1.5L8 9l-2-2 3.5-3.5L11 5l1.5-1.5L14 5l1.5-1.5L17 5l4-3z" />
                  <circle cx="7.5" cy="16.5" r="4.5" />
                </svg>
                <span>API Keys</span>
              </button>

              {/* 5. 账单 */}
              <button
                type="button"
                className={`ek-nav-item ${activeNav === 'billing' ? 'active' : ''}`}
                onClick={() => setActiveNav('billing')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>账单</span>
              </button>
            </nav>
          </div>

          <div className="ek-sidebar-bottom">
            <button
              type="button"
              className="ek-logout-btn"
              disabled={state.busy}
              onClick={() => { void workspace.disconnect().then(() => window.dispatchEvent(new Event('embodikit-access-changed'))); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>退出账户</span>
            </button>
          </div>
        </aside>

        {/* 右侧核心内容区 */}
        <main className="ek-main">
          <div className="ek-main-content">
            <LoadState loading={state.loading.access} error={state.errors.access} retry={() => { void workspace.loadAccess(); }} />
            {state.actionError && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{state.actionError}</p>}
            <LoadState loading={accountReady && state.loading[slot]} error={state.errors[slot]} retry={handleSyncData} />

            {/* ========================================================
               视图 1: 概览 (Overview) - 参照 概览.jpg
               ======================================================== */}
            {activeNav === 'overview' && (
              <div>
                {/* 3 张顶部卡片 */}
                <div className="ek-metric-grid">
                  {/* 卡片 1: 可用 Token */}
                  <div className="ek-metric-card">
                    <div className="ek-metric-top">
                      <div className="ek-metric-icon-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="8" cy="8" r="6" />
                          <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                          <line x1="7" y1="6" x2="9" y2="10" />
                        </svg>
                        <span>可用 Token</span>
                      </div>
                      <div className="ek-metric-sparkline">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                          <polyline points="17 6 23 6 23 12" />
                        </svg>
                      </div>
                    </div>
                    <div>
                      <div className="ek-metric-value">{formatTokens(state.balance?.available_tokens)}</div>
                      <div className="ek-metric-subtext">EmbodiKit_Tokens</div>
                    </div>
                  </div>

                  {/* 卡片 2: 处理中 */}
                  <div className="ek-metric-card">
                    <div className="ek-metric-top">
                      <div className="ek-metric-icon-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>处理中</span>
                      </div>
                      <div className="ek-metric-sparkline">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                          <polyline points="17 6 23 6 23 12" />
                        </svg>
                      </div>
                    </div>
                    <div>
                      <div className="ek-metric-value">{formatTokens(state.balance?.processing_tokens)}</div>
                      <div className="ek-metric-subtext">已进入计费流程</div>
                    </div>
                  </div>

                  {/* 卡片 3: 累计消费 */}
                  <div className="ek-metric-card">
                    <div className="ek-metric-top">
                      <div className="ek-metric-icon-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </svg>
                        <span>累计消费</span>
                      </div>
                      <div className="ek-metric-sparkline">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                          <polyline points="17 6 23 6 23 12" />
                        </svg>
                      </div>
                    </div>
                    <div>
                      <div className="ek-metric-value highlight">{formatTokens(state.balance?.consumed_tokens)}</div>
                      <div className="ek-metric-subtext">更新于 {formatTime(state.balance?.updated_at)}</div>
                    </div>
                  </div>
                </div>

                {/* 蓝色左边线摘要条 */}
                <div className="ek-summary-strip">
                  <div className="ek-summary-item">
                    <span>请求</span>
                    <strong>{formatTokens(state.summary?.request_count)}</strong>
                  </div>
                  <div className="ek-summary-item">
                    <span>成功</span>
                    <strong style={{ color: '#16a34a' }}>{formatTokens(state.summary?.successful_requests)}</strong>
                  </div>
                  <div className="ek-summary-item">
                    <span>失败</span>
                    <strong style={{ color: '#ef4444' }}>{formatTokens(state.summary?.failed_requests)}</strong>
                  </div>
                  <div className="ek-summary-item">
                    <span>本期消费</span>
                    <strong>{formatTokens(state.summary?.charged_tokens)}</strong>
                  </div>
                </div>

                {/* 左右双栏：最近会话 & 最近流水 */}
                <div className="ek-two-col">
                  {/* 左：最近会话 */}
                  <div className="ek-card-box">
                    <div className="ek-card-header">
                      <h3>最近会话</h3>
                      <button
                        type="button"
                        className="ek-card-link"
                        onClick={() => {
                          setActiveNav('usage');
                          setUsageTab('records');
                        }}
                      >
                        <span>查看全部</span>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="7" y1="17" x2="17" y2="7" />
                          <polyline points="7 7 17 7 17 17" />
                        </svg>
                      </button>
                    </div>

                    <div className="ek-session-list">
                      {(state.recentSessions?.sessions ?? []).map(item => <div className="ek-session-row" key={item.session_id}><div className="ek-session-name">{item.algorithm_ref}</div><div className="ek-session-meta">{item.protocol} · {sessionStatus(item.status)} · {formatTime(item.created_at)}</div></div>)}
                      <LoadState empty={!state.loading.overview && !state.errors.overview && state.recentSessions?.sessions.length === 0} retry={handleSyncData} />
                    </div>
                  </div>

                  {/* 右：最近流水 */}
                  <div className="ek-card-box">
                    <div className="ek-card-header">
                      <h3>最近流水</h3>
                      <button
                        type="button"
                        className="ek-card-link"
                        onClick={() => setActiveNav('billing')}
                      >
                        <span>查看全部</span>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="7" y1="17" x2="17" y2="7" />
                          <polyline points="7 7 17 7 17 17" />
                        </svg>
                      </button>
                    </div>

                    <p style={{ fontSize: 12, color: '#64748b' }}>充值记录；推理消费请查看用量信息。</p>
                    <div className="ek-session-list">{(state.recentTransactions?.transactions ?? []).map(item => <div className="ek-session-row" key={item.transaction_id}><div className="ek-session-name">{item.display_name} · +{formatTokens(item.amount_tokens)} Token</div><div className="ek-session-meta">{formatTime(item.created_at)}</div></div>)}</div>
                    <LoadState empty={!state.loading.overview && !state.errors.overview && state.recentTransactions?.transactions.length === 0} retry={handleSyncData} />
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================
               视图 2: 算法目录 (Catalog) - 参照 算法目录.jpg
               ======================================================== */}
            {activeNav === 'catalog' && (
              <div>
                <h1 className="ek-title" style={{ marginBottom: 20 }}>算法目录</h1>

                {/* 搜索与筛选输入框 */}
                <div className="ek-filter-bar">
                  <div className="ek-search-box">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      className="ek-search-input"
                      placeholder="搜索算法名称或标识"
                      value={catalogSearch}
                      onChange={(e) => { workspace.invalidate('catalog'); setCatalogSearch(e.target.value); setCatalogPage(1); }}
                    />
                  </div>

                  <select
                    className="ek-select"
                    value={catalogRobot}
                    onChange={(e) => { workspace.invalidate('catalog'); setCatalogRobot(e.target.value); setCatalogPage(1); }}
                  >
                    <option value="all">全部机器人</option>
                    {robotOptions.map(robot => <option key={robot} value={robot}>{robot}</option>)}
                  </select>
                </div>

                {catalogGroups.map(([category, algorithms]) => <div style={{ marginBottom: 32 }} key={category}>
                  <div className="ek-category-label"><div className="ek-category-chip">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" />
                        <line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" />
                        <line x1="15" y1="20" x2="15" y2="23" />
                        <line x1="20" y1="9" x2="23" y2="9" />
                        <line x1="20" y1="14" x2="23" y2="14" />
                        <line x1="1" y1="9" x2="4" y2="9" />
                        <line x1="1" y1="14" x2="4" y2="14" />
                      </svg>
                    </div><span>{category}</span><span className="ek-category-count">{algorithms.length} 个算法</span></div>
                  <div className="ek-catalog-grid">{algorithms.map(item => <button type="button" className="ek-algo-card" key={item.algorithm_ref} onClick={() => { workspace.invalidate('detail'); setSelectedRef(item.algorithm_ref); setCodeType(''); setActiveNav('detail'); }} style={{ textAlign: 'left', font: 'inherit', color: 'inherit' }}>
                    <div><div className="ek-algo-card-top"><div className="ek-algo-badge-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg></div>
                      <div className="ek-algo-card-title">{item.name}</div><div className="ek-algo-card-sub">{item.algorithm_ref}</div><p className="ek-algo-card-desc">{item.description || '暂无算法说明'}</p>
                      {item.supported_robot_types.map(robot => <span className="ek-algo-tag" key={robot}>{robot}</span>)}
                    </div>
                    <div className="ek-algo-card-bottom"><div><span style={{ color: '#64748b' }}>{item.pricing?.billing_type === 'token_usage' ? '按用量计费 ' : '每次成功调用 '}</span><strong className="ek-algo-price">{priceText(item.pricing)}</strong></div><span className="ek-algo-detail-btn">查看详情</span></div>
                  </button>)}</div>
                </div>)}
                <LoadState empty={state.catalog?.algorithms.length === 0} retry={handleSyncData} />
                <Pager page={catalogPage} hasMore={state.catalog?.has_more ?? false} onChange={page => { workspace.invalidate('catalog'); setCatalogPage(page); }} disabled={state.loading.catalog} />
              </div>
            )}

            {/* ========================================================
               视图 3: 算法详情 (Detail) - 参照 算法.jpg
               ======================================================== */}
            {activeNav === 'detail' && (
              <div>
                {/* 返回算法目录按钮 */}
                <button
                  type="button"
                  className="ek-back-link"
                  onClick={() => setActiveNav('catalog')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                  <span>返回算法目录</span>
                </button>

                <h1 className="ek-title" style={{ marginBottom: 20 }}>{selectedAlgo?.name ?? selectedRef}</h1>

                {/* 顶部三栏元信息 */}
                <div className="ek-detail-status-strip">
                  <div className="ek-detail-status-col">
                    <div className="ek-detail-status-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
                        <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
                        <circle cx="12" cy="12" r="2" />
                        <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
                        <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
                      </svg>
                    </div>
                    <div className="ek-detail-status-text">
                      <small>服务状态</small>
                      <strong>{selectedAlgo ? selectedAlgo.availability.status === 'available' ? '当前可调用' : '暂不可用' : '—'}</strong>
                    </div>
                  </div>

                  <div className="ek-detail-status-col">
                    <div className="ek-detail-status-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    </div>
                    <div className="ek-detail-status-text">
                      <small>兼容机器人</small>
                      <strong>{selectedAlgo?.supported_robot_types.join('、') || '—'}</strong>
                    </div>
                  </div>

                  <div className="ek-detail-status-col">
                    <div className="ek-detail-status-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </div>
                    <div className="ek-detail-status-text">
                      <small>成功调用计费</small>
                      <strong>{priceText(selectedAlgo?.pricing)}</strong>
                    </div>
                  </div>
                </div>

                {selectedAlgo?.availability.reason && <p style={{ color: '#64748b' }}>{selectedAlgo.availability.reason}</p>}
                {([['输入字段', '发送推理请求时需要提供的字段。', selectedAlgo?.input_schema], ['输出字段', '成功响应中返回的算法结果。', selectedAlgo?.output_schema]] as const).map(([title, description, schema]) => <div className="ek-table-section" key={title}>
                  <h3 className="ek-table-section-title">{title}</h3><p className="ek-table-section-sub">{description}</p>
                  <table className="ek-spec-table"><tbody>{schemaFields(schema).map(field => <tr key={field.name}><td style={{ width: 280 }}><code style={{ fontWeight: 600, color: '#0f172a' }}>{field.name}</code>{field.required && <span className="ek-badge-req">必填</span>}</td><td style={{ width: 120, color: '#64748b' }}>{field.type}</td><td style={{ color: '#334155' }}>{field.description}</td></tr>)}</tbody></table>
                  {selectedAlgo && schemaFields(schema).length === 0 && <p className="ek-table-section-sub">该算法暂未公布字段级说明。</p>}
                </div>)}
                <div className="ek-table-section">
                  <div className="ek-code-header"><div><h3 className="ek-table-section-title">调用示例</h3><p className="ek-table-section-sub" style={{ margin: 0 }}>选择与你的客户端一致的调用方式。</p></div>
                    <div className="ek-code-pills">{examples.map(example => <button type="button" key={example.key} className={`ek-code-pill-btn ${activeExample?.key === example.key ? 'active' : ''}`} onClick={() => setCodeType(example.key)}>{example.label}</button>)}</div>
                  </div>
                  {activeExample ? <div className="ek-code-box"><button type="button" className="ek-copy-code-btn" onClick={() => { void handleCopyCode(activeExample.source); }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg><span>复制</span></button><pre><code>{activeExample.source}</code></pre></div> : <p className="ek-table-section-sub">该算法尚未提供公开调用示例。</p>}
                </div>
              </div>
            )}

            {/* ========================================================
               视图 4: 用量信息 (Usage) - 参照 用量信息.jpg / 调用记录.jpg
               ======================================================== */}
            {activeNav === 'usage' && (
              <div>
                <LoadState loading={state.loading.filters} error={state.errors.filters} retry={() => { void workspace.loadFilters(); }} />
                {/* 顶部 Tab 切换 */}
                <div className="ek-tabs-row">
                  <button
                    type="button"
                    className={`ek-tab-btn ${usageTab === 'trend' ? 'active' : ''}`}
                    onClick={() => { if (usageTab !== 'trend') { workspace.invalidate('usage'); setUsageTab('trend'); } }}
                  >
                    用量趋势
                  </button>
                  <button
                    type="button"
                    className={`ek-tab-btn ${usageTab === 'records' ? 'active' : ''}`}
                    onClick={() => { if (usageTab !== 'records') { workspace.invalidate('usage'); setUsageTab('records'); } }}
                  >
                    调用记录
                  </button>
                </div>

                {/* 筛选过滤条 (对标 调用记录.jpg) */}
                <div className="ek-filter-chips-row">
                  <div className="ek-filter-chips-left">
                    <select
                      className="ek-select"
                      value={usageTimeFilter}
                      onChange={(e) => { workspace.invalidate('usage'); setUsageTimeFilter(e.target.value); setRecordsPage(1); setBreakdownPage(1); setSessionId(null); }}
                    >
                      <option value="30d">时间维度 近 30 天</option>
                      <option value="7d">时间维度 近 7 天</option>
                      <option value="24h">时间维度 近 24 小时</option>
                      <option value="90d">时间维度 近 90 天</option>
                    </select>

                    <select
                      className="ek-select"
                      value={usageAlgoFilter}
                      onChange={(e) => { workspace.invalidate('usage'); setUsageAlgoFilter(e.target.value); setRecordsPage(1); setBreakdownPage(1); setSessionId(null); }}
                    >
                      <option value="all">算法 全部</option>
                      {usageAlgorithms.map(ref => <option key={ref} value={ref}>{state.filterAlgorithms.find(item => item.algorithm_ref === ref)?.name ?? algorithmOptions[ref] ?? ref}</option>)}
                    </select>

                    {usageTab === 'records' && <select
                      className="ek-select"
                      value={usageStatusFilter}
                      onChange={(e) => { workspace.invalidate('usage'); setUsageStatusFilter(e.target.value); setRecordsPage(1); setSessionId(null); }}
                    >
                      <option value="all">状态 全部</option>
                      <option value="closed">已完成</option>
                      <option value="failed">失败</option>
                      <option value="opening">正在建立</option>
                      <option value="active">处理中</option>
                    </select>}
                    <select className="ek-select" aria-label="API Key 用量筛选" value={usageKeyFilter} onChange={event => { workspace.invalidate('usage'); setUsageKeyFilter(event.target.value); setRecordsPage(1); setBreakdownPage(1); setSessionId(null); }}><option value="all">API Key 全部</option>{usageKeys.map(item => <option key={item.key_id} value={item.key_id}>{item.name}</option>)}{usageKeyFilter !== 'all' && !usageKeys.some(item => item.key_id === usageKeyFilter) && <option value={usageKeyFilter}>{usageKeyFilter}</option>}</select>

                    {(usageAlgoFilter !== 'all' || usageStatusFilter !== 'all' || usageTimeFilter !== '30d' || usageKeyFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          workspace.invalidate('usage'); setUsageAlgoFilter('all');
                          setUsageStatusFilter('all');
                          setUsageTimeFilter('30d'); setUsageKeyFilter('all'); setRecordsPage(1); setBreakdownPage(1); setSessionId(null);
                          showToast('已重置筛选条件');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          fontSize: 13,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        清除筛选条件
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncData}
                    disabled={isSyncing}
                    className="ek-sync-btn"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }}>
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    <span>同步</span>
                  </button>
                </div>

                {/* Tab 内容 1: 调用记录 */}
                {usageTab === 'records' && (
                  <div className="ek-card-box" style={{ padding: '22px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' }}>调用记录</h3>
                        <p style={{ fontSize: 12.5, color: '#64748b', margin: 0 }}>
                          HTTP 请求按次记录，WebSocket 按完整会话汇总。
                        </p>
                      </div>
                      <span style={{ fontSize: 12.5, color: '#64748b' }}>本页 {filteredRecords.length} 条</span>
                    </div>

                    <table className="ek-records-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>算法</th>
                          <th>调用类型</th>
                          <th>请求数</th>
                          <th>成功 / 失败</th>
                          <th>状态</th>
                          <th>实际消费</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.map((rec) => (
                          <tr key={rec.id}>
                            <td>{rec.time}</td>
                            <td style={{ fontWeight: 600 }}><button type="button" className="ek-card-link" onClick={() => openSession(rec.id)}>{rec.algorithm}</button></td>
                            <td>
                              <span className="ek-badge-protocol">
                                {rec.type === 'HTTP' ? (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="12" cy="12" r="10" />
                                      <line x1="2" y1="12" x2="22" y2="12" />
                                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                    </svg>
                                    <span>HTTP</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
                                      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
                                      <circle cx="12" cy="12" r="2" />
                                      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
                                      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
                                    </svg>
                                    <span>WebSocket</span>
                                  </>
                                )}
                              </span>
                            </td>
                            <td>{rec.requestCount}</td>
                            <td>
                              <span style={{ color: rec.successCount > 0 ? '#16a34a' : '#64748b', fontWeight: 600 }}>{rec.successCount}</span>
                              <span style={{ color: '#94a3b8' }}> / </span>
                              <span style={{ color: rec.failCount > 0 ? '#ef4444' : '#64748b', fontWeight: rec.failCount > 0 ? 600 : 'normal' }}>{rec.failCount}</span>
                            </td>
                            <td>
                              <span className="ek-badge-status-done" style={rec.status === '失败' ? { color: '#b91c1c', background: '#fef2f2' } : rec.status !== '已完成' ? { color: '#0369a1', background: '#f0f9ff' } : undefined}>
                                {rec.status === '已完成' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>}
                                <span>{rec.status}</span>
                              </span>
                            </td>
                            <td>
                              <strong style={{ color: rec.tokens > 0 ? '#0f172a' : '#94a3b8' }}>
                                {rec.tokens > 0 ? `${rec.tokens.toLocaleString()} Token` : '0 Token'}
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <LoadState empty={state.sessions?.sessions.length === 0} retry={handleSyncData} />
                    <Pager page={recordsPage} hasMore={state.sessions?.has_more ?? false} onChange={page => { workspace.invalidate('usage'); setRecordsPage(page); }} disabled={state.loading.usage} />
                  </div>
                )}

                {/* Tab 内容 2: 用量趋势 */}
                {usageTab === 'trend' && (
                  <div>
                    <div className="ek-metric-grid" style={{ marginBottom: 24 }}>
                      <div className="ek-metric-card">
                        <span style={{ fontSize: 13, color: '#64748b' }}>所选范围消费总量</span>
                        <div className="ek-metric-value" style={{ marginTop: 8 }}>{formatTokens(state.summary?.charged_tokens)} Token</div>
                        <span className="ek-metric-subtext">全部调用类型汇总</span>
                      </div>
                      <div className="ek-metric-card">
                        <span style={{ fontSize: 13, color: '#64748b' }}>成功调用率</span>
                        <div className="ek-metric-value" style={{ marginTop: 8, color: '#16a34a' }}>{state.summary ? state.summary.request_count ? `${(state.summary.successful_requests / state.summary.request_count * 100).toFixed(1)}%` : '—' : '—'}</div>
                        <span className="ek-metric-subtext">{formatTokens(state.summary?.successful_requests)} 成功 / {formatTokens(state.summary?.failed_requests)} 失败</span>
                      </div>
                      <div className="ek-metric-card">
                        <span style={{ fontSize: 13, color: '#64748b' }}>API 请求</span>
                        <div className="ek-metric-value" style={{ marginTop: 8 }}>{formatTokens(state.summary?.request_count)}</div>
                        <span className="ek-metric-subtext">所选时间范围</span>
                      </div>
                    </div>

                    <div className="ek-card-box">
                      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>Token 日度消耗趋势 (Tokens / Day)</h3>
                      {/* 上游日度消费 */}
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 180, paddingTop: 20, borderBottom: '1px solid #e2e8f0' }}>
                        {(state.series?.points ?? []).map((point, i) => { const d = { date: new Date(point.bucket_start).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }), val: point.charged_tokens }; return (
                          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                            <div
                              style={{
                                width: '100%',
                                maxWidth: 42,
                                height: `${Math.max(0, (d.val / Math.max(1, ...(state.series?.points ?? []).map(point => point.charged_tokens))) * 140)}px`,
                                background: d.val > 0 ? '#0284c7' : '#f1f5f9',
                                borderRadius: '4px 4px 0 0',
                                transition: 'all 0.3s ease',
                              }}
                              title={`${d.date}: ${d.val} Token`}
                            />
                            <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>{d.date}</span>
                          </div>
                        ); })}
                      </div>
                    </div>
                  </div>
                )}
                {usageTab === 'trend' && <>
                  <LoadState empty={state.series?.points.length === 0} retry={handleSyncData} />
                  {[['算法消费分布', state.algorithmBreakdown], ['按 API Key 查看用量', state.keyBreakdown]].map(([title, breakdown]) => {
                    const group = breakdown as typeof state.keyBreakdown;
                    return <div className="ek-card-box" style={{ marginTop: 20 }} key={String(title)}><h3>{String(title)}</h3><table className="ek-records-table"><thead><tr><th>算法 / API Key</th><th>请求</th><th>成功 / 失败</th><th>已用 Token</th></tr></thead><tbody>{group?.items.map((item, index) => <tr key={item.api_key?.key_id ?? item.algorithm_ref ?? index}><td>{item.api_key ? <button className="ek-card-link" type="button" onClick={() => { workspace.invalidate('usage'); setUsageKeyFilter(item.api_key!.key_id); setBreakdownPage(1); }}>{item.api_key.name} · {item.api_key.enabled ? '启用' : '已禁用'}</button> : item.algorithm_ref}</td><td>{item.request_count}</td><td>{item.successful_requests} / {item.failed_requests}</td><td>{formatTokens(item.charged_tokens)}</td></tr>)}</tbody></table><LoadState empty={group?.items.length === 0} retry={handleSyncData} /></div>;
                  })}
                  <Pager page={breakdownPage} hasMore={Boolean(state.algorithmBreakdown?.has_more || state.keyBreakdown?.has_more)} onChange={page => { workspace.invalidate('usage'); setBreakdownPage(page); }} disabled={state.loading.usage} />
                </>}
                {sessionId && <div className="ek-card-box" style={{ marginTop: 20 }}>
                  <button type="button" className="ek-back-link" onClick={() => setSessionId(null)}>关闭会话详情</button><h3>会话详情</h3>
                  <LoadState loading={state.loading.session} error={state.errors.session} retry={() => { void workspace.loadSession(sessionId, requestsPage, usageRecordsPage); }} />
                  {state.session && <p>{state.session.algorithm_ref} · {sessionStatus(state.session.status)} · {formatTokens(state.session.charged_tokens)} Token</p>}
                  <table className="ek-records-table"><thead><tr><th>请求时间</th><th>Request ID</th><th>状态</th><th>错误</th><th>消费</th></tr></thead><tbody>{state.requests?.requests.map(item => <tr key={item.request_id}><td>{formatTime(item.created_at)}</td><td>{item.request_id}</td><td>{item.status}</td><td>{item.error_code ?? '—'}</td><td>{formatTokens(item.charged_tokens)}</td></tr>)}</tbody></table>
                  <LoadState empty={state.requests?.requests.length === 0} retry={handleSyncData} /><Pager page={requestsPage} hasMore={state.requests?.has_more ?? false} onChange={page => { workspace.invalidate('session'); setRequestsPage(page); }} disabled={state.loading.session} />
                  <h3>已计费用量记录</h3><table className="ek-records-table"><thead><tr><th>时间</th><th>Request ID</th><th>计费方式</th><th>输入 / 输出 Token</th><th>已扣 Token</th></tr></thead><tbody>{state.usageRecords?.usage_records.map(item => <tr key={item.usage_id}><td>{formatTime(item.created_at)}</td><td>{item.request_id}</td><td>{item.billing_type}</td><td>{item.input_tokens} / {item.output_tokens}</td><td>{formatTokens(item.charged_tokens)}</td></tr>)}</tbody></table>
                  <LoadState empty={state.usageRecords?.usage_records.length === 0} retry={handleSyncData} /><Pager page={usageRecordsPage} hasMore={state.usageRecords?.has_more ?? false} onChange={page => { workspace.invalidate('session'); setUsageRecordsPage(page); }} disabled={state.loading.session} />
                </div>}
              </div>
            )}

            {/* ========================================================
               视图 5: API Keys - 参照 api key.jpg
               ======================================================== */}
            {activeNav === 'apikeys' && (
              <div>
                <div className="ek-header-row">
                  <h1 className="ek-title" style={{ margin: 0 }}>API Keys</h1>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="button"
                      className="ek-btn-secondary"
                      onClick={() => {
                        setActiveNav('usage');
                        setUsageTab('trend'); setUsageKeyFilter('all'); setBreakdownPage(1);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="20" x2="18" y2="10" />
                        <line x1="12" y1="20" x2="12" y2="4" />
                        <line x1="6" y1="20" x2="6" y2="14" />
                      </svg>
                      <span>按 API Key 查看用量</span>
                    </button>

                    <button
                      type="button"
                      className="ek-btn-primary"
                      disabled={state.busy || !accessActive} onClick={() => { setNewKeyName(state.pendingKeyName ?? ''); setIsCreateKeyModalOpen(true); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>创建 API Key</span>
                    </button>
                  </div>
                </div>

                {/* API Key 列表表格 (对标 api key.jpg) */}
                <div className="ek-card-box" style={{ padding: '0 24px 20px' }}>
                  <table className="ek-records-table">
                    <thead>
                      <tr>
                        <th>名称</th>
                        <th>Tracking ID</th>
                        <th>Key</th>
                        <th>创建日期</th>
                        <th>最近使用日期</th>
                        <th style={{ textAlign: 'right' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((item) => (
                        <tr key={item.key_id}>
                          <td style={{ fontWeight: 600 }}>{item.name}</td>
                          <td style={{ color: '#475569', fontFamily: 'monospace', fontSize: 12 }}>{item.key_id}</td>
                          <td>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: '#334155' }}>{item.key_prefix}••••••••</span>

                            </div>
                          </td>
                          <td style={{ color: '#64748b' }}>{formatTime(item.created_at)}</td>
                          <td style={{ color: '#64748b' }}>{formatTime(item.last_used_at)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="ek-action-icon-btn"
                              title="禁用此 API Key" disabled={state.busy}
                              onClick={() => handleDeleteApiKey(item.key_id, item.name)}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <LoadState empty={state.keys != null && apiKeys.length === 0} retry={handleSyncData} />
                  <Pager page={keysPage} hasMore={state.keys?.has_more ?? false} onChange={page => { workspace.invalidate('keys'); setKeysPage(page); }} disabled={state.loading.keys} />
                </div>

                {/* 创建 Key 弹窗 */}
                {isCreateKeyModalOpen && (
                  <div role="dialog" aria-modal="true" aria-label="创建 API Key" onKeyDown={event => dialogKeyDown(event, closeCreate)}
                    style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'rgba(15, 23, 42, 0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 9999,
                    }}
                  >
                    <div
                      style={{
                        background: '#ffffff',
                        borderRadius: 12,
                        padding: '24px 28px',
                        width: '100%',
                        maxWidth: 440,
                        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px', color: '#0f172a' }}>
                        创建新的 API Key
                      </h3>
                      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
                        为机械臂边缘节点或仿真器接口指定可追踪的调用凭据。
                      </p>

                      <form onSubmit={handleCreateApiKey}>
                        <div style={{ marginBottom: 20 }}>
                          <label htmlFor="kit-key-name" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                            Key 名称
                          </label>
                          <input
                            id="kit-key-name" type="text"
                            placeholder="例如：Robot-Arm-Primary"
                            value={state.pendingKeyName ?? newKeyName}
                            maxLength={200} disabled={state.busy || state.pendingKeyName !== null}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '9px 12px',
                              border: '1px solid #cbd5e1',
                              borderRadius: 6,
                              fontSize: 13.5,
                              boxSizing: 'border-box',
                            }}
                            autoFocus
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                          <button
                            type="button"
                            className="ek-btn-secondary"
                            onClick={closeCreate}
                          >
                            取消
                          </button>
                          <button type="submit" className="ek-btn-primary" disabled={state.busy || !(state.pendingKeyName ?? newKeyName).trim()}>
                            {state.busy ? '创建中…' : state.pendingKeyName ? '重试原请求' : '确认创建'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}

            {state.secret && <div role="dialog" aria-modal="true" aria-label="API Key 已创建" onKeyDown={event => dialogKeyDown(event, () => workspace.clearSecret())} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}><div style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', maxWidth: 440 }}><h3>API Key 已创建</h3><p style={{ color: '#64748b', fontSize: 13 }}>完整 Secret 仅显示一次，请立即保存。关闭后无法恢复。</p><code style={{ display: 'block', overflowWrap: 'anywhere', marginBottom: 18 }}>{state.secret}</code><button type="button" className="ek-btn-primary" autoFocus onClick={() => { void handleCopyCode(state.secret!); }}>复制</button><button type="button" className="ek-btn-secondary" style={{ marginLeft: 10 }} onClick={() => workspace.clearSecret()}>已保存，关闭</button></div></div>}

            {/* ========================================================
               视图 6: 账单 (Billing) - 完整闭环支持
               ======================================================== */}
            {activeNav === 'billing' && (
              <div>
                <h1 className="ek-title" style={{ marginBottom: 20 }}>账单与 Token 充值</h1>

                <div className="ek-metric-grid" style={{ marginBottom: 24 }}>
                  <div className="ek-metric-card">
                    <span style={{ fontSize: 13, color: '#64748b' }}>可用余额</span>
                    <div className="ek-metric-value" style={{ marginTop: 8 }}>{formatTokens(state.balance?.available_tokens)} Token</div>
                    <span className="ek-metric-subtext">EmbodiKit_Tokens</span>
                  </div>
                  <div className="ek-metric-card">
                    <span style={{ fontSize: 13, color: '#64748b' }}>已消费总计</span>
                    <div className="ek-metric-value" style={{ marginTop: 8 }}>{formatTokens(state.balance?.consumed_tokens)} Token</div>
                    <span className="ek-metric-subtext">EmbodiKit 累计消费</span>
                  </div>
                  <div className="ek-metric-card">
                    <span style={{ fontSize: 13, color: '#64748b' }}>账户状态</span>
                    <div className="ek-metric-value" style={{ marginTop: 8, color: '#16a34a' }}>{state.access?.profile?.status ?? '—'}</div>
                    <span className="ek-metric-subtext">当前绑定账户状态</span>
                  </div>
                </div>

                <div className="ek-card-box">
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px', color: '#0f172a' }}>Token 充值（暂不可用）</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                    {[
                      { tokens: '充值', price: '暂不可用', desc: '支付渠道尚未接入' },
                      { tokens: '账户余额', price: '暂不可用', desc: '余额由 EmbodiKit 返回', hot: true },
                      { tokens: '充值记录', price: '暂不可用', desc: '本期仅支持查询' },
                    ].map((pkg, i) => (
                      <div
                        key={i}
                        style={{
                          border: pkg.hot ? '2px solid #0284c7' : '1px solid #e2e8f0',
                          borderRadius: 10,
                          padding: '18px 20px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          background: pkg.hot ? '#f0f9ff' : '#ffffff',
                          cursor: 'default',
                        }}
                        aria-disabled="true"
                      >
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{pkg.tokens}</div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{pkg.desc}</div>
                        </div>
                        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong style={{ fontSize: 16, color: '#0284c7' }}>{pkg.price}</strong>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#0284c7' }}>暂不可用</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ek-card-box" style={{ marginTop: 24 }}><h3>充值记录</h3><p style={{ color: '#64748b', fontSize: 13 }}>此处仅展示充值流水，推理消费请查看用量信息。</p><table className="ek-records-table"><thead><tr><th>时间</th><th>类型</th><th>Token</th><th>充值后余额</th></tr></thead><tbody>{state.transactions?.transactions.map(item => <tr key={item.transaction_id}><td>{formatTime(item.created_at)}</td><td>{item.display_name}</td><td>+{formatTokens(item.amount_tokens)}</td><td>{formatTokens(item.balance_after_tokens)}</td></tr>)}</tbody></table><LoadState empty={state.transactions?.transactions.length === 0} retry={handleSyncData} /><Pager page={billingPage} hasMore={state.transactions?.has_more ?? false} onChange={page => { workspace.invalidate('billing'); setBillingPage(page); }} disabled={state.loading.billing} /></div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
