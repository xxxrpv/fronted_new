'use client';

import React from 'react';
import styles from '../deploy.module.css';
import type { DeployxDeploymentResponse } from '../../../lib/api';

interface StepExecutionDeployProps {
  deployment: DeployxDeploymentResponse | null;
  onConfirmDeploy: () => void;
  onFetchLogs: () => void;
  logs: string;
  logsLoading?: boolean;
  isLoading?: boolean;
  canConfirm: boolean;
  opened: boolean;
  canViewLogs: boolean;
}

export default function StepExecutionDeploy({
  deployment,
  onConfirmDeploy,
  onFetchLogs,
  logs,
  logsLoading = false,
  isLoading = false,
  canConfirm,
  opened,
  canViewLogs,
}: StepExecutionDeployProps) {
  const upstream = deployment;
  const deployStep = upstream?.steps?.deploy;
  const isDeployActive = upstream?.status === 'RUNNING';
  const isDeploySucceeded = upstream?.status === 'SUCCEEDED';
  const isFailed = upstream?.status === 'FAILED';
  const isCancelled = upstream?.status === 'CANCELLED';

  const canConfirmDeploy = canConfirm;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>人工确认下发真机</div>
        <div className={styles.cardDesc}>
          构建已就绪。请确认下发至目标真机，系统不会自动下发。
        </div>
      </div>

      <div className={styles.cardBody}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 当前下发状态卡片 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={onConfirmDeploy}
              disabled={isLoading || !canConfirmDeploy}
            >
              {isLoading
                ? '正在提交下发指令…'
                : isDeploySucceeded
                ? '部署已成功完成'
                : !opened ? '未开放' : '人工确认：下发至机器人真机'}
            </button>

            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onFetchLogs}
              disabled={logsLoading || !canViewLogs}
            >
              {logsLoading ? '正在拉取日志…' : !canViewLogs ? '未开放' : '查看容器日志尾部快照'}
            </button>
          </div>

          {/* 状态与执行步骤 */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              fontSize: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 600, color: '#0f172a' }}>
              下发事实观测
            </div>
            <div>
              任务状态: <strong>{upstream?.status || '等待确认'}</strong>
              {isDeployActive && <span style={{ marginLeft: 8, color: '#0284c7' }}>🔄 运行中...</span>}
              {isDeploySucceeded && <span style={{ marginLeft: 8, color: '#16a34a' }}>✅ 下发成功</span>}
              {isFailed && <span style={{ marginLeft: 8, color: '#dc2626' }}>❌ 部署失败</span>}
              {isCancelled && <span style={{ marginLeft: 8, color: '#64748b' }}>⏹ 已取消</span>}
            </div>
            {deployStep && (
              <div style={{ color: '#475569' }}>
                执行阶段: {deployStep.status}
              </div>
            )}
            <div style={{ color: '#94a3b8', fontSize: 11 }}>
              最后观测时间: {upstream?.observedAt ? new Date(upstream.observedAt).toLocaleString() : '暂无'}
            </div>
          </div>

          {/* 真实日志快照展示 */}
          {logs && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                容器运行日志 (最新快照)
              </div>
              <pre
                style={{
                  background: '#09090b',
                  color: '#f4f4f5',
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  maxHeight: 280,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {logs}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
