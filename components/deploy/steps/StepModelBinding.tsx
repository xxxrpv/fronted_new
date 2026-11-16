'use client';

import React, { useRef, useState } from 'react';
import styles from '../deploy.module.css';
import type {
  DeployxRobotResource,
  DeployxTemplateResource,
  DeployxRobotStatusResponse,
} from '../../../lib/api';

interface StepModelBindingProps {
  projectId?: string;
  packageId: string;
  robots: DeployxRobotResource[];
  templates: DeployxTemplateResource[];
  selectedRobotId: string | null;
  selectedTemplateId: string | null;
  robotStatus: DeployxRobotStatusResponse | null;
  onSelectRobot: (robotId: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onCreateDeployment: () => void;
  isCreating?: boolean;
  canCreate: boolean;
  hasActiveTask?: boolean;
  readOnly?: boolean;
  canBindRobot?: boolean;
  canPrepareRobot?: boolean;
  onBindRobot?: (robotId: string, approvedBindingId: string, bindingVersion: string) => void;
  onPrepareRobot?: (robotId: string) => void;
  isLoadingPrep?: boolean;
}

export default function StepModelBinding({
  projectId,
  packageId,
  robots,
  templates,
  selectedRobotId,
  selectedTemplateId,
  robotStatus,
  onSelectRobot,
  onSelectTemplate,
  onCreateDeployment,
  isCreating = false,
  canCreate,
  hasActiveTask = false,
  readOnly = false,
  canPrepareRobot = false,
  onPrepareRobot,
  isLoadingPrep = false,
}: StepModelBindingProps) {
  const [confirmation, setConfirmation] = useState<{ scope: string; version: number } | null>(null);
  const scope = JSON.stringify([projectId, selectedRobotId]);
  const currentScope = useRef({ scope, version: 0 });
  if (currentScope.current.scope !== scope) currentScope.current = { scope, version: currentScope.current.version + 1 };
  const showConfirmPrepare = confirmation?.scope === scope && confirmation.version === currentScope.current.version;

  const currentRobot = robots.find((r) => r.id === selectedRobotId);
  const currentTemplate = templates.find((t) => t.id === selectedTemplateId);

  const handleExecutePrepare = () => {
    if (!projectId || !selectedRobotId || !onPrepareRobot || !canPrepareRobot || isLoadingPrep || !confirmation || confirmation.scope !== currentScope.current.scope || confirmation.version !== currentScope.current.version || confirmation.scope !== scope) return;
    onPrepareRobot(selectedRobotId);
    setConfirmation(null);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
      {/* 左侧：机器人选择与硬件绑定卡片 */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className={styles.cardTitle}>目标真机与机型模板</div>
            <div className={styles.cardDesc}>
              选择已绑定的授权真机与匹配的机型硬件模板。
            </div>
          </div>
          <button
            type="button"
            disabled
            className={`${styles.btnSecondary} ${styles.btnSm}`}
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          >
            未开放
          </button>
        </div>

        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 机器人选择 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
              选择目标机器人
            </label>
            <select
              aria-label="选择目标机器人"
              className={styles.select}
              value={selectedRobotId || ''}
              disabled={readOnly || hasActiveTask}
              onChange={(e) => onSelectRobot(e.target.value)}
            >
              {robots.length === 0 && <option value="">暂无可用机器人</option>}
              {robots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.online ? '在线' : '离线'})
                </option>
              ))}
            </select>
          </div>

          {/* 机型模板选择 */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
              选择机型模板
            </label>
            <select
              aria-label="选择机型模板"
              className={styles.select}
              value={selectedTemplateId || ''}
              disabled={readOnly || hasActiveTask}
              onChange={(e) => onSelectTemplate(e.target.value)}
            >
              {templates.length === 0 && <option value="">暂无机型模板</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.arch} · {t.runtime})
                </option>
              ))}
            </select>
          </div>

          {/* 机器人缓存状态卡片 */}
          {currentRobot && (
            <div
              style={{
                marginTop: 6,
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                机器人状态缓存: {currentRobot.name}
              </div>
              <div style={{ color: '#64748b' }}>
                网络在线: {currentRobot.online ? '🟢 在线' : '🔴 离线'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                上报时间: {robotStatus?.lastSeenAt ? new Date(robotStatus.lastSeenAt).toLocaleString() : '暂无数据'}
              </div>
            </div>
          )}

          {/* 准备阶段操作：硬件绑定与真机预备（需二次确认与受控能力） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, padding: 12, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>机器人就绪化准备动作</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" disabled className={`${styles.btnSecondary} ${styles.btnSm}`}>
                硬件绑定 (未开放：缺少可信绑定记录)
              </button>

              {canPrepareRobot && onPrepareRobot ? (
                showConfirmPrepare ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#dc2626' }}>预备可能停止或重置机器人 {currentRobot?.name || selectedRobotId}（{selectedRobotId}），确认下发？</span>
                    <button
                      type="button"
                      disabled={isLoadingPrep}
                      className={`${styles.btnPrimary} ${styles.btnSm}`}
                      onClick={handleExecutePrepare}
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      className={`${styles.btnSecondary} ${styles.btnSm}`}
                      onClick={() => setConfirmation(null)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!projectId || !selectedRobotId || isLoadingPrep}
                    className={`${styles.btnSecondary} ${styles.btnSm}`}
                    onClick={() => setConfirmation({ scope, version: currentScope.current.version })}
                  >
                    {isLoadingPrep ? '提交中…' : '真机预备 (Prepare)'}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled
                  className={`${styles.btnSecondary} ${styles.btnSm}`}
                  style={{ opacity: 0.6, cursor: 'not-allowed' }}
                >
                  真机预备 (未开放)
                </button>
              )}
            </div>
          </div>

          {/* 探测与登记未开放提示 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              disabled
              className={`${styles.btnSecondary} ${styles.btnSm}`}
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            >
              探针检测 (未开放)
            </button>
            <button
              type="button"
              disabled
              className={`${styles.btnSecondary} ${styles.btnSm}`}
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            >
              添加新机器人 (未开放)
            </button>
          </div>
        </div>
      </div>

      {/* 右侧：意图确认与任务创建卡片 */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>冻结部署意图</div>
          <div className={styles.cardDesc}>
            确认资源绑定并创建真实部署任务（MANUAL_STAGE 策略）。
          </div>
        </div>

        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div><strong>算法包 ID:</strong> {packageId}</div>
            <div><strong>机器人 ID:</strong> {selectedRobotId || '未选择'}</div>
            <div><strong>机型模板:</strong> {selectedTemplateId || '未选择'}</div>
            <div><strong>模式:</strong> 真实部署 (isShadow=false, progressionPolicy=MANUAL_STAGE)</div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={onCreateDeployment}
              disabled={!canCreate || !packageId || isCreating || hasActiveTask || !selectedRobotId || !selectedTemplateId || readOnly}
              style={{ width: '100%' }}
            >
              {isCreating ? '创建中…' : hasActiveTask ? '部署任务已建立' : !canCreate ? '未开放' : '确认并创建部署任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
