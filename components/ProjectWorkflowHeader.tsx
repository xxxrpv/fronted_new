'use client';

import React, { useState, useEffect, useRef } from 'react';
import { getProject, listProjects } from '../lib/api';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { getProjectById, getProjects } from '../lib/demo-data';
import dynamic from 'next/dynamic';

const KitBalanceBadge = dynamic(() => import('../lib/embodikit/components').then(module => module.KitBalanceBadge), { ssr: false });

export type StageKey = 'embodex' | 'coding' | 'simcore' | 'algorithms' | 'deployment';

export interface WorkflowStageConfig {
  id: number;
  key: StageKey;
  name: string;
  meta: string;
  getHref: (projectId: string) => string;
}

export const WORKFLOW_STAGES: WorkflowStageConfig[] = [
  {
    id: 1,
    key: 'embodex',
    name: 'Embodex・方案设计',
    meta: '系统架构 · 场景建模',
    getHref: (pid) => (pid ? `/projects/${pid}/embodex` : '/embodex'),
  },
  {
    id: 2,
    key: 'coding',
    name: 'Lexis・自动编程',
    meta: '控制算法编写 · 依赖配置',
    getHref: () => '#',
  },
  {
    id: 3,
    key: 'simcore',
    name: 'Simcore・仿真训练',
    meta: 'StageRun #3 · 60 FPS 动力学',
    getHref: (pid) => (pid ? `/projects/${pid}/simcore` : '/simcore'),
  },
  {
    id: 4,
    key: 'algorithms',
    name: 'Embokit・算法管理',
    meta: '权重评测 · 模型版本库',
    getHref: (pid) => (pid ? `/projects/${pid}/algorithms` : '/algorithms'),
  },
  {
    id: 5,
    key: 'deployment',
    name: 'Deplox・真机部署',
    meta: '生产部署 · 运行验证',
    getHref: (pid) => (pid ? `/projects/${pid}/deploy` : '/deploy'),
  },
];

interface ProjectWorkflowHeaderProps {
  projectId?: string;
  projectName?: string;
  activeStage?: StageKey | number;
  rightSlot?: React.ReactNode;
}

export default function ProjectWorkflowHeader({
  projectId: propProjectId,
  projectName: propProjectName,
  activeStage: propActiveStage,
  rightSlot,
}: ProjectWorkflowHeaderProps) {
  const pathname = usePathname() || '';
  const params = useParams();
  const isSimcoreRoute = /^\/(?:simcore|projects\/[^/]+\/simcore)(?:\/|$)/.test(pathname);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2400);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const [fetchedProjectName, setFetchedProjectName] = useState<string | null>(null);

  // 智能推断 Project ID
  const resolvedProjectId =
    propProjectId ||
    (params?.projectId as string) ||
    (pathname.startsWith('/projects/') && pathname.split('/')[2] !== 'new'
      ? pathname.split('/')[2]
      : isSimcoreRoute ? '' : 'proj-embodix-01');

  useEffect(() => {
    if (!resolvedProjectId || resolvedProjectId === 'proj-embodix-01') return;
    let active = true;
    if (typeof getProject === 'function') {
      getProject({ path: { projectId: resolvedProjectId } })
        .then((res) => {
          if (active && res.data?.name) {
            setFetchedProjectName(res.data.name);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [resolvedProjectId]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  interface ProjectSummary {
    id: string;
    name: string;
    projectType?: string;
  }

  const [projectsList, setProjectsList] = useState<ProjectSummary[]>([]);
  const selectorRef = useRef<HTMLDivElement>(null);

  const getFallbackProjects = (): ProjectSummary[] => {
    if (typeof getProjects !== 'function') return [];
    return getProjects().map((d: any) => ({
      id: d.id,
      name: d.name,
      projectType: d.projectType || (/非标|equipment|自动化/i.test(d.name) ? 'AUTOMATION' : 'EMBODIED_AI'),
    }));
  };

  useEffect(() => {
    let active = true;
    if (typeof listProjects === 'function') {
      listProjects({ query: { limit: 20 } })
        .then((res: any) => {
          if (!active) return;
          if (res?.data?.items && Array.isArray(res.data.items) && res.data.items.length > 0) {
            setProjectsList(
              res.data.items.map((p: any) => ({
                id: p.id,
                name: p.name || '未命名项目',
                projectType: p.projectType,
              }))
            );
          } else {
            setProjectsList(getFallbackProjects());
          }
        })
        .catch(() => {
          if (active) {
            setProjectsList(getFallbackProjects());
          }
        });
    } else {
      setProjectsList(getFallbackProjects());
    }
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDropdownOpen]);

  const displayProjects = projectsList.length > 0 ? projectsList : getFallbackProjects();

  const isAutomationProject = (proj: ProjectSummary) => {
    return (
      proj.projectType === 'AUTOMATION' ||
      /非标|equipment/i.test(proj.projectType || '') ||
      /非标/i.test(proj.name || '')
    );
  };

  const projectObj = isSimcoreRoute ? undefined : (typeof getProjectById === 'function' ? getProjectById(resolvedProjectId) : undefined);

  const resolvedProjectName =
    propProjectName ||
    fetchedProjectName ||
    (projectObj
      ? projectObj.name
      : !resolvedProjectId
        ? '选择 Project'
        : '双臂协作装配机械臂控制系统');

  // 智能推断当前活跃阶段 (默认根据 pathname 自动判定)
  let activeStageId = 3; // 缺省为 Simcore・仿真训练
  if (typeof propActiveStage === 'number') {
    activeStageId = propActiveStage;
  } else if (typeof propActiveStage === 'string') {
    const found = WORKFLOW_STAGES.find((s) => s.key === propActiveStage);
    if (found) activeStageId = found.id;
  } else {
    if ((pathname.includes('/embodex') || pathname.includes('/temp'))) {
      activeStageId = 1;
    } else if (pathname.includes('/simcore')) {
      activeStageId = 3;
    } else if (pathname.includes('/algorithms')) {
      activeStageId = 4;
    } else if (pathname.includes('/deploy') || (pathname.startsWith('/projects/') && !pathname.includes('/new'))) {
      activeStageId = 5; // 项目主详情页即 Production Deployment
    }
  }

  // 依据当前阶段自动渲染右侧工具栏
  const renderAdaptiveRightActions = () => {
    if (rightSlot) return rightSlot;

    switch (activeStageId) {
      case 1: // Embodex・方案设计
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="task-btn-publish"
              onClick={() => showToast('✓ 已发布方案设计规格产物 (URDF 1.0 / GLB 拓扑)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>发布方案</span>
            </button>
            <button type="button" className="task-icon-btn" title="更多选项">···</button>
          </div>
        );

      case 3: // Simcore・仿真训练
        if (!isSimcoreRoute) {
          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <div className="task-env-badge" title="当前 UE 5.4 实时环境就绪">
                <span className="task-env-dot" />
                <span>实时就绪 (60 FPS)</span>
              </div>
            </div>
          );
        }
        return null;

      case 4: // Embokit・算法管理
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div
              className="task-btn-ghost"
              style={{
                fontSize: 11,
                padding: '4px 10px',
                background: '#f0f9ff',
                color: '#0284c7',
                borderColor: '#bae6fd',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 9999,
              }}
              title="当前可用 Token 余额"
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0284c7' }} />
              <KitBalanceBadge projectId={typeof params?.projectId === 'string' ? params.projectId : propProjectId} />
            </div>
            <button type="button" className="task-icon-btn" title="更多选项">···</button>
          </div>
        );

      case 5: // Deplox・真机部署
      default:
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="task-icon-btn" title="更多选项">···</button>
          </div>
        );
    }
  };

  return (
    <>
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

      <header
        className="task-topbar"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: '#ffffff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}
      >
        <div className="task-topbar-left" style={{ flex: 1, minWidth: 0 }}>
          {/* 返回项目列表 */}
          <Link href="/projects" className="task-icon-btn" title="返回项目列表">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </Link>

          {/* 收藏项目 */}
          <button type="button" className="task-icon-btn" title="收藏项目">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          {/* 项目标题与下拉选择器 */}
          <div className="task-project-selector-wrap" ref={selectorRef}>
            <button
              type="button"
              className={`task-project-selector ${isDropdownOpen ? 'open' : ''}`}
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              aria-expanded={isDropdownOpen}
              aria-haspopup="menu"
              title={`当前项目: ${resolvedProjectName} (点击切换项目)`}
            >
              <span className="task-project-name" title={resolvedProjectName}>
                {resolvedProjectName}
              </span>
              <span className="task-project-lock-icon" aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <span className="task-project-chevron-icon" aria-hidden="true">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>

            {isDropdownOpen && (
              <div className="task-project-dropdown" role="menu">
                <div className="task-project-dropdown-header">
                  <span>切换项目</span>
                </div>

                <div className="task-project-dropdown-list">
                  {displayProjects.map((proj) => {
                    const isCurrent = proj.id === resolvedProjectId;
                    const isAutomation = isAutomationProject(proj);
                    const targetHref = isAutomation
                      ? `/projects/${proj.id}/equipment`
                      : `/projects/${proj.id}`;

                    return (
                      <Link
                        key={proj.id}
                        href={targetHref}
                        className={`task-project-dropdown-item ${isCurrent ? 'active' : ''}`}
                        onClick={() => setIsDropdownOpen(false)}
                        role="menuitem"
                        title={`${proj.name}${isAutomation ? ' (非标设备工作台)' : ''}`}
                      >
                        <div className="task-project-dropdown-item-main">
                          <span
                            className={`task-project-type-icon ${isAutomation ? 'automation' : 'embodied'}`}
                            aria-hidden="true"
                          >
                            {isAutomation ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect width="16" height="16" x="4" y="4" rx="2" />
                                <rect width="6" height="6" x="9" y="9" rx="1" />
                                <path d="M15 2v2" />
                                <path d="M15 20v2" />
                                <path d="M2 15h2" />
                                <path d="M20 15h2" />
                              </svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 8V4H8" />
                                <rect width="16" height="12" x="4" y="8" rx="2" />
                                <path d="M2 14h2" />
                                <path d="M20 14h2" />
                                <path d="M15 13v2" />
                                <path d="M9 13v2" />
                              </svg>
                            )}
                          </span>
                          <span className="task-project-dropdown-item-name">{proj.name}</span>
                          {isAutomation && (
                            <span className="task-project-tag automation">非标</span>
                          )}
                        </div>

                        {isCurrent && (
                          <span className="task-project-dropdown-current-badge">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>

                <div className="task-project-dropdown-divider" role="separator" />

                <div className="task-project-dropdown-footer">
                  <Link
                    href="/projects"
                    className="task-project-dropdown-all-btn"
                    onClick={() => setIsDropdownOpen(false)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="7" height="7" x="3" y="3" rx="1" />
                      <rect width="7" height="7" x="14" y="3" rx="1" />
                      <rect width="7" height="7" x="14" y="14" rx="1" />
                      <rect width="7" height="7" x="3" y="14" rx="1" />
                    </svg>
                    <span>全部项目</span>
                    <span className="task-project-dropdown-all-arrow">→</span>
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div className="task-topbar-divider" />

          {/* 5 阶段 Workflow Stepper (Embodex・方案设计 → Lexis・自动编程 → Simcore・仿真训练 → Embokit・算法管理 → Deplox・真机部署) */}
          <nav className="tasks2-stepper-wrap" aria-label="Workflow Stepper">
            {WORKFLOW_STAGES.map((stage, idx) => {
              const isCurrentActive = activeStageId === stage.id;
              const isCompleted = stage.id < activeStageId;
              const isPending = stage.id > activeStageId;
              const targetHref = stage.getHref(resolvedProjectId);
              const stageMeta = isSimcoreRoute && stage.id === 3 ? '训练任务 · 状态见任务面板' : stage.meta;
              const isClickable = targetHref !== '#';
              const isLexis = stage.key === 'coding';

              const pillContent = (
                <>
                  {/* 完成阶段显示绿色对勾 */}
                  {isCompleted && (
                    <span className="tasks2-step-check-icon">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}

                  {/* 当前活跃阶段显示呼吸绿点 */}
                  {isCurrentActive && <span className="tasks2-pulse-dot" />}

                  {/* 待执行阶段显示序号 */}
                  {isPending && <span className="tasks2-step-num">{stage.id}</span>}

                  {/* 阶段名称 */}
                  <span>{stage.name}</span>

                  {/* 当前活跃阶段标记 */}
                  {isCurrentActive && (
                    <span className="tasks2-run-tag">ACTIVE</span>
                  )}
                </>
              );

              const pillClasses = `tasks2-step-pill ${
                isCurrentActive ? 'active' : isCompleted ? 'done' : 'pending'
              }`;

              return (
                <React.Fragment key={stage.id}>
                  {idx > 0 && (
                    <span className="tasks2-step-arrow" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  )}

                  {isLexis ? (
                    <a
                      href="#lexis"
                      role="button"
                      onClick={(e) => {
                        e.preventDefault();
                        showToast('暂未开放');
                      }}
                      className={pillClasses}
                      title={`${stage.id}. ${stage.name} (暂未开放)`}
                    >
                      {pillContent}
                    </a>
                  ) : isClickable ? (
                    <Link
                      href={targetHref}
                      className={pillClasses}
                      title={`${stage.id}. ${stage.name} (${stageMeta}) - 点击跳转`}
                    >
                      {pillContent}
                    </Link>
                  ) : (
                    <span
                      className={pillClasses}
                      title={`${stage.id}. ${stage.name} (${stageMeta})`}
                      style={{ cursor: 'default' }}
                    >
                      {pillContent}
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        </div>

        {/* 顶部右侧自适应操作区 */}
        <div className="task-topbar-right" style={{ flexShrink: 0 }}>
          {renderAdaptiveRightActions()}
        </div>
      </header>
    </>
  );
}
