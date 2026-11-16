'use client';

import React from 'react';
import styles from '../deploy.module.css';
import type { DeployxValidationReportItem } from '../../../lib/api';

interface StepTwoStageValidationProps {
  packageId: string;
  selectedRobotId?: string | null;
  validations?: DeployxValidationReportItem[];
  canTriggerStage1?: boolean;
  canTriggerStage2?: boolean;
  stage2Passed?: boolean;
  onValidateStage1?: () => void;
  onValidateStage2?: (robotId: string) => void;
  isLoading?: boolean;
}

export default function StepTwoStageValidation({
  packageId,
  selectedRobotId = null,
  validations = [],
  canTriggerStage1 = false,
  canTriggerStage2 = false,
  stage2Passed = false,
  onValidateStage1,
  onValidateStage2,
  isLoading = false,
}: StepTwoStageValidationProps) {
  const allPassed = validations.length > 0 && validations.every((v) => v.status === 'PASSED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 官方提示语 */}
      <div className={styles.bannerInfo}>
        此处支持阶段一算法包自身规范检查与阶段二目标机器人兼容性预校验。真实下发前需通过阶段二检验。
      </div>

      {/* 阶段一校验报告卡片 */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className={styles.cardTitle}>阶段一：算法包自身规范检查</div>
            <div className={styles.cardDesc}>算法包 ID: {packageId}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canTriggerStage1 && onValidateStage1 ? (
              <button
                type="button"
                disabled={isLoading}
                onClick={onValidateStage1}
                className={`${styles.btnSecondary} ${styles.btnSm}`}
              >
                {isLoading ? '校验中…' : '触发阶段一校验'}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className={`${styles.btnSecondary} ${styles.btnSm}`}
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              >
                未开放
              </button>
            )}
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: allPassed ? '#ecfdf5' : '#f1f5f9',
                color: allPassed ? '#047857' : '#64748b',
                border: '1px solid #e2e8f0',
              }}
            >
              {validations.length === 0 ? '暂无校验记录' : allPassed ? '校验通过' : '待处理'}
            </span>
          </div>
        </div>

        <div className={styles.cardBody}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', marginBottom: 8 }}>检查项</div>
          {validations.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              上游暂未生成该算法包的校验报告
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {validations.map((item, idx) => {
                const isPass = item.status === 'PASSED';
                const issueCount = item.issues?.length ?? (item as any).checkedRules?.length ?? 0;
                return (
                  <li
                    key={item.id || `${item.stage}-${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #f1f5f9',
                      background: '#ffffff',
                    }}
                  >
                    <span style={{ fontSize: 14, marginTop: 1 }}>{isPass ? '✅' : '⚠️'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                        {item.stage}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        状态: {item.status} · 校验项/问题: {issueCount} 项
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* 阶段二目标校验卡片 */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className={styles.cardTitle}>阶段二：目标机器人兼容性预校验</div>
            <div className={styles.cardDesc}>
              {selectedRobotId ? `关联目标真机: ${selectedRobotId}` : '需在后续步骤选择或指定目标机器人'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canTriggerStage2 && onValidateStage2 && selectedRobotId ? (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onValidateStage2(selectedRobotId)}
                className={`${styles.btnSecondary} ${styles.btnSm}`}
              >
                {isLoading ? '校验中…' : '触发阶段二校验'}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className={`${styles.btnSecondary} ${styles.btnSm}`}
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              >
                {!selectedRobotId ? '需先选机器人' : '未开放'}
              </button>
            )}
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: stage2Passed ? '#ecfdf5' : '#f1f5f9',
                color: stage2Passed ? '#047857' : '#64748b',
                border: '1px solid #e2e8f0',
              }}
            >
              {stage2Passed ? '阶段二通过' : '待校验'}
            </span>
          </div>
        </div>
        <div className={styles.cardBody}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            校验内容包括：机器人运行时环境版本匹配、硬件算力与内存规格、外设驱动与通讯协议接口。
          </div>
        </div>
      </div>
    </div>
  );
}
