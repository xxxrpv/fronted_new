import type {
  DeployxDeploymentResponse,
  DeployxCapabilities,
  DeployxPackageResource,
  DeployxValidationReportItem,
  LocalCapabilities,
  PreparationOperation,
} from '../api';

export const isPending = (status: string) => status === 'PENDING_SUBMIT' || status === 'UNKNOWN_SUBMIT';

export function needsDeploymentPoll(d: DeployxDeploymentResponse): boolean {
  return !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(d.status || '') || isPending(d.submitStatus)
    || d.operations.some(o => isPending(o.submitStatus))
    || d.relatedStops.some(s => !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(s.status))
    || d.safety.safeStopVerified.value === null || d.safety.newDeploymentAdmission.value === null;
}

export function deploymentControls(
  d: DeployxDeploymentResponse | null,
  c?: DeployxCapabilities,
  busy = false,
  localCaps?: LocalCapabilities | null,
) {
  const pending = busy || Boolean(d && (isPending(d.submitStatus) || d.operations.some(o => isPending(o.submitStatus))));
  const build = d?.steps?.build?.status;
  const revision = d?.version !== null && d?.version !== undefined;
  const ld = localCaps?.decisions;

  const canCreate = ld?.CREATE_DEPLOYMENT === true;
  const canBuild = ld?.BUILD_RELEASE === true;
  const canDeploy = ld?.DEPLOY_TO_ROBOT === true;
  const canStop = ld?.STOP === true;
  const canCancel = ld?.CANCEL === true;
  const canRecover = ld?.RECOVER === true;
  const canLogs = ld?.LOGS === true;

  return {
    create: !d && !pending && canCreate,
    build: !pending && revision && canBuild && d?.availableActions?.includes('BUILD_RELEASE') === true && !['SUCCEEDED', 'REUSED'].includes(build || ''),
    deploy: !pending && revision && canDeploy && d?.availableActions?.includes('DEPLOY_TO_ROBOT') === true && ['SUCCEEDED', 'REUSED'].includes(build || ''),
    stop: !pending && Boolean(d?.upstreamTaskId) && canStop,
    cancel: !pending && Boolean(d?.upstreamTaskId) && canCancel && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(d?.status || ''),
    recover: !pending && Boolean(d?.upstreamTaskId) && canRecover && ['FAILED', 'SAFETY_BLOCKED'].includes(d?.status || ''),
    logs: Boolean(d?.upstreamTaskId) && canLogs,
    restart: !pending && Boolean(d && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(d.status || '') && d.safety.newDeploymentAdmission.value === true),
  };
}

export function preparationControls(
  localCaps?: LocalCapabilities | null,
  legacyCaps?: DeployxCapabilities | null,
  busy = false,
) {
  const d = localCaps?.decisions;
  return {
    uploadPackage: !busy && (d?.UPLOAD_PACKAGE === true),
    uploadModel: !busy && (d?.UPLOAD_MODEL ?? false),
    unpack: !busy && (d?.UNPACK === true),
    validateStage1: !busy && (d?.VALIDATE_STAGE1 === true),
    validateStage2: !busy && (d?.VALIDATE_STAGE2 === true),
    bind: !busy && false,
    prepare: !busy && (d?.PREPARE ?? false),
  };
}

export function packageStepStatus(p: DeployxPackageResource | null) {
  if (!p) return 'PENDING';
  if (['UNPACK_FAILED', 'REJECTED'].includes(p.status)) return 'FAILED';
  if (p.status === 'UNPACKING') return 'RUNNING';
  return ['UNPACKED', 'VALIDATING', 'VALIDATED', 'VALIDATION_FAILED'].includes(p.status) ? 'SUCCEEDED' : 'PENDING';
}

export function validationStepStatus(reports: DeployxValidationReportItem[]) {
  if (reports.some(r => r.status === 'FAILED')) return 'FAILED';
  if (reports.some(r => r.status === 'RUNNING')) return 'RUNNING';
  return reports.length > 0 && reports.every(r => r.status === 'PASSED') ? 'SUCCEEDED' : 'PENDING';
}

export function stage2ValidationPassed(
  reports: DeployxValidationReportItem[],
  packageId?: string | null,
  robotId?: string | null,
): boolean {
  if (!packageId || !robotId) return false;
  const stage2Reports = reports.filter(
    r => (r.stage === 'stage2' || (r.stage as string) === 'STAGE2_TARGET') && r.packageId === packageId && r.robotId === robotId,
  );
  return stage2Reports.length > 0 && stage2Reports.every(r => r.status === 'PASSED');
}

export function deployxError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; error?: unknown; code?: unknown };
    if (e.error) return deployxError(e.error);
    if (typeof e.message === 'string') return e.message.slice(0, 300);
    if (typeof e.code === 'string') return e.code;
  }
  return '请求失败，请稍后刷新查看任务状态。';
}
