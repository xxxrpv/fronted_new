'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Resource, Task, TaskStatus } from '../../lib/api/generated/types.gen';
import {
  pollTrainingTask,
  cancelTrainingTask,
  reconcileTrainingTask,
  fetchTrainingResults,
  getResourceDisplayName,
  getTrainingRobotUnavailableReason,
  getTrainingRobotPublicationDiagnostic,
  isTerminalStatus,
  SimcoreSubmissionSession,
  SimcorePollingController,
  resumeSimcoreTask,
  SimcoreProjectResourceManager,
  type SimcoreResourceState,
  SimcoreAsyncScopeController,
} from '../../lib/simcore/training-workflow';
import type { SanitizedTrainingResultData } from '../../lib/simcore/training-result';
import SimcoreCurvesChart from './SimcoreCurvesChart';
import SimcoreArtifactsList from './SimcoreArtifactsList';
import SimcoreTrainingLiveStream from './SimcoreTrainingLiveStream';

interface SimcoreTrainingViewProps {
  projectId: string;
  initialTaskId?: string | null;
  onTaskIdChange?: (taskId: string | null) => void;
}

export function EmbodexPublicationDiagnostics({ robots }: { robots: Resource[] }) {
  const diagnostics = robots.flatMap((resource) => {
    const diagnostic = getTrainingRobotPublicationDiagnostic(resource);
    return diagnostic ? [{ resource, diagnostic }] : [];
  });
  if (diagnostics.length === 0) return null;
  return (
    <section aria-label="Embodex 模型发布诊断" style={{ marginTop: 12, fontSize: 12, overflowWrap: 'anywhere' }}>
      <strong>Embodex 模型发布状态</strong>
      <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
        {diagnostics.map(({ resource, diagnostic }) => (
          <li key={resource.id}>
            <strong>{getResourceDisplayName(resource)}</strong>：{diagnostic.status}
            {diagnostic.stage && <span>；阶段：{diagnostic.stage}</span>}
            {diagnostic.code && <span>；错误码：<code>{diagnostic.code}</code></span>}
            {diagnostic.pendingArtifactId && <span>；待确认产物 UUID（仅诊断，不可用于训练）：<code>{diagnostic.pendingArtifactId}</code></span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SimcoreTrainingView({
  projectId,
  initialTaskId,
  onTaskIdChange,
}: SimcoreTrainingViewProps) {
  // R3-01: 统一接入 SimcoreProjectResourceManager，管理项目级资源加载与选择，具备世代失效与 fail-closed 强校验
  const [resourceState, setResourceState] = useState<SimcoreResourceState>({
    projectId,
    robots: [],
    algorithms: [],
    selectedRobotId: '',
    selectedAlgorithmId: '',
    loading: Boolean(projectId),
    error: null,
  });

  const resourceManagerRef = useRef<SimcoreProjectResourceManager>(
    new SimcoreProjectResourceManager(projectId, (next) => setResourceState({ ...next })),
  );

  const {
    robots,
    algorithms,
    selectedRobotId,
    selectedAlgorithmId,
    loading: loadingResources,
    error: resourceError,
  } = resourceState;

  // 表单选择
  const [totalSteps, setTotalSteps] = useState<number>(32);
  const [presentationMode, setPresentationMode] = useState<'headless' | 'visible'>('headless');

  // 任务状态
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const activeTaskRef = useRef<Task | null>(null);
  const applyTask = useCallback((incoming: Task | null) => {
    const accepted = incoming ? reconcileTrainingTask(activeTaskRef.current, incoming) : null;
    activeTaskRef.current = accepted;
    setActiveTask(accepted);
    return accepted;
  }, []);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);

  // 结果状态 (F-04: 增加独立的 resultError 状态，不静默伪装成 empty)
  const [results, setResults] = useState<SanitizedTrainingResultData[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  // 用户在 Visible 运行态时主动选择查看结果的 TaskId (纯派生优先)
  const [manualResultsTaskId, setManualResultsTaskId] = useState<string | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopResultRefresh = useCallback(() => {
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = null;
  }, []);

  // F-01 & R2-03: 幂等提交与重试会话管理器
  const sessionRef = useRef<SimcoreSubmissionSession>(new SimcoreSubmissionSession());
  // R2-01: 具备世代失效与飞行中请求取消边界的轮询控制器
  const pollingControllerRef = useRef<SimcorePollingController>(new SimcorePollingController());
  // R4-01: 项目与任务异步读取世代隔离控制器 (防止在途的 manual refresh 与 result fetch 迟到响应写回旧状态)
  const asyncScopeRef = useRef<SimcoreAsyncScopeController>(
    new SimcoreAsyncScopeController(projectId, activeTask?.id || ''),
  );

  // F-04 & R4-01: 拉取任务结果，明确分离 loading / empty / error，且受项目/任务世代安全保护
  const loadResults = useCallback(
    async (taskId: string, attempt = 0): Promise<void> => {
      if (!taskId) return;
      stopResultRefresh();
      await asyncScopeRef.current.runGuardedResultFetch(
        projectId,
        taskId,
        fetchTrainingResults,
        {
          onStart: () => {
            setLoadingResults(true);
            setResultError(null);
          },
          onSuccess: (res) => {
            setResults(res);
            setResultError(null);
            if (res.some(result => result.assemblyPending)) {
              if (attempt < 12) resultTimerRef.current = setTimeout(() => { void loadResults(taskId, attempt + 1); }, 5000);
              else setResultError('任务已结束，产物仍在整理，请重试获取结果。');
            }
          },
          onError: (msg) => {
            setResultError(msg);
          },
          onFinally: () => {
            setLoadingResults(false);
          },
        },
      );
    },
    [projectId, stopResultRefresh],
  );

  // R2-01: 停止轮询并递增世代 Token (使任何正在飞行中的 HTTP 响应作废)
  const stopPolling = useCallback(() => {
    pollingControllerRef.current.cancel();
    setIsPolling(false);
  }, []);

  // R2-01: 启动生命周期安全轮询
  const startPolling = useCallback(
    (taskId: string, currentStatus?: TaskStatus | null) => {
      setIsPolling(true);
      pollingControllerRef.current.start(
        taskId,
        currentStatus,
        {
          onUpdate: (updatedTask) => {
            applyTask(updatedTask);
            setPollingError(null);
            setIsPolling(pollingControllerRef.current.getIsPolling());
          },
          onError: (errMsg) => {
            setPollingError(errMsg);
            setIsPolling(pollingControllerRef.current.getIsPolling());
          },
          onTerminal: (terminalTask) => {
            applyTask(terminalTask);
            setIsPolling(false);
            loadResults(terminalTask.id);
          },
        },
      );
    },
    [loadResults, applyTask],
  );

  // R2-01 & R3-01 & R4-01 & R5-01: 当 projectId 改变时，立即中断旧轮询，清理旧状态并隔离提交会话、资源状态与异步读取世代
  useEffect(() => {
    stopPolling();
    stopResultRefresh();
    applyTask(null);
    setIsCancelling(false);
    setResults([]);
    setResultError(null);
    setPollingError(null);
    setSubmitError(null);
    setLoadingResults(false);
    setIsSubmitting(false);

    // R5-01: 替换为全新 Session 对象，避免进行中的旧提交修改新项目的会话内部字段
    sessionRef.current = new SimcoreSubmissionSession();

    // R4-01 & R5-01: 切换项目时作废在途的旧项目 manual refresh、result fetch 以及 submission 响应
    asyncScopeRef.current.resetScope(projectId, '');

    // R3-01: 清空旧资源状态并基于新 projectId 启动世代安全加载
    resourceManagerRef.current.load(projectId);
  }, [projectId, stopPolling, stopResultRefresh, applyTask]);

  // R2-02: 挂载时如果 URL 带有 initialTaskId，验证并恢复任务，绝不重新提交！
  useEffect(() => {
    if (!initialTaskId) return;

    let isMounted = true;
    (async () => {
      const res = await resumeSimcoreTask({
        projectId,
        initialTaskId,
      });

      if (!isMounted) return;

      if (res.status === 'resumed') {
        asyncScopeRef.current.setTaskId(res.task.id);
        applyTask(res.task);
        if (isTerminalStatus(res.task.status)) {
          loadResults(res.task.id);
        } else {
          startPolling(res.task.id, res.task.status);
        }
      } else if (res.status === 'mismatch') {
        console.warn('Initial taskId project mismatch, ignoring');
        onTaskIdChange?.(null);
      } else {
        console.error('Failed to resume initial task:', res.error);
      }
    })();

    return () => {
      isMounted = false;
      stopPolling();
    };
  }, [initialTaskId, projectId, loadResults, onTaskIdChange, startPolling, stopPolling]);

  // R2-01 & R3-01 & R4-01 & R5-01: 组件卸载时清理所有定时器、轮询与资源加载与异步读取世代
  useEffect(() => {
    return () => {
      stopPolling();
      stopResultRefresh();
      sessionRef.current = new SimcoreSubmissionSession();
      resourceManagerRef.current.resetForProject('');
      asyncScopeRef.current.resetScope('', '');
    };
  }, [stopPolling, stopResultRefresh]);

  
  const isTaskRunning = Boolean(activeTask && !isTerminalStatus(activeTask.status));
  const isVisibleMode = presentationMode === 'visible';
  // 核心联动：Visible 运行中自动切到 3D 实时流；训练结束自动切回曲线与产物；支持用户手动切换
  const showLiveStream = isTaskRunning && isVisibleMode && manualResultsTaskId !== activeTask?.id;

  // F-01 & R2-03 & R3-01 & R5-01: 启动或重试训练 (使用世代隔离与独立 Session 实例保护)
  const handleStartTraining = async (isRetry = false) => {
    if (isSubmitting || loadingResources) return;

    // R3-01: 校验选中的 Robot 与 Algorithm 是否确属当前项目的有效资源集
    const selectionCheck = resourceManagerRef.current.validateSelection(projectId, selectedRobotId, selectedAlgorithmId);
    if (!selectionCheck.valid) {
      setSubmitError(selectionCheck.error || '选中的资源无效');
      return;
    }

    if (!Number.isSafeInteger(totalSteps) || totalSteps <= 0) {
      setSubmitError('训练步数必须为正整数 (>= 1)');
      return;
    }

    stopPolling();
    stopResultRefresh();
    setResults([]);
    setResultError(null);

    const activeSession = sessionRef.current;
    const currentProjectId = projectId;

    await asyncScopeRef.current.runGuardedSubmission(
      currentProjectId,
      () =>
        activeSession.submit(
          {
            projectId: currentProjectId,
            robotResourceId: selectedRobotId,
            algorithmResourceId: selectedAlgorithmId,
            totalSteps,
            presentationMode,
          },
          { isRetry },
        ),
      {
        onStart: () => {
          setIsSubmitting(true);
          setSubmitError(null);
        },
        onSuccess: (task) => {
          asyncScopeRef.current.setTaskId(task.id);
          applyTask(task);
          onTaskIdChange?.(task.id);

          // 启动轮询
          startPolling(task.id, task.status);
        },
        onError: (msg) => {
          setSubmitError(msg);
        },
        onFinally: () => {
          setIsSubmitting(false);
        },
        isSessionCurrent: () => sessionRef.current === activeSession,
      },
    );
  };

  // 重置并准备开启新一轮训练
  const handleNewRun = () => {
    stopPolling();
    stopResultRefresh();
    applyTask(null);
    setIsCancelling(false);
    setResults([]);
    setResultError(null);
    setPollingError(null);
    setSubmitError(null);
    setLoadingResults(false);
    setIsSubmitting(false);
    // R5-01: 开启新训练时替换为全新 Session 对象
    sessionRef.current = new SimcoreSubmissionSession();
    asyncScopeRef.current.resetScope(projectId, '');
    onTaskIdChange?.(null);
  };

  // R4-01: 手动刷新当前任务状态，具备项目/任务世代安全与迟到响应隔离
  const handleManualRefresh = async () => {
    if (!activeTask) return;
    const currentTaskId = activeTask.id;
    stopPolling();
    await asyncScopeRef.current.runGuardedTaskRefresh(
      projectId,
      currentTaskId,
      pollTrainingTask,
      {
        onSuccess: (incoming) => {
          const updated = applyTask(incoming)!;
          setPollingError(null);
          if (isTerminalStatus(updated.status)) {
            stopPolling();
            loadResults(updated.id);
          } else startPolling(updated.id, updated.status);
        },
        onError: (msg) => {
          setPollingError(msg);
          startPolling(currentTaskId, activeTaskRef.current?.status);
        },
      },
    );
  };

  const handleCancel = async () => {
    if (!activeTask || isCancelling || isTerminalStatus(activeTask.status)) return;
    stopPolling();
    setIsCancelling(true);
    await asyncScopeRef.current.runGuardedTaskRefresh(projectId, activeTask.id, cancelTrainingTask, {
      onSuccess: (incoming) => {
        const updated = applyTask(incoming)!;
        setIsCancelling(false);
        setPollingError(null);
        if (isTerminalStatus(updated.status)) loadResults(updated.id);
        else startPolling(updated.id, updated.status);
      },
      onError: (message) => {
        setIsCancelling(false);
        setPollingError(message);
        startPolling(activeTask.id, activeTaskRef.current?.status);
      },
    });
  };

  const primaryResult = results[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: 16 }}>
      {/* 左侧：配置与操作面板 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <article className="simcore2-panel">
          <div className="simcore2-panel-header">
            <span className="simcore2-panel-title">下一次训练配置（草稿）</span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 9999,
                fontWeight: 600,
                background: '#f1f5f9',
                color: '#64748b',
              }}
            >
              草稿
            </span>
          </div>

          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            下方选择用于下一次训练，不代表已提交或恢复任务的配置；当前任务状态见平台任务状态面板。
          </p>

          {resourceError && (
            <div
              style={{
                padding: '10px 14px',
                background: '#fef2f2',
                color: '#991b1b',
                borderRadius: 6,
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              加载资源失败: {resourceError}
            </div>
          )}

          {/* 资源选择器 */}
          <div className="simcore2-form-grid">
            <label className="simcore2-label">
              <span>机器人资源</span>
              {loadingResources ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>加载中...</div>
              ) : robots.length === 0 ? (
                <div style={{ fontSize: 12, color: '#ef4444' }}>
                  未找到可用于训练的 Robot 资源
                </div>
              ) : (
                <select
                  className="simcore2-select"
                  value={selectedRobotId}
                  onChange={(e) => resourceManagerRef.current.setSelectedRobotId(e.target.value)}
                  disabled={isSubmitting || Boolean(activeTask && !isTerminalStatus(activeTask.status))}
                >
                  <option value="" disabled>请选择已发布的机器人模型</option>
                  {robots.map((r) => (
                    <option key={r.id} value={r.id} disabled={Boolean(getTrainingRobotUnavailableReason(r))}>
                      {getResourceDisplayName(r)} ({r.externalId})
                      {getTrainingRobotUnavailableReason(r) ? ` — ${getTrainingRobotUnavailableReason(r)}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {robots.some((r) => r.sourceModule === 'embodex') && (
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  Embodex 模型完成发布登记后可选；灰色选项标明暂不可用原因。
                </span>
              )}
            </label>

            <label className="simcore2-label">
              <span>训练算法</span>
              {loadingResources ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>加载中...</div>
              ) : algorithms.length === 0 ? (
                <div style={{ fontSize: 12, color: '#ef4444' }}>
                  未找到可用于训练的 Algorithm 资源
                </div>
              ) : (
                <select
                  className="simcore2-select"
                  value={selectedAlgorithmId}
                  onChange={(e) => resourceManagerRef.current.setSelectedAlgorithmId(e.target.value)}
                  disabled={isSubmitting || Boolean(activeTask && !isTerminalStatus(activeTask.status))}
                >
                  {algorithms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {getResourceDisplayName(a)} ({a.externalId})
                    </option>
                  ))}
                </select>
              )}
            </label>

            <label className="simcore2-label">
              <span>总训练步数</span>
              <input
                type="number"
                min={1}
                className="simcore2-input"
                value={totalSteps}
                onChange={(e) => setTotalSteps(Math.max(1, parseInt(e.target.value, 10) || 1))}
                disabled={isSubmitting || Boolean(activeTask && !isTerminalStatus(activeTask.status))}
              />
            </label>

            <label className="simcore2-label">
              <span>运行模式</span>
              <select
                className="simcore2-select"
                value={presentationMode}
                onChange={(e) => setPresentationMode(e.target.value as 'headless' | 'visible')}
                disabled={isSubmitting || Boolean(activeTask && !isTerminalStatus(activeTask.status))}
              >
                <option value="headless">Headless (推荐，高速无渲染)</option>
                <option value="visible">Visible (渲染模式)</option>
              </select>
            </label>
          </div>

          <EmbodexPublicationDiagnostics robots={robots} />

          {submitError && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: '#fef2f2',
                color: '#991b1b',
                borderRadius: 6,
                fontSize: 12,
              }}
              role="alert"
            >
              <strong>
                {sessionRef.current.getLastFailedPhase() === 'validation'
                  ? '校验阶段失败 (Validation Phase): '
                  : sessionRef.current.getLastFailedPhase() === 'task'
                  ? '任务创建阶段失败 (Task Phase): '
                  : '提交失败: '}
              </strong>
              {submitError}
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {!activeTask || isTerminalStatus(activeTask.status) ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => handleStartTraining(false)}
                disabled={
                  isSubmitting ||
                  loadingResources ||
                  robots.length === 0 ||
                  algorithms.length === 0 ||
                  !resourceManagerRef.current.validateSelection(projectId, selectedRobotId, selectedAlgorithmId).valid
                }
              >
                {isSubmitting ? '正在提交任务...' : activeTask ? '再次启动训练' : '启动训练'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleManualRefresh}
                disabled={isSubmitting || isCancelling}
              >
                刷新任务状态
              </button>
            )}

            {activeTask && !isTerminalStatus(activeTask.status) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleCancel}
                disabled={isCancelling || activeTask.status === 'CANCEL_REQUESTED'}>
                {isCancelling ? '正在提交取消...' : activeTask.status === 'CANCEL_REQUESTED' ? '等待节点确认' : '取消任务'}
              </button>
            )}

            {submitError && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleStartTraining(true)}
                disabled={isSubmitting}
                title={
                  sessionRef.current.canRetryTask()
                    ? '复用同一 Validation 与 Idempotency-Key 重试 Task 提交'
                    : '重新发起 Validation 校验 (不复用旧 Validation)'
                }
              >
                {sessionRef.current.canRetryTask()
                  ? '重试 Task (复用 Validation + Idempotency-Key)'
                  : '重新创建 Validation'}
              </button>
            )}

            {activeTask && isTerminalStatus(activeTask.status) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleNewRun}
              >
                创建新训练任务
              </button>
            )}
          </div>
        </article>

        {/* 任务状态卡片 */}
        {activeTask && (
          <article className="simcore2-panel">
            <div className="simcore2-panel-header">
              <span className="simcore2-panel-title">平台任务状态</span>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 10px',
                  borderRadius: 9999,
                  fontWeight: 600,
                  background:
                    activeTask.status === 'SUCCEEDED'
                      ? '#ecfdf5'
                      : activeTask.status === 'FAILED'
                      ? '#fef2f2'
                      : activeTask.status === 'TIMEOUT'
                      ? '#fffbeb'
                      : '#eff6ff',
                  color:
                    activeTask.status === 'SUCCEEDED'
                      ? '#10b981'
                      : activeTask.status === 'FAILED'
                      ? '#ef4444'
                      : activeTask.status === 'TIMEOUT'
                      ? '#d97706'
                      : '#3b82f6',
                }}
              >
                {activeTask.status}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Task ID:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{activeTask.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Validation ID:</span>
                <span style={{ fontFamily: 'monospace' }}>{activeTask.validationId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Idempotency Key:</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {activeTask.idempotencyKey.slice(0, 16)}...
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>创建时间:</span>
                <span>{new Date(activeTask.createdAt).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* TIMEOUT 警示 */}
            {activeTask.status === 'TIMEOUT' && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  background: '#fffbeb',
                  border: '1px solid #fef3c7',
                  color: '#92400e',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                role="alert"
              >
                <strong>状态查询超时：</strong> 平台暂时无法确认节点状态，不代表训练执行超时。系统将退避重试并自动对账，也可取消任务或手动刷新。
              </div>
            )}

            {activeTask.status === 'CANCEL_REQUESTED' && (
              <p role="status">取消请求已提交，等待节点确认。确认退出前仍保留执行资源。</p>
            )}

            {/* 轮询信息 */}
            {isPolling && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span className="embodex-sidebar-dot" />
                <span>正在同步最新状态 ({activeTask.status === 'TIMEOUT' ? '10–60 秒退避重试' : '每 3 秒'})...</span>
              </div>
            )}

            {pollingError && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>
                状态同步告警: {pollingError}
              </div>
            )}
          </article>
        )}
      </div>

      {/* 右侧：结果、曲线与产物展示 / 3D 实时监控 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 模式 A: 3D 实时画面视口 (胶囊内嵌于视口右上角) */}
        {showLiveStream ? (
          <SimcoreTrainingLiveStream
            projectId={projectId}
            activeTask={activeTask}
            onSwitchToResults={isTaskRunning ? () => activeTask && setManualResultsTaskId(activeTask.id) : undefined}
          />
        ) : (
          /* 模式 B: 真实收敛曲线与产物元数据 (胶囊内嵌于曲线卡片右上角) */
          <>
            {/* 结果获取失败横幅 */}
            {resultError && (
              <div
                style={{
                  padding: '14px 16px',
                  background: '#fef2f2',
                  border: '1px solid #fee2e2',
                  borderRadius: 8,
                  color: '#991b1b',
                  fontSize: 13,
                }}
                role="alert"
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>训练结果获取失败</div>
                <div style={{ fontSize: 12, color: '#b91c1c' }}>{resultError}</div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => activeTask && loadResults(activeTask.id)}
                >
                  重试获取结果
                </button>
              </div>
            )}

            {/* 训练收敛曲线 (右上角内嵌切换回 3D 画面胶囊) */}
            <article className="simcore2-panel">
              <div className="simcore2-panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="simcore2-panel-title">真实收敛曲线</span>
                  {loadingResults && (
                    <span style={{ fontSize: 11, color: '#64748b' }}>加载曲线中...</span>
                  )}
                </div>

                {isTaskRunning && isVisibleMode && (
                  <div
                    style={{
                      display: 'inline-flex',
                      background: '#f1f5f9',
                      padding: 2,
                      borderRadius: 6,
                      gap: 2,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setManualResultsTaskId(null)}
                      style={{
                        padding: '3px 9px',
                        fontSize: 11,
                        background: 'transparent',
                        color: '#475569',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title="切回 3D 实时画面视口"
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                      3D 画面
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: '3px 9px',
                        fontSize: 11,
                        background: '#0f172a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'default',
                        fontWeight: 600,
                      }}
                    >
                      收敛曲线
                    </button>
                  </div>
                )}
              </div>
              {resultError ? (
                <div style={{ padding: '16px', color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
                  因结果加载失败，收敛曲线暂不可用
                </div>
              ) : (
                <SimcoreCurvesChart curves={primaryResult?.curves} />
              )}
            </article>

            {/* 结果产物元数据 */}
            <article className="simcore2-panel">
              <div className="simcore2-panel-header">
                <span className="simcore2-panel-title">训练产物与检查点元数据</span>
                {primaryResult && (
                  <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>
                    Status: {primaryResult.finalStatus}
                  </span>
                )}
              </div>

              {primaryResult?.failure && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: '10px 12px',
                    background: '#fef2f2',
                    border: '1px solid #fee2e2',
                    borderRadius: 6,
                    color: '#991b1b',
                    fontSize: 12,
                  }}
                >
                  <strong>失败原因 [{primaryResult.failure.code}]:</strong>{' '}
                  {primaryResult.failure.message}
                </div>
              )}

              {resultError ? (
                <div style={{ padding: '16px', color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
                  因结果加载失败，产物元数据暂不可用
                </div>
              ) : (
                <SimcoreArtifactsList
                  artifacts={primaryResult?.artifacts}
                  artifactCorrelation={primaryResult?.artifactCorrelation}
                />
              )}
            </article>
          </>
        )}
      </div>
    </div>
  );
}
