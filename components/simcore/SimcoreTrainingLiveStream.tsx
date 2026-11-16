'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Task } from '../../lib/api/generated/types.gen';
import { PreviewWorkflow, previewPresentation, type PreviewViewState } from '../../lib/simcore/preview-workflow';

interface SimcoreTrainingLiveStreamProps {
  projectId: string;
  activeTask: Task | null;
  onSwitchToResults?: () => void;
}

export default function SimcoreTrainingLiveStream({ projectId, activeTask, onSwitchToResults }: SimcoreTrainingLiveStreamProps) {
  const [view, setView] = useState<PreviewViewState>({
    status: null,
    pending: null,
    unavailable: false,
    error: null,
  });
  const [workflow] = useState(() => new PreviewWorkflow(projectId, setView));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeKey, setIframeKey] = useState(1);

  const previewPath = `/api/v1/projects/${encodeURIComponent(projectId)}/simcore/preview`;

  const fetchStatus = useCallback(() => {
    return workflow.refresh(() =>
      fetch(previewPath, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }),
    );
  }, [workflow, previewPath]);

  useEffect(() => {
    let active = true;
    workflow.activate();

    void fetchStatus();
    const interval = setInterval(() => {
      if (active) void fetchStatus();
    }, 3000);

    return () => {
      active = false;
      clearInterval(interval);
      workflow.dispose();
    };
  }, [workflow, fetchStatus]);

  const presentation = previewPresentation(view);
  const streamUrl = presentation.streamUrl;
  const isRunning = Boolean(view.status?.running);
  const status = view.status;

  // 全屏切换
  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  return (
    <article
      className="simcore2-panel"
      style={{
        padding: 0,
        overflow: 'hidden',
        background: '#090d16',
        border: '1px solid #1e293b',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
        borderRadius: 12,
      }}
    >
      {/* 视口顶部工具栏 */}
      <div
        style={{
          padding: '10px 16px',
          background: '#0f172a',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: streamUrl ? '#10b981' : '#f59e0b',
              boxShadow: streamUrl ? '0 0 8px #10b981' : 'none',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {streamUrl ? '3D 训练实时渲染监控 (Visible)' : '正在拉起 3D 渲染执行节点...'}
          </span>
          {activeTask && (
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>
              [{activeTask.id.slice(0, 8)}]
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onSwitchToResults && (
            <div
              style={{
                display: 'inline-flex',
                background: '#1e293b',
                padding: 2,
                borderRadius: 6,
                gap: 2,
                border: '1px solid #334155',
              }}
            >
              <button
                type="button"
                style={{
                  padding: '3px 9px',
                  fontSize: 11,
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'default',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffffff', display: 'inline-block' }} />
                3D 画面
              </button>
              <button
                type="button"
                onClick={onSwitchToResults}
                style={{
                  padding: '3px 9px',
                  fontSize: 11,
                  background: 'transparent',
                  color: '#94a3b8',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'color 0.15s ease',
                }}
                title="切换查看实时收敛指标与产物"
              >
                收敛曲线
              </button>
            </div>
          )}

          {streamUrl && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIframeKey((k) => k + 1)}
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  borderColor: '#334155',
                }}
                title="重新加载画面流"
              >
                🔄 刷新流
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleToggleFullscreen}
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  borderColor: '#334155',
                }}
                title="全屏显示"
              >
                ⛶ 全屏
              </button>
            </>
          )}
        </div>
      </div>

      {/* 实时视频展示区域 */}
      <div ref={containerRef} style={{ width: '100%', position: 'relative', background: '#090d16' }}>
        {streamUrl ? (
          <div>
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={streamUrl}
              title="Simcore Visible Training Stream"
              allow="autoplay; fullscreen; pointer-lock"
              style={{
                width: '100%',
                height: '460px',
                border: 'none',
                background: '#000000',
                display: 'block',
              }}
            />
            {/* 画面下方状态指示栏 */}
            <div
              style={{
                padding: '8px 16px',
                background: '#0a0f1d',
                borderTop: '1px solid #1e293b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#94a3b8',
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#10b981' }}>● Pixel Streaming 正常运行中</span>
                <span>💡 提示：在画面内点击可旋转视角与观察机器人动作</span>
              </div>
              {status?.session?.sessionId && (
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>
                  Session: {status.session.sessionId.slice(0, 8)}...
                </span>
              )}
            </div>
          </div>
        ) : (
          /* 占位等待卡片 */
          <div
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              minHeight: 460,
              background: 'radial-gradient(ellipse at top, #1e293b 0%, #090d16 100%)',
            }}
          >
            <div
              className="spinner"
              style={{
                width: 36,
                height: 36,
                borderColor: '#38bdf8',
                borderTopColor: 'transparent',
              }}
            />
            <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 600 }}>
              {view.unavailable ? '正在等待 3D 渲染执行节点响应...' : '正在同步 3D 仿真画面流...'}
            </div>
            <p style={{ color: '#94a3b8', fontSize: 12, maxWidth: 380, lineHeight: 1.6, margin: 0 }}>
              当前任务以 <strong>Visible 渲染模式</strong> 运行，计算节点正在初始化 WebRTC 视频流。
              视频流就绪后将在此实时渲染，训练完成后将自动切换展示收敛曲线与检查点产物。
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
