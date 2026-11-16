import React from 'react';
import type { CapacityState } from '../../lib/workspace/workspace-types';
import {
  formatBytes,
  formatMeasurement,
} from '../../lib/workspace/workspace-formatters';
import { workspaceStyles as styles } from './workspace-styles';

interface CapacityCardProps {
  state: CapacityState;
  onRefresh: () => void;
}

export const CapacityCard: React.FC<CapacityCardProps> = ({ state, onRefresh }) => {
  const { status, data, error } = state;

  return (
    <section style={styles.card} aria-labelledby="capacity-card-heading">
      <div style={styles.cardHeader}>
        <h2 id="capacity-card-heading" style={styles.cardTitle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          存储容量概览
        </h2>
        <div style={styles.cardActions}>
          <button
            type="button"
            style={styles.btn}
            onClick={onRefresh}
            disabled={status === 'loading'}
            aria-label="刷新容量信息"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            {status === 'loading' ? '正在查询...' : '刷新'}
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div style={styles.metricsGrid} data-testid="capacity-loading-skeleton">
          <div style={{ ...styles.metricItem, ...styles.skeleton, height: 72 }} />
          <div style={{ ...styles.metricItem, ...styles.skeleton, height: 72 }} />
          <div style={{ ...styles.metricItem, ...styles.skeleton, height: 72 }} />
          <div style={{ ...styles.metricItem, ...styles.skeleton, height: 72 }} />
        </div>
      )}

      {status === 'initialization_pending' && (
        <div style={styles.stateBanner('pending')} role="status">
          <div style={{ fontWeight: 600 }}>工作区初始化中 (503 WORKSPACE_INITIALIZATION_PENDING)</div>
          <div style={{ fontSize: 13 }}>
            当前用户的专属工作空间存储正处于初始化建立阶段，请稍后点击下方按钮重试。
          </div>
          {error?.requestId && (
            <div style={styles.monoId}>请求编号: {error.requestId}</div>
          )}
          <button
            type="button"
            style={{ ...styles.btnPrimary, marginTop: 4 }}
            onClick={onRefresh}
          >
            重新尝试检查
          </button>
        </div>
      )}

      {status === 'error' && (
        <div style={styles.stateBanner('error')} role="alert">
          <div style={{ fontWeight: 600 }}>无法读取存储容量 ({error?.code || 'ERROR'})</div>
          <div style={{ fontSize: 13 }}>{error?.message || '获取容量信息失败，请稍后重试。'}</div>
          {error?.requestId && (
            <div style={styles.monoId}>排查编号: {error.requestId}</div>
          )}
          <button
            type="button"
            style={{ ...styles.btnPrimary, marginTop: 4 }}
            onClick={onRefresh}
          >
            重试读取
          </button>
        </div>
      )}

      {status === 'success' && data && (() => {
        const reservedBytes = data.reservedBytes ?? 0;
        const totalOccupied = BigInt(data.usedBytes) + BigInt(reservedBytes);
        const hasQuota = data.quotaBytes !== null && data.quotaBytes > 0;
        const isOverquota = data.quotaBytes !== null && totalOccupied > BigInt(data.quotaBytes);
        const percentVal = hasQuota ? (Number(totalOccupied) / data.quotaBytes!) * 100 : 0;

        let remainingDisplay = '-';
        if (data.quotaBytes === null) {
          remainingDisplay = '无配置限额';
        } else if (isOverquota) {
          remainingDisplay = '已超出限额 (可用 0 B)';
        } else if (data.remainingBytes === 0) {
          remainingDisplay = '可用 0 B (已占满)';
        } else {
          remainingDisplay = formatBytes(data.remainingBytes);
        }

        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>工作区标识:</span>
              <code style={styles.monoId}>{data.workspaceId}</code>
            </div>

            {/* 配额进度条 */}
            {hasQuota && (
              <div style={styles.progressContainer}>
                <div style={styles.progressBarBg}>
                  <div
                    style={styles.progressBarFill(
                      percentVal,
                      isOverquota,
                    )}
                  />
                </div>
                <div style={styles.progressLabelRow}>
                  <span>
                    总占用率: {percentVal.toFixed(1)}%
                    {reservedBytes > 0 ? ` (含预占 ${formatBytes(reservedBytes)})` : ''}
                  </span>
                  {isOverquota && (
                    <span style={styles.metricWarning}>
                      已超出配额限额
                    </span>
                  )}
                </div>
              </div>
            )}

            <div style={styles.metricsGrid}>
              <div style={styles.metricItem}>
                <span style={styles.metricLabel}>已用存储空间</span>
                <span style={styles.metricValue}>{formatBytes(data.usedBytes)}</span>
              </div>

              <div style={styles.metricItem}>
                <span style={styles.metricLabel}>预占保留空间</span>
                <span style={styles.metricValue}>{formatBytes(reservedBytes)}</span>
              </div>

              <div style={styles.metricItem}>
                <span style={styles.metricLabel}>配置配额限额</span>
                <span style={styles.metricValue}>
                  {data.quotaBytes !== null ? formatBytes(data.quotaBytes) : '无配置限额'}
                </span>
              </div>

              <div style={styles.metricItem}>
                <span style={styles.metricLabel}>剩余可用空间</span>
                <span
                  style={{
                    ...styles.metricValue,
                    ...(isOverquota ? styles.metricWarning : {}),
                  }}
                >
                  {remainingDisplay}
                </span>
              </div>

              <div style={styles.metricItem}>
                <span style={styles.metricLabel}>计量口径</span>
                <span style={{ ...styles.metricValue, fontSize: 14 }}>
                  {formatMeasurement(data.measurement)}
                </span>
              </div>
            </div>
          </>
        );
      })()}
    </section>
  );
};
