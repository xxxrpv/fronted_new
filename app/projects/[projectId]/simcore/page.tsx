'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getProject } from '../../../../lib/api';
import type { Project } from '../../../../lib/api/generated/types.gen';
import SimcoreTrainingView from '../../../../components/simcore/SimcoreTrainingView';
import SimcoreEvaluationView from '../../../../components/simcore/SimcoreEvaluationView';
import SimcorePreviewView from '../../../../components/simcore/SimcorePreviewView';
import SimcoreDisabledNotice from '../../../../components/simcore/SimcoreDisabledNotice';

export type SimcoreView = 'training' | 'evaluation' | 'simulator' | 'manual';

export default function ProjectSimcorePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const projectId = (params?.projectId as string) || '';
  const initialTaskId = searchParams?.get('taskId');

  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);

  // 默认激活训练视图 (Training 为 Task-006 真实闭环)
  const requestedView = searchParams?.get('view');
  const urlView: SimcoreView = requestedView && ['training', 'evaluation', 'simulator', 'manual'].includes(requestedView)
    ? requestedView as SimcoreView : searchParams?.get('action') === 'SIMCORE_EVALUATION' ? 'evaluation' : 'training';
  const [navigation, setNavigation] = useState<{ projectId: string; view: SimcoreView; training: string | null; evaluation: string | null; evaluationVisited: boolean }>(() => ({
    projectId, view: urlView, training: urlView === 'training' ? initialTaskId : null,
    evaluation: urlView === 'evaluation' ? initialTaskId : null, evaluationVisited: urlView === 'evaluation',
  }));
  const activeView = navigation.projectId === projectId ? navigation.view : urlView;
  const trainingTaskId = navigation.projectId === projectId ? navigation.training : null;
  const evaluationTaskId = navigation.projectId === projectId ? navigation.evaluation : null;
  const currentTaskId = activeView === 'evaluation' ? evaluationTaskId : trainingTaskId;

  const writeUrl = useCallback((view: SimcoreView, taskId: string | null) => {
    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    sp.set('view', view);
    sp.delete('action');
    if (taskId) sp.set('taskId', taskId); else sp.delete('taskId');
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `${pathname}?${sp}`);
  }, [pathname]);
  const setActiveView = (view: SimcoreView) => {
    setNavigation((current) => ({ ...current, view, evaluationVisited: current.evaluationVisited || view === 'evaluation' }));
    writeUrl(view, view === 'evaluation' ? evaluationTaskId : view === 'training' ? trainingTaskId : null);
  };
  useEffect(() => {
    setNavigation((current) => {
      const base = current.projectId === projectId ? current : { projectId, view: urlView, training: null, evaluation: null, evaluationVisited: false };
      return { ...base, view: urlView, ...(urlView === 'training' || urlView === 'evaluation' ? { [urlView]: initialTaskId } : {}), evaluationVisited: base.evaluationVisited || urlView === 'evaluation' };
    });
  }, [projectId, urlView, initialTaskId]);

  const handleTrainingTaskIdChange = useCallback((taskId: string | null) => {
    setNavigation((current) => current.projectId === projectId ? { ...current, training: taskId } : current);
    const view = new URLSearchParams(window.location.search).get('view');
    if (!view || view === 'training') writeUrl('training', taskId);
  }, [projectId, writeUrl]);
  const handleEvaluationTaskIdChange = useCallback((taskId: string | null) => {
    setNavigation((current) => {
      if (current.projectId !== projectId) return current;
      return { ...current, evaluation: taskId };
    });
    // A background evaluation must not overwrite the visible training URL.
    const query = new URLSearchParams(window.location.search);
    if (query.get('view') === 'evaluation' || query.get('action') === 'SIMCORE_EVALUATION') writeUrl('evaluation', taskId);
  }, [projectId, writeUrl]);

  // 通知气泡
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2400);
  };

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setProjectLoading(false);
      return;
    }

    setProjectLoading(true);
    setProjectError(null);

    getProject({ path: { projectId } })
      .then((res) => {
        if (!active) return;
        if (res.data) {
          setProject(res.data);
          setProjectError(null);
        } else {
          setProjectError('未找到该项目或项目不存在');
        }
      })
      .catch((err) => {
        if (!active) return;
        setProjectError(err instanceof Error ? err.message : '获取项目详情失败，请检查网络');
      })
      .finally(() => {
        if (active) {
          setProjectLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [projectId]);


  if (!projectId) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <h2>无效的项目标识</h2>
        <p style={{ color: '#64748b', marginTop: 8 }}>未检测到 URL 中的 projectId 参数。</p>
        <Link href="/projects" className="btn btn-primary" style={{ marginTop: 16 }}>
          返回项目列表
        </Link>
      </div>
    );
  }

  // 1. 加载中状态 (Fail-Closed: 绝对不提前挂载工作流与发起轮询)
  if (projectLoading || (!projectError && project?.id !== projectId)) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '36px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
          正在验证项目工作流权限...
        </h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>请稍候，正在获取项目分类与配置</p>
      </div>
    );
  }

  // 2. 错误状态 (404 或网络失败)
  if (projectError || !project) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '36px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
          无法访问 Simcore 仿真训练
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>
          {projectError || '未找到该项目或项目不存在。'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
          <Link href="/projects" className="btn btn-primary btn-sm">
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  // 3. 非标自动化项目拦截：仅具身智能 (EMBODIED_AI) 允许进入 Simcore 工作流
  if (project.projectType === 'AUTOMATION') {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '36px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
          非标自动化项目不进入 Simcore 仿真训练
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>
          当前项目《{project.name}》分类为【非标自动化】(AUTOMATION)。平台规则限定：仅【具身智能】(EMBODIED_AI) 项目支持进入 Embodex / Simcore 既有工作流，非标自动化的专属工作流另行设计。
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <Link href={`/projects/${projectId}`} className="btn btn-primary btn-sm">
            返回项目概览
          </Link>
          <Link href="/projects" className="btn btn-secondary btn-sm">
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  // 4. 仅在成功确认 EMBODIED_AI 时，方可渲染工作流 (Fail-Closed)
  if (project.projectType !== 'EMBODIED_AI') {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>项目类型不匹配，无法进入 Simcore 仿真训练。</p>
        <Link href={`/projects/${projectId}`} className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
          返回项目概览
        </Link>
      </div>
    );
  }

  return (
    <div className="simcore2-layout">
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: 24,
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
          {toastMsg}
        </div>
      )}

      {/* 左侧侧边栏 */}
      <aside className="embodex-sidebar" aria-label="Simcore 平台侧边栏">
        <div className="embodex-nav-wrapper">
          <div className="embodex-sidebar-title">仿真训练</div>

          {/* 分组 1: 任务管理 */}
          <div className="embodex-nav-group">
            <div className="embodex-nav-header">任务管理</div>

            {/* 1. 训练 */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'training' ? 'active' : ''}`}
              onClick={() => setActiveView('training')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M7 14l3-3 2.5 2.5L17 9" />
              </svg>
              <span>训练</span>
              {activeView === 'training' && (
                <svg className="embodex-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </button>

            {/* 2. 模型评估 */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'evaluation' ? 'active' : ''}`}
              onClick={() => setActiveView('evaluation')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="9" y2="17" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="15" y1="14" x2="15" y2="17" />
              </svg>
              <span>模型评估</span>
              {activeView === 'evaluation' && (
                <svg className="embodex-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </button>
          </div>

          <div className="embodex-nav-divider" />

          {/* 分组 2: 仿真与工具 */}
          <div className="embodex-nav-group">
            <div className="embodex-nav-header">仿真与工具</div>

            {/* 3. 仿真器 */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveView('simulator')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="3" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <polygon points="10 7 15 10 10 13" fill="currentColor" />
              </svg>
              <span>仿真器</span>
              {activeView === 'simulator' ? (
                <svg className="embodex-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              ) : (
                <span className="embodex-badge-preview">
                  预览
                </span>
              )}
            </button>

            {/* 4. 手动接口 */}
            <button
              type="button"
              className={`embodex-nav-item ${activeView === 'manual' ? 'active' : ''}`}
              onClick={() => setActiveView('manual')}
            >
              <svg className="embodex-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <polyline points="7 9 10 12 7 15" />
                <line x1="12" y1="15" x2="16" y2="15" />
              </svg>
              <span>手动接口</span>
              {activeView === 'manual' ? (
                <svg className="embodex-nav-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              ) : (
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
                  未开放
                </span>
              )}
            </button>
          </div>
        </div>

        {/* 侧栏底部状态 */}
        <div className="embodex-sidebar-footer">
          <div className="embodex-sidebar-footer-row">
            <span style={{ fontWeight: 600, color: '#0f172a' }}>项目作用域</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#0284c7' }}>
              {projectId.slice(0, 16)}
            </span>
          </div>
          <div className="embodex-sidebar-footer-row">
            <span>契约版本</span>
            <span style={{ color: '#0f172a' }}>Platform API</span>
          </div>
          <div className="embodex-sidebar-footer-row">
            <span>集成切片</span>
            <span style={{ color: '#10b981', fontWeight: 600 }}>Simcore Seam</span>
          </div>
        </div>
      </aside>

      {/* 右侧主工作区 */}
      <main className="simcore2-main">
        {/* 顶部标题与信息 */}
        <header className="simcore2-topbar">
          <div className="simcore2-title-box">
            {/* <nav className="simcore2-breadcrumb" aria-label="项目导航路径">
              <Link href="/projects" className="simcore2-breadcrumb-link">项目列表</Link>
              <span className="simcore2-breadcrumb-sep">/</span>
              <Link href={`/projects/${projectId}`} className="simcore2-breadcrumb-link" title={project.name}>
                {project.name}
              </Link>
              <span className="simcore2-breadcrumb-sep">/</span>
              <span className="simcore2-breadcrumb-current">仿真训练 (Simcore)</span>
            </nav> */}
            <h1>{project.name} · 仿真训练工作台</h1>
            <p>配置机器人与训练算法，启动训练任务并查看运行结果</p>
          </div>
          <div className="simcore2-top-actions">
            <Link href={`/projects/${projectId}`} className="btn btn-secondary btn-sm">
              返回项目概览
            </Link>
          </div>
        </header>

        {/* 运行态业务看板 */}
        <section className="simcore2-metric-strip" aria-label="仿真运行态看板">
          <div className="simcore2-metric-item">
            <span className="simcore2-metric-label">执行节点状态</span>
            <strong className="simcore2-metric-value">
              {activeView === 'simulator' ? (
                <>
                  <span className="embodex-sidebar-dot" style={{ background: '#10b981' }} />
                  <span style={{ color: '#059669' }}>3D 实时流会话</span>
                </>
              ) : currentTaskId ? (
                <>
                  <span className="embodex-sidebar-dot" style={{ background: '#0284c7' }} />
                  <span style={{ color: '#0284c7' }}>任务处理中</span>
                </>
              ) : (
                <>
                  <span className="embodex-sidebar-dot" style={{ background: '#10b981' }} />
                  <span style={{ color: '#059669' }}>节点待机 (Ready)</span>
                </>
              )}
            </strong>
            <small className="simcore2-metric-sub">
              {activeView === 'simulator' ? '单实例独占预览环境' : currentTaskId ? '异步调度与状态机对账' : '计算资源已就绪'}
            </small>
          </div>

          <div className="simcore2-metric-item">
            <span className="simcore2-metric-label">活跃调度任务</span>
            <strong className="simcore2-metric-value">
              {currentTaskId ? (
                <span style={{ color: '#0284c7', fontFamily: 'monospace', fontSize: 13 }}>
                  {currentTaskId.slice(0, 8)}...
                </span>
              ) : (
                <span style={{ color: '#64748b' }}>暂无运行任务</span>
              )}
            </strong>
            <small className="simcore2-metric-sub">
              {currentTaskId ? '已绑定当前上下文' : '等待发起新任务'}
            </small>
          </div>

          <div className="simcore2-metric-item">
            <span className="simcore2-metric-label">当前聚焦工作流</span>
            <strong className="simcore2-metric-value">
              {activeView === 'training' && <span style={{ color: '#0f172a' }}>强化学习训练</span>}
              {activeView === 'evaluation' && <span style={{ color: '#0f172a' }}>模型泛化评估</span>}
              {activeView === 'simulator' && <span style={{ color: '#0f172a' }}>3D 实时仿真器</span>}
              {activeView === 'manual' && <span style={{ color: '#0f172a' }}>底层手动控制</span>}
            </strong>
            <small className="simcore2-metric-sub">
              {activeView === 'training' && 'ROBOT / ALGORITHM 编排'}
              {activeView === 'evaluation' && '模型 Checkpoint 多回合验证'}
              {activeView === 'simulator' && 'WebRTC 交互流'}
              {activeView === 'manual' && '受限内部接口'}
            </small>
          </div>

          <div className="simcore2-metric-item">
            <span className="simcore2-metric-label">项目类型</span>
            <strong className="simcore2-metric-value">
              <span style={{ color: '#0f172a' }}>具身智能</span>
            </strong>
            <small className="simcore2-metric-sub">
              Embodied AI
            </small>
          </div>
        </section>

        {/* 视图内容滚动区 */}
        <div className="simcore2-scroll">
          {/* 1. 训练面板 (真实平台闭环) */}
          {activeView === 'training' && (
            <SimcoreTrainingView
              projectId={projectId}
              initialTaskId={trainingTaskId}
              onTaskIdChange={handleTrainingTaskIdChange}
            />
          )}

          {/* 1.5 评估面板 (Task-022 真实平台闭环) */}
          {navigation.projectId === projectId && navigation.evaluationVisited && (
            <div hidden={activeView !== 'evaluation'}><SimcoreEvaluationView
              key={projectId}
              projectId={projectId}
              initialTaskId={evaluationTaskId}
              onTaskIdChange={handleEvaluationTaskIdChange}
            /></div>
          )}

          {/* 2. 仿真器面板 (真实实时 3D 预览与生命周期控制) */}
          {activeView === 'simulator' && (
            <div className="simulator-view">
              <SimcorePreviewView projectId={projectId} />
            </div>
          )}

          {/* 3. 手动接口 (内部能力，受限并明确提示) */}
          {activeView === 'manual' && (
            <article className="simcore2-panel" style={{ maxWidth: 840 }}>
              <SimcoreDisabledNotice
                title="底层手动控制接口 (Manual Control reset/step)"
                description="底层单步控制属于平台内部测试能力，未在 Platform Public OpenAPI v0.1 中开放。为防止绕过调度器误操作环境，操作已被安全禁用。"
              />

              <div className="simcore2-form-grid">
                <label className="simcore2-label">
                  <span>Reset seed</span>
                  <input type="number" className="simcore2-input" value={42} disabled readOnly />
                </label>
                <label className="simcore2-label">
                  <span>Step 次数</span>
                  <input type="number" className="simcore2-input" value={1} disabled readOnly />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled>
                  reset (未开放)
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled>
                  step (未开放)
                </button>
              </div>
            </article>
          )}
        </div>
      </main>
    </div>
  );
}
