'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth-context';
import { getEmbodiKitBalance } from '../api/client';
import { formatTokens } from './workspace';

export function dialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  if (event.key !== 'Tab') return;
  const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
  const first = elements[0]; const last = elements[elements.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
}

export function Pager({ page, hasMore, onChange, disabled = false }: { page: number; hasMore: boolean; onChange: (page: number) => void; disabled?: boolean }) {
  return <div className="ek-pagination-row"><button type="button" className="ek-page-btn" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>‹ 上一页</button><span className="ek-page-num">{page}</span><button type="button" className="ek-page-btn" disabled={disabled || !hasMore} onClick={() => onChange(page + 1)}>下一页 ›</button></div>;
}
export function LoadState({ loading, error, empty, retry }: { loading?: boolean; error?: string; empty?: boolean; retry: () => void }) {
  if (!loading && !error && !empty) return null;
  return <div className="ek-empty-state" role={error ? 'alert' : 'status'}><span>{loading ? '正在加载…' : error || '暂无数据。'}</span>{error && !loading ? <button type="button" className="ek-btn-secondary" onClick={retry}>重试</button> : null}</div>;
}

export function KitBalanceBadge({ projectId }: { projectId?: string }) {
  const auth = useAuth();
  const context = `${auth.status}:${auth.user?.id ?? ''}:${projectId ?? ''}`;
  const [value, setValue] = useState<{ context: string; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      setValue(null);
      if (auth.status !== 'authenticated') return;
      try {
        const result = await getEmbodiKitBalance({ query: projectId ? { projectId } : {}, signal: controller.signal, cache: 'no-store' });
        if (controller.signal.aborted || request !== sequence) return;
        setValue({ context, text: result.data ? `余额 ${formatTokens(result.data.available_tokens)} Token` : '余额暂不可用' });
      } catch { if (!controller.signal.aborted && request === sequence) setValue({ context, text: '余额暂不可用' }); }
    };
    void load();
    window.addEventListener('embodikit-access-changed', load);
    return () => { controller.abort(); window.removeEventListener('embodikit-access-changed', load); };
  }, [context, auth.status, projectId]);
  return <span>{value?.context === context ? value.text : auth.status === 'authenticated' ? '余额加载中…' : '余额暂不可用'}</span>;
}
