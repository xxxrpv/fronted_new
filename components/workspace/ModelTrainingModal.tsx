'use client';

import React, { useEffect, useRef } from 'react';
import type { ModelTrainingState } from '../../lib/workspace/workspace-types';
import {
  formatDateTimeUtc,
  formatTaskStatus,
} from '../../lib/workspace/workspace-formatters';
import { workspaceStyles as styles } from './workspace-styles';

interface ModelTrainingModalProps {
  isOpen: boolean;
  state: ModelTrainingState;
  onClose: () => void;
  onRetry: () => void;
}

export const ModelTrainingModal: React.FC<ModelTrainingModalProps> = ({
  isOpen,
  state,
  onClose,
  onRetry,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Keep keyboard focus inside the modal and restore it on close or unmount.
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'));
    const keepFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus();
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0] ?? dialog;
      const last = controls.at(-1) ?? dialog;
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    (focusable()[0] ?? dialog).focus();
    document.addEventListener('focusin', keepFocus);
    dialog.addEventListener('keydown', trapTab);
    return () => {
      document.removeEventListener('focusin', keepFocus);
      dialog.removeEventListener('keydown', trapTab);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const { status, data, error, fileName } = state;

  return (
    <div
      style={styles.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid="model-training-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-training-dialog-title"
        tabIndex={-1}
        style={styles.modalDialog}
        data-testid="model-training-modal"
      >
        {/* Header */}
        <div style={styles.modalHeader}>
          <h2 id="model-training-dialog-title" style={styles.modalTitle}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0284c7"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            模型训练信息
          </h2>
          <button
            type="button"
            data-close-btn
            style={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="关闭模型训练信息窗口"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={styles.modalBody}>
          {/* Target File Hint */}
          {fileName && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary, #475569)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span>目标文件:</span>
              <span style={{ ...styles.detailValue, fontFamily: 'monospace' }}>{fileName}</span>
            </div>
          )}

          {/* Loading State */}
          {status === 'loading' && (
            <div
              data-testid="model-training-loading"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                gap: 12,
                color: 'var(--text-muted, #64748b)',
              }}
            >
              <style>{`@keyframes modal-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ animation: 'modal-spin 1s linear infinite' }}
                aria-hidden="true"
              >
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
              <div style={{ fontSize: 13 }}>正在验证产物身份并读取训练信息...</div>
            </div>
          )}

          {/* Error State */}
          {status === 'error' && (
            <div style={styles.stateBanner('error')} role="alert" data-testid="model-training-error">
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {error?.code === 'MODEL_TRAINING_NOT_FOUND'
                  ? '未找到模型训练关联信息'
                  : error?.code === 'FILE_NOT_AVAILABLE'
                  ? '模型文件尚未就绪'
                  : error?.code === 'IDENTITY_CONFLICT'
                  ? '模型身份证据冲突'
                  : error?.code === 'AUTHENTICATION_REQUIRED'
                  ? '登录会话已过期'
                  : error?.code === 'WORKSPACE_ENTRY_NOT_FOUND'
                  ? '工作区条目不存在'
                  : '获取模型训练信息失败'}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                {error?.code === 'MODEL_TRAINING_NOT_FOUND'
                  ? '该文件未关联任何有效平台训练任务，或当前账户无权访问该任务。'
                  : error?.code === 'FILE_NOT_AVAILABLE'
                  ? '该文件尚未完全可用（上传或验证进行中），请等待产物就绪后重试。'
                  : error?.code === 'IDENTITY_CONFLICT'
                  ? '该模型产物关联到多重或矛盾的训练执行源，系统已进行安全阻断。'
                  : error?.code === 'AUTHENTICATION_REQUIRED'
                  ? '请重新登录以刷新认证会话。'
                  : error?.message || '上游服务暂时不可用，请稍后重试。'}
              </div>
              {error?.requestId && (
                <div style={styles.monoId}>排查编号: {error.requestId}</div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  style={styles.btnPrimary}
                  onClick={onRetry}
                >
                  重试读取
                </button>
                <button
                  type="button"
                  style={styles.btn}
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>
            </div>
          )}

          {/* Success State */}
          {status === 'success' && data && (
            <div data-testid="model-training-details" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={styles.detailGrid}>
                {/* 4. File Name */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>模型文件名</span>
                  <span style={{ ...styles.detailValue, fontFamily: 'monospace', fontSize: 12 }}>{data.fileName}</span>
                </div>

                {/* 5. Algorithm */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>训练算法</span>
                  <span style={styles.detailValue}>
                    {data.algorithm ? data.algorithm.toUpperCase() : '未提供'}
                  </span>
                </div>

                {/* 6. Planned Total Steps */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>计划总步数</span>
                  <span style={styles.detailValue}>
                    {data.plannedTotalSteps !== null && data.plannedTotalSteps !== undefined
                      ? `${data.plannedTotalSteps.toLocaleString('en-US')} 步`
                      : '未提供'}
                  </span>
                </div>

                {/* 7. Training Status */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>任务运行状态</span>
                  <span style={styles.taskStatusBadge(data.trainingStatus)}>
                    {formatTaskStatus(data.trainingStatus)}
                  </span>
                </div>

                {/* 8. Model Execution Count */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>本任务模型执行次数</span>
                  <span style={styles.detailValue}>{data.modelExecutionCount} 次</span>
                </div>

                {/* 9. Robot Training Execution Count */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>机器人累计训练次数 (同项目)</span>
                  <span style={styles.detailValue}>
                    {data.robotTrainingExecutionCount !== null && data.robotTrainingExecutionCount !== undefined
                      ? `${data.robotTrainingExecutionCount} 次`
                      : '未提供'}
                  </span>
                </div>

                {/* 10. Result Recorded At */}
                <div style={styles.detailItem}>
                  <span style={styles.detailLabel}>结果入库时间 (UTC)</span>
                  <span style={styles.detailValue}>
                    {data.resultRecordedAt ? formatDateTimeUtc(data.resultRecordedAt) : '未提供'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
