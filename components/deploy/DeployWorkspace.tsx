'use client';

import React, { useState } from 'react';
import styles from './deploy.module.css';
import DeployWizardStepper, { type WizardStepStatus } from './DeployWizardStepper';
import StepUploadPackage from './steps/StepUploadPackage';
import StepUnpackAnalysis from './steps/StepUnpackAnalysis';
import StepTwoStageValidation from './steps/StepTwoStageValidation';
import StepModelBinding from './steps/StepModelBinding';
import StepReleaseBuild from './steps/StepReleaseBuild';
import StepExecutionDeploy from './steps/StepExecutionDeploy';
import { packageStepStatus, validationStepStatus } from '../../lib/deploy/deployx-state';
import { useDeployxState } from '../../lib/deploy/useDeployxState';
import { useAuth } from '../../lib/auth-context';

interface DeployWorkspaceProps {
  projectId?: string;
  initialDeploymentId?: string;
}

export default function DeployWorkspace({
  projectId,
  initialDeploymentId,
}: DeployWorkspaceProps) {
  const [step, setStep] = useState(0);
  const { user, status } = useAuth();

  const {
    resources,
    localCapabilities,
    resourcesLoading,
    controls,
    prepControls,
    pending,
    resourcesError,
    selectedPackageId,
    setSelectedPackageId,
    selectedModelAssetId,
    setSelectedModelAssetId,
    selectedRobotId,
    setSelectedRobotId,
    selectedTemplateId,
    setSelectedTemplateId,
    packageDetail,
    packageManifest,
    packageValidations,
    robotStatus,
    currentDeployment,
    actionLoading,
    prepLoading,
    actionError,
    stage2ValidationPassed,
    uploadStatus,
    robotLogs,
    logsLoading,
    handleCreateDeployment,
    handleConfirmBuild,
    handleConfirmDeploy,
    handleStop,
    handleCancel,
    handleRecover,
    handleFetchLogs,
    handleRestart,
    handleUploadPackage,
    handleUploadModelAsset,
    handleCancelUpload,
    handleUnpackPackage,
    handleValidateStage1,
    handleValidateStage2,
    handleBindRobot,
    handlePrepareRobot,
  } = useDeployxState({ projectId, initialDeploymentId, accountId: status === 'authenticated' ? user?.id : undefined });

  const hasActiveTask = currentDeployment !== null;
  const taskStatus = currentDeployment?.status || 'PENDING';
  const isTerminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(taskStatus);
  const isRunning = !isTerminal || Boolean(currentDeployment?.upstreamTaskId && localCapabilities?.decisions.STOP);

  // 各步状态计算
  const stepStatuses: Record<number, WizardStepStatus> = {
    0: currentDeployment?.steps?.package?.status || (selectedPackageId ? 'SUCCEEDED' : 'PENDING'),
    1: currentDeployment?.steps?.unpack?.status || packageStepStatus(packageDetail),
    2: currentDeployment?.steps?.validation?.status || currentDeployment?.steps?.static_check?.status || validationStepStatus(packageValidations),
    3: currentDeployment?.steps?.target?.status || currentDeployment?.steps?.compatibility?.status || (selectedRobotId && selectedTemplateId ? 'WAITING_INPUT' : 'PENDING'),
    4: currentDeployment?.steps?.build?.status || 'PENDING',
    5: currentDeployment?.steps?.deploy?.status || (taskStatus === 'FAILED' ? 'FAILED' : taskStatus === 'RUNNING' ? 'RUNNING' : 'PENDING'),
  };

  const canNext = Boolean(
    (step === 0 && selectedPackageId) ||
    (step === 1 && selectedPackageId) ||
    (step === 2 && selectedPackageId) ||
    (step === 3 && selectedRobotId && selectedTemplateId) ||
    (step === 4 && hasActiveTask) ||
    step < 5
  );

  return (
    <div className={styles.deployWrapper}>
      {/* 顶部标题与控制栏 */}
      <div className={styles.deployHeader}>
        <div className={styles.titleArea}>
          <h1 className={styles.mainTitle}>部署向导</h1>
          <p className={styles.subTitle}>仿真算法包 → 校验 → 构建 → 下发真机，全流程可视化。</p>
        </div>

        {hasActiveTask && (
          <div className={styles.headerActions}>
            {isTerminal && (
              <button
                type="button"
                className={`${styles.btnSecondary} ${styles.btnSm}`}
                onClick={handleRestart}
                disabled={!controls.restart}
              >
                {controls.restart ? '本任务已结束，开始新的部署' : '等待安全状态确认'}
              </button>
            )}

            {isRunning && (
              <>
                <button
                  type="button"
                  className={`${styles.btnSecondary} ${styles.btnSm}`}
                  disabled={!controls.stop}
                  onClick={handleStop}
                >
                  {localCapabilities?.decisions.STOP ? '安全停止' : '未开放'}
                </button>
                <button
                  type="button"
                  className={`${styles.btnSecondary} ${styles.btnSm}`}
                  disabled={!controls.cancel}
                  onClick={handleCancel}
                >
                  {localCapabilities?.decisions.CANCEL ? '取消部署' : '未开放'}
                </button>
              </>
            )}

            {['FAILED', 'SAFETY_BLOCKED'].includes(taskStatus) && (
              <>
                <button
                  type="button"
                  className={`${styles.btnSecondary} ${styles.btnSm}`}
                  disabled={!controls.recover}
                  onClick={handleRecover}
                >
                  {localCapabilities?.decisions.RECOVER ? '受控恢复' : '未开放'}
                </button>
                <select
                  aria-label="选择历史部署"
                  className={styles.select}
                  disabled
                  style={{ fontSize: 12, padding: '3px 8px', opacity: 0.6, cursor: 'not-allowed' }}
                >
                  <option value="">未开放</option>
                </select>
                <button
                  type="button"
                  disabled
                  className={`${styles.btnSecondary} ${styles.btnSm}`}
                  style={{ opacity: 0.6, cursor: 'not-allowed' }}
                >
                  未开放
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 错误提示条 */}
      {(resourcesError || actionError) && (
        <div className={styles.bannerNotice} style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          {[resourcesError, actionError].filter(Boolean).join('；')}
        </div>
      )}

      {(pending || currentDeployment) && (
        <div className={styles.bannerNotice} role="status">
          {pending && '提交结果待确认，请勿重复操作。 '}
          {currentDeployment && <>
            安全停止接收：{String(currentDeployment.safety.stopAccepted.value ?? '未知')}；
            安全停止确认：{String(currentDeployment.safety.safeStopVerified.value ?? '未知')}；
            租约：{currentDeployment.safety.lease.value ?? '未知'}；
            新部署准入：{String(currentDeployment.safety.newDeploymentAdmission.value ?? '未知')}。
            {currentDeployment.operations.filter(o => o.submitStatus === 'PENDING_SUBMIT' || o.submitStatus === 'UNKNOWN_SUBMIT').map(o => <span key={o.operationId}> {o.operationType}：{o.submitStatus}。</span>)}
            {currentDeployment.relatedStops.map(s => <span key={s.upstreamStopTaskId}> 停止跟踪：{s.status}。</span>)}
          </>}
        </div>
      )}

      {/* 计划冻结提示 */}
      {hasActiveTask && step <= 3 && (
        <div className={styles.bannerNotice}>
          当前配置已冻结。已创建本方平台任务 (Task ID: {currentDeployment.platformTaskId})，远端任务 ID: {currentDeployment.upstreamTaskId || '待生成'}。
        </div>
      )}

      {/* 6 步 Stepper */}
      <DeployWizardStepper
        current={step}
        onSelect={(idx) => setStep(idx)}
        stepStatuses={stepStatuses}
      />

      {/* 步骤内容区域 */}
      {step === 0 && (
        <StepUploadPackage
          packages={resources?.packages || []}
          models={resources?.modelAssets || []}
          selectedPackageId={selectedPackageId}
          selectedModelAssetId={selectedModelAssetId}
          onSelectPackage={setSelectedPackageId}
          onModelAssetChange={setSelectedModelAssetId}
          readOnly={hasActiveTask}
          canUploadPackage={prepControls.uploadPackage}
          canUploadModel={prepControls.uploadModel}
          onUploadPackage={handleUploadPackage}
          onUploadModel={handleUploadModelAsset}
          uploadStatus={uploadStatus}
          onCancelUpload={handleCancelUpload}
          isUploading={prepLoading}
        />
      )}

      {step === 1 && (
        <StepUnpackAnalysis
          packageDetail={packageDetail}
          packageManifest={packageManifest}
          canUnpack={prepControls.unpack && packageDetail?.status === 'UPLOADED'}
          onUnpack={handleUnpackPackage}
          isLoading={prepLoading}
        />
      )}

      {step === 2 && (
        <StepTwoStageValidation
          packageId={selectedPackageId || ''}
          selectedRobotId={selectedRobotId}
          validations={packageValidations}
          canTriggerStage1={prepControls.validateStage1 && packageManifest?.packageId === selectedPackageId}
          canTriggerStage2={prepControls.validateStage2}
          stage2Passed={stage2ValidationPassed}
          onValidateStage1={() => handleValidateStage1()}
          onValidateStage2={(robotId) => handleValidateStage2(robotId)}
          isLoading={prepLoading}
        />
      )}

      {step === 3 && (
        <StepModelBinding
          projectId={projectId}
          packageId={selectedPackageId || ''}
          robots={resources?.robots || []}
          templates={resources?.templates || []}
          selectedRobotId={selectedRobotId}
          selectedTemplateId={selectedTemplateId}
          robotStatus={robotStatus}
          onSelectRobot={setSelectedRobotId}
          onSelectTemplate={setSelectedTemplateId}
          onCreateDeployment={handleCreateDeployment}
          isCreating={actionLoading}
          canCreate={controls.create}
          hasActiveTask={hasActiveTask}
          readOnly={hasActiveTask}
          canBindRobot={prepControls.bind}
          canPrepareRobot={prepControls.prepare}
          onBindRobot={handleBindRobot}
          onPrepareRobot={handlePrepareRobot}
          isLoadingPrep={prepLoading}
        />
      )}

      {step === 4 && (
        <StepReleaseBuild
          deployment={currentDeployment}
          onConfirmBuild={handleConfirmBuild}
          canConfirm={controls.build}
          opened={localCapabilities?.decisions.BUILD_RELEASE === true}
          isLoading={actionLoading}
        />
      )}

      {step === 5 && (
        <StepExecutionDeploy
          deployment={currentDeployment}
          onConfirmDeploy={handleConfirmDeploy}
          canConfirm={controls.deploy}
          opened={localCapabilities?.decisions.DEPLOY_TO_ROBOT === true}
          canViewLogs={controls.logs}
          onFetchLogs={handleFetchLogs}
          logs={robotLogs}
          logsLoading={logsLoading}
          isLoading={actionLoading}
        />
      )}

      {/* 底部导航栏 */}
      <div className={styles.footerNav}>
        <button
          type="button"
          className={styles.btnSecondary}
          disabled={step === 0}
          onClick={() => setStep(Math.max(0, step - 1))}
        >
          ← 上一步
        </button>

        <span style={{ fontSize: 12, color: '#71717a' }}>
          步骤 {step + 1} / 6
        </span>

        <button
          type="button"
          className={styles.btnPrimary}
          disabled={!canNext}
          onClick={() => setStep(Math.min(5, step + 1))}
        >
          下一步 →
        </button>
      </div>
    </div>
  );
}
