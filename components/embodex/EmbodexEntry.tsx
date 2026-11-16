/**
 * 在设计页面入口选择旧版或 Hub 新版，原有设计组件保持独立且不修改内部实现。
 * 模式来自后端 env 对应的公开枚举接口，浏览器不接触服务地址和服务 Token。
 * 运行时选择避免 NEXT_PUBLIC 构建开关与后端配置不一致，重启后端即可切换。
 * 模式查询失败时提供重试，不擅自回退到可能发起另一套任务的旧工作流。
 * 两套界面按需加载，不在同一页面同时创建旧聊天会话和 Hub 会话。
 */
'use client';

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { platformJson } from '../../lib/hub/api';

const Legacy = lazy(() => import('./EmbodexSchemeDesignPage'));
const Hub = lazy(() => import('../hub/HubWorkspace'));

export default function EmbodexEntry({ projectId, projectName }: { projectId?: string; projectName?: string }) {
  const [mode, setMode] = useState<'legacy' | 'hub' | null>(null);
  const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setMode(null); setError(false);
    void platformJson<{ mode: string }>('/api/v1/embodex/integration', { signal: abort.signal }).then(value => {
      if (value.mode !== 'hub' && value.mode !== 'legacy') throw new Error('invalid mode');
      if (!abort.signal.aborted) setMode(value.mode);
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [retry]);
  const loading = <p role="status" style={{ padding: 32 }}>正在打开方案设计…</p>;
  if (error) return <div role="alert" style={{ padding: 32 }}><p>暂时无法打开方案设计，请检查平台连接。</p><button type="button" className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>重试</button></div>;
  if (!mode) return loading;
  return <Suspense fallback={loading}>{mode === 'legacy' ? <Legacy projectId={projectId} /> : <Hub key={projectId} projectId={projectId} projectName={projectName} />}</Suspense>;
}
