'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { HubApi } from '../../lib/hub/api';
import { parseOriginalUrdf, type UrdfPart } from '../../lib/embodex/parts';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../../lib/auth-context';
import { AgentMessageView } from './AgentMessageView';
import { HubSession } from '../../lib/hub/session';
import { initialHubState, type HubState, type Version } from '../../lib/hub/types';
import { versionName, playerUrl } from './HubWorkspaceView';

type ViewMode = 'ue' | 'parts';
type JointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic';

type PartItem = UrdfPart;
type PartsStatus = 'empty' | 'loading' | 'error' | 'ready';

const previewLabels: Record<string, string> = {
  IDLE: '等待生成模型',
  LOADING: '正在加载模型…',
  READY: '模型已就绪 (60 FPS)',
  UNKNOWN: '预览归属待核实',
  UNAVAILABLE: '预览暂不可用',
};

export interface HubWorkspaceProps {
  projectId?: string;
  projectName?: string;
}

export default function HubWorkspace(props: HubWorkspaceProps) {
  const params = useParams();
  const projectId = props.projectId || (params?.projectId as string) || '';
  const projectName = props.projectName || '当前项目';

  const { status, user } = useAuth();
  const userId = user?.id || '';

  // 1. 侧边栏：UE 交互置为第一项，零件清单置为第二项
  const [activeView, setActiveView] = useState<ViewMode>('ue');
  const [parts, setParts] = useState<PartItem[]>([]);
  const [rawUrdfXml, setRawUrdfXml] = useState<string | null>(null);
  const [partsStatus, setPartsStatus] = useState<PartsStatus>('empty');
  const [partsError, setPartsError] = useState<string | null>(null);
  const [linkCount, setLinkCount] = useState<number>(0);
  const [jointCount, setJointCount] = useState<number>(0);
  const [rootLinkName, setRootLinkName] = useState<string>('—');
  const urdfControllerRef = useRef<AbortController | null>(null);
  const urdfGenerationRef = useRef<number>(0);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [partsSearch, setPartsSearch] = useState('');
  const [partsFilter, setPartsFilter] = useState<'all' | 'revolute' | 'fixed' | 'front_legs' | 'rear_legs'>('all');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // =========================================================================
  // 核心：复用 HubSession（真正负责 Agent 生成版本 与 Agent 对话）
  // 彻底剔除项目模板，只展现 Agent 生成的版本
  // =========================================================================
  const [hubState, setHubState] = useState<HubState>(initialHubState);
  const hubSession = useRef<HubSession | null>(null);

  // 发布确认弹窗状态 (Human-In-The-Loop)
  const [confirmation, setConfirmation] = useState<Version | null>(null);

  // 监听 Esc 快捷键关闭确认发布弹窗 (非发布中状态有效)
  useEffect(() => {
    if (!confirmation) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hubState.publishing) {
        setConfirmation(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [confirmation, hubState.publishing]);

  useEffect(() => {
    if (status !== 'authenticated' || !userId || !projectId) {
      if (hubSession.current) {
        hubSession.current.dispose();
        hubSession.current = null;
      }
      setHubState(initialHubState());
      return;
    }
    const session = new HubSession(userId, projectId, (nextState) => {
      setHubState(nextState);
    });
    hubSession.current = session;
    void session.initialize();
    return () => {
      session.dispose();
      hubSession.current = null;
    };
  }, [status, userId, projectId]);

  const hasAgentVersions = hubState.versions && hubState.versions.length > 0;
  const currentStreamUrl = playerUrl(hubState);
  const isPreviewLoading = hubState.preview.status === 'LOADING';

  // 检测 Agent 发布建议与目标版本
  const proposalVersion = hubState.versions.find((v) => v.version_id === hubState.proposal?.versionId);
  const selectedVersion = hubState.versions.find((v) => v.version_id === hubState.selected);
  const targetVersion = proposalVersion || selectedVersion || hubState.versions[0];
  const alreadyPublished =
    targetVersion &&
    hubState.publication?.version_id === targetVersion.version_id &&
    hubState.publication?.status === 'SUCCEEDED';

  const handleSelectAgentVersion = (versionId: string) => {
    if (hasAgentVersions && versionId) {
      hubSession.current?.select(versionId);
    }
  };

  const handleDeployAgentModel = async () => {
    if (hasAgentVersions && hubState.selected) {
      if (hubSession.current) {
        const ok = await hubSession.current.previewSelected();
        if (ok) {
          showToast(`✓ 已请求加载模型：${selectedVersion?.number ? `第 ${selectedVersion.number} 版` : '当前选定版本'}`);
        } else {
          showToast(`加载模型失败：${hubSession.current.state.error || '请检查后端或网络'}`);
        }
      }
    } else {
      showToast('暂无生成的模型，请先在右侧与 Agent 对话生成模型');
    }
  };

  const handleRefreshAgentStatus = () => {
    if (hubSession.current) {
      void hubSession.current.refresh(true);
      showToast('已刷新 Agent 模型状态');
    } else {
      showToast('已刷新状态');
    }
  };

  // =========================================================================
  // 零件清单：按当前选中版本加载真实 URDF，支持取消请求与版本防串
  // =========================================================================
  const loadUrdfForVersion = useCallback(async (vid: string | null) => {
    if (urdfControllerRef.current) {
      urdfControllerRef.current.abort();
      urdfControllerRef.current = null;
    }
    const currentGen = ++urdfGenerationRef.current;

    setSelectedPartId(null);
    setParts([]);
    setRawUrdfXml(null);
    setLinkCount(0);
    setJointCount(0);
    setRootLinkName('—');
    setPartsError(null);

    if (!vid) {
      setPartsStatus('empty');
      return;
    }

    const controller = new AbortController();
    urdfControllerRef.current = controller;
    setPartsStatus('loading');

    try {
      const api = new HubApi(projectId);
      const xml = await api.urdf(vid, controller.signal);
      if (currentGen !== urdfGenerationRef.current) return;

      const parsed = parseOriginalUrdf(xml);
      if (currentGen !== urdfGenerationRef.current) return;

      setParts(parsed.parts);
      setRawUrdfXml(xml);
      setLinkCount(parsed.linkCount);
      setJointCount(parsed.jointCount);
      setRootLinkName(parsed.rootLinkName || (parsed.parts[0]?.linkName ?? '—'));
      setPartsStatus('ready');
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      if (currentGen !== urdfGenerationRef.current) return;
      console.error('[HubWorkspace] loadUrdfForVersion error:', err);
      setPartsError(err instanceof Error ? err.message : String(err));
      setPartsStatus('error');
    } finally {
      if (currentGen === urdfGenerationRef.current) {
        urdfControllerRef.current = null;
      }
    }
  }, [projectId]);

  useEffect(() => {
    if (!hasAgentVersions || !hubState.selected) {
      void loadUrdfForVersion(null);
    } else {
      void loadUrdfForVersion(hubState.selected);
    }
  }, [hasAgentVersions, hubState.selected, loadUrdfForVersion]);

  useEffect(() => {
    return () => {
      if (urdfControllerRef.current) {
        urdfControllerRef.current.abort();
        urdfControllerRef.current = null;
      }
    };
  }, []);

  // =========================================================================
  // 聊天对话状态与输入框交互
  // =========================================================================
  const [inputValue, setInputValue] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [hubState.messages, hubState.busy, hubState.proposal]);

  const handleSendMessage = async () => {
    const text = inputValue.trim();
    if (!text || hubState.busy) return;

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    if (hubSession.current) {
      await hubSession.current.send(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleSyncSession = () => {
    if (hubSession.current) {
      void hubSession.current.initialize();
    }
    showToast('已同步最新会话状态');
  };

  const handleCopyUrdf = () => {
    if (!rawUrdfXml) {
      showToast('当前版本 URDF 尚未加载完成，无法复制');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(rawUrdfXml).then(
        () => showToast('原始 URDF XML 已复制到剪贴板'),
        () => showToast('复制失败，请手动选择复制')
      );
    } else {
      showToast('当前环境不支持剪贴板写入');
    }
  };

  const movableJointCount = parts.filter((p) =>
    ['revolute', 'continuous', 'prismatic'].includes(p.jointType)
  ).length;
  const fixedCount = parts.filter((p) => p.jointType === 'fixed').length;

  const hasLegNaming = useMemo(() => {
    return parts.some((p) =>
      /^(fr|fl|rr|rl)[-_]/i.test(p.linkName) ||
      /^(fr|fl|rr|rl)[-_]/i.test(p.jointName)
    );
  }, [parts]);

  const filteredParts = parts.filter((p) => {
    const q = partsSearch.toLowerCase().trim();
    const matchSearch =
      !q ||
      p.label.toLowerCase().includes(q) ||
      p.linkName.toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q) ||
      p.parentLink.toLowerCase().includes(q) ||
      p.jointName.toLowerCase().includes(q);

    if (!matchSearch) return false;

    if (partsFilter === 'revolute') return ['revolute', 'continuous', 'prismatic'].includes(p.jointType);
    if (partsFilter === 'fixed') return p.jointType === 'fixed';
    if (partsFilter === 'front_legs') {
      return (
        /^(fr|fl)[-_]/i.test(p.linkName) ||
        /^(fr|fl)[-_]/i.test(p.jointName) ||
        p.uid.includes('fr-') ||
        p.uid.includes('fl-')
      );
    }
    if (partsFilter === 'rear_legs') {
      return (
        /^(rr|rl)[-_]/i.test(p.linkName) ||
        /^(rr|rl)[-_]/i.test(p.jointName) ||
        p.uid.includes('rr-') ||
        p.uid.includes('rl-')
      );
    }
    return true;
  });

  return (
    <div className="embodex-root" style={{ height: 'calc(100vh - 48px)', width: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 提示通知 */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            color: '#ffffff',
            padding: '8px 20px',
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 99999,
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* 主体三栏布局: 左侧侧边栏 | 中间主工作区 | 右侧 Embodex Agent */}
      <div className="embodex-body" style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        
        {/* =========================================================================
            左侧侧边栏：【UE 交互第一项】，【零件清单第二项】
            ========================================================================= */}
        <aside className="embodex-sidebar" aria-label="方案设计侧边栏">
          <div className="embodex-nav-wrapper">
            <div className="embodex-sidebar-title">方案设计</div>
            <div className="embodex-nav-group">

            {/* 1. UE 交互 Tab (第一项) */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'ue' ? 'active' : ''}`}
              onClick={() => setActiveView('ue')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>UE 交互</span>
            </button>

            {/* 2. 零件清单 Tab (第二项) */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'parts' ? 'active' : ''}`}
              onClick={() => setActiveView('parts')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
              <span>零件清单</span>
              <span className="embodex-nav-badge">{parts.length}</span>
            </button>
          </div>
          </div>

          {/* 侧边栏底部状态看板 */}
          <div className="embodex-sidebar-footer">
            <div className="embodex-sidebar-footer-row">
              <span style={{ fontWeight: 600, color: '#0f172a' }}>运行环境</span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>● 实时就绪</span>
            </div>
            <div className="embodex-sidebar-footer-row">
              <span>渲染引擎</span>
              <span style={{ color: '#0f172a' }}>UE 交互 (60 FPS)</span>
            </div>
            <div className="embodex-sidebar-footer-row">
              <span>CAD 建模</span>
              <span style={{ color: '#0f172a' }}>SolidWorks</span>
            </div>
            <div className="embodex-sidebar-footer-row">
              <span>运动学格式</span>
              <span style={{ color: '#0070f3', fontWeight: 600 }}>URDF 1.0</span>
            </div>
          </div>
        </aside>

        {/* =========================================================================
            中间主工作区: 
            - 顶部齐平单行：【UE 交互工作区】+ 严格展示【Agent 生成版本】下拉 + [加载模型] + [刷新状态]
            - 中间视频区：支持实时 Pixel Streaming，无流时优雅降级为矢量超清底图
            ========================================================================= */}
        <main className="embodex-center-pane" style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: '#f8fafc', padding: '16px 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          {/* 视图 A: UE 交互工作区 */}
          {activeView === 'ue' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
              
              {/* 顶部工具栏：【UE 交互工作区】标题与版本控件齐平在同一行 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                {/* 左侧：标题与状态指示 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    UE 交互工作区
                  </h3>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#10b981' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                    {previewLabels[hubState.preview.status] || '模型已就绪 (60 FPS)'}
                  </span>
                </div>

                {/* 右侧：下拉直接选择【Agent 生成版本】 + [加载模型] + [刷新状态] (齐平同一行) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', justifyContent: 'flex-end', maxWidth: 660 }}>
                  <select
                    value={hasAgentVersions ? hubState.selected || '' : ''}
                    disabled={isPreviewLoading || hubState.loading || !hasAgentVersions}
                    onChange={(e) => handleSelectAgentVersion(e.target.value)}
                    aria-label="选择 Agent 生成版本"
                    title={hasAgentVersions ? '模型来源：已锁定为 Agent 生成版本' : '暂无生成的模型版本，请从右侧对话开始生成'}
                    style={{
                      flex: 1,
                      minWidth: 230,
                      maxWidth: 380,
                      height: 32,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: hasAgentVersions ? '#ffffff' : '#f8fafc',
                      color: hasAgentVersions ? '#0f172a' : '#94a3b8',
                      fontSize: 12.5,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      outline: 'none',
                      cursor: hasAgentVersions ? 'pointer' : 'not-allowed',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                    }}
                  >
                    {hasAgentVersions ? (
                      hubState.versions.map((v: Version) => (
                        <option key={v.version_id} value={v.version_id}>
                          第 {v.number} 版 · {versionName(v)}
                        </option>
                      ))
                    ) : (
                      <option value="">暂无模型版本（等待 Agent 生成）</option>
                    )}
                  </select>

                  <button
                    type="button"
                    onClick={handleDeployAgentModel}
                    disabled={isPreviewLoading || !hasAgentVersions || !hubState.selected}
                    style={{
                      height: 32,
                      padding: '0 14px',
                      borderRadius: 6,
                      background: '#000000',
                      color: '#ffffff',
                      border: '1px solid #000000',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isPreviewLoading || !hasAgentVersions || !hubState.selected ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.15s ease',
                      opacity: isPreviewLoading || !hasAgentVersions || !hubState.selected ? 0.45 : 1,
                    }}
                  >
                    {isPreviewLoading ? '加载中...' : '加载模型'}
                  </button>

                  <button
                    type="button"
                    onClick={handleRefreshAgentStatus}
                    style={{
                      height: 32,
                      padding: '0 14px',
                      borderRadius: 6,
                      background: '#ffffff',
                      color: '#0f172a',
                      border: '1px solid #cbd5e1',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    刷新状态
                  </button>
                </div>
              </div>

              {/* 黑色仿真视口：真实视频流 or 矢量超清底图 */}
              <div
                style={{
                  background: '#04060a',
                  borderRadius: 14,
                  border: '1px solid #1e293b',
                  position: 'relative',
                  overflow: 'hidden',
                  flex: 1,
                  minHeight: 500,
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {currentStreamUrl ? (
                  <iframe
                    key={`${hubState.preview.version_id}:${currentStreamUrl}`}
                    src={currentStreamUrl}
                    title="当前 Agent 模型 Pixel Streaming 播放器"
                    allow="autoplay; fullscreen; gamepad"
                    allowFullScreen
                    referrerPolicy="no-referrer"
                    style={{ width: '100%', height: '100%', border: 0, background: '#04060a', display: 'block' }}
                  />
                ) : (
                  /* 无实时流时的矢量超高清仿真视图（放大绝不模糊，支持任意高分屏/视口） */
                  <img
                    src="/sim-robot-preview.svg"
                    alt="UE 仿真工作区默认渲染底图"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      objectPosition: 'center',
                      display: 'block',
                      userSelect: 'none',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* 视图 B: 现代化专业零件与动力学拓扑清单 */}
          {activeView === 'parts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 顶部标题栏与快捷操作 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                      零件与动力学拓扑清单
                    </h3>
                  </div>
                  <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
                    管理当前机器人的刚体连杆（Link）与转动副/固定副（Joint）运动学拓扑
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* 与 UE 页面同款的机器人模型版本选择下拉框 */}
                  <select
                    value={hasAgentVersions ? hubState.selected || '' : ''}
                    disabled={isPreviewLoading || hubState.loading || !hasAgentVersions}
                    onChange={(e) => handleSelectAgentVersion(e.target.value)}
                    aria-label="选择机器人模型版本"
                    title={hasAgentVersions ? '模型来源：已锁定为 Agent 生成版本' : '暂无生成的模型版本，请从右侧对话开始生成'}
                    style={{
                      minWidth: 230,
                      maxWidth: 320,
                      height: 32,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: hasAgentVersions ? '#ffffff' : '#f8fafc',
                      color: hasAgentVersions ? '#0f172a' : '#94a3b8',
                      fontSize: 12.5,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      outline: 'none',
                      cursor: hasAgentVersions ? 'pointer' : 'not-allowed',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                    }}
                  >
                    {hasAgentVersions ? (
                      hubState.versions.map((v: Version) => (
                        <option key={v.version_id} value={v.version_id}>
                          第 {v.number} 版 · {versionName(v)}
                        </option>
                      ))
                    ) : (
                      <option value="">暂无模型版本（等待 Agent 生成）</option>
                    )}
                  </select>

                  <button
                    type="button"
                    disabled={!hasAgentVersions || partsStatus === 'loading'}
                    onClick={() => {
                      if (hubState.selected) {
                        void loadUrdfForVersion(hubState.selected);
                        showToast('正在重新加载当前版本 URDF…');
                      } else {
                        showToast('暂无模型版本');
                      }
                    }}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      borderRadius: 6,
                      background: '#ffffff',
                      color: !hasAgentVersions || partsStatus === 'loading' ? '#94a3b8' : '#475569',
                      border: '1px solid #cbd5e1',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: !hasAgentVersions || partsStatus === 'loading' ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {partsStatus === 'loading' ? '加载中…' : '重新加载'}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyUrdf}
                    style={{
                      height: 32,
                      padding: '0 14px',
                      borderRadius: 6,
                      background: '#000000',
                      color: '#ffffff',
                      border: '1px solid #000000',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                    复制 URDF XML
                  </button>
                </div>
              </div>

              {/* 核心指标统计卡片条 (4格，紧凑 76px 高度，释放表格垂直空间) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, height: 76, padding: '10px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, lineHeight: 1.2 }}>总连杆 (Links)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 3, lineHeight: 1.2 }}>
                    {linkCount} <span style={{ fontSize: 11.5, fontWeight: 400, color: '#94a3b8' }}>个连杆</span>
                  </div>
                </div>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, height: 76, padding: '10px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, lineHeight: 1.2 }}>可动关节 (Movable)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#2563eb', marginTop: 3, lineHeight: 1.2 }}>
                    {movableJointCount} <span style={{ fontSize: 11.5, fontWeight: 400, color: '#94a3b8' }}>处关节</span>
                  </div>
                </div>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, height: 76, padding: '10px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, lineHeight: 1.2 }}>刚性固定连接 (Fixed)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#475569', marginTop: 3, lineHeight: 1.2 }}>
                    {fixedCount} <span style={{ fontSize: 11.5, fontWeight: 400, color: '#94a3b8' }}>处刚连</span>
                  </div>
                </div>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, height: 76, padding: '10px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, lineHeight: 1.2 }}>基准参考系 (Root)</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#10b981', marginTop: 3, lineHeight: 1.2, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rootLinkName}>
                    {rootLinkName}
                  </div>
                </div>
              </div>

              {/* 搜索与过滤工具栏 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  background: '#ffffff',
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  flexWrap: 'wrap',
                }}
              >
                {/* 搜索框 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 240px', maxWidth: 360 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={partsSearch}
                    onChange={(e) => setPartsSearch(e.target.value)}
                    placeholder="按名称、Link 或角色快速检索…"
                    style={{
                      border: 'none',
                      outline: 'none',
                      fontSize: 12.5,
                      width: '100%',
                      background: 'transparent',
                      color: '#0f172a',
                    }}
                  />
                  {partsSearch && (
                    <button
                      type="button"
                      onClick={() => setPartsSearch('')}
                      style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 12, padding: 0 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* 分类筛选标签 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {[
                    { id: 'all', label: `全部 (${parts.length})` },
                    { id: 'revolute', label: `可动关节 (${movableJointCount})` },
                    { id: 'fixed', label: `固定连接 (${fixedCount})` },
                    ...(hasLegNaming
                      ? [
                          { id: 'front_legs', label: '前肢 FL/FR' },
                          { id: 'rear_legs', label: '后肢 RL/RR' },
                        ]
                      : []),
                  ].map((tab) => {
                    const active = partsFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPartsFilter(tab.id as any)}
                        style={{
                          border: active ? '1px solid #000000' : '1px solid transparent',
                          background: active ? '#000000' : '#f1f5f9',
                          color: active ? '#ffffff' : '#475569',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 11.5,
                          fontWeight: active ? 600 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 现代化高辨识度数据表格 */}
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ overflowX: 'auto', width: '100%', position: 'relative' }}>
                  <table
                    style={{
                      width: '100%',
                      minWidth: 792,
                      tableLayout: 'fixed',
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                      textAlign: 'left',
                      fontSize: 12.5,
                    }}
                  >
                    <thead>
                      <tr style={{ background: '#f8fafc', color: '#64748b', fontSize: 11.5, fontWeight: 600 }}>
                        {/* 序号 (Sticky 固定第 1 列，表头与数据行严格同步) */}
                        <th
                          style={{
                            position: 'sticky',
                            left: 0,
                            zIndex: 10,
                            background: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                            padding: '8px 8px',
                            width: 42,
                            minWidth: 42,
                            maxWidth: 42,
                            boxSizing: 'border-box',
                            textAlign: 'center',
                          }}
                        >
                          #
                        </th>
                        {/* 零件名称与角色 (Sticky 固定第 2 列，配备优雅清晰的右侧立体微阴影分界) */}
                        <th
                          style={{
                            position: 'sticky',
                            left: 42,
                            zIndex: 10,
                            background: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                            borderRight: '1px solid #cbd5e1',
                            boxShadow: '4px 0 8px -2px rgba(15, 23, 42, 0.08)',
                            padding: '8px 12px',
                            width: 160,
                            minWidth: 160,
                            maxWidth: 160,
                            boxSizing: 'border-box',
                          }}
                        >
                          零件名称 / 功能角色
                        </th>
                        <th style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', width: 130, minWidth: 130, boxSizing: 'border-box' }}>Link 标识</th>
                        <th style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', width: 110, minWidth: 110, boxSizing: 'border-box' }}>父级 Link</th>
                        <th style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', width: 130, minWidth: 130, boxSizing: 'border-box' }}>Joint 关节类型</th>
                        <th style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', width: 130, minWidth: 130, boxSizing: 'border-box' }}>XYZ 偏移 (m)</th>
                        <th style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 12px', width: 90, minWidth: 90, boxSizing: 'border-box' }}>旋转轴 (Axis)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partsStatus === 'empty' ? (
                        <tr>
                          <td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                            暂无模型版本，请从右侧与 Agent 对话生成模型。
                          </td>
                        </tr>
                      ) : partsStatus === 'loading' ? (
                        <tr>
                          <td colSpan={7} style={{ padding: '48px 20px', textAlign: 'center', color: '#2563eb', fontSize: 13 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                              正在加载零件结构…
                            </div>
                          </td>
                        </tr>
                      ) : partsStatus === 'error' ? (
                        <tr>
                          <td colSpan={7} style={{ padding: '40px 20px', textAlign: 'center', color: '#ef4444', fontSize: 13 }}>
                            <div style={{ fontWeight: 600 }}>零件清单加载失败，支持重试</div>
                            {partsError && <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4 }}>失败详情：{partsError}</div>}
                            <button
                              type="button"
                              onClick={() => {
                                const targetVid = hubState.selected || hubState.versions[0]?.version_id;
                                if (targetVid) void loadUrdfForVersion(targetVid);
                              }}
                              style={{
                                marginTop: 10,
                                padding: '5px 14px',
                                borderRadius: 6,
                                border: '1px solid #fca5a5',
                                background: '#fef2f2',
                                color: '#b91c1c',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                              }}
                            >
                              重试加载
                            </button>
                          </td>
                        </tr>
                      ) : filteredParts.length > 0 ? (
                        filteredParts.map((p, idx) => {
                          const isRevolute = ['revolute', 'continuous', 'prismatic'].includes(p.jointType);
                          const isSelected = selectedPartId === p.uid;
                          const axisLabel = p.axis.trim() === '0 0 1' ? 'Z 轴' : p.axis.trim() === '0 1 0' ? 'Y 轴' : p.axis.trim() === '1 0 0' ? 'X 轴' : 'Axis';
                          const baseBg = isSelected ? '#eff6ff' : '#ffffff';
                          const hoverBg = isSelected ? '#e0f2fe' : '#f8fafc';

                          return (
                            <tr
                              key={p.uid}
                              onClick={() => setSelectedPartId(isSelected ? null : p.uid)}
                              style={{
                                height: 56,
                                background: baseBg,
                                cursor: 'pointer',
                                transition: 'background 0.12s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = hoverBg;
                                const stickyTds = e.currentTarget.querySelectorAll('.sticky-col');
                                stickyTds.forEach((el) => ((el as HTMLElement).style.background = hoverBg));
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = baseBg;
                                const stickyTds = e.currentTarget.querySelectorAll('.sticky-col');
                                stickyTds.forEach((el) => ((el as HTMLElement).style.background = baseBg));
                              }}
                            >
                              {/* 序号 (Sticky 固定第 1 列) */}
                              <td
                                className="sticky-col"
                                style={{
                                  position: 'sticky',
                                  left: 0,
                                  zIndex: 5,
                                  background: baseBg,
                                  borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9',
                                  padding: '6px 8px',
                                  width: 42,
                                  minWidth: 42,
                                  maxWidth: 42,
                                  boxSizing: 'border-box',
                                  textAlign: 'center',
                                  color: isSelected ? '#2563eb' : '#94a3b8',
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  transition: 'background 0.12s ease',
                                }}
                              >
                                {String(idx + 1).padStart(2, '0')}
                              </td>

                              {/* 零件名称与角色 (Sticky 固定第 2 列，配备右侧柔和阴影分界) */}
                              <td
                                className="sticky-col"
                                style={{
                                  position: 'sticky',
                                  left: 42,
                                  zIndex: 5,
                                  background: baseBg,
                                  borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9',
                                  borderRight: '1px solid #cbd5e1',
                                  boxShadow: '4px 0 8px -2px rgba(15, 23, 42, 0.08)',
                                  padding: '6px 12px',
                                  width: 160,
                                  minWidth: 160,
                                  maxWidth: 160,
                                  boxSizing: 'border-box',
                                  transition: 'background 0.12s ease',
                                }}
                              >
                                <div style={{ fontWeight: 600, color: isSelected ? '#1d4ed8' : '#0f172a', fontSize: 12.5, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {p.label}
                                </div>
                                <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 1, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {p.role}
                                </div>
                              </td>

                              {/* Link 标识 (只读保留输入框外观) */}
                              <td style={{ borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9', padding: '6px 12px', width: 130, minWidth: 130, boxSizing: 'border-box' }}>
                                <input
                                  type="text"
                                  readOnly
                                  value={p.linkName}
                                  title={p.linkName}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    height: 26,
                                    width: 116,
                                    padding: '0 7px',
                                    borderRadius: 5,
                                    border: '1px solid #e2e8f0',
                                    background: '#fafafa',
                                    color: '#0f172a',
                                    fontSize: 11.5,
                                    fontFamily: 'ui-monospace, monospace',
                                    outline: 'none',
                                    cursor: 'default',
                                    userSelect: 'text',
                                  }}
                                />
                              </td>

                              {/* 父级 Link */}
                              <td style={{ borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9', padding: '6px 12px', width: 110, minWidth: 110, boxSizing: 'border-box' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    fontSize: 11,
                                    fontFamily: 'ui-monospace, monospace',
                                    color: '#475569',
                                    background: '#f1f5f9',
                                    padding: '2px 7px',
                                    borderRadius: 4,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{ color: '#94a3b8' }}>↳</span> {p.parentLink}
                                </span>
                              </td>

                              {/* Joint 关节类型 */}
                              <td style={{ borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9', padding: '6px 12px', width: 130, minWidth: 130, boxSizing: 'border-box' }}>
                                <div
                                  style={{
                                    height: 26,
                                    padding: '0 8px',
                                    borderRadius: 5,
                                    border: isRevolute ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                                    background: isRevolute ? '#eff6ff' : '#f8fafc',
                                    color: isRevolute ? '#1d4ed8' : '#475569',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    cursor: 'default',
                                    userSelect: 'text',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span>● {p.jointType}</span>
                                </div>
                              </td>

                              {/* XYZ 偏移 (只读保留输入框外观) */}
                              <td style={{ borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9', padding: '6px 12px', width: 130, minWidth: 130, boxSizing: 'border-box' }}>
                                <input
                                  type="text"
                                  readOnly
                                  value={p.xyz}
                                  title="位姿偏移坐标 X Y Z (单位: 米)"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    height: 26,
                                    width: 116,
                                    padding: '0 7px',
                                    borderRadius: 5,
                                    border: '1px solid #e2e8f0',
                                    background: '#fafafa',
                                    color: '#0f172a',
                                    fontSize: 11,
                                    fontFamily: 'ui-monospace, monospace',
                                    outline: 'none',
                                    cursor: 'default',
                                    userSelect: 'text',
                                  }}
                                />
                              </td>

                              {/* Axis 轴向 (紧凑数值展示，绝不裁切) */}
                              <td style={{ borderBottom: isSelected ? '1px solid #bfdbfe' : '1px solid #f1f5f9', padding: '6px 12px', width: 90, minWidth: 90, boxSizing: 'border-box' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    fontSize: 10.5,
                                    fontFamily: 'ui-monospace, monospace',
                                    fontWeight: 600,
                                    color: '#334155',
                                    background: '#f1f5f9',
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    border: '1px solid #e2e8f0',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{ color: '#0284c7' }}>{axisLabel}</span>
                                  <span style={{ color: '#64748b' }}>({p.axis})</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={7} style={{ padding: '36px 20px', textAlign: 'center', color: '#94a3b8' }}>
                            没有匹配到零件构件，请尝试调整搜索关键字或筛选条件。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 表格底部汇总信息 */}
                <div
                  style={{
                    padding: '10px 16px',
                    background: '#f8fafc',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: '#64748b',
                  }}
                >
                  <span>
                    当前显示 <strong>{partsStatus === 'ready' ? filteredParts.length : 0}</strong> / {linkCount} 个构件
                  </span>
                  <span>
                    {selectedVersion ? `当前版本：第 ${selectedVersion.number} 版 · ${versionName(selectedVersion)} (${selectedVersion.version_id.slice(0, 8)})（只读）` : '只读查看模式'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* =========================================================================
            右侧 Embodex Agent: 
            - 真实对齐 Hub 对话状态
            - Agent 发布建议卡片 (人在回路确认)
            - 大圆角卡片输入框 + 纯黑 34px 发送键 (带 white ↑ 箭头)
            ========================================================================= */}
        <aside className="embodex-agent-dock" style={{ width: 410, display: 'flex', flexDirection: 'column', background: '#ffffff', borderLeft: '1px solid #e2e8f0' }}>
          {/* Agent 头部 */}
          <div className="embodex-agent-header" style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="embodex-agent-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
              <span className="embodex-agent-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              <span>Embodex Agent</span>
            </div>

            <button
              type="button"
              className="embodex-agent-btn"
              onClick={handleSyncSession}
              title="从服务器刷新并同步最新会话状态"
              style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}
            >
              同步会话
            </button>
          </div>

          {/* 消息滚动区域 */}
          <div
            ref={chatScrollRef}
            style={{
              flex: 1,
              padding: '14px 16px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              minHeight: 0,
            }}
          >
            {/* 默认欢迎消息 (当还没有任何对话时展示) */}
            {hubState.messages.length === 0 && (
              <div style={{ alignSelf: 'flex-start', maxWidth: '92%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Embodex Agent</span>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    fontSize: 13,
                    lineHeight: 1.5,
                    background: '#f1f5f9',
                    color: '#1e293b',
                    borderBottomLeftRadius: 4,
                  }}
                >
                  你好！我是 Embodex Agent，已挂载项目 <code>{projectId || '当前项目'}</code>。我将根据你的指令直接生成和迭代机器人模型版本，你可以随时下达修改或设计指令。
                </div>
              </div>
            )}

            {/* 真实消息流渲染 */}
            {hubState.messages.map((msg) => {
              if (msg.role === 'tool') return null;

              if (msg.role === 'user') {
                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: 'flex-end',
                      maxWidth: '92%',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>你</span>
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        fontSize: 13,
                        lineHeight: 1.5,
                        background: '#0f172a',
                        color: '#ffffff',
                        borderBottomRightRadius: 4,
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              }

              if (msg.role === 'assistant') {
                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: 'flex-start',
                      maxWidth: '92%',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>Embodex Agent</span>
                    <div
                      style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        fontSize: 13,
                        lineHeight: 1.6,
                        background: '#f1f5f9',
                        color: '#1e293b',
                        borderBottomLeftRadius: 4,
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      <AgentMessageView message={msg} />
                    </div>
                  </div>
                );
              }

              return null;
            })}

            {/* 正在思考中的提示 */}
            {hubState.busy && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12, padding: '4px 0' }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', animation: 'pulse 1.2s infinite' }} />
                <span>Agent 正在处理本轮设计指令…</span>
              </div>
            )}

            {/* 错误提示 */}
            {hubState.error && (
              <div style={{ alignSelf: 'center', background: '#fee2e2', color: '#b91c1c', fontSize: 11, padding: '4px 10px', borderRadius: 6, textAlign: 'center' }}>
                {hubState.error}
              </div>
            )}
          </div>

          {/* =========================================================================
              Agent 发布建议卡片 (人在回路确认) - 紧凑淡黄琥珀风，释放垂直空间
              ========================================================================= */}
          {targetVersion && !alreadyPublished && (
            <div
              style={{
                margin: '0 12px 6px 12px',
                padding: '8px 12px',
                borderRadius: 10,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                boxShadow: '0 1px 3px rgba(245, 158, 11, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#92400e', whiteSpace: 'nowrap' }}>
                      {proposalVersion ? 'Agent 发布建议' : '模型版本就绪'}
                    </span>
                    <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600, background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>
                      第 {targetVersion.number} 版
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#78350f',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 190,
                      marginTop: 1,
                    }}
                    title={versionName(targetVersion)}
                  >
                    {versionName(targetVersion)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={async () => {
                    if (hubSession.current) {
                      hubSession.current.select(targetVersion.version_id);
                      const ok = await hubSession.current.previewSelected();
                      if (ok) {
                        showToast(`已在 UE 视口加载第 ${targetVersion.number} 版`);
                      } else {
                        showToast(`加载模型失败：${hubSession.current.state.error || '请检查后端或网络'}`);
                      }
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    background: '#ffffff',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  UE 预览
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmation(targetVersion)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                >
                  确认发布
                </button>
              </div>
            </div>
          )}

          {/* 底部的输入框卡片 */}
          <div style={{ padding: '8px 12px 12px 12px', background: '#ffffff', borderTop: '1px solid #f1f5f9' }}>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #d1d5db',
                borderRadius: 14,
                padding: '8px 8px 6px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                boxShadow: '0 4px 14px -1px rgba(15, 23, 42, 0.08), 0 2px 5px -1px rgba(15, 23, 42, 0.04)',
                transition: 'all 0.2s ease',
              }}
            >
              {/* 输入文本框 */}
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={hubState.busy ? 'AI 正在处理生成中，请稍候…' : '向 Embodex Agent 提出机器人模型设计指令…'}
                disabled={hubState.busy}
                rows={1}
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: '#0f172a',
                  background: 'transparent',
                  padding: 0,
                  minHeight: 24,
                  maxHeight: 90,
                  fontFamily: 'inherit',
                }}
              />

              {/* 下层：右下角深纯黑、大尺寸发送键 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: 2 }}>
                <button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={!inputValue.trim() || hubState.busy}
                  title={hubState.busy ? '正在生成回复…' : '发送指令 (Enter)'}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: inputValue.trim() && !hubState.busy ? '#000000' : '#171717',
                    color: '#ffffff',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: inputValue.trim() && !hubState.busy ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
                    opacity: inputValue.trim() && !hubState.busy ? 1 : 0.7,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* =========================================================================
          产物发布前二次确认模态弹窗 (Human-in-the-Loop)
          ========================================================================= */}
      {confirmation && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999999,
          }}
          onClick={() => {
            if (!hubState.publishing) setConfirmation(null);
          }}
        >
          <div
            style={{
              position: 'relative',
              background: '#ffffff',
              borderRadius: 16,
              padding: '24px 28px',
              maxWidth: 480,
              width: '90%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 右上角关闭 ✕ 按钮 */}
            <button
              type="button"
              onClick={() => {
                if (!hubState.publishing) setConfirmation(null);
              }}
              disabled={hubState.publishing}
              aria-label="关闭确认弹窗"
              title={hubState.publishing ? '发布中禁止关闭' : '关闭 (Esc)'}
              style={{
                position: 'absolute',
                top: 18,
                right: 18,
                width: 30,
                height: 30,
                borderRadius: '50%',
                border: 'none',
                background: '#f1f5f9',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: hubState.publishing ? 'not-allowed' : 'pointer',
                opacity: hubState.publishing ? 0.4 : 1,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!hubState.publishing) {
                  e.currentTarget.style.background = '#e2e8f0';
                  e.currentTarget.style.color = '#0f172a';
                }
              }}
              onMouseLeave={(e) => {
                if (!hubState.publishing) {
                  e.currentTarget.style.background = '#f1f5f9';
                  e.currentTarget.style.color = '#64748b';
                }
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* 头部标题与徽标 */}
            <div>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#0284c7',
                  background: '#e0f2fe',
                  padding: '2px 8px',
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              >
                方案规格产物发布确认
              </span>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a', paddingRight: 32 }}>
                发布第 {confirmation.number} 版机器人模型？
              </h3>
            </div>

            {/* 模型元数据与说明 */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '12px 14px',
                fontSize: 13,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                color: '#334155',
              }}
            >
              <div><strong>归属项目：</strong>{projectName || projectId || '当前项目'}</div>
              <div><strong>模型名称：</strong>{versionName(confirmation)}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                <strong>模型摘要：</strong>{confirmation.summary || '包含完整刚体 Link、Joint 拓扑及 CAD 几何约束'}
              </div>
            </div>

            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, margin: 0 }}>
              确认发布后，平台将上传本版本的完整模型工程，并自动归档为生产级 URDF 1.0 与 GLB 产物；旧版模型将按项目保留规则归档。
            </p>

            {/* 操作按钮栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setConfirmation(null)}
                disabled={hubState.publishing}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: hubState.publishing ? 'default' : 'pointer',
                }}
              >
                继续查看
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (hubSession.current && confirmation) {
                    const ok = await hubSession.current.publishVersion(confirmation.version_id);
                    if (ok && !hubSession.current.state.error) {
                      showToast(`✓ 已成功提交第 ${confirmation.number} 版发布任务！`);
                      setConfirmation(null);
                    } else {
                      showToast(`发布失败：${hubSession.current.state.error || '请检查网络或后端状态'}`);
                    }
                  }
                }}
                disabled={hubState.publishing}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#000000',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: hubState.publishing ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {hubState.publishing ? '正在提交发布…' : '确认发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
