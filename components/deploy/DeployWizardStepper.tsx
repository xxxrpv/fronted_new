'use client';

import React from 'react';
import styles from './deploy.module.css';

export type WizardStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'SUCCEEDED'
  | 'REUSED'
  | 'SKIPPED'
  | 'FAILED';

export const STEP_DEFS = [
  { name: '上传算法包', locked: false },
  { name: '解包与解析', locked: false },
  { name: '两阶段校验', locked: false },
  { name: '选择机型与绑定', locked: false },
  { name: '构建 Release', locked: false },
  { name: '部署下发', locked: false },
];

interface DeployWizardStepperProps {
  current: number;
  onSelect: (index: number) => void;
  stepStatuses: Record<number, WizardStepStatus>;
}

export default function DeployWizardStepper({
  current,
  onSelect,
  stepStatuses,
}: DeployWizardStepperProps) {
  return (
    <div className={styles.stepperContainer}>
      <div className={styles.stepperList}>
        {STEP_DEFS.map((item, index) => {
          const active = index === current;
          const status = stepStatuses[index] || (index < current ? 'SUCCEEDED' : 'PENDING');
          const isDone = status === 'SUCCEEDED' || status === 'REUSED';
          const isRunning = status === 'RUNNING';
          const isFailed = status === 'FAILED';
          const isWaiting = status === 'WAITING_INPUT';

          let dotClass = styles.stepDot;
          if (active) dotClass = `${styles.stepDot} ${styles.stepDotActive}`;
          else if (isDone) dotClass = `${styles.stepDot} ${styles.stepDotDone}`;
          else if (isRunning) dotClass = `${styles.stepDot} ${styles.stepDotRunning}`;
          else if (isWaiting) dotClass = `${styles.stepDot} ${styles.stepDotWarn}`;
          else if (isFailed) dotClass = `${styles.stepDot} ${styles.stepDotError}`;

          return (
            <button
              key={item.name}
              type="button"
              disabled={item.locked}
              className={`${styles.stepButton} ${active ? styles.stepButtonActive : ''}`}
              onClick={() => onSelect(index)}
              title={`步骤 ${index + 1}: ${item.name}`}
            >
              <span className={dotClass}>
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : isRunning ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    style={{ animation: 'spin 1s linear infinite' }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : isFailed ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className={styles.stepName}>{item.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
