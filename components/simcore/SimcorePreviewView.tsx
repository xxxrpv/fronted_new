'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SimcorePreviewSession as ApiPreviewSession, SimcorePreviewStatus, SimcorePreviewTemplate } from '../../lib/api/generated/types.gen';
import { PreviewWorkflow, previewPresentation, type PreviewViewState } from '../../lib/simcore/preview-workflow';

export interface SimcorePreviewSession extends ApiPreviewSession { sessionId: string; }
export type { SimcorePreviewStatus };
interface SimcorePreviewViewProps { projectId: string; }

export default function SimcorePreviewView({ projectId }: SimcorePreviewViewProps) {
  // A Project change unmounts its request coordinator before a new scope is displayed.
  return <ProjectPreview key={projectId} projectId={projectId} />;
}

function ProjectPreview({ projectId }: SimcorePreviewViewProps) {
  const [templates, setTemplates] = useState<SimcorePreviewTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [view, setView] = useState<PreviewViewState>({ status: null, pending: null, unavailable: false, error: null });
  const [workflow] = useState(() => new PreviewWorkflow(projectId, setView));
  const { status, error: errorMessage } = view;
  const isStarting = view.pending === 'start';
  const isStopping = view.pending === 'stop';
  const presentation = previewPresentation(view);
  const conflictNotice = status?.executionState === 'busy' ? 'ℹ️ 执行节点正在运行训练任务，当前项目暂时不能启动预览；训练结束后可在此启动 3D 预览。' : null;
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeKey, setIframeKey] = useState(1);
  const previewPath = '/api/v1/projects/' + encodeURIComponent(projectId) + '/simcore/preview';

  const fetchStatus = useCallback(() => workflow.refresh(() => fetch(previewPath, {
    headers: { Accept: 'application/json' }, cache: 'no-store',
  })), [workflow, previewPath]);

  useEffect(() => {
    let active = true;
    workflow.activate();
    const abort = new AbortController();
    async function loadTemplates() {
      try {
        const response = await fetch(previewPath + '/templates', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('模板目录暂不可用。');
        const data: { templates?: SimcorePreviewTemplate[] } = await response.json();
        const list = data.templates;
        if (!Array.isArray(list) || list.some(item => typeof item.id !== 'string' || !item.id || typeof item.name !== 'string')) throw new Error('模板目录响应无效。');
        if (active) {
          setTemplates(list);
          setSelectedTemplateId(current => current || list[0]?.id || '');
        }
      } catch {
        if (active) setTemplates([]);
      } finally {
        if (active) setLoadingTemplates(false);
      }
    }
    void loadTemplates();
    void fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => { active = false; abort.abort(); clearInterval(interval); workflow.dispose(); };
  }, [workflow, previewPath, fetchStatus]);

  useEffect(() => {
    setRemainingSeconds(status?.session?.remainingSeconds ?? 0);
  }, [status]);

  useEffect(() => {
    if (!status?.session) return;
    const timer = setInterval(() => setRemainingSeconds(current => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [status?.session?.sessionId]);

  const handleStart = async () => {
    if (!selectedTemplateId || loadingTemplates) return;
    await workflow.start(() => fetch(previewPath + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ templateId: selectedTemplateId }),
    }));
  };

  const handleStop = async () => {
    const sessionId = status?.session?.sessionId;
    if (!sessionId || !status?.session?.isCurrentProject || !status?.session?.isOwner) return;
    await workflow.stop(sessionId, () => fetch(previewPath + '/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sessionId }),
    }));
  };

  // 全屏切换
  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  // 格式化时间 mm:ss
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  const executionState = view.unavailable ? 'unknown' : status?.executionState;
  const isRunning = Boolean(status?.running) && executionState === 'running';
  const isTransitioning = executionState === 'starting' || executionState === 'cancelling';
  const hasSession = Boolean(status?.session);
  const isConflictRunning = status?.executionState === 'busy';
  const streamUrl = presentation.streamUrl;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 冲突提示条 */}
      {conflictNotice && (
        <div
          style={{
            padding: '12px 18px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 8,
            color: '#b45309',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {conflictNotice}
        </div>
      )}

      {/* 错误提示条 */}
      {errorMessage && (
        <div
          style={{
            padding: '12px 18px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#b91c1c',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => workflow.dismissError()}
            aria-label="关闭错误提示"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#b91c1c',
              fontWeight: 600,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 控制总面板 */}
      <article className="simcore2-panel" style={{ width: '100%' }}>
        <div className="simcore2-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="simcore2-panel-title">仿真器实时场景预览 (Live Preview)</span>
            {isRunning ? (
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 9999,
                  background: '#ecfdf5',
                  color: '#059669',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 8px #10b981',
                  }}
                />
                {presentation.label}
              </span>
            ) : (
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 9999,
                  background: '#f1f5f9',
                  color: '#64748b',
                }}
              >
                {presentation.label}
              </span>
            )}
          </div>

          {/* 10 分钟倒计时胶囊 */}
          {(isRunning || (hasSession && isTransitioning)) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 12px',
                borderRadius: 20,
                background: remainingSeconds <= 60 ? '#fef2f2' : '#f0f9ff',
                border: `1px solid ${remainingSeconds <= 60 ? '#f87171' : '#bae6fd'}`,
                color: remainingSeconds <= 60 ? '#dc2626' : '#0284c7',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>⏱️ {status?.session?.isMonitoring ? '训练实时监控中 (无时限)' : '剩余时限:'}</span>
              {!status?.session?.isMonitoring && (
                <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
                  {formatTime(remainingSeconds)}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>
                {status?.session?.isMonitoring ? '(画面随训练任务动态同步)' : '(到期请求取消，退出确认后释放)'}
              </span>
            </div>
          )}
        </div>

        {/* 控制表单栅格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 16,
            alignItems: 'flex-end',
            marginTop: 12,
          }}
        >
          <label className="simcore2-label" style={{ margin: 0 }}>
            <span>场景仿真模板</span>
            <select
              className="simcore2-select"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              disabled={!presentation.canStart || loadingTemplates}
            >
              {templates.length === 0 && (
                <option value="">
                  {loadingTemplates ? '加载模板列表中...' : '模板目录暂不可用'}
                </option>
              )}
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name || tpl.id} ({tpl.id})
                </option>
              ))}
            </select>
          </label>

          {/* 交互按钮组 */}
          <div style={{ display: 'flex', gap: 10 }}>
            {!hasSession ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStart}
                disabled={!presentation.canStart || loadingTemplates || !selectedTemplateId}
                style={{
                  minWidth: 150,
                  background: isConflictRunning ? '#94a3b8' : '#059669',
                  borderColor: isConflictRunning ? '#94a3b8' : '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {isStarting ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                    <span>正在拉起仿真引擎...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>Start Preview (启动)</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleStop}
                disabled={!presentation.canStop}
                title={status?.session?.isMonitoring ? '当前为训练监控流，请在训练页面停止任务' : undefined}
                style={{
                  minWidth: 150,
                  borderColor: '#ef4444',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {isStopping ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                    <span>正在停止...</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    <span>Stop Preview (停止)</span>
                  </>
                )}
              </button>
            )}

            {isRunning && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIframeKey((k) => k + 1)}
                  title="重新加载 WebRTC 视频流画面"
                  disabled={!streamUrl}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>刷新流</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleToggleFullscreen}
                  title="全屏查看"
                  disabled={!streamUrl}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                  <span>全屏</span>
                </button>
              </>
            )}
          </div>
        </div>
      </article>

      {/* 实时视频展示区域 */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          position: 'relative',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#090d16',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
          border: '1px solid #1e293b',
        }}
      >
        {streamUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={streamUrl}
              title="Simcore Pixel Streaming"
              allow="autoplay; fullscreen; pointer-lock"
              style={{
                width: '100%',
                height: '560px',
                border: 'none',
                background: '#000000',
                display: 'block',
              }}
            />
            {/* 画面下方状态指示栏 */}
            <div
              style={{
                padding: '10px 18px',
                background: '#0f172a',
                borderTop: '1px solid #1e293b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#94a3b8',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#10b981',
                    }}
                  />
                  已配置播放器 · 视频收帧待验证 · 会话 {status?.session?.sessionId}
                </span>
                <span>💡 提示：在画面内点击即可捕获鼠标视角，拖拽可旋转 3D 场景</span>
              </div>
              <div style={{ fontFamily: 'monospace', color: remainingSeconds <= 60 ? '#f87171' : '#38bdf8' }}>
                到期请求取消: {formatTime(remainingSeconds)}
              </div>
            </div>
          </div>
        ) : (
          /* 空态占位卡片 */
          <div
            style={{
              padding: '64px 32px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              background: 'radial-gradient(ellipse at top, #1e293b 0%, #090d16 100%)',
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: '#1e293b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
                boxShadow: '0 0 24px rgba(56, 189, 248, 0.15)',
              }}
            >
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.75">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M7 12h10" />
                <path d="M12 7v10" />
              </svg>
            </div>

            <div>
              <h3 style={{ color: '#f8fafc', fontSize: 18, fontWeight: 600, margin: '0 0 6px 0' }}>
                开启 3D 物理仿真环境实时视频预览
              </h3>
              <p style={{ color: '#94a3b8', fontSize: 13, maxWidth: 540, margin: '0 auto', lineHeight: 1.6 }}>
                {presentation.label}。
                {status?.session ? `会话 ${status.session.sessionId}；等待可信播放器和执行状态确认。` : '选择仿真场景并启动预览，实时查看机器人与环境的交互画面。'}
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 24,
                marginTop: 8,
                padding: '12px 24px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid #1e293b',
                fontSize: 12,
                color: '#64748b',
              }}
            >
              
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
