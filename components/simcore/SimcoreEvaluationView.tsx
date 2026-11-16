'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Task, SimcoreEvaluationModelCandidate } from '../../lib/api/generated/types.gen';
import {
  fetchEvaluationModelCandidates,
  pollEvaluationTask,
  cancelEvaluationTask,
  reconcileEvaluationTask,
  fetchEvaluationResults,
  listProjectEvaluationTasks,
  isTerminalEvaluationStatus,
  SimcoreEvaluationSubmissionSession,
  SimcoreEvaluationPollingController,
  resumeSimcoreEvaluationTask,
  getSafeEvaluationCsvDownloadUrl,
} from '../../lib/simcore/evaluation-workflow';
import type { SanitizedEvaluationResultData } from '../../lib/simcore/evaluation-result';
import styles from './SimcoreEvaluationView.module.css';

interface SimcoreEvaluationViewProps {
  projectId: string;
  initialTaskId?: string | null;
  onTaskIdChange?: (taskId: string | null) => void;
}

export default function SimcoreEvaluationView({
  projectId,
  initialTaskId,
  onTaskIdChange,
}: SimcoreEvaluationViewProps) {
  // Candidates State
  const [candidates, setCandidates] = useState<SimcoreEvaluationModelCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<SimcoreEvaluationModelCandidate | null>(null);

  // Form State
  const [episodes, setEpisodes] = useState<number>(5);

  // Active Task & Submission State
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const activeTaskRef = useRef<Task | null>(null);
  const applyTask = useCallback((incoming: Task | null) => {
    const accepted = incoming ? reconcileEvaluationTask(activeTaskRef.current, incoming) : null;
    activeTaskRef.current = accepted;
    setActiveTask(accepted);
    return accepted;
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);

  // Results State
  const [results, setResults] = useState<SanitizedEvaluationResultData[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History State
  const [historyTasks, setHistoryTasks] = useState<Task[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Controllers
  const sessionRef = useRef<SimcoreEvaluationSubmissionSession>(new SimcoreEvaluationSubmissionSession());
  const pollingControllerRef = useRef<SimcoreEvaluationPollingController>(new SimcoreEvaluationPollingController());

  const stopResultRefresh = useCallback(() => {
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = null;
  }, []);

  const stopPolling = useCallback(() => {
    pollingControllerRef.current.cancel();
    setIsPolling(false);
  }, []);

  // A task switch invalidates every in-flight operation, including catch/finally/timers.
  const scope = useRef({ projectId, generation: 0 });
  if (scope.current.projectId !== projectId) {
    scope.current = { projectId, generation: scope.current.generation + 1 };
  }
  const resultSequence = useRef(0);
  const candidateSequence = useRef(0);
  const historySequence = useRef(0);
  const taskSequence = useRef(0);
  const onTaskIdChangeRef = useRef(onTaskIdChange);
  onTaskIdChangeRef.current = onTaskIdChange;
  const [historyError, setHistoryError] = useState<string | null>(null);

  const invalidateTask = useCallback(() => {
    scope.current.generation++;
    resultSequence.current++;
    taskSequence.current++;
    stopPolling();
    stopResultRefresh();
    setLoadingResults(false);
    setIsCancelling(false);
    setIsSubmitting(false);
  }, [stopPolling, stopResultRefresh]);

  const loadHistoryList = useCallback(async () => {
    const requestProject = projectId;
    const sequence = ++historySequence.current;
    const current = () => scope.current.projectId === requestProject && sequence === historySequence.current;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const list = await listProjectEvaluationTasks(projectId, 15);
      if (current()) setHistoryTasks(list);
    } catch (err) {
      if (current()) setHistoryError(err instanceof Error ? err.message : '获取评估历史失败');
    } finally {
      if (current()) setLoadingHistory(false);
    }
  }, [projectId]);

  const loadResults = useCallback(async (taskId: string, attempt = 0): Promise<void> => {
    const generation = scope.current.generation;
    const sequence = ++resultSequence.current;
    const current = () => scope.current.projectId === projectId && generation === scope.current.generation &&
      sequence === resultSequence.current && activeTaskRef.current?.id === taskId;
    if (!current()) return;
    stopResultRefresh();
    setLoadingResults(true);
    setResultError(null);
    try {
      const res = await fetchEvaluationResults(taskId);
      if (!current()) return;
      setResults(res);
      const incomplete = res.some((r) => !r.assembly.complete && !r.assembly.retryExhausted);
      if (incomplete && attempt < 10) {
        resultTimerRef.current = setTimeout(() => {
          if (current()) void loadResults(taskId, attempt + 1);
        }, 3000);
      }
    } catch (err) {
      if (current()) setResultError(err instanceof Error ? err.message : '获取评估结果失败');
    } finally {
      if (current()) setLoadingResults(false);
    }
  }, [projectId, stopResultRefresh]);

  const startPolling = useCallback((taskId: string, status?: Task['status'] | null) => {
    const generation = scope.current.generation;
    const current = () => scope.current.projectId === projectId && generation === scope.current.generation && activeTaskRef.current?.id === taskId;
    if (!current()) return;
    setIsPolling(true);
    pollingControllerRef.current.start(taskId, status, {
      onUpdate: (task) => {
        if (!current()) return;
        applyTask(task);
        setPollingError(null);
        setIsPolling(pollingControllerRef.current.getIsPolling());
      },
      onError: (message) => { if (current()) setPollingError(message); },
      onTerminal: (task) => {
        if (!current()) return;
        applyTask(task);
        stopPolling();
        void loadResults(task.id);
        void loadHistoryList();
      },
    });
  }, [projectId, applyTask, loadResults, loadHistoryList, stopPolling]);

  const loadCandidatesList = useCallback(async () => {
    const sequence = ++candidateSequence.current;
    const current = () => scope.current.projectId === projectId && sequence === candidateSequence.current;
    setLoadingCandidates(true);
    setCandidatesError(null);
    try {
      const items = await fetchEvaluationModelCandidates(projectId);
      if (!current()) return;
      setCandidates(items);
      setSelectedCandidate(items[0] ?? null);
    } catch (err) {
      if (!current()) return;
      setCandidatesError(err instanceof Error ? err.message : '获取候选模型失败');
      setCandidates([]);
      setSelectedCandidate(null);
    } finally {
      if (current()) setLoadingCandidates(false);
    }
  }, [projectId]);

  useEffect(() => {
    applyTask(null);
    setResults([]);
    setHistoryTasks([]);
    sessionRef.current = new SimcoreEvaluationSubmissionSession();
    void loadCandidatesList();
    void loadHistoryList();
    return () => {
      scope.current.generation++;
      candidateSequence.current++;
      historySequence.current++;
      pollingControllerRef.current.cancel();
      stopResultRefresh();
    };
  }, [projectId, applyTask, loadCandidatesList, loadHistoryList, stopResultRefresh]);

  useEffect(() => {
    // A URL acknowledgement for the already selected task must not invalidate its request.
    if (!initialTaskId || initialTaskId === activeTaskRef.current?.id) return;
    invalidateTask();
    applyTask(null);
    setResults([]);
    const generation = scope.current.generation;
    let disposed = false;
    void resumeSimcoreEvaluationTask({ projectId, initialTaskId }).then((res) => {
      if (disposed || scope.current.projectId !== projectId || generation !== scope.current.generation) return;
      if (res.status === 'resumed') {
        applyTask(res.task);
        if (isTerminalEvaluationStatus(res.task.status)) void loadResults(res.task.id);
        else startPolling(res.task.id, res.task.status);
      } else {
        setPollingError(res.error);
        if (res.status === 'mismatch') onTaskIdChangeRef.current?.(null);
      }
    });
    return () => { disposed = true; };
  }, [initialTaskId, projectId, applyTask, invalidateTask, loadResults, startPolling]);

  const handleStartEvaluation = async (isRetry = false) => {
    const session = sessionRef.current;
    if (session.isInFlight() || !selectedCandidate) return;
    if (!Number.isInteger(episodes) || episodes < 1 || episodes > 100) {
      setSubmitError('评估回合数 (Episodes) 必须在 1 至 100 之间');
      return;
    }
    invalidateTask();
    const generation = scope.current.generation;
    const current = () => scope.current.projectId === projectId && generation === scope.current.generation;
    setSubmitError(null);
    setIsSubmitting(true);
    setResults([]);
    setResultError(null);
    try {
      const task = await session.submit({
        projectId, sourceTrainingTaskId: selectedCandidate.sourceTrainingTaskId,
        sourceArtifactId: selectedCandidate.sourceArtifactId, episodes,
      }, { isRetry });
      if (!current()) return;
      applyTask(task);
      onTaskIdChangeRef.current?.(task.id);
      void loadHistoryList();
      if (isTerminalEvaluationStatus(task.status)) void loadResults(task.id);
      else startPolling(task.id, task.status);
    } catch (err) {
      if (current()) setSubmitError(err instanceof Error ? err.message : '提交评估任务失败');
    } finally {
      if (current()) setIsSubmitting(false);
    }
  };

  const refreshTask = async (cancel: boolean) => {
    const task = activeTaskRef.current;
    if (!task || (cancel && (isCancelling || isTerminalEvaluationStatus(task.status)))) return;
    stopPolling();
    const generation = scope.current.generation;
    const sequence = ++taskSequence.current;
    const current = () => scope.current.projectId === projectId && generation === scope.current.generation &&
      sequence === taskSequence.current && activeTaskRef.current?.id === task.id;
    if (cancel) setIsCancelling(true);
    try {
      const incoming = await (cancel ? cancelEvaluationTask(task.id) : pollEvaluationTask(task.id));
      if (!current()) return;
      const updated = applyTask(incoming)!;
      setPollingError(null);
      if (isTerminalEvaluationStatus(updated.status)) void loadResults(updated.id);
      else startPolling(updated.id, updated.status);
    } catch (err) {
      if (!current()) return;
      setPollingError(err instanceof Error ? err.message : '刷新或取消任务失败');
      startPolling(task.id, activeTaskRef.current?.status);
    } finally {
      if (current()) setIsCancelling(false);
    }
  };
  const handleCancel = () => refreshTask(true);
  const handleManualRefresh = () => refreshTask(false);

  const handleNewEvaluation = () => {
    if (sessionRef.current.isInFlight() || sessionRef.current.canRetryTask()) return;
    invalidateTask();
    applyTask(null);
    setResults([]);
    setResultError(null);
    setPollingError(null);
    setSubmitError(null);
    sessionRef.current.resetNewRun();
    onTaskIdChangeRef.current?.(null);
  };

  const handleSelectHistoryTask = (task: Task) => {
    invalidateTask();
    applyTask(task);
    setResults([]);
    setResultError(null);
    setPollingError(null);
    setSubmitError(null);
    onTaskIdChangeRef.current?.(task.id);
    if (isTerminalEvaluationStatus(task.status)) void loadResults(task.id);
    else startPolling(task.id, task.status);
  };

  const primaryResult = results[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: 16 }}>
      {/* 左侧：候选模型选择与配置 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <article className="simcore2-panel">
          <div className="simcore2-panel-header">
            <span className="simcore2-panel-title">评估目标模型选择</span>
            <span className={styles.tagBlue}>严格来源验证</span>
          </div>

          {loadingCandidates ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              正在校验候选训练任务与产物完整性...
            </div>
          ) : candidatesError ? (
            <div className={styles.failureNotice}>
              <strong>无法获取候选模型：</strong> {candidatesError}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ display: 'block', marginTop: 8 }}
                onClick={() => void loadCandidatesList()}
              >
                重试加载
              </button>
            </div>
          ) : candidates.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px dashed #cbd5e1',
                marginTop: 8,
                color: '#64748b',
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                暂无合格的候选模型
              </div>
              <p style={{ margin: 0, fontSize: 12 }}>
                仅支持已成功完成训练 (SUCCEEDED) 且包含完整 <code>final_model.zip</code> 的模型。请先在“训练 (Training)”中完成策略训练。
              </p>
            </div>
          ) : (
            <>
              <div className={styles.candidateList} role="radiogroup" aria-label="候选模型列表">
                {candidates.map((cand) => {
                  const isSelected =
                    selectedCandidate?.sourceTrainingTaskId === cand.sourceTrainingTaskId &&
                    selectedCandidate?.sourceArtifactId === cand.sourceArtifactId;
                  return (
                    <div
                      key={`${cand.sourceTrainingTaskId}_${cand.sourceArtifactId}`}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={0}
                      className={`${styles.candidateCard} ${isSelected ? styles.candidateCardActive : ''}`}
                      onClick={() => setSelectedCandidate(cand)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          setSelectedCandidate(cand);
                        }
                      }}
                    >
                      <div className={styles.candidateHeader}>
                        <span>算法: {cand.algorithm.toUpperCase()}</span>
                        <span className={styles.tagGreen}>已核验可评</span>
                      </div>
                      <div className={styles.candidateMeta}>
                        <span>来源任务: {cand.sourceTrainingTaskId.slice(0, 8)}...</span>
                        <span>模板: {cand.templateId}</span>
                        <span>大小: {(cand.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span>
                        <span>产出时间: {new Date(cand.trainedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 表单配置 */}
          <div className="simcore2-form-grid" style={{ marginTop: 12 }}>
            <label className="simcore2-label">
              <span>评估回合数 (Episodes)</span>
              <input
                type="number"
                min={1}
                max={100}
                className="simcore2-input"
                value={episodes}
                disabled={isSubmitting || Boolean(activeTask && !isTerminalEvaluationStatus(activeTask.status))}
                onChange={(e) => setEpisodes(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
              />
              <span style={{ fontSize: 11, color: '#64748b' }}>范围 1–100，默认 5 回合</span>
            </label>

            <label className="simcore2-label">
              <span>运行模式 (固定)</span>
              <input
                className="simcore2-input"
                value="Headless (后台静默高并发评估)"
                readOnly
                disabled
              />
            </label>
          </div>

          {selectedCandidate && (
            <div style={{ marginTop: 12, padding: 10, background: '#f8fafc', borderRadius: 6, fontSize: 12 }}>
              <div style={{ color: '#475569', marginBottom: 4 }}>
                <strong>继承训练环境配置（只读不可篡改）：</strong>
              </div>
              <div style={{ color: '#64748b' }}>
                模板 ID: <code>{selectedCandidate.templateId}</code> | 算法: <code>{selectedCandidate.algorithm}</code>
              </div>
            </div>
          )}

          {submitError && (
            <div className={styles.failureNotice}>
              <strong>提交失败：</strong> {submitError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                isSubmitting ||
                sessionRef.current.canRetryTask() ||
                loadingCandidates ||
                !selectedCandidate ||
                Boolean(activeTask && !isTerminalEvaluationStatus(activeTask.status))
              }
              onClick={() => void handleStartEvaluation(false)}
            >
              {isSubmitting ? '正在提交评估任务...' : '启动评估 (Start Evaluation)'}
            </button>

            {sessionRef.current.canRetryTask() && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isSubmitting}
                onClick={() => void handleStartEvaluation(true)}
              >
                重试 Task 提交 (复用 Validation)
              </button>
            )}

            {activeTask && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isSubmitting || sessionRef.current.isInFlight() || sessionRef.current.canRetryTask()}
                onClick={handleNewEvaluation}
              >
                新建评估
              </button>
            )}
          </div>
        </article>

        {/* 历史评估任务列表 */}
        <article className="simcore2-panel">
          <div className="simcore2-panel-header">
            <span className="simcore2-panel-title">本工程评估任务历史</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {historyTasks.length} 条记录
            </span>
          </div>

          {loadingHistory ? (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
              加载历史记录中...
            </div>
          ) : historyError ? (
            <div className={styles.failureNotice} role="alert">{historyError}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadHistoryList()}>重试历史</button>
            </div>
          ) : historyTasks.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
              暂无历史评估记录
            </div>
          ) : (
            <div className={styles.historyList}>
              {historyTasks.map((t) => {
                const isSelected = activeTask?.id === t.id;
                return (
                  <button
                    type="button"
                    key={t.id}
                    className={`${styles.historyItem} ${isSelected ? styles.historyItemActive : ''}`}
                    onClick={() => handleSelectHistoryTask(t)}
                  >
                    <div>
                      <span className={styles.historyId}>{t.id.slice(0, 8)}...</span>
                      <span style={{ marginLeft: 8, color: '#64748b', fontSize: 11 }}>
                        {new Date(t.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <span
                      className={`badge ${
                        t.status === 'SUCCEEDED'
                          ? 'badge-success'
                          : t.status === 'FAILED'
                          ? 'badge-danger'
                          : t.status === 'CANCELED'
                          ? 'badge-neutral'
                          : 'badge-warning'
                      }`}
                    >
                      {t.status}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </article>
      </div>

      {/* 右侧：当前任务状态与评估结果 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <article className="simcore2-panel">
          <div className="simcore2-panel-header">
            <span className="simcore2-panel-title">
              当前评估任务状态 {activeTask ? `(${activeTask.id.slice(0, 8)}...)` : ''}
            </span>
            {activeTask && (
              <span
                className={`badge ${
                  activeTask.status === 'SUCCEEDED'
                    ? 'badge-success'
                    : activeTask.status === 'FAILED'
                    ? 'badge-danger'
                    : activeTask.status === 'CANCELED'
                    ? 'badge-neutral'
                    : 'badge-warning'
                }`}
              >
                {activeTask.status}
              </span>
            )}
          </div>

          {!activeTask ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b' }}>
              {pollingError && <div className={styles.failureNotice} role="alert">{pollingError}</div>}
              <p style={{ margin: 0, fontSize: 14 }}>尚未选择或启动评估任务</p>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                请在左侧选择目标候选模型并点击“启动评估”，或在历史记录中选中已有任务。
              </p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  任务 ID: <code style={{ color: '#0f172a' }}>{activeTask.id}</code>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!isTerminalEvaluationStatus(activeTask.status) && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={isCancelling}
                      onClick={() => void handleCancel()}
                    >
                      {isCancelling ? '正在取消...' : '取消任务'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={isCancelling}
                    onClick={() => void handleManualRefresh()}
                  >
                    刷新状态
                  </button>
                </div>
              </div>

              {pollingError && (
                <div className={styles.failureNotice} style={{ marginBottom: 12 }}>
                  <strong>轮询异常：</strong> {pollingError}
                </div>
              )}

              {/* 评估指标展示卡片 */}
              {loadingResults ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                  正在拉取与解析安全脱敏指标...
                </div>
              ) : resultError ? (
                <div className={styles.failureNotice}>
                  <strong>结果解析错误：</strong> {resultError}
                </div>
              ) : primaryResult ? (
                <div>
                  {/* 核心指标栅格 */}
                  <div className={styles.metricsGrid}>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>综合任务成功率</div>
                      <div
                        className={`${styles.metricValue} ${
                          primaryResult.successRate === 0 ? styles.trueZero : ''
                        }`}
                      >
                        {primaryResult.successRate !== null
                          ? `${(primaryResult.successRate * 100).toFixed(1)}%`
                          : '未产出'}
                      </div>
                      {primaryResult.successRate === 0 && (
                        <span className={styles.tag} style={{ background: '#fee2e2', color: '#dc2626', marginTop: 4 }}>
                          真实 0%
                        </span>
                      )}
                    </div>

                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>已完成回合 / 规划回合</div>
                      <div className={styles.metricValue}>
                        {primaryResult.episodes !== null ? primaryResult.episodes : '-'}
                        <span style={{ fontSize: 14, color: '#64748b' }}>
                          {' '}
                          / {primaryResult.episodeRewards.length || episodes}
                        </span>
                      </div>
                    </div>

                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>平均累计回报 (Avg Return)</div>
                      <div
                        className={`${styles.metricValue} ${
                          primaryResult.averageCumulativeReward === 0 ? styles.trueZero : ''
                        }`}
                      >
                        {primaryResult.averageCumulativeReward !== null
                          ? primaryResult.averageCumulativeReward.toFixed(4)
                          : '未产出'}
                      </div>
                    </div>
                  </div>

                  {/* 产物组装诊断 */}
                  {!primaryResult.assembly.complete && (
                    <div className={styles.assemblyNotice}>
                      {primaryResult.assembly.retryExhausted ? (
                        <>
                          <strong>产物整理已重试耗尽 (ARTIFACT_ASSEMBLY_INCOMPLETE)：</strong>
                          上游仿真器已报告执行终态，但由于产物传输延迟或部分文件缺失，指标未全部完成组装。已保留基础执行凭据。
                        </>
                      ) : (
                        <>
                          <strong>产物整理中：</strong>
                          正在从执行节点抓取并核验脱敏产物（尝试第 {primaryResult.assembly.attempts} 次）...
                        </>
                      )}
                    </div>
                  )}

                  {/* 失败归因 */}
                  {primaryResult.failure && (
                    <div className={styles.failureNotice}>
                      <strong>执行失败归因：</strong>
                      <div>
                        错误码: <code>{primaryResult.failure.code}</code>
                      </div>
                      <div style={{ marginTop: 4 }}>{primaryResult.failure.message}</div>
                    </div>
                  )}

                  {/* 回合明细表格 */}
                  {primaryResult.episodeRewards.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                        回合收益与步数统计 (Episode Rewards)
                      </div>
                      {primaryResult.assembly.complete && (
                        <svg className={styles.rewardChart} viewBox="0 0 480 180" role="img" aria-label="每回合累计 Reward 图">
                          <title>每回合累计 Reward（横轴：回合，纵轴：累计回报）</title>
                          <line x1="30" y1="150" x2="460" y2="150" stroke="currentColor" />
                          <line x1="30" y1="15" x2="30" y2="150" stroke="currentColor" />
                          {(() => {
                            const rewards = primaryResult.episodeRewards;
                            const min = Math.min(0, ...rewards.map((ep) => ep.cumulativeReward));
                            const max = Math.max(0, ...rewards.map((ep) => ep.cumulativeReward));
                            const x = (i: number) => 40 + i * 410 / Math.max(1, rewards.length - 1);
                            const y = (v: number) => 140 - (v - min) / (max - min || 1) * 115;
                            return <>
                              <text x="2" y="18" fontSize="10">{max.toPrecision(3)}</text>
                              <text x="2" y="148" fontSize="10">{min.toPrecision(3)}</text>
                              <polyline fill="none" stroke="#0284c7" strokeWidth="2" points={rewards.map((ep, i) => `${x(i)},${y(ep.cumulativeReward)}`).join(' ')} />
                              {rewards.map((ep, i) => <circle key={ep.episode} cx={x(i)} cy={y(ep.cumulativeReward)} r="3" fill="#0284c7"><title>{`回合 ${ep.episode}：${ep.cumulativeReward}`}</title></circle>)}
                              <text x="35" y="172" fontSize="10">{rewards[0].episode}</text>
                              <text x="445" y="172" fontSize="10">{rewards[rewards.length - 1].episode}</text>
                            </>;
                          })()}
                        </svg>
                      )}
                      <table className={styles.rewardTable}>
                        <thead>
                          <tr>
                            <th>回合序号</th>
                            <th>步数 (Steps)</th>
                            <th>累计回报 (Reward)</th>
                            <th>结果</th>
                          </tr>
                        </thead>
                        <tbody>
                          {primaryResult.episodeRewards.map((ep) => (
                            <tr key={ep.episode}>
                              <td>Episode #{ep.episode}</td>
                              <td>{ep.steps}</td>
                              <td style={{ fontFamily: 'monospace' }}>{ep.cumulativeReward.toFixed(4)}</td>
                              <td>
                                <span
                                  className={`badge ${ep.success ? 'badge-success' : 'badge-danger'}`}
                                >
                                  {ep.success ? '成功' : '失败'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* 产物清单与安全 CSV 下载 */}
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                      安全核验产物与数据导出
                    </div>
                    <div className={styles.artifactsContainer}>
                      {primaryResult.artifacts.map((art) => {
                        const isCsv = art.name === 'evaluation_steps.csv';
                        const downloadUrl = isCsv && activeTask
                          ? getSafeEvaluationCsvDownloadUrl(
                              activeTask.id,
                              primaryResult.executionProof.requestId,
                              art,
                            )
                          : null;

                        return (
                          <div key={art.artifactId} className={styles.artifactItem}>
                            <div className={styles.artifactInfo}>
                              <span className={styles.artifactName}>{art.name}</span>
                              <span className={styles.artifactMeta}>
                                大小: {(art.sizeBytes / 1024).toFixed(1)} KB | SHA-256: {art.sha256.slice(0, 12)}...
                              </span>
                            </div>
                            <div>
                              {downloadUrl ? (
                                <a
                                  href={downloadUrl}
                                  download={art.name}
                                  className="btn btn-secondary btn-sm"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  下载明细 CSV
                                </a>
                              ) : (
                                <span className={styles.tagGray}>
                                  平台脱敏指标 (不提供直接文件下载)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : activeTask.status === 'SUCCEEDED' ? (
                <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>
                  任务已完成，未查到关联结果数据。
                </div>
              ) : null}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
