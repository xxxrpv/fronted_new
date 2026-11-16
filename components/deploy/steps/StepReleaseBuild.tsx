'use client';

import React from 'react';
import styles from '../deploy.module.css';
import type { DeployxDeploymentResponse } from '../../../lib/api';

interface StepReleaseBuildProps {
  deployment: DeployxDeploymentResponse | null;
  onConfirmBuild: () => void;
  isLoading?: boolean;
  canConfirm: boolean;
  opened: boolean;
}

export default function StepReleaseBuild({
  deployment,
  onConfirmBuild,
  isLoading = false,
  canConfirm,
  opened,
}: StepReleaseBuildProps) {
  const upstream = deployment;
  const buildStep = upstream?.steps?.build;
  const isBuildSucceeded = buildStep?.status === 'SUCCEEDED' || buildStep?.status === 'REUSED';
  const canConfirmBuild = canConfirm;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>人工确认构建</div>
        <div className={styles.cardDesc}>
          意图已冻结。请人工核对并点击“确认构建”，系统不会自动跳步。
        </div>
      </div>

      <div className={styles.cardBody}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
          {/* 当前状态说明 */}
          <div style={{ fontSize: 13, color: '#334155' }}>
            <strong>当前任务状态:</strong> {upstream?.status || '等待创建'}
            {upstream?.version !== null && upstream?.version !== undefined && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b' }}>
                (版本: {upstream.version})
              </span>
            )}
          </div>

          {/* 人工确认按钮 */}
          <div>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={onConfirmBuild}
              disabled={isLoading || !canConfirmBuild}
            >
              {isLoading ? '正在提交构建动作…' : isBuildSucceeded ? '镜像构建已完成' : !opened ? '未开放' : '人工确认：开始构建 Release'}
            </button>
          </div>

          {/* 构建详情卡片 */}
          {buildStep && (
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
                构建详情事实 {isBuildSucceeded ? '✅' : '⏳'}
              </div>
              <div style={{ color: '#475569' }}>
                构建状态: <strong>{buildStep.status}</strong>
              </div>
              {buildStep.detail?.imageRef && (
                <div style={{ color: '#475569', wordBreak: 'break-all' }}>
                  镜像引用: {buildStep.detail.imageRef}
                </div>
              )}
              {buildStep.detail?.imageDigest && (
                <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
                  Digest: {buildStep.detail.imageDigest}
                </div>
              )}
            </div>
          )}

          {!buildStep && !canConfirmBuild && (
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
              尚未发起构建动作，请先在上一步创建部署任务。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
