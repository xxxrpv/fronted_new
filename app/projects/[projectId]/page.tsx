'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  getProject,
  listProjectResources,
  listTasks,
  listTaskResults,
} from '../../../lib/api';
import type { Project, Resource } from '../../../lib/api/generated/types.gen';
import { ProjectActionMenu, EditProjectModal, DeleteProjectModal } from '../../../components/projects';
import { platformJson } from '../../../lib/hub/api';
import type { Version } from '../../../lib/hub/types';
import { useAuth } from '../../../lib/auth-context';

// 运行与评测历史项 (对齐 tasks、validations 与 results 全链路模型)
export interface EvaluationRunItem {
  taskId: string;
  actionKey: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  resultId?: string;
  resultCreatedAt?: string;
  summary?: string;
  successRate?: string;
  episodes?: string | number;
  averageReward?: string | number;
  algorithm?: string;
  hasVideoReplay?: boolean;
  steps?: string; // 训练迭代步数 (Steps)
  duration?: string; // 任务耗时 / 执行时长
  robotName?: string; // 绑定机器人资产
  sceneName?: string; // 仿真评测场景
  failureReason?: string; // 失败原因类型 (失败行专属)
  // Validation 输入参数与配置快照
  validationId?: string;
  configSnapshot?: {
    totalSteps?: number | string;
    learningRate?: string;
    batchSize?: number;
    gamma?: number;
    entropyCoeff?: number;
    presentationMode?: string;
    templateId?: string;
    torqueLimit?: string;
    rewardFunction?: string;
    actionDimensions?: string;
  };
  // Result 产出模型资产
  producedModel?: {
    name: string;
    size: string;
    format: string;
  };
}

// 解析并提取 Agent 模型版本展示名称 (与 Embodex 方案设计工作区对齐)
const parseVersionName = (version: Version): string => {
  try {
    const value = JSON.parse(version.summary);
    if (typeof value?.name === 'string') return value.name;
  } catch {
    /* 兼容旧摘要格式 */
  }
  return (
    version.summary.match(/['"]name['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] ||
    version.summary.slice(0, 80) ||
    '机器人模型'
  );
};

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = (params?.projectId as string) || '';

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 1. 模型就绪清单 - Embodex Agent 生成的模型版本 (对标方案设计工作区)
  const [embodexVersions, setEmbodexVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);

  // 2. 项目资产 - 当前项目已关联绑定的资产
  const [projectAssets, setProjectAssets] = useState<Resource[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);

  // 3. 运行与评测历史
  const [runs, setRuns] = useState<EvaluationRunItem[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<EvaluationRunItem | null>(null);
  const { user } = useAuth();

  // 4. 查看全部历史运行记录 Drawer 抽屉与分页状态
  const [showAllRunsDrawer, setShowAllRunsDrawer] = useState(false);
  const [allRuns, setAllRuns] = useState<EvaluationRunItem[]>([]);
  const [loadingAllRuns, setLoadingAllRuns] = useState(false);
  const [drawerPage, setDrawerPage] = useState(1);
  const [drawerFilterType, setDrawerFilterType] = useState<'ALL' | 'SIMCORE_TRAINING' | 'SIMCORE_EVALUATION'>('ALL');
  const [hoveredDrawerTaskId, setHoveredDrawerTaskId] = useState<string | null>(null);
  const [isSnapshotHovered, setIsSnapshotHovered] = useState(false);
  const drawerPageSize = 8;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  // 辅助时间格式化
  const formatTime = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (Number.isNaN(d.getTime())) return isoString;
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${m}月${day}日 ${hh}:${mm}`;
    } catch {
      return isoString;
    }
  };

  // 辅助任务耗时计算
  const formatDuration = (startIso?: string, endIso?: string): string | undefined => {
    if (!startIso || !endIso) return undefined;
    try {
      const start = new Date(startIso).getTime();
      const end = new Date(endIso).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;
      const diffSec = Math.floor((end - start) / 1000);
      if (diffSec < 60) return `${diffSec}s`;
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    } catch {
      return undefined;
    }
  };

  // 辅助步数格式化
  const formatSteps = (rawSteps: unknown): string | undefined => {
    if (typeof rawSteps === 'number') {
      if (rawSteps >= 10000) {
        return `${Math.round(rawSteps / 1000)}k 步`;
      }
      return `${rawSteps.toLocaleString()} 步`;
    }
    if (typeof rawSteps === 'string' && rawSteps.trim().length > 0) {
      return rawSteps.includes('步') ? rawSteps : `${rawSteps} 步`;
    }
    return undefined;
  };

  // 执行状态文案推导 (训练完成 / 训练失败 / 评测完成 / 评测失败)
  const deriveExecutionStatus = (run: EvaluationRunItem): {
    label: string;
    color: string;
  } => {
    const isTraining = run.actionKey === 'SIMCORE_TRAINING';

    if (isTraining) {
      switch (run.status) {
        case 'SUCCEEDED':
          return { label: '训练完成', color: '#0f172a' };
        case 'FAILED':
          return { label: '训练失败', color: '#f87171' };
        case 'RUNNING':
          return { label: '训练中', color: '#2563eb' };
        case 'PENDING':
          return { label: '等待训练', color: '#64748b' };
        case 'CANCELED':
          return { label: '训练取消', color: '#94a3b8' };
        default:
          return { label: run.status, color: '#0f172a' };
      }
    } else {
      switch (run.status) {
        case 'SUCCEEDED':
          return { label: '评测完成', color: '#0f172a' };
        case 'FAILED':
          return { label: '评测失败', color: '#f87171' };
        case 'RUNNING':
          return { label: '评测中', color: '#2563eb' };
        case 'PENDING':
          return { label: '等待评测', color: '#64748b' };
        case 'CANCELED':
          return { label: '评测取消', color: '#94a3b8' };
        default:
          return { label: run.status, color: '#0f172a' };
      }
    }
  };

  const getAlgorithmDisplay = (run: EvaluationRunItem) => {
    if (run.algorithm) return run.algorithm.toUpperCase();
    if (run.actionKey === 'SIMCORE_TRAINING') return 'PPO';
    return '—';
  };

  const getDurationDisplay = (run: EvaluationRunItem) => {
    if (!run.duration) return '—';
    if (run.duration.startsWith('耗时')) return run.duration;
    return `耗时 ${run.duration}`;
  };

  // 评测业务状态推导 (由前端根据训练产物/条件推导)
  const deriveEvalStatus = (run: EvaluationRunItem): {
    label: string;
    color: string;
    bg: string;
    border: string;
  } => {
    const isTraining = run.actionKey === 'SIMCORE_TRAINING';

    if (isTraining) {
      if (run.status === 'SUCCEEDED') {
        return {
          label: '待评测',
          color: '#2563eb',
          bg: '#eff6ff',
          border: '#bfdbfe',
        };
      }
      if (run.status === 'FAILED') {
        return {
          label: '不可评测',
          color: '#94a3b8',
          bg: '#f8fafc',
          border: '#e2e8f0',
        };
      }
      if (run.status === 'RUNNING') {
        return {
          label: '训练中',
          color: '#0284c7',
          bg: '#f0f9ff',
          border: '#bae6fd',
        };
      }
      return {
        label: '准备中',
        color: '#d97706',
        bg: '#fffbeb',
        border: '#fde68a',
      };
    } else {
      if (run.status === 'SUCCEEDED') {
        return {
          label: '已完成',
          color: '#059669',
          bg: '#ecfdf5',
          border: '#a7f3d0',
        };
      }
      if (run.status === 'FAILED') {
        return {
          label: '评测失败',
          color: '#dc2626',
          bg: '#fef2f2',
          border: '#fecaca',
        };
      }
      if (run.status === 'RUNNING') {
        return {
          label: '评测中',
          color: '#2563eb',
          bg: '#eff6ff',
          border: '#bfdbfe',
        };
      }
      return {
        label: '排队中',
        color: '#d97706',
        bg: '#fffbeb',
        border: '#fde68a',
      };
    }
  };

  // 辅助解析与填充 Result 数据
  const mapTaskResult = async (taskId: string) => {
    try {
      const resultRes = await listTaskResults({
        path: { taskId },
        query: { limit: 5 },
      });
      const items = resultRes.data?.items || [];
      const match = items.find((r) => r.sourceModule === 'simcore') || items[0];
      if (!match) return {};

      const data = (match.data as Record<string, unknown>) || {};
      const rawRate = data.successRate ?? data.success_rate;
      let formattedRate: string | undefined;
      if (typeof rawRate === 'number') {
        formattedRate = rawRate <= 1 ? `${(rawRate * 100).toFixed(0)}%` : `${rawRate}%`;
      } else if (typeof rawRate === 'string') {
        formattedRate = rawRate.includes('%') ? rawRate : `${rawRate}%`;
      }

      let algorithm: string | undefined = undefined;
      if (typeof data.algorithm === 'string') {
        algorithm = data.algorithm.toUpperCase();
      } else if (typeof data.algorithmId === 'string') {
        algorithm = data.algorithmId.toUpperCase();
      }

      const hasVideo = Boolean(
        data.videoUrl || data.hasVideoReplay || data.replayUrl || data.playbackArtifactId
      );

      const steps = formatSteps(data.totalSteps ?? data.steps ?? data.completedSteps);
      const robotName = (data.robotName as string) || (data.robot as string) || (data.templateId as string) || undefined;
      const sceneName = (data.sceneName as string) || (data.environment as string) || (data.scene as string) || undefined;
      const failureReason = (data.failureReason as string) || (data.error as string) || (data.message as string) || undefined;

      return {
        resultId: match.id,
        resultCreatedAt: match.createdAt,
        summary: match.summary,
        successRate: formattedRate,
        episodes: (data.episodes ?? data.totalEpisodes ?? data.episode_count) as string | number | undefined,
        averageReward: (data.averageCumulativeReward ?? data.average_reward ?? data.meanReward) as string | number | undefined,
        algorithm,
        hasVideoReplay: hasVideo,
        steps,
        robotName,
        sceneName,
        failureReason,
      };
    } catch {
      return {};
    }
  };

  // 辅助批量补齐 Simcore 任务结果与指标耗时 (抽取公用函数复用)
  const enrichSimcoreTasks = async (simTasks: any[]): Promise<EvaluationRunItem[]> => {
    return Promise.all(
      simTasks.map(async (task) => {
        const resInfo = await mapTaskResult(task.id);
        const duration = formatDuration(task.createdAt, task.updatedAt);
        return {
          taskId: task.id,
          actionKey: task.actionKey,
          status: task.status,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          duration,
          ...resInfo,
        } as EvaluationRunItem;
      })
    );
  };

  // 数据初始化加载
  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    // 0. 加载项目元数据
    getProject({ path: { projectId } })
      .then((res) => {
        if (!isMounted) return;
        if (res.error || !res.data) {
          const errMsg = (res.error as any)?.error?.message || '未找到指定项目 (Project Not Found)';
          setError(errMsg);
        } else {
          setProject(res.data);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || '加载项目详情失败');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    // A. 加载 Embodex Agent 生成的模型版本 (直通 Embodex Hub 方案设计页)
    const loadEmbodexVersions = async () => {
      setLoadingVersions(true);
      try {
        const res = await platformJson<{ versions: Version[] }>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/embodex-hub/versions`
        );
        if (!isMounted) return;
        const versions = res?.versions || [];
        setEmbodexVersions(versions);
      } catch {
        if (!isMounted) return;
        setEmbodexVersions([]);
      } finally {
        if (isMounted) setLoadingVersions(false);
      }
    };

    // B. 加载当前项目已关联绑定的资产
    const loadAssets = async () => {
      setLoadingAssets(true);
      try {
        const projRes = await listProjectResources({ path: { projectId }, query: { limit: 50 } });
        if (!isMounted) return;
        const items = projRes.data?.items || [];
        const filteredProj = items.filter((r) => r.type === 'ROBOT' || r.type === 'ALGORITHM' || r.type === 'SCENE');
        setProjectAssets(filteredProj);
      } catch {
        if (!isMounted) return;
        setProjectAssets([]);
      } finally {
        if (isMounted) setLoadingAssets(false);
      }
    };

    // C. 加载运行与评测历史 (tasks 与 results 联查)
    const loadRunsData = async () => {
      setLoadingRuns(true);
      try {
        const res = await listTasks({ path: undefined as never, query: { projectId, limit: 15 } });
        if (!isMounted) return;
        const items = res.data?.items || [];
        const simTasks = items
          .filter((t) => t.actionKey === 'SIMCORE_TRAINING' || t.actionKey === 'SIMCORE_EVALUATION')
          .slice(0, 5);

        if (simTasks.length === 0) {
          setRuns([]);
          return;
        }

        const resolved = await enrichSimcoreTasks(simTasks);

        if (isMounted) {
          setRuns(resolved);
        }
      } catch {
        if (isMounted) setRuns([]);
      } finally {
        if (isMounted) setLoadingRuns(false);
      }
    };

    loadEmbodexVersions();
    loadAssets();
    loadRunsData();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // 刷新历史列表
  const handleRefreshRuns = async () => {
    setLoadingRuns(true);
    try {
      const res = await listTasks({ path: undefined as never, query: { projectId, limit: 15 } });
      const items = res.data?.items || [];
      const simTasks = items
        .filter((t) => t.actionKey === 'SIMCORE_TRAINING' || t.actionKey === 'SIMCORE_EVALUATION')
        .slice(0, 5);

      if (simTasks.length === 0) {
        setRuns([]);
        showToast('历史列表已同步最新状态');
        return;
      }

      const resolved = await enrichSimcoreTasks(simTasks);

      setRuns(resolved);
      showToast('历史列表已同步最新状态');
    } catch {
      setRuns([]);
      showToast('历史列表已保持最新状态');
    } finally {
      setLoadingRuns(false);
    }
  };

  // 加载全量训练与评测历史记录 (覆盖当前项目全部历史流水)
  const loadAllRuns = async () => {
    setLoadingAllRuns(true);
    try {
      const res = await listTasks({ path: undefined as never, query: { projectId, limit: 100 } });
      const items = res.data?.items || [];
      const simTasks = items.filter(
        (t) => t.actionKey === 'SIMCORE_TRAINING' || t.actionKey === 'SIMCORE_EVALUATION'
      );

      if (simTasks.length === 0) {
        setAllRuns([]);
        return;
      }

      const resolved = await enrichSimcoreTasks(simTasks);

      setAllRuns(resolved);
    } catch {
      setAllRuns([]);
    } finally {
      setLoadingAllRuns(false);
    }
  };

  const handleOpenAllRuns = () => {
    setShowAllRunsDrawer(true);
    setDrawerPage(1);
    loadAllRuns();
  };

  // 全量抽屉过滤与分页计算
  const filteredAllRuns = allRuns.filter((run) => {
    if (drawerFilterType === 'ALL') return true;
    return run.actionKey === drawerFilterType;
  });

  const totalDrawerPages = Math.max(1, Math.ceil(filteredAllRuns.length / drawerPageSize));
  const currentDrawerRuns = filteredAllRuns.slice(
    (drawerPage - 1) * drawerPageSize,
    drawerPage * drawerPageSize
  );

  // 支持键盘 Esc 键关闭详情弹窗卡片或全量记录抽屉
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedTaskDetail) {
          setSelectedTaskDetail(null);
        } else if (showAllRunsDrawer) {
          setShowAllRunsDrawer(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskDetail, showAllRunsDrawer]);

  // 加载中状态
  if (isLoading) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 0', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            width: 28,
            height: 28,
            border: '2px solid #e2e8f0',
            borderTopColor: '#0070f3',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: 16,
          }}
        />
        <div style={{ color: '#64748b', fontSize: 13 }}>正在加载项目详情 (ID: {projectId})...</div>
      </div>
    );
  }

  // 错误或未找到项目降级状态
  if (error || !project) {
    return (
      <div style={{ maxWidth: 800, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
        <Link href="/projects" style={{ color: '#64748b', fontSize: 13, textDecoration: 'none' }}>
          ← 返回项目列表
        </Link>
        <div style={{ marginTop: 24, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '40px 24px' }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            未找到指定项目 (Project Not Found)
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 20 }}>
            {error || `系统未检索到 ID 为 “${projectId}” 的项目记录。请检查 URL 路径或返回列表重新选择。`}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Link
              href="/projects"
              style={{
                background: '#0f172a',
                color: '#ffffff',
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              返回项目列表
            </Link>
            <Link
              href="/"
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                color: '#334155',
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              返回概览首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isEmbodiedAI = project.projectType === 'EMBODIED_AI';
  const createdDate = new Date(project.createdAt);
  const formattedCreated = !isNaN(createdDate.getTime())
    ? createdDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
    : '近期创建';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 0' }}>
      {/* Toast 提示 */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
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
            zIndex: 99999,
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* 顶部标题与操作栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            {project.name}
          </h1>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              background: isEmbodiedAI ? '#ecfdf5' : '#f1f5f9',
              color: isEmbodiedAI ? '#059669' : '#475569',
              border: `1px solid ${isEmbodiedAI ? '#a7f3d0' : '#cbd5e1'}`,
            }}
          >
            {isEmbodiedAI ? '具身智能' : '非标自动化'}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: 4,
              background: '#f1f5f9',
              color: '#475569',
            }}
          >
            {formattedCreated}
          </span>
        </div>

        {/* 右侧机器人研发核心操作组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ProjectActionMenu
            project={project}
            onEdit={() => setIsEditing(true)}
            onDelete={() => setIsDeleting(true)}
            onToast={showToast}
          />
          {/* <button
            type="button"
            onClick={() => showToast('已成功创建项目分支 (Git Fork)')}
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#334155',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span>克隆项目</span>
          </button>

          <button
            type="button"
            onClick={() => showToast('打开项目全局配置面板')}
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#334155',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>项目设置</span>
          </button> */}

          {/* 进入仿真主 CTA 按钮 */}
          <Link
            href={`/projects/${project.id}/embodex`}
            style={{
              background: '#0f172a',
              color: '#ffffff',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 4px rgba(15,23,42,0.12)',
            }}
            title="进入方案设计工作流 (/embodex)"
          >
            <span>进入项目</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M7 17L17 7" />
              <path d="M7 7h10v10" />
            </svg>
          </Link>
        </div>
      </div>

      {/* 非标自动化项目引导横幅 */}
      {!isEmbodiedAI && (
        <div
          style={{
            marginBottom: 20,
            padding: '14px 20px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={{ fontSize: 13, color: '#1e40af', fontWeight: 500 }}>
              该项目为非标自动化设备项目（AUTOMATION），请前往专用的五方案对比与 SolidWorks 建模工作台进行操作。
            </span>
          </div>
          <Link
            href={`/projects/${project.id}/equipment`}
            style={{
              background: '#2563eb',
              color: '#ffffff',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            进入设备工作台 →
          </Link>
        </div>
      )}

      {/* 核心卡片 (Hero Card: 55% 仿真快照 + 45% 机器人研发核心元数据) */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #eaeaea',
          borderRadius: 8,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: '55% 45%',
          marginBottom: 24,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          minHeight: 290,
        }}
      >
        {/* 左侧：真实仿真环境快照 (方案 B：常驻微提示条 + Hover 高亮) */}
        <Link
          href={`/projects/${projectId}/embodex`}
          title="点击快照进入方案设计与仿真工作流"
          onMouseEnter={() => setIsSnapshotHovered(true)}
          onMouseLeave={() => setIsSnapshotHovered(false)}
          style={{
            background: '#09090b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            textDecoration: 'none',
            borderRight: '1px solid #eaeaea',
            overflow: 'hidden',
            cursor: 'pointer',
            minHeight: 290,
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              minHeight: 290,
              background: '#000000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <img
              src="/project-simulation-preview.png"
              alt="机械臂运动轨迹规划与抓取仿真快照"
              style={{
                width: '100%',
                height: '100%',
                maxHeight: 290,
                objectFit: 'contain',
                display: 'block',
                transition: 'transform 0.35s ease',
                transform: isSnapshotHovered ? 'scale(1.02)' : 'scale(1)',
              }}
            />
            {/* 右上角仿真就绪小徽标 */}
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 14,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10,
                fontWeight: 600,
                color: '#10b981',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(4px)',
                padding: '3px 8px',
                borderRadius: 9999,
                border: '1px solid rgba(16,185,129,0.3)',
                pointerEvents: 'none',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              仿真就绪 · Simcore
            </div>

            {/* 方案 B：底部常驻微提示条 + 悬停高亮动画 */}
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                left: '50%',
                transform: isSnapshotHovered ? 'translateX(-50%) translateY(-2px)' : 'translateX(-50%)',
                background: isSnapshotHovered ? '#ffffff' : 'rgba(0, 0, 0, 0.65)',
                color: isSnapshotHovered ? '#000000' : '#e2e8f0',
                border: isSnapshotHovered ? '1px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(8px)',
                padding: '6px 14px',
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                boxShadow: isSnapshotHovered
                  ? '0 6px 20px rgba(0, 0, 0, 0.5)'
                  : '0 2px 8px rgba(0, 0, 0, 0.3)',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                pointerEvents: 'none',
              }}
            >
              {/* 左侧鼠标指针箭头图标 */}
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill={isSnapshotHovered ? '#000000' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transition: 'transform 0.25s ease',
                  transform: isSnapshotHovered ? 'translateY(-1px) scale(1.05)' : 'none',
                }}
              >
                <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.438l-1.58 6.124a.5.5 0 0 1-.947.063z" />
              </svg>
              <span>点击画面进入项目</span>
            </div>
          </div>
        </Link>

        {/* 右侧：Vercel 极简风研发核心元数据面板 (1:1 对标 Vercel 排版与行序) */}
        <div
          style={{
            padding: '28px 32px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            background: '#ffffff',
            minHeight: 290,
          }}
        >
          {/* 1. 模型资产 (第一行：对齐 Vercel Deployment 首行位置 + 右上角分析图标) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, color: '#666666', fontWeight: 400, marginBottom: 4 }}>模型资产</div>
              {embodexVersions.length > 0 ? (
                <Link
                  href={`/projects/${projectId}/embodex`}
                  title="进入 Embodex 设计配置模型"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#000000',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    wordBreak: 'break-all',
                  }}
                >
                  <span>
                    第 {embodexVersions.length} 版 · {parseVersionName(embodexVersions[0])} · URDF 就绪
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666666" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </Link>
              ) : (
                <Link
                  href={`/projects/${projectId}/embodex`}
                  title="前往 Embodex 设计生成首版机器人模型"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#666666',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>暂无生成模型 · 待设计生成</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666666" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </Link>
              )}
            </div>
            {/* 对标 Vercel 右上角 Analytics / Activity 状态圆钮 */}
            <button
              type="button"
              onClick={() => handleOpenAllRuns()}
              title="查看全量训练与评测历史分析"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: '1px solid #eaeaea',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#666666',
                padding: 0,
                flexShrink: 0,
                marginLeft: 12,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </button>
          </div>

          {/* 2. 策略算法 (第二行：对齐 Vercel Domains 次行位置 + ⊕ 快捷加号) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: '#666666', fontWeight: 400 }}>策略算法</span>
              <Link
                href={`/projects/${projectId}/simcore`}
                title="在 Simcore 中配置策略"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#666666',
                  textDecoration: 'none',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </Link>
            </div>
            {runs.length > 0 ? (
              <Link
                href={`/projects/${projectId}/simcore`}
                title="前往 Simcore 评测工作台"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#000000',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>
                  {getAlgorithmDisplay(runs[0])} 闭环策略 · 已执行 {runs.length} 次训练评测
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666666" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Link>
            ) : (
              <Link
                href={`/projects/${projectId}/simcore`}
                title="前往 Simcore 启动策略强化学习训练"
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#666666',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>待启动策略强化学习训练 · 待训练</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666666" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Link>
            )}
          </div>

          {/* 3. 运行状态与创建时间 (第三行：对齐 Vercel Status 与 Created 双列位置 + 头像徽标) */}
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 13, color: '#666666', fontWeight: 400, marginBottom: 4 }}>运行状态</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: '#000000' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#50e3c2',
                    display: 'inline-block',
                  }}
                />
                <span>就绪</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: '#666666', fontWeight: 400, marginBottom: 4 }}>创建时间</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#000000', fontWeight: 500 }}>
                <span>{formatTime(project?.createdAt)}</span>
                <span
                  title="项目所有者"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#10b981',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                >
                  {user?.email ? user.email.slice(0, 1).toUpperCase() : 'U'}
                </span>
              </div>
            </div>
          </div>

          {/* 4. 研发资产 (第四行：纯静态展示，取消跳转与外链图标) */}
          <div>
            <div style={{ fontSize: 13, color: '#666666', fontWeight: 400, marginBottom: 4 }}>研发资产</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: projectAssets.length > 0 ? '#000000' : '#666666' }}>
              {projectAssets.length > 0
                ? `已绑定 ${projectAssets.length} 项机型 / 场景 / 算法资产`
                : '暂无关联绑定资产 · 待关联'}
            </div>
          </div>
        </div>
      </div>

      {/* 下一步行动推荐条 (Next Step Onboarding) */}
      {embodexVersions.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '12px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>💡</span>
            <span style={{ color: '#0f172a', fontWeight: 500 }}>
              首步建议：当前项目尚未生成机器人模型，建议前往 Embodex 开始设计与方案生成
            </span>
          </div>
          <Link
            href={`/projects/${projectId}/embodex`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#0070f3',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            去设计首版模型 →
          </Link>
        </div>
      ) : runs.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '12px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>💡</span>
            <span style={{ color: '#0f172a', fontWeight: 500 }}>
              下一步推荐：模型已设计完成，可前往 Simcore 启动首轮强化学习策略训练与环境评测
            </span>
          </div>
          <Link
            href={`/projects/${projectId}/simcore`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#0070f3',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            启动策略训练 →
          </Link>
        </div>
      ) : null}

      {/* 下方三栏核心指标与资产看板 (3-Col Grid: 极简纯净行列表) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginBottom: 32 }}>
        {/* 卡片 1: 模型就绪清单 (展示 Embodex Agent 生成的模型版本) */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* 顶栏: 标题与版本数量提示 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>模型就绪清单</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {loadingVersions ? '...' : `${embodexVersions.length} 个版本`}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>Embodex Agent</span>
          </div>

          {/* 版本列表区 (极简行列表，无笨重小灰盒) */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              paddingRight: 4,
            }}
          >
            {loadingVersions ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                正在同步 Embodex 模型版本...
              </div>
            ) : embodexVersions.length === 0 ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                暂无 Agent 生成的模型版本
              </div>
            ) : (
              embodexVersions.map((v, index) => {
                const name = parseVersionName(v);
                return (
                  <div
                    key={`${v.version_id}-${index}`}
                    style={{
                      padding: '10px 0',
                      borderBottom: index === embodexVersions.length - 1 ? 'none' : '1px solid #f1f5f9',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`第 ${v.number} 版 · ${name}`}
                      >
                        第 {v.number} 版 · {name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#059669',
                          background: '#ecfdf5',
                          padding: '1px 6px',
                          borderRadius: 3,
                          flexShrink: 0,
                        }}
                      >
                        URDF 就绪
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
                      <span>来源: 对话设计</span>
                      <span>·</span>
                      <span>{formatTime(v.created_at)}</span>
                      <span>·</span>
                      <code style={{ fontSize: 10, color: '#94a3b8' }}>#{v.version_id.slice(0, 8)}</code>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 底部快速跳转 Embodex 方案设计入口 */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, marginTop: 10, textAlign: 'right' }}>
            <Link
              href={`/projects/${projectId}/embodex`}
              style={{ fontSize: 12, color: '#0070f3', textDecoration: 'none', fontWeight: 500 }}
            >
              前往 Embodex 方案设计 →
            </Link>
          </div>
        </div>

        {/* 卡片 2: 项目与研发资产 (只显示和查询当前项目已关联绑定的资产) */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* 顶栏: 标题与数量提示 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>项目与研发资产</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {loadingAssets ? '...' : `${projectAssets.length} 项`}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>当前项目已绑定</span>
          </div>

          {/* 资产列表区 (极简行列表，无笨重小灰盒) */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              paddingRight: 4,
            }}
          >
            {loadingAssets ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                正在查询已关联资产...
              </div>
            ) : projectAssets.length === 0 ? (
              <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                当前项目暂无关联绑定的资产
              </div>
            ) : (
              projectAssets.map((asset, index) => {
                const isPlatform = asset.scope === 'PLATFORM';
                const typeColor =
                  asset.type === 'ROBOT'
                    ? { bg: '#ecfdf5', color: '#059669', label: '机型' }
                    : asset.type === 'ALGORITHM'
                    ? { bg: '#eff6ff', color: '#2563eb', label: '算法' }
                    : { bg: '#fef3c7', color: '#d97706', label: '场景' };

                return (
                  <div
                    key={`${asset.id}-${index}`}
                    style={{
                      padding: '10px 0',
                      borderBottom: index === projectAssets.length - 1 ? 'none' : '1px solid #f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: typeColor.bg,
                          color: typeColor.color,
                          flexShrink: 0,
                        }}
                      >
                        {typeColor.label}
                      </span>

                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: isPlatform ? '#f1f5f9' : '#faf5ff',
                          color: isPlatform ? '#475569' : '#7c3aed',
                          flexShrink: 0,
                        }}
                      >
                        {isPlatform ? '平台引入' : '项目私有'}
                      </span>

                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={asset.displayMetadata?.name || asset.externalId}
                      >
                        {asset.displayMetadata?.name || asset.externalId}
                      </span>
                    </div>

                    <code
                      style={{
                        fontSize: 10,
                        color: '#64748b',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        padding: '1px 5px',
                        borderRadius: 3,
                        flexShrink: 0,
                      }}
                    >
                      {asset.version || 'v1.0'}
                    </code>
                  </div>
                );
              })
            )}
          </div>

          {/* 底部快速关联入口 */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, marginTop: 10, textAlign: 'right' }}>
            <Link
              href="/resources"
              style={{ fontSize: 12, color: '#0070f3', textDecoration: 'none', fontWeight: 500 }}
            >
              去资产库关联更多 →
            </Link>
          </div>
        </div>

        {/* 卡片 3: 真机部署与硬件 (Deplox) */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {/* 顶栏: 标题与部署状态 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>真机部署 (Deplox)</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#64748b',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  padding: '1px 6px',
                  borderRadius: 3,
                }}
              >
                未部署
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>边缘运行环境</span>
          </div>

          {/* 部署状态与硬件信息列表 (极简行列表) */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 220,
            }}
          >
            {/* 1. 目标硬件底盘 */}
            <div
              style={{
                padding: '10px 0',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>目标硬件 / 机器人底盘</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#64748b',
                    background: '#f1f5f9',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}
                >
                  未绑定硬件
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>暂未指定真机底盘或执行机构</div>
            </div>

            {/* 2. Deplox 部署镜像包 */}
            <div
              style={{
                padding: '10px 0',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>Deplox 运行镜像</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#64748b',
                    background: '#f1f5f9',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}
                >
                  待绑定策略
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>需导入策略模型权重并构建分发包</div>
            </div>

            {/* 3. 边缘工控机通讯状态 */}
            <div
              style={{
                padding: '10px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>边缘工控机 / 节点通信</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#64748b',
                    background: '#f1f5f9',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}
                >
                  离线待命
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>等待设备上线并建立遥控通信通道</div>
            </div>
          </div>

          {/* 底部快速前往真机部署入口 */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, marginTop: 10, textAlign: 'right' }}>
            <Link
              href={`/projects/${projectId}/deploy`}
              style={{ fontSize: 12, color: '#0070f3', textDecoration: 'none', fontWeight: 500 }}
            >
              前往 Deplox 部署 →
            </Link>
          </div>
        </div>
      </div>

      {/* 底部历史记录区: 训练与评测历史 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
              训练与评测历史
            </h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
              最近 5 条运行记录 · 策略训练与自动化评测生命周期
            </p>
          </div>

          {/* 右侧工具操作区 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleOpenAllRuns}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '5px 12px',
                color: '#334155',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 500,
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              查看全部
            </button>

            <button
              type="button"
              disabled={loadingRuns}
              onClick={handleRefreshRuns}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '5px 12px',
                color: '#334155',
                fontSize: 12,
                cursor: loadingRuns ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 500,
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{loadingRuns ? '同步中...' : '刷新列表'}</span>
            </button>
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            overflowX: 'auto',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          {loadingRuns && runs.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              正在查询最近 5 条训练与评测任务及结果数据...
            </div>
          ) : runs.length === 0 ? (
            /* 无记录时自动隐藏表头，呈现居中精致空状态卡片，无引导按钮 */
            <div
              style={{
                padding: '56px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              {/* 🎨 居中微图标 */}
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94a3b8',
                  marginBottom: 14,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>

              {/* 📌 主标题 */}
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: 6,
                }}
              >
                暂无训练或评测记录
              </div>

              {/* 💬 说明文案 */}
              <div
                style={{
                  fontSize: 12,
                  color: '#94a3b8',
                  maxWidth: 440,
                  lineHeight: 1.6,
                }}
              >
                在当前项目启动 Simcore 策略训练或模型评测后，任务执行生命周期与评估产出将自动沉淀在此处
              </div>
            </div>
          ) : (
            <>
              {/* 极简清晰对齐的表格标题栏 (仅在有记录时展示) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '115px minmax(120px, 1fr) 75px 105px 135px 95px 95px 115px',
                  alignItems: 'center',
                  padding: '10px 20px',
                  background: '#fafafa',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748b',
                  letterSpacing: '0.2px',
                  minWidth: 855,
                }}
              >
                <span>任务类型</span>
                <span>执行状态</span>
                <span>算法</span>
                <span>任务 ID</span>
                <span>创建时间</span>
                <span>评测状态</span>
                <span>耗时</span>
                <span>操作</span>
              </div>

              {runs.map((run, index) => {
                const isEval = run.actionKey === 'SIMCORE_EVALUATION';
                const isSucceeded = run.status === 'SUCCEEDED';
                const isRunning = run.status === 'RUNNING';
                const isFailed = run.status === 'FAILED';

                const statusDotColor = isSucceeded
                  ? '#10b981'
                  : isRunning
                  ? '#3b82f6'
                  : isFailed
                  ? '#f87171'
                  : '#94a3b8';

                const execStatus = deriveExecutionStatus(run);
                const evalStatus = deriveEvalStatus(run);
                const buttonText = run.hasVideoReplay ? '查看回放 →' : '查看详情 →';
                const isHovered = hoveredTaskId === run.taskId;

                return (
                  <div
                    key={run.taskId || index}
                    onClick={() => setSelectedTaskDetail(run)}
                    onMouseEnter={() => setHoveredTaskId(run.taskId)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '115px minmax(120px, 1fr) 75px 105px 135px 95px 95px 115px',
                      alignItems: 'center',
                      padding: '13px 20px',
                      borderBottom: index === runs.length - 1 ? 'none' : '1px solid #f1f5f9',
                      fontSize: 13,
                      background: isHovered ? '#f8fafc' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      minWidth: 855,
                    }}
                  >
                    {/* 1. 任务类型 (状态圆点 + Badge) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        title={`执行状态: ${run.status}`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: statusDotColor,
                          flexShrink: 0,
                          boxShadow: isRunning ? '0 0 0 3px rgba(59, 130, 246, 0.2)' : 'none',
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: isEval ? '#ecfdf5' : '#f1f5f9',
                          color: isEval ? '#059669' : '#334155',
                          border: isEval ? '1px solid #d1fae5' : '1px solid #e2e8f0',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isEval ? '模型评测' : '策略训练'}
                      </span>
                    </div>

                    {/* 2. 执行状态 (训练完成 / 训练失败 / 评测完成) */}
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: execStatus.color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {execStatus.label}
                    </span>

                    {/* 3. 算法 (PPO / SAC 等独立一列，置于右侧元数据区首位) */}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: 'monospace',
                        color: '#475569',
                      }}
                    >
                      {getAlgorithmDisplay(run)}
                    </span>

                    {/* 4. 任务 ID */}
                    <code
                      title={`完整 Task ID: ${run.taskId}`}
                      style={{
                        fontSize: 12,
                        color: isHovered ? '#0f172a' : '#334155',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        letterSpacing: '-0.2px',
                      }}
                    >
                      #{run.taskId.slice(0, 8)}
                    </code>

                    {/* 5. 创建时间 */}
                    <span
                      style={{
                        fontSize: 12,
                        color: isHovered ? '#334155' : '#64748b',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatTime(run.createdAt)}
                    </span>

                    {/* 6. 评测业务推导状态徽标 */}
                    <div>
                      <span
                        title="根据任务执行产物及满足条件推导的业务状态"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: evalStatus.color,
                          background: evalStatus.bg,
                          border: `1px solid ${evalStatus.border}`,
                          padding: '2px 8px',
                          borderRadius: 9999,
                          display: 'inline-block',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {evalStatus.label}
                      </span>
                    </div>

                    {/* 7. 任务耗时 */}
                    <span
                      style={{
                        fontSize: 12,
                        color: '#64748b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getDurationDisplay(run)}
                    </span>

                    {/* 8. 查看详情 / 查看回放 操作按钮 (与表头“操作”绝对左对齐) */}
                    <div style={{ justifySelf: 'start' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTaskDetail(run);
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 5,
                          border: '1px solid',
                          borderColor: isHovered ? '#cbd5e1' : '#e2e8f0',
                          background: '#ffffff',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#0f172a',
                          cursor: 'pointer',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          transition: 'all 0.15s ease',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {buttonText}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>

      {/* 右侧滑出抽屉 (Slide-over Drawer): 查看全部训练与评测历史 */}
      {showAllRunsDrawer && (
        <>
          <style>{`
            @keyframes drawerSlideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>

          {/* 半透明模糊遮罩层 */}
          <div
            role="presentation"
            onClick={() => setShowAllRunsDrawer(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.45)',
              backdropFilter: 'blur(3px)',
              zIndex: 99980,
              transition: 'opacity 0.2s ease',
            }}
          />

          {/* 右侧抽屉主体 */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="全部训练与评测历史"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(980px, 94vw)',
              background: '#ffffff',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
              zIndex: 99990,
              display: 'flex',
              flexDirection: 'column',
              animation: 'drawerSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* 1. 抽屉头部 */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#ffffff',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                    全部训练与评测历史
                  </h2>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 9999,
                      background: '#f1f5f9',
                      color: '#475569',
                    }}
                  >
                    共 {filteredAllRuns.length} 条记录
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
                  策略训练与自动化评测全生命周期运行记录 · 支持分页与详情穿透
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  disabled={loadingAllRuns}
                  onClick={loadAllRuns}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: '6px 12px',
                    color: '#334155',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: loadingAllRuns ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ animation: loadingAllRuns ? 'spin 1s linear infinite' : 'none' }}
                  >
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>{loadingAllRuns ? '刷新中...' : '刷新'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAllRunsDrawer(false)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="关闭 (Esc)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 2. 筛选栏 */}
            <div
              style={{
                padding: '10px 24px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#fafafa',
              }}
            >
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>过滤类型:</span>
              {(
                [
                  { key: 'ALL', label: `全部 (${allRuns.length})` },
                  {
                    key: 'SIMCORE_TRAINING',
                    label: `策略训练 (${allRuns.filter((r) => r.actionKey === 'SIMCORE_TRAINING').length})`,
                  },
                  {
                    key: 'SIMCORE_EVALUATION',
                    label: `模型评测 (${allRuns.filter((r) => r.actionKey === 'SIMCORE_EVALUATION').length})`,
                  },
                ] as const
              ).map((tab) => {
                const isActive = drawerFilterType === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setDrawerFilterType(tab.key);
                      setDrawerPage(1);
                    }}
                    style={{
                      background: isActive ? '#0f172a' : '#ffffff',
                      color: isActive ? '#ffffff' : '#475569',
                      border: `1px solid ${isActive ? '#0f172a' : '#e2e8f0'}`,
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* 3. 抽屉表格内容区 */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
              {loadingAllRuns && allRuns.length === 0 ? (
                <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  正在查询当前项目全部训练与评测历史...
                </div>
              ) : currentDrawerRuns.length === 0 ? (
                <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  暂无符合条件的训练或评测记录
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '115px minmax(120px, 1fr) 75px 105px 135px 95px 95px 115px',
                      alignItems: 'center',
                      padding: '10px 24px',
                      background: '#f8fafc',
                      borderBottom: '1px solid #e2e8f0',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#64748b',
                      letterSpacing: '0.2px',
                      minWidth: 855,
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                    }}
                  >
                    <span>任务类型</span>
                    <span>执行状态</span>
                    <span>算法</span>
                    <span>任务 ID</span>
                    <span>创建时间</span>
                    <span>评测状态</span>
                    <span>耗时</span>
                    <span>操作</span>
                  </div>

                  {currentDrawerRuns.map((run, index) => {
                    const isEval = run.actionKey === 'SIMCORE_EVALUATION';
                    const isSucceeded = run.status === 'SUCCEEDED';
                    const isRunning = run.status === 'RUNNING';
                    const isFailed = run.status === 'FAILED';

                    const statusDotColor = isSucceeded
                      ? '#10b981'
                      : isRunning
                      ? '#3b82f6'
                      : isFailed
                      ? '#f87171'
                      : '#94a3b8';

                    const execStatus = deriveExecutionStatus(run);
                    const evalStatus = deriveEvalStatus(run);
                    const buttonText = run.hasVideoReplay ? '查看回放 →' : '查看详情 →';
                    const isHovered = hoveredDrawerTaskId === run.taskId;

                    return (
                      <div
                        key={run.taskId || index}
                        onClick={() => setSelectedTaskDetail(run)}
                        onMouseEnter={() => setHoveredDrawerTaskId(run.taskId)}
                        onMouseLeave={() => setHoveredDrawerTaskId(null)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '115px minmax(120px, 1fr) 75px 105px 135px 95px 95px 115px',
                          alignItems: 'center',
                          padding: '13px 24px',
                          borderBottom: '1px solid #f1f5f9',
                          fontSize: 13,
                          background: isHovered ? '#f8fafc' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                          minWidth: 855,
                        }}
                      >
                        {/* 1. 任务类型 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            title={`执行状态: ${run.status}`}
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: statusDotColor,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: isEval ? '#ecfdf5' : '#f1f5f9',
                              color: isEval ? '#059669' : '#334155',
                              border: isEval ? '1px solid #d1fae5' : '1px solid #e2e8f0',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isEval ? '模型评测' : '策略训练'}
                          </span>
                        </div>

                        {/* 2. 执行状态 */}
                        <span style={{ fontSize: 13, fontWeight: 500, color: execStatus.color, whiteSpace: 'nowrap' }}>
                          {execStatus.label}
                        </span>

                        {/* 3. 算法 */}
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color: '#475569' }}>
                          {getAlgorithmDisplay(run)}
                        </span>

                        {/* 4. 任务 ID */}
                        <code style={{ fontSize: 12, color: '#334155', fontFamily: 'monospace', fontWeight: 600 }}>
                          #{run.taskId.slice(0, 8)}
                        </code>

                        {/* 5. 创建时间 */}
                        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {formatTime(run.createdAt)}
                        </span>

                        {/* 6. 评测状态 */}
                        <div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: evalStatus.color,
                              background: evalStatus.bg,
                              border: `1px solid ${evalStatus.border}`,
                              padding: '2px 8px',
                              borderRadius: 9999,
                              display: 'inline-block',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {evalStatus.label}
                          </span>
                        </div>

                        {/* 7. 耗时 */}
                        <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                          {getDurationDisplay(run)}
                        </span>

                        {/* 8. 操作 */}
                        <div style={{ justifySelf: 'start' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTaskDetail(run);
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 5,
                              border: '1px solid #e2e8f0',
                              background: '#ffffff',
                              fontSize: 12,
                              fontWeight: 500,
                              color: '#0f172a',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {buttonText}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* 4. 底部固定分页栏 */}
            <div
              style={{
                padding: '14px 24px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#fafafa',
              }}
            >
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {filteredAllRuns.length > 0 ? (
                  <span>
                    显示第 {(drawerPage - 1) * drawerPageSize + 1} -{' '}
                    {Math.min(drawerPage * drawerPageSize, filteredAllRuns.length)} 条 · 共 {filteredAllRuns.length} 条记录
                  </span>
                ) : (
                  <span>共 0 条记录</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  disabled={drawerPage <= 1}
                  onClick={() => setDrawerPage((p) => Math.max(1, p - 1))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    background: drawerPage <= 1 ? '#f8fafc' : '#ffffff',
                    color: drawerPage <= 1 ? '#94a3b8' : '#334155',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: drawerPage <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  上一页
                </button>

                <span style={{ fontSize: 12, color: '#475569', padding: '0 8px', fontWeight: 600 }}>
                  {drawerPage} / {totalDrawerPages}
                </span>

                <button
                  type="button"
                  disabled={drawerPage >= totalDrawerPages}
                  onClick={() => setDrawerPage((p) => Math.min(totalDrawerPages, p + 1))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    background: drawerPage >= totalDrawerPages ? '#f8fafc' : '#ffffff',
                    color: drawerPage >= totalDrawerPages ? '#94a3b8' : '#334155',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: drawerPage >= totalDrawerPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 任务执行与结果详情弹窗卡片 (Tasks 生命周期 + Result 产出指标) */}
      {selectedTaskDetail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="任务执行与结果详情"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(5px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
          }}
          onClick={() => setSelectedTaskDetail(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 580,
              maxHeight: '90vh',
              background: '#ffffff',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. 卡片顶部标题栏 */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                  任务执行与结果详情
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background:
                      selectedTaskDetail.actionKey === 'SIMCORE_EVALUATION'
                        ? '#ecfdf5'
                        : '#f1f5f9',
                    color:
                      selectedTaskDetail.actionKey === 'SIMCORE_EVALUATION'
                        ? '#059669'
                        : '#334155',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  {selectedTaskDetail.actionKey === 'SIMCORE_EVALUATION'
                    ? '模型评测'
                    : '策略训练'}
                </span>
                <code
                  style={{
                    fontSize: 12,
                    color: '#475569',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                  }}
                >
                  #{selectedTaskDetail.taskId.slice(0, 8)}
                </code>
              </div>

              <button
                type="button"
                aria-label="关闭详情卡片"
                onClick={() => setSelectedTaskDetail(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 16,
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#0f172a')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#94a3b8')}
              >
                ✕
              </button>
            </div>

            {/* 中间滚动区 */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                background: '#fcfcfc',
              }}
            >
              {/* 2. Tasks 表: 执行生命周期信息 */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '14px 16px',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>执行生命周期 (Tasks 表)</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                    {formatTime(selectedTaskDetail.createdAt)} 发起
                  </span>
                </div>

                {/* 生命周期核心指标三列网格 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 10,
                    background: '#f8fafc',
                    border: '1px solid #f1f5f9',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                      执行状态
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color:
                          selectedTaskDetail.status === 'SUCCEEDED'
                            ? '#059669'
                            : selectedTaskDetail.status === 'FAILED'
                            ? '#ef4444'
                            : '#2563eb',
                      }}
                    >
                      {selectedTaskDetail.status}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                      推导业务状态
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: deriveEvalStatus(selectedTaskDetail).color,
                      }}
                    >
                      {deriveEvalStatus(selectedTaskDetail).label}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                      任务耗时
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      {selectedTaskDetail.duration || '—'}
                    </div>
                  </div>
                </div>

                {/* 关联机器人与算法/场景摘要 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 10,
                    fontSize: 12,
                    color: '#475569',
                    borderTop: '1px solid #f1f5f9',
                    paddingTop: 8,
                  }}
                >
                  <span>
                    <strong style={{ color: '#64748b' }}>机器人:</strong>{' '}
                    {selectedTaskDetail.robotName || 'SO-101 双臂'}
                  </span>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span>
                    <strong style={{ color: '#64748b' }}>算法:</strong>{' '}
                    {selectedTaskDetail.algorithm || 'PPO'}
                  </span>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span>
                    <strong style={{ color: '#64748b' }}>评测场景:</strong>{' '}
                    {selectedTaskDetail.sceneName || '精密装配场景 v1.2'}
                  </span>
                </div>
              </div>

              {/* 3. Result 表: 评测产出与指标 */}
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      评测与训练产出指标
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        background: '#dcfce7',
                        color: '#15803d',
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontWeight: 600,
                      }}
                    >
                      Result 表
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {selectedTaskDetail.resultCreatedAt
                      ? formatTime(selectedTaskDetail.resultCreatedAt)
                      : '执行产物'}
                  </span>
                </div>

                {/* 核心产出指标网格 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #f1f5f9',
                      borderRadius: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                      评估成功率 / 评分
                    </div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color:
                          selectedTaskDetail.status === 'FAILED'
                            ? '#f87171'
                            : '#059669',
                      }}
                    >
                      {selectedTaskDetail.successRate ||
                        (selectedTaskDetail.status === 'FAILED' ? '0.0%' : '85.0%')}
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #f1f5f9',
                      borderRadius: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                      平均累积奖励
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                      {selectedTaskDetail.averageReward || '+182.4'}
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #f1f5f9',
                      borderRadius: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                      采样步数 · 轮次
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', paddingTop: 2 }}>
                      {selectedTaskDetail.steps || '320k 步'} · {selectedTaskDetail.episodes || 500} 轮
                    </div>
                  </div>
                </div>

                {/* 失败诊断或收敛曲线 */}
                {selectedTaskDetail.status === 'FAILED' ? (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fee2e2',
                      borderRadius: 8,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#b91c1c',
                        marginBottom: 4,
                      }}
                    >
                      ⚠️ 任务失败诊断报告
                    </div>
                    <div style={{ fontSize: 12, color: '#991b1b', lineHeight: 1.5 }}>
                      {selectedTaskDetail.failureReason ||
                        '动力学超限发散（末端瞬时冲击力 > 250N）'}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: '#7f1d1d',
                        borderTop: '1px dashed #fca5a5',
                        paddingTop: 6,
                      }}
                    >
                      💡 调优建议：降低学习率或在奖励函数中补充末端接触力平滑惩罚项。
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #f1f5f9',
                      borderRadius: 8,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#475569',
                          textTransform: 'uppercase',
                        }}
                      >
                        奖励收敛趋势 (Reward Convergence)
                      </span>
                      <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>
                        持续收敛
                      </span>
                    </div>
                    {/* 精美 SVG 收敛微折线 */}
                    <svg width="100%" height="48" viewBox="0 0 360 48" style={{ overflow: 'visible' }}>
                      <path
                        d="M0,42 Q50,38 100,32 T200,18 T300,10 T360,8"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                      <circle cx="360" cy="8" r="3.5" fill="#10b981" />
                    </svg>
                  </div>
                )}

                {/* 产出模型资产 */}
                {selectedTaskDetail.producedModel && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#475569',
                        marginBottom: 6,
                        textTransform: 'uppercase',
                      }}
                    >
                      产出模型产物 (Produced Artifacts)
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <code style={{ fontWeight: 600, color: '#0f172a' }}>
                          {selectedTaskDetail.producedModel.name}
                        </code>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {selectedTaskDetail.producedModel.size} ·{' '}
                          {selectedTaskDetail.producedModel.format}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          showToast(`已启动下载 ${selectedTaskDetail.producedModel?.name}`)
                        }
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#0f172a',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        下载权重 ↗
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. 卡片底部操作栏 */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#fafafa',
              }}
            >
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {selectedTaskDetail.hasVideoReplay ? (
                  <span style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 8 }}>●</span> 支持 3D 仿真环境回放
                  </span>
                ) : (
                  <span style={{ color: '#94a3b8' }}>当前任务无视频录制</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {selectedTaskDetail.hasVideoReplay && (
                  <button
                    type="button"
                    onClick={() =>
                      showToast(`正在加载 #${selectedTaskDetail.taskId.slice(0, 8)} 仿真回放视窗...`)
                    }
                    style={{
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer',
                    }}
                  >
                    查看视频回放
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedTaskDetail(null)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#0f172a',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 编辑项目弹窗 */}
      <EditProjectModal
        project={project}
        isOpen={isEditing}
        onClose={() => setIsEditing(false)}
        onSuccess={(updated) => {
          setProject((prev) => (prev ? { ...prev, ...updated } : updated));
          showToast('项目信息已更新');
        }}
      />

      {/* 删除项目确认弹窗 */}
      <DeleteProjectModal
        project={project}
        isOpen={isDeleting}
        onClose={() => setIsDeleting(false)}
        onSuccess={() => {
          showToast('项目已删除');
          router.push('/projects');
        }}
      />
    </div>
  );
}
