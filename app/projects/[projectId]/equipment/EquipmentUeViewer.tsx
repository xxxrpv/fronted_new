/**
 * 管理非标 UE 装载、状态轮询与观看授权的界面生命周期。
 * 遵循现代工业仿真交互规范：
 * 1. 顶栏一体化融合方案信息与仿真状态；
 * 2. 视口背景融入科技蓝微晕与 3D Blueprint CAD 网格暗纹；
 * 3. 视口中央直达「一键装载」大按钮，配有纯净矢量图标交互指引；
 * 4. 视口高度紧凑适配首屏（480px），悬浮毛玻璃 HUD 首屏完整可见；
 * 5. 右侧「设备规格与环境」侧边面板/抽屉：纯净工程规范排版（彻底去除 Emoji），磁贴网格化参数，支持外部遮罩一键收起。
 */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchEquipmentUeRuntime,
  createEquipmentUeLoad,
  fetchEquipmentUeLoadDetail,
  fetchEquipmentUeViewerAccess,
} from '../../../../lib/equipment/equipment-service';
import type {
  EquipmentAlternative,
  EquipmentConceptParameters,
  ProjectEquipmentUeDetail,
  ProjectEquipmentUeReceipt,
  ProjectEquipmentUeRuntime,
  ProjectEquipmentUeViewerAccess,
} from '../../../../lib/equipment/types';

export interface EquipmentUeViewerProps {
  projectId: string;
  batchId: string;
  alternativeId: string;
  alternativeTitle?: string;
  alternativeDisplayName?: string;
  previewAvailable: boolean;
  parameters?: EquipmentConceptParameters | null;
  alternative?: EquipmentAlternative | null;
}

type ViewerPhase =
  | 'idle'
  | 'checking_runtime'
  | 'dispatching'
  | 'polling'
  | 'acquiring_viewer'
  | 'ready'
  | 'error';

export default function EquipmentUeViewer({
  projectId,
  batchId,
  alternativeId,
  alternativeTitle,
  alternativeDisplayName,
  previewAvailable,
  parameters,
  alternative,
}: EquipmentUeViewerProps) {
  const [phase, setPhase] = useState<ViewerPhase>('idle');
  const [runtimeSlot, setRuntimeSlot] = useState<ProjectEquipmentUeRuntime | null>(null);
  const [, setOperationReceipt] = useState<ProjectEquipmentUeReceipt | null>(null);
  const [, setOperationDetail] = useState<ProjectEquipmentUeDetail | null>(null);
  const [viewerAccess, setViewerAccess] = useState<ProjectEquipmentUeViewerAccess | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pollingStatusText, setPollingStatusText] = useState<string>('');
  const [iframeKey, setIframeKey] = useState<number>(0);

  // 右侧设备规格与仿真环境面板展开状态
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  const activePollingRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeIdempotencyKeyRef = useRef<string | null>(null);
  const lastRevisionRef = useRef<string | null>(null);

  // 清理所有异步计时器与请求
  const cleanupAll = useCallback(() => {
    if (activePollingRef.current !== null) {
      window.clearInterval(activePollingRef.current);
      activePollingRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 当切换项目、批次或方案时，强制清理并重置状态，销毁旧 iframe
  useEffect(() => {
    cleanupAll();
    activeIdempotencyKeyRef.current = null;
    lastRevisionRef.current = null;
    setPhase('idle');
    setOperationReceipt(null);
    setOperationDetail(null);
    setViewerAccess(null);
    setErrorMessage(null);
    setPollingStatusText('');

    return () => {
      cleanupAll();
    };
  }, [projectId, batchId, alternativeId, cleanupAll]);

  // 查询运行时槽位状态
  const checkRuntime = useCallback(async () => {
    if (!projectId) return;
    try {
      const rt = await fetchEquipmentUeRuntime(projectId);
      setRuntimeSlot(rt);
      return rt;
    } catch (err: any) {
      console.warn('获取 UE 运行时槽位状态失败:', err);
      return null;
    }
  }, [projectId]);

  // 初始进入或方案就绪时拉取一次运行时槽位
  useEffect(() => {
    void checkRuntime();
  }, [checkRuntime]);

  // 启动 UE 装载状态机流程
  const handleStartLoad = useCallback(async (forceNewKey = false) => {
    if (!projectId || !batchId || !alternativeId || !previewAvailable) return;

    cleanupAll();
    setErrorMessage(null);
    setViewerAccess(null);
    setPhase('checking_runtime');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    try {
      // 1. 获取当前最新运行时槽位 revision
      const rt = await fetchEquipmentUeRuntime(projectId, signal);
      setRuntimeSlot(rt);

      if (!rt.controllable && rt.status !== 'idle') {
        throw new Error(`当前 UE 运行槽处于 [${rt.status}] 且不可控制，请稍后重试或等待槽空闲。`);
      }

      setPhase('dispatching');
      setPollingStatusText('正在发起 UE 场景装载...');

      // 2. 构造或复用幂等键并提交装载请求
      const revisionChanged = lastRevisionRef.current !== null && lastRevisionRef.current !== rt.revision;
      if (forceNewKey || !activeIdempotencyKeyRef.current || revisionChanged) {
        activeIdempotencyKeyRef.current = `ue-load-${batchId}-${alternativeId}-${Date.now().toString(36)}`;
      }
      lastRevisionRef.current = rt.revision;
      const idempotencyKey = activeIdempotencyKeyRef.current;
      const receipt = await createEquipmentUeLoad(
        projectId,
        batchId,
        alternativeId,
        idempotencyKey,
        rt.revision,
        signal
      );

      setOperationReceipt(receipt);

      // 3. 进入轮询阶段
      setPhase('polling');
      setPollingStatusText(`装载已受理，正在传输模型与网格优化...`);

      const opId = receipt.operationId;
      let attempts = 0;
      const maxAttempts = 60; // 最多轮询 90 秒
      let isTerminal = false;

      const pollStep = async () => {
        if (signal.aborted) return;
        attempts++;

        try {
          const detail = await fetchEquipmentUeLoadDetail(projectId, opId, signal);
          setOperationDetail(detail);

          if (detail.status === 'ready') {
            isTerminal = true;
            if (activePollingRef.current !== null) {
              window.clearInterval(activePollingRef.current);
              activePollingRef.current = null;
            }

            if (!detail.loadedIdentityVerified) {
              activeIdempotencyKeyRef.current = null;
              setPhase('error');
              setErrorMessage('UE 运行时模型身份校验未通过，已阻止接入。');
              return;
            }

            setPhase('acquiring_viewer');
            setPollingStatusText('正在建立受控视口连接...');

            try {
              const grant = await fetchEquipmentUeViewerAccess(projectId, opId, signal);
              setViewerAccess(grant);
              setPhase('ready');
              setPollingStatusText('场景装载完成');
            } catch (viewerErr: any) {
              if (signal.aborted) return;
              console.error('获取 UE 观看入口失败:', viewerErr);
              activeIdempotencyKeyRef.current = null;
              setPhase('error');
              setErrorMessage(viewerErr.message || '获取受控观看入口失败，请重试');
            }
          } else if (detail.status === 'failed' || detail.status === 'needs_attention') {
            isTerminal = true;
            if (activePollingRef.current !== null) {
              window.clearInterval(activePollingRef.current);
              activePollingRef.current = null;
            }
            activeIdempotencyKeyRef.current = null;
            setPhase('error');
            setErrorMessage(detail.error?.message || `UE 装载未完成 (状态: ${detail.status})`);
          } else {
            setPollingStatusText(`UE 正在加载解析模型... (${attempts * 1.5}s)`);
            if (attempts >= maxAttempts) {
              isTerminal = true;
              if (activePollingRef.current !== null) {
                window.clearInterval(activePollingRef.current);
                activePollingRef.current = null;
              }
              activeIdempotencyKeyRef.current = null;
              setPhase('error');
              setErrorMessage('UE 装载轮询超时，请检查 Windows UE 运行时是否启动。');
            }
          }
        } catch (pollErr: any) {
          if (signal.aborted) return;
          console.warn('UE 状态轮询抖动:', pollErr);
          if (attempts >= maxAttempts) {
            isTerminal = true;
            if (activePollingRef.current !== null) {
              window.clearInterval(activePollingRef.current);
              activePollingRef.current = null;
            }
            activeIdempotencyKeyRef.current = null;
            setPhase('error');
            setErrorMessage(pollErr.message || '获取 UE 装载状态失败');
          }
        }
      };

      await pollStep();

      if (!signal.aborted && !isTerminal) {
        activePollingRef.current = window.setInterval(() => {
          void pollStep();
        }, 1500);
      }
    } catch (err: any) {
      if (signal.aborted) return;
      cleanupAll();
      activeIdempotencyKeyRef.current = null;
      setPhase('error');
      setErrorMessage(err.message || '发起 UE 装载失败');
    }
  }, [projectId, batchId, alternativeId, previewAvailable, cleanupAll]);

  // 手动断开当前视口
  const handleDisconnect = useCallback(() => {
    cleanupAll();
    activeIdempotencyKeyRef.current = null;
    lastRevisionRef.current = null;
    setPhase('idle');
    setViewerAccess(null);
    setOperationDetail(null);
    setPollingStatusText('');
  }, [cleanupAll]);

  // 全屏切换
  const handleToggleFullscreen = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  }, []);

  // 视角重置 / 视口刷新
  const handleResetView = useCallback(() => {
    if (phase === 'ready' && viewerAccess?.viewerUrl) {
      setIframeKey((prev) => prev + 1);
    } else {
      void checkRuntime();
    }
  }, [phase, viewerAccess, checkRuntime]);

  const isLoading =
    phase === 'checking_runtime' ||
    phase === 'dispatching' ||
    phase === 'polling' ||
    phase === 'acquiring_viewer';

  const displayAltName = alternativeDisplayName || '当前方案';
  const displayAltTitle = alternativeTitle || alternative?.title || '参数化自动化装配机构与仿真单元';

  return (
    <div
      id="equipment-ue"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        borderRadius: 14,
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
      }}
    >
      {/* 1. 一体化工作台顶栏 (Header) */}
      <div
        style={{
          padding: '16px 22px',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
          borderBottom: '1px solid #f1f5f9',
          flexShrink: 0,
        }}
      >
        <div>
          {/* 方案主标题与状态标签行 (机构名称为主标题 + 方案徽标) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2px 8px',
                  borderRadius: 5,
                  background: '#0f172a',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.15)',
                }}
              >
                {displayAltName}
              </span>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#0f172a',
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                {displayAltTitle}
              </h3>
            </div>

            {/* 精简标签：仅保留核心资产就绪状态 */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: previewAvailable ? '#059669' : '#b45309',
                background: previewAvailable ? '#ecfdf5' : '#fffbeb',
                border: `1px solid ${previewAvailable ? '#a7f3d0' : '#fde68a'}`,
                padding: '2px 8px',
                borderRadius: 9999,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: previewAvailable ? '#10b981' : '#f59e0b',
                  display: 'inline-block',
                }}
              />
              <span>{previewAvailable ? '资产已就绪' : '等待资产'}</span>
            </span>
          </div>

          {/* 副标题描述 */}
          <div
            style={{
              fontSize: 12.5,
              color: '#64748b',
              margin: '4px 0 0',
              lineHeight: 1.4,
            }}
          >
            基于 Unreal Engine 的设备装配与交互预览
          </div>

          {/* 状态步骤面包屑流水线 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              marginTop: 10,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#10b981', fontWeight: 500 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>SolidWorks 已完成</span>
            </span>

            <span style={{ color: '#cbd5e1', fontSize: 11 }}>&gt;</span>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#10b981', fontWeight: 500 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>GLB 已就绪</span>
            </span>

            <span style={{ color: '#cbd5e1', fontSize: 11 }}>&gt;</span>

            {phase === 'ready' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#10b981', fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>UE 装载已完成</span>
              </span>
            ) : isLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#0284c7', fontWeight: 500 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    border: '2px solid #bae6fd',
                    borderTopColor: '#0284c7',
                    animation: 'spin 1s linear infinite',
                    display: 'inline-block',
                  }}
                />
                <span>UE 装载中...</span>
              </span>
            ) : phase === 'error' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ef4444', fontWeight: 500 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>装载异常</span>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#64748b' }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    border: '1.5px dashed #94a3b8',
                    display: 'inline-block',
                  }}
                />
                <span>等待 UE 装载</span>
              </span>
            )}
          </div>
        </div>

        {/* 右上角操作区：设备规格与仿真环境抽屉折叠按钮（细线纯 SVG 矢量图标） + 装载主按键 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 右侧滑出面板折叠按钮 */}
          <button
            type="button"
            onClick={() => setDrawerOpen((prev) => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 38,
              padding: '0 15px',
              borderRadius: 8,
              background: drawerOpen ? '#f0f9ff' : '#ffffff',
              color: drawerOpen ? '#0284c7' : '#334155',
              border: `1px solid ${drawerOpen ? '#7dd3fc' : '#e2e8f0'}`,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: drawerOpen ? '0 0 0 1px #7dd3fc' : '0 1px 2px rgba(0, 0, 0, 0.04)',
            }}
            title="点击展开/收起设备工况尺寸与仿真物理环境面板"
          >
            {/* 调谐器/规格滑块 SVG 图标 */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <span>设备规格与环境</span>
            {/* 展开指示小箭头 */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                marginLeft: 2,
                transform: drawerOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                color: drawerOpen ? '#0284c7' : '#94a3b8',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* 主装载按钮 */}
          {phase === 'idle' && (
            <button
              type="button"
              disabled={!previewAvailable}
              onClick={() => void handleStartLoad(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                height: 38,
                padding: '0 20px',
                borderRadius: 8,
                background: previewAvailable ? '#0f172a' : '#94a3b8',
                color: '#ffffff',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: previewAvailable ? 'pointer' : 'not-allowed',
                boxShadow: previewAvailable ? '0 2px 6px rgba(15, 23, 42, 0.2)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
              </svg>
              <span>装载到 UE</span>
            </button>
          )}

          {isLoading && (
            <button
              type="button"
              disabled
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                height: 38,
                padding: '0 20px',
                borderRadius: 8,
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'wait',
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  border: '2px solid #cbd5e1',
                  borderTopColor: '#0284c7',
                  animation: 'spin 1s linear infinite',
                  display: 'inline-block',
                }}
              />
              <span>正在装载...</span>
            </button>
          )}

          {phase === 'ready' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => void handleStartLoad(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 38,
                  padding: '0 16px',
                  borderRadius: 8,
                  background: '#f8fafc',
                  color: '#0f172a',
                  border: '1px solid #cbd5e1',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                title="重新向 UE 运行槽装载此方案"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                <span>重新装载</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 38,
                  padding: '0 14px',
                  borderRadius: 8,
                  background: '#ffffff',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                title="断开当前仿真并销毁凭据"
              >
                <span>断开</span>
              </button>
            </div>
          )}

          {phase === 'error' && (
            <button
              type="button"
              onClick={() => void handleStartLoad(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 38,
                padding: '0 18px',
                borderRadius: 8,
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>重试装载</span>
            </button>
          )}
        </div>
      </div>

      {/* 异常提示栏 */}
      {errorMessage && (
        <div
          style={{
            padding: '10px 18px',
            background: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>装载异常: {errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: 13 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. 中间大沉浸感视口 (垂直自适应撑满剩余高度，小屏 480px 兜底，带 Blueprint CAD 网格暗纹) */}
      <div
        ref={viewportRef}
        style={{
          position: 'relative',
          width: '100%',
          flex: 1,
          minHeight: 480,
          background:
            phase === 'ready'
              ? '#000000'
              : 'radial-gradient(circle at 50% 45%, rgba(14, 165, 233, 0.08) 0%, rgba(9, 13, 22, 0) 65%), linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px) 0 0 / 36px 36px, linear-gradient(to bottom, rgba(255, 255, 255, 0.035) 1px, transparent 1px) 0 0 / 36px 36px, #090d16',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {phase === 'ready' && viewerAccess?.viewerUrl ? (
          <iframe
            key={iframeKey}
            src={viewerAccess.viewerUrl}
            title="非标自动化设备 UE 交互仿真视口"
            sandbox="allow-scripts allow-same-origin"
            allow="fullscreen"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#000000',
            }}
          />
        ) : phase === 'idle' ? (
          /* 未装载状态占位：居中大屏图标 + 提示 + 一键装载行动卡片 + 纯净矢量指引标签 */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '24px 32px',
              zIndex: 2,
            }}
          >
            {/* 精美玻璃拟态屏幕方框图标 */}
            <div
              style={{
                width: 68,
                height: 56,
                borderRadius: 14,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
              }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <polygon points="10 8 16 11 10 14" fill="#94a3b8" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>

            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: '#f8fafc',
                letterSpacing: '0.02em',
                marginBottom: 6,
              }}
            >
              设备尚未装载
            </div>

            <div
              style={{
                fontSize: 12.5,
                color: '#94a3b8',
                maxWidth: 440,
                lineHeight: 1.5,
              }}
            >
              当前方案已完成 SolidWorks 参数化装配建模，点击下方或右上角按钮装载至 UE 交互仿真
            </div>

            {/* 视口中央直达主按钮 */}
            <button
              type="button"
              disabled={!previewAvailable}
              onClick={() => void handleStartLoad(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
                padding: '9px 24px',
                borderRadius: 24,
                background: previewAvailable ? '#0284c7' : '#334155',
                color: '#ffffff',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: previewAvailable ? 'pointer' : 'not-allowed',
                boxShadow: previewAvailable ? '0 4px 16px rgba(2, 132, 199, 0.4)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
              </svg>
              <span>一键装载到 UE 视口</span>
            </button>
          </div>
        ) : phase === 'error' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 32,
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 12,
                background: 'rgba(239, 68, 68, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fca5a5', marginBottom: 6 }}>
              UE 模型装载遇到异常
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', maxWidth: 460, lineHeight: 1.5, marginBottom: 16 }}>
              {errorMessage || '装载通信异常或物理引擎加载失败，请确认 Windows UE 仿真程序已开启。'}
            </div>
            <button
              type="button"
              onClick={() => void handleStartLoad(true)}
              style={{
                padding: '7px 18px',
                borderRadius: 20,
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重新尝试装载
            </button>
          </div>
        ) : (
          /* 装载中过渡动画 */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 32,
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                border: '3px solid rgba(255, 255, 255, 0.1)',
                borderTopColor: '#38bdf8',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: 16,
              }}
            />
            <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 6 }}>
              正在装载设备模型至 UE 仿真视口...
            </div>
            <div style={{ fontSize: 12.5, color: '#38bdf8', maxWidth: 460, lineHeight: 1.5 }}>
              {pollingStatusText || '正在与 UE 运行槽通信并同步装配体网格...'}
            </div>
          </div>
        )}

        {/* 视口底部半透明毛玻璃浮层 HUD 工具条 */}
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 16,
            right: 16,
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 10,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 10,
            pointerEvents: 'auto',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          {/* 左侧：运行状态 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#e2e8f0' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  phase === 'ready'
                    ? '#10b981'
                    : isLoading
                    ? '#0284c7'
                    : phase === 'error'
                    ? '#ef4444'
                    : '#94a3b8',
                boxShadow: phase === 'ready' ? '0 0 8px rgba(16, 185, 129, 0.8)' : 'none',
                display: 'inline-block',
              }}
            />
            <span style={{ fontWeight: 500 }}>
              {phase === 'ready'
                ? 'UE 视口 · 交互就绪'
                : isLoading
                ? 'UE 视口 · 装载中...'
                : phase === 'error'
                ? 'UE 视口 · 装载异常'
                : 'UE 视口 · 未装载'}
            </span>
          </div>

          {/* 右侧：视角与侧栏工具（纯净 SVG 图标） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => setDrawerOpen((prev) => !prev)}
              title="设备工况尺寸与仿真物理环境面板"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 6,
                background: drawerOpen ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: drawerOpen ? '#38bdf8' : '#cbd5e1',
                fontSize: 11.5,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
              </svg>
              <span>规格参数</span>
              <span style={{ fontSize: 9 }}>{drawerOpen ? '✕' : '◀'}</span>
            </button>
            <button
              type="button"
              onClick={handleResetView}
              title="复位视角 / 刷新通信"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                color: '#cbd5e1',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleToggleFullscreen}
              title="全屏视口"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                color: '#cbd5e1',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
          </div>
        </div>

        {/* 4. 抽屉背景半透明遮罩 (点击遮罩收起抽屉) */}
        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.45)',
              zIndex: 20,
              cursor: 'pointer',
              transition: 'opacity 0.2s ease',
            }}
          />
        )}

        {/* 5. 右侧滑出抽屉 (Slide-over Drawer) - 纯净工程规范排版（彻底去除 Emoji） */}
        {drawerOpen && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 370,
              background: '#ffffff',
              borderLeft: '1px solid #e2e8f0',
              boxShadow: '-8px 0 28px rgba(0, 0, 0, 0.18)',
              zIndex: 25,
              display: 'flex',
              flexDirection: 'column',
              animation: 'slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* 抽屉头部 */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 6,
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#0284c7',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="21" x2="4" y2="14" />
                    <line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" />
                    <line x1="20" y1="12" x2="20" y2="3" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                    设备规格与仿真环境
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                    参数化工况 · 机构工程特性 · 仿真物理内核
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: '#f1f5f9',
                  border: 'none',
                  color: '#64748b',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                title="关闭侧边栏"
              >
                ✕
              </button>
            </div>

            {/* 抽屉主体内容滚动区 */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              {/* 分组 1: 工况尺寸与布局参数（2x2 工业磁贴卡片） */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z" />
                      <path d="m7.5 10.5 2 2" />
                      <path d="m10.5 7.5 2 2" />
                      <path d="m13.5 4.5 2 2" />
                      <path d="m4.5 13.5 2 2" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      工况尺寸与空间布局
                    </span>
                  </div>
                  <span style={{ fontSize: 10.5, color: '#0284c7', background: '#f0f9ff', border: '1px solid #bae6fd', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>
                    SolidWorks 驱动
                  </span>
                </div>

                {/* 2x2 磁贴网格 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>输送线总长</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 3 }}>
                      {parameters?.conveyor_length_mm ?? 1000} <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>mm</span>
                    </div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>输送通道宽</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 3 }}>
                      {parameters?.conveyor_width_mm ?? 300} <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>mm</span>
                    </div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>输送台面高</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 3 }}>
                      {parameters?.deck_height_mm ?? 750} <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>mm</span>
                    </div>
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>台板结构厚</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 3 }}>
                      {parameters?.deck_thickness_mm ?? 20} <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b' }}>mm</span>
                    </div>
                  </div>
                </div>

                {/* 目标工件尺寸横幅卡片 */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '9px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="9" y1="21" x2="9" y2="9" />
                    </svg>
                    <span style={{ fontSize: 11.5, color: '#475569' }}>目标工件规格 (L×W×H)</span>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                    {parameters?.workpiece_length_mm ?? 100} × {parameters?.workpiece_width_mm ?? 60} × {parameters?.workpiece_height_mm ?? 30} mm
                  </span>
                </div>
              </div>

              {/* 分组 2: 机构工程选型 */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      选型机构工程特性
                    </span>
                  </div>
                  <span style={{ fontSize: 10.5, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>
                    装配体就绪
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#64748b' }}>装配特征组件</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      {alternative?.componentCount ? `${alternative.componentCount} 个实体零件` : '参数化装配体'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#64748b' }}>几何模型来源</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      SolidWorks 特征装配导出
                    </span>
                  </div>

                  {alternative?.condition && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>适用工况与前提:</div>
                      <div
                        style={{
                          color: '#334155',
                          lineHeight: 1.5,
                          fontSize: 11.5,
                          background: '#f8fafc',
                          borderLeft: '3px solid #cbd5e1',
                          padding: '7px 10px',
                          borderRadius: '0 6px 6px 0',
                        }}
                      >
                        {alternative.condition}
                      </div>
                    </div>
                  )}

                  {alternative?.designRationale && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>机构原理与选型依据:</div>
                      <div
                        style={{
                          color: '#334155',
                          lineHeight: 1.5,
                          fontSize: 11.5,
                          background: '#f8fafc',
                          borderLeft: '3px solid #0284c7',
                          padding: '7px 10px',
                          borderRadius: '0 6px 6px 0',
                        }}
                      >
                        {alternative.designRationale}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 分组 3: 仿真运行环境 */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      UE 仿真物理环境
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: runtimeSlot?.status === 'idle' ? '#ecfdf5' : '#f0f9ff',
                      color: runtimeSlot?.status === 'idle' ? '#059669' : '#0284c7',
                      border: `1px solid ${runtimeSlot?.status === 'idle' ? '#a7f3d0' : '#bae6fd'}`,
                      fontWeight: 500,
                    }}
                  >
                    {runtimeSlot?.status === 'idle' ? '运行槽就绪' : runtimeSlot?.status === 'occupied' ? '运行槽占用' : '运行时就绪'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>物理动力学内核</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: '#0f172a' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                      <span>MuJoCo 物理引擎</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>交互流送协议</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>WebRTC Pixel Streaming</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>网格优化防护</span>
                    <span style={{ fontWeight: 600, color: '#10b981' }}>QEM 自适应动态降面</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>接入鉴权模式</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>受控单操作者模式</span>
                  </div>
                </div>
              </div>

              {/* 底部工程说明小脚注 */}
              <div
                style={{
                  marginTop: 'auto',
                  paddingTop: 14,
                  borderTop: '1px solid #f1f5f9',
                  fontSize: 11,
                  color: '#94a3b8',
                  lineHeight: 1.45,
                }}
              >
                参数同步自工况约束要求及 SolidWorks 参数化装配求解器，受控视口实时渲染。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
