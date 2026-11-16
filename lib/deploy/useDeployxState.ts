'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listDeployxProjectResources, getDeployxPackageDetail, getDeployxPackageManifest,
  getDeployxPackageValidation, getDeployxRobotStatus, listDeployxDeployments,
  createDeployxDeployment, getDeployxDeploymentDetail, triggerDeployxDeploymentAction,
  getDeployxDeploymentRobotLogs, stopDeployxDeployment, cancelDeployxDeployment, recoverDeployxDeployment,
  unpackDeployxPackage,
  validateDeployxStage1, validateDeployxStage2,
  prepareDeployxRobot, getDeployxPreparationOperation, getDeployxLocalCapabilities,
  type DeployxProjectResourcesResponse, type DeployxDeploymentResponse,
  type DeployxPackageManifestResponse, type DeployxValidationReportItem,
  type DeployxRobotStatusResponse, type GetDeployxPackageDetailResponse,
  type LocalCapabilities, type PreparationOperation,
} from '../api';
import { deploymentControls, preparationControls, deployxError, isPending, needsDeploymentPoll, stage2ValidationPassed } from './deployx-state';

export interface UseDeployxStateOptions { projectId?: string; initialDeploymentId?: string; accountId?: string }
type PendingPointer = { key: string; kind: string; deploymentId: string | null; environmentKey?: string; intent?: Record<string, string | number | null> };

function readPointer(projectId: string, accountId: string, preparation = false): PendingPointer | null {
  const blocked = { key: 'legacy', kind: 'LEGACY', deploymentId: null };
  try {
    const raw = localStorage.getItem(`deployx-${preparation ? 'prep' : 'pending'}:${accountId}:${projectId}`);
    if (!raw) return !preparation && sessionStorage.getItem(`deployx-pending:${projectId}`) ? blocked : null;
    const value = JSON.parse(raw);
    return value && typeof value.key === 'string' && /^[a-f0-9-]{36}$/i.test(value.key) && ['CREATE_DEPLOYMENT', 'BUILD_RELEASE', 'DEPLOY_TO_ROBOT', 'STOP', 'CANCEL', 'RECOVER', 'UPLOAD_PACKAGE', 'UPLOAD_MODEL', 'UNPACK', 'VALIDATE_STAGE1', 'VALIDATE_STAGE2', 'BIND', 'PREPARE'].includes(value.kind) && (value.deploymentId === null || typeof value.deploymentId === 'string') ? value : blocked;
  } catch { return blocked; }
}

function writePointer(projectId: string, accountId: string, pointer: PendingPointer | null, preparation = false) {
  try {
    if (pointer) localStorage.setItem(`deployx-${preparation ? 'prep' : 'pending'}:${accountId}:${projectId}`, JSON.stringify(pointer));
    else localStorage.removeItem(`deployx-${preparation ? 'prep' : 'pending'}:${accountId}:${projectId}`);
    return true;
  } catch { return false; }
}

function unwrap<T>(result: { data?: T; error?: unknown; response?: Response }): T {
  if (result.error || result.data === undefined) {
    const error = new Error(deployxError(result.error)) as Error & { status?: number; code?: string };
    error.status = result.response?.status;
    const envelope = result.error as { error?: { code?: unknown; message?: unknown } } | undefined;
    if (typeof envelope?.error?.code === 'string' && typeof envelope.error.message === 'string') error.code = envelope.error.code;
    throw error;
  }
  return result.data;
}

export function useDeployxState({ projectId, initialDeploymentId, accountId }: UseDeployxStateOptions) {
  const [stateScope, setStateScope] = useState(`${accountId}:${projectId}`);
  const [resources, setResources] = useState<DeployxProjectResourcesResponse | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [capsSnapshot, setCapsSnapshot] = useState<{ scope: string; sequence: number; value: LocalCapabilities } | null>(null);
  const environmentAnchor = useRef<string | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedModelAssetId, setSelectedModelAssetId] = useState<string | null>(null);
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [packageDetail, setPackageDetail] = useState<GetDeployxPackageDetailResponse | null>(null);
  const [packageManifest, setPackageManifest] = useState<DeployxPackageManifestResponse | null>(null);
  const [packageValidations, setPackageValidations] = useState<DeployxValidationReportItem[]>([]);
  const [robotStatus, setRobotStatus] = useState<DeployxRobotStatusResponse | null>(null);
  const [currentDeployment, setCurrentDeployment] = useState<DeployxDeploymentResponse | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [robotLogs, setRobotLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [pending, setPending] = useState<PendingPointer | null>(null);
  const [prepPending, setPrepPending] = useState<PendingPointer | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [preparationOperations, setPreparationOperations] = useState<Record<string, PreparationOperation>>({});

  const epoch = useRef(0);
  const selectedDeployment = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pendingRef = useRef<PendingPointer | null>(null);
  const prepPendingRef = useRef<PendingPointer | null>(null);
  const prepInFlight = useRef(false);
  const activePrepTimers = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const uploadAbort = useRef<AbortController | null>(null);
  const prepVersion = useRef(0);
  const requestSequence = useRef(0);
  const packageSequence = useRef(0);
  const robotSequence = useRef(0);
  const capsSequence = useRef(0);
  const pollBudget = useRef({ id: '', count: 0 });
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;

  const savePending = useCallback((pointer: PendingPointer | null) => {
    pendingRef.current = pointer;
    setPending(pointer);
    return projectId && accountId ? writePointer(projectId, accountId, pointer) : false;
  }, [projectId, accountId]);

  // Called only while holding this account/project's preparation Web Lock.
  const compareAndSetPrep = (expected: PendingPointer | null, next: PendingPointer | null) => {
    if (!projectId || !accountId) return 'error' as const;
    const current = readPointer(projectId, accountId, true);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      prepPendingRef.current = current; setPrepPending(current);
      return 'changed' as const;
    }
    if (!writePointer(projectId, accountId, next, true)) {
      setActionError('浏览器存储不可用，准备操作仍待核查。');
      return 'error' as const;
    }
    prepPendingRef.current = next; setPrepPending(next);
    return 'updated' as const;
  };

  const clearPrepPending = async (expected: PendingPointer, valid: () => boolean, onUpdated?: () => void) => {
    if (!projectId || !accountId || !navigator.locks) return 'busy' as const;
    try {
      return await navigator.locks.request(`deployx:prep:${accountId}:${projectId}`, { ifAvailable: true }, lock => {
        if (!valid()) return 'stale' as const;
        if (!lock) return 'busy' as const;
        const result = compareAndSetPrep(expected, null);
        if (result === 'updated' && valid()) onUpdated?.();
        return result;
      });
    } catch { if (valid()) setActionError('无法取得跨标签页安全锁，准备操作仍待核查。'); return 'busy' as const; }
  };

  const applyDeployment = useCallback((d: DeployxDeploymentResponse) => {
    selectedDeployment.current = d.deploymentId;
    setCurrentDeployment(d);
    setSelectedPackageId(d.packageId);
    setSelectedRobotId(d.robotId);
    setSelectedTemplateId(d.templateId);
    setSelectedModelAssetId(d.modelAssetId || null);
    const p = pendingRef.current;
    const operation = d.operations.find(o => o.operationId === p?.key || o.idempotencyKey === p?.key);
    if (operation && !isPending(operation.submitStatus)) savePending(null);
  }, [savePending]);

  const refreshDeployment = useCallback(async (deploymentId: string, generation = epoch.current) => {
    if (!projectId) return;
    const seq = ++requestSequence.current;
    try {
      const d = unwrap(await getDeployxDeploymentDetail({ path: { projectId, deploymentId } }));
      if (generation !== epoch.current || projectId !== currentProject.current || accountId !== currentAccount.current || seq !== requestSequence.current || selectedDeployment.current !== deploymentId) return;
      const pointer = pendingRef.current;
      const observedOperation = d.operations.find(o => o.operationId === pointer?.key || o.idempotencyKey === pointer?.key);
      if (observedOperation && !isPending(observedOperation.submitStatus)) savePending(null);
      applyDeployment(d);
      const recovered = [...d.operations].reverse().find(o => o.operationType === 'RECOVER' && o.submitStatus === 'SUBMITTED' && o.retryDeploymentId);
      if (recovered?.retryDeploymentId && recovered.retryDeploymentId !== deploymentId && d.retryDeployments.some(r => r.deploymentId === recovered.retryDeploymentId)) {
        const next = unwrap(await getDeployxDeploymentDetail({ path: { projectId, deploymentId: recovered.retryDeploymentId } }));
        if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current && seq === requestSequence.current && selectedDeployment.current === deploymentId) {
          setRobotLogs('');
          applyDeployment(next);
        }
        return;
      }
    } catch (error) {
      if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current && seq === requestSequence.current) setActionError(deployxError(error));
    }
  }, [projectId, applyDeployment, savePending]);

  // Project boundaries invalidate every outstanding request before loading new authoritative state.
  useEffect(() => {
    const generation = ++epoch.current;
    ++prepVersion.current;
    environmentAnchor.current = null;
    setStateScope(`${accountId}:${projectId}`);
    const controller = new AbortController();
    selectedDeployment.current = null;
    ++requestSequence.current;
    inFlight.current = false; prepInFlight.current = false;
    uploadAbort.current?.abort(); uploadAbort.current = null;
    activePrepTimers.current.forEach(clearInterval);
    activePrepTimers.current.clear();
    setResources(null); setResourcesError(null); setCapsSnapshot(null); setCurrentDeployment(null);
    setSelectedPackageId(null); setSelectedModelAssetId(null); setSelectedRobotId(null); setSelectedTemplateId(null);
    setPackageDetail(null); setPackageManifest(null); setPackageValidations([]); setRobotStatus(null);
    setRobotLogs(''); setActionError(null); setActionLoading(false); setLogsLoading(false); setUploadStatus(null); setPreparationOperations({}); setPrepLoading(false);
    const pointer = projectId && accountId ? readPointer(projectId, accountId) : null;
    const prepPointer = projectId && accountId ? readPointer(projectId, accountId, true) : null;
    pendingRef.current = pointer; setPending(pointer); prepPendingRef.current = prepPointer; setPrepPending(prepPointer);
    setRestoring(Boolean(projectId)); setResourcesLoading(Boolean(projectId));
    if (!projectId || !accountId) return () => { ++epoch.current; controller.abort(); };
    const valid = () => generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current;
    listDeployxProjectResources({ path: { projectId }, signal: controller.signal }).then(unwrap).then(data => {
      if (!valid()) return;
      setResources(data);
      let saved: unknown[] = [];
      try { const parsed = JSON.parse(String(prepPointer?.intent?.scope || 'null')); if (Array.isArray(parsed) && parsed[0] === accountId && parsed[1] === projectId) saved = parsed; } catch {}
      const robot = typeof saved[2] === 'string' && data.robots.some(item => item.id === saved[2]) ? saved[2] : null;
      const pkg = typeof saved[3] === 'string' && data.packages.some(item => item.id === saved[3]) ? saved[3] : null;
      const template = typeof saved[4] === 'string' && data.templates.some(item => item.id === saved[4]) ? saved[4] : null;
      const model = typeof saved[5] === 'string' && data.modelAssets.some(item => item.id === saved[5]) ? saved[5] : null;
      setSelectedPackageId(old => old || pkg || data.packages[0]?.id || null);
      setSelectedRobotId(old => old || robot || data.robots[0]?.id || null);
      setSelectedTemplateId(old => old || template || data.robots[0]?.templateId || data.templates[0]?.id || null);
      setSelectedModelAssetId(old => old || model);
    }).catch(error => { if (valid()) setResourcesError(deployxError(error)); }).finally(() => { if (valid()) setResourcesLoading(false); });
    (async () => {
      try {
        if (pointer?.kind === 'LEGACY') { setActionError('存在旧版未决操作，无法安全确认所属账号，请联系管理员核查。'); return; }
        let savedDeployment: string | undefined;
        if (prepPointer?.environmentKey && prepPointer.intent && !initialDeploymentId && !pointer) {
          try { const scope = JSON.parse(String(prepPointer.intent.scope)); if (scope[0] === accountId && scope[1] === projectId && typeof scope[6] === 'string') savedDeployment = scope[6]; } catch {}
        }
        let id = initialDeploymentId || pointer?.deploymentId || savedDeployment;
        if (!id) {
          const list = unwrap(await listDeployxDeployments({ path: { projectId }, signal: controller.signal }));
          const match = pointer ? list.items.find(d => d.operations.some(o => o.operationId === pointer.key || o.idempotencyKey === pointer.key)) : list.items[0];
          id = match?.deploymentId;
        }
        if (!valid()) return;
        if (id) { selectedDeployment.current = id; await refreshDeployment(id, generation); }
        else if (pointer) setActionError('提交结果尚未确认，请刷新查询；请勿重复提交。');
      } catch (error) { if (valid()) setActionError(deployxError(error)); }
      finally { if (valid()) setRestoring(false); }
    })();
    return () => { ++epoch.current; controller.abort(); uploadAbort.current?.abort(); activePrepTimers.current.forEach(clearInterval); activePrepTimers.current.clear(); };
  }, [projectId, accountId, initialDeploymentId, refreshDeployment]);

  const capsScope = JSON.stringify([accountId, projectId, selectedRobotId, selectedPackageId, selectedTemplateId, selectedModelAssetId, currentDeployment?.deploymentId]);
  const localCapabilities = capsSnapshot?.scope === capsScope && capsSnapshot.sequence === capsSequence.current ? capsSnapshot.value : null;
  // A matching same-origin response anchors the server's environment for this account/project.
  useEffect(() => {
    setCapsSnapshot(null);
    if (!projectId || !accountId) return;
    const controller = new AbortController();
    const generation = epoch.current;
    const seq = ++capsSequence.current;
    const query = {
      robotId: selectedRobotId || undefined,
      packageId: selectedPackageId || undefined,
      templateId: selectedTemplateId || undefined,
      modelAssetId: selectedModelAssetId || undefined,
      deploymentId: currentDeployment?.deploymentId || undefined,
    };
    const valid = () => !controller.signal.aborted && generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current && seq === capsSequence.current;
    getDeployxLocalCapabilities({ path: { projectId }, query, signal: controller.signal })
      .then(unwrap).then(caps => {
        if (!valid()) return;
        const keys = ['robotId', 'packageId', 'templateId', 'modelAssetId', 'deploymentId'] as const;
        const matching = caps.projectId === projectId && typeof caps.environmentKey === 'string' && !!caps.environmentKey && caps.target && Object.keys(caps.target).every(key => keys.includes(key as typeof keys[number])) && keys.every(key => (caps.target[key] ?? undefined) === query[key]);
        const expected = currentDeployment?.environmentKey || prepPendingRef.current?.environmentKey || pendingRef.current?.environmentKey || environmentAnchor.current;
        if (!matching || (expected && expected !== caps.environmentKey)) { setCapsSnapshot(null); return; }
        environmentAnchor.current = caps.environmentKey;
        setCapsSnapshot({ scope: capsScope, sequence: seq, value: caps });
      }).catch(() => { if (valid()) setCapsSnapshot(null); });
    return () => { ++capsSequence.current; controller.abort(); };
  }, [capsScope, projectId, accountId]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = epoch.current;
    let active = true;
    const sequence = ++packageSequence.current;
    setPackageDetail(null); setPackageManifest(null); setPackageValidations([]);
    if (projectId && selectedPackageId) {
      const path = { projectId, packageId: selectedPackageId };
      Promise.all([
        getDeployxPackageDetail({ path, signal: controller.signal }).then(unwrap),
        getDeployxPackageManifest({ path, signal: controller.signal }).then(unwrap),
        getDeployxPackageValidation({ path, signal: controller.signal }).then(unwrap),
      ]).then(([detail, manifest, validations]) => {
        if (!active || sequence !== packageSequence.current || generation !== epoch.current || projectId !== currentProject.current || accountId !== currentAccount.current) return;
        setPackageDetail(detail); setPackageManifest(manifest); setPackageValidations(validations.reports);
      }).catch(error => { if (active && sequence === packageSequence.current && generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) setActionError(deployxError(error)); });
    }
    return () => { active = false; controller.abort(); };
  }, [projectId, selectedPackageId]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = epoch.current;
    let active = true;
    const sequence = ++robotSequence.current;
    setRobotStatus(null);
    if (projectId && selectedRobotId) getDeployxRobotStatus({ path: { projectId, robotId: selectedRobotId }, signal: controller.signal }).then(unwrap).then(data => {
      if (active && sequence === robotSequence.current && generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) setRobotStatus(data);
    }).catch(error => { if (active && sequence === robotSequence.current && generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) setActionError(deployxError(error)); });
    return () => { active = false; controller.abort(); };
  }, [projectId, selectedRobotId]);

  useEffect(() => {
    if (!currentDeployment || !needsDeploymentPoll(currentDeployment)) return;
    const id = currentDeployment.deploymentId;
    if (pollBudget.current.id !== id) pollBudget.current = { id, count: 0 };
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(currentDeployment.status || '');
    const unresolvedOperation = isPending(currentDeployment.submitStatus) || currentDeployment.operations.some(o => isPending(o.submitStatus));
    const limit = unresolvedOperation || currentDeployment.relatedStops.length > 0 ? 15 : 3;
    const timer = setInterval(() => {
      if ((terminal || unresolvedOperation) && pollBudget.current.count >= limit) {
        clearInterval(timer);
        setActionError(old => old || '状态仍待确认，已暂停自动查询，请刷新页面继续核查。');
        return;
      }
      pollBudget.current.count++;
      void refreshDeployment(id);
    }, pollBudget.current.count < 5 ? 4000 : 15000);
    return () => clearInterval(timer);
  }, [currentDeployment, refreshDeployment]);

  useEffect(() => {
    if (!projectId || !pending || pending.intent || currentDeployment) return;
    const generation = epoch.current;
    let active = true;
    let reads = 0;
    const timer = setInterval(() => {
      if (++reads > 15) { clearInterval(timer); setActionError(old => old || '提交结果仍待确认，请刷新页面继续核查。'); return; }
      void listDeployxDeployments({ path: { projectId } }).then(unwrap).then(async list => {
        if (!active || generation !== epoch.current || projectId !== currentProject.current || accountId !== currentAccount.current) return;
        const d = list.items.find(item => item.operations.some(o => o.operationId === pending.key || o.idempotencyKey === pending.key));
        if (d) { selectedDeployment.current = d.deploymentId; await refreshDeployment(d.deploymentId, generation); }
      }).catch(error => { if (active && generation === epoch.current) setActionError(deployxError(error)); });
    }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [projectId, pending, currentDeployment, refreshDeployment]);

  const contextReady = stateScope === `${accountId}:${projectId}` && Boolean(accountId);
  const deploymentDecision = deploymentControls(
    contextReady ? currentDeployment : null,
    contextReady ? resources?.capabilities : undefined,
    actionLoading || restoring || Boolean(pending) || !contextReady,
    contextReady ? localCapabilities : null,
  );
  const prepUnresolved = prepLoading || Boolean(prepPending);
  const controls = { ...deploymentDecision, create: !prepUnresolved && deploymentDecision.create && Boolean(selectedRobotId && selectedPackageId && selectedTemplateId), build: !prepUnresolved && deploymentDecision.build, deploy: !prepUnresolved && deploymentDecision.deploy };
  const stage2Passed = stage2ValidationPassed(packageValidations, selectedPackageId, selectedRobotId);
  const prepDecision = preparationControls(
    contextReady ? localCapabilities : null,
    contextReady ? resources?.capabilities : undefined,
    prepLoading || actionLoading || restoring || Boolean(prepPending) || Boolean(pending) || !contextReady,
  );
  const prepControls = {
    ...prepDecision,
    unpack: prepDecision.unpack && Boolean(selectedPackageId),
    validateStage1: prepDecision.validateStage1 && Boolean(selectedPackageId && packageManifest?.packageId === selectedPackageId),
    validateStage2: prepDecision.validateStage2 && Boolean(selectedPackageId && selectedRobotId),
    prepare: prepDecision.prepare && Boolean(selectedRobotId),
  };

  const withWriteLock = async (work: () => Promise<void>) => {
    if (!projectId || !accountId) return;
    const generation = epoch.current, sequence = capsSequence.current;
    if (!navigator.locks) { setActionError('浏览器不支持跨标签页安全锁，暂不能提交。'); return; }
    try { await navigator.locks.request(`deployx:prep:${accountId}:${projectId}`, { ifAvailable: true }, async lock => {
      if (generation !== epoch.current || projectId !== currentProject.current || accountId !== currentAccount.current || sequence !== capsSequence.current) return;
      if (!lock) { setActionError('另一个页面正在提交，请等待并核查结果。'); return; }
      const existing = readPointer(projectId, accountId, true);
      if (existing) { prepPendingRef.current = existing; setPrepPending(existing); setActionError('已有未决准备操作，请先核查原操作。'); return; }
      await work();
    }); } catch {
      if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) setActionError('无法取得跨标签页安全锁，暂不能提交。');
    }
  };

  const runWriteUnlocked = async (kind: string, send: (key: string, acknowledge: (operation: { submitStatus: string }) => void) => Promise<DeployxDeploymentResponse | null>) => {
    if (!projectId || !accountId || accountId !== currentAccount.current || !capsSnapshot || capsSnapshot.sequence !== capsSequence.current || inFlight.current || pendingRef.current || (kind === 'CREATE_DEPLOYMENT' && selectedDeployment.current)) return;
    if (['CREATE_DEPLOYMENT', 'BUILD_RELEASE', 'DEPLOY_TO_ROBOT'].includes(kind) && (prepInFlight.current || prepPendingRef.current || readPointer(projectId, accountId, true))) return;
    const stored = readPointer(projectId, accountId);
    if (stored) { pendingRef.current = stored; setPending(stored); setActionError('已有未决部署操作，请先核查原操作。'); return; }
    inFlight.current = true;
    pollBudget.current.count = 0;
    const generation = epoch.current;
    ++requestSequence.current;
    const pointer = { kind, key: crypto.randomUUID(), deploymentId: currentDeployment?.deploymentId || null };
    if (!savePending(pointer)) {
      pendingRef.current = null; setPending(null); inFlight.current = false;
      setActionError('浏览器存储不可用，暂不能提交操作。');
      return;
    }
    setActionLoading(true); setActionError(null);
    try {
      const result = await send(pointer.key, operation => {
        if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current && !isPending(operation.submitStatus)) savePending(null);
      });
      if (generation !== epoch.current || projectId !== currentProject.current || accountId !== currentAccount.current) return;
      if (result) { selectedDeployment.current = result.deploymentId; setRobotLogs(''); applyDeployment(result); }
      const id = result?.deploymentId || pointer.deploymentId;
      if (id) await refreshDeployment(id, generation);
    } catch (error) {
      if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) {
        setActionError(deployxError(error));
        const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const classification = `${status}:${code}`;
        const rejection = kind === 'CREATE_DEPLOYMENT'
          ? ['400:INVALID_INTENT', '400:PRODUCTION_INTENT_UNSUPPORTED', '404:MODEL_ASSET_NOT_FOUND', '409:ROBOT_SAFETY_BLOCKED', '503:PRODUCTION_TASK_EXECUTOR_UNAVAILABLE']
          : ['BUILD_RELEASE', 'DEPLOY_TO_ROBOT'].includes(kind)
          ? ['400:INVALID_INPUT', '404:TASK_NOT_FOUND', '409:IDEMPOTENCY_KEY_REUSED', '409:TASK_REVISION_MISMATCH', '409:STAGE_ACTION_NOT_AVAILABLE', '400:STAGE_PREREQUISITE_FAILED', '503:PRODUCTION_TASK_EXECUTOR_UNAVAILABLE']
          : ['400:INVALID_INPUT', '403:ACTOR_MISMATCH'];
        if (['401:UNAUTHENTICATED', '403:FORBIDDEN', ...rejection].includes(classification)) savePending(null);
        if (pointer.deploymentId) await refreshDeployment(pointer.deploymentId, generation);
      }
    } finally {
      if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) { inFlight.current = false; setActionLoading(false); }
    }
  };

  const runWrite = (kind: string, send: (key: string, acknowledge: (operation: { submitStatus: string }) => void) => Promise<DeployxDeploymentResponse | null>) => ['CREATE_DEPLOYMENT', 'BUILD_RELEASE', 'DEPLOY_TO_ROBOT'].includes(kind) ? withWriteLock(() => runWriteUnlocked(kind, send)) : runWriteUnlocked(kind, send);

  const handleCreateDeployment = async () => {
    if (!controls.create || !projectId || !selectedRobotId || !selectedPackageId || !selectedTemplateId) return;
    const body = { robotId: selectedRobotId, packageId: selectedPackageId, templateId: selectedTemplateId, ...(selectedModelAssetId ? { modelAssetId: selectedModelAssetId } : {}) };
    await runWrite('CREATE_DEPLOYMENT', async key => unwrap(await createDeployxDeployment({ path: { projectId }, body: { ...body, idempotencyKey: key } })));
  };

  const confirmStage = async (action: 'BUILD_RELEASE' | 'DEPLOY_TO_ROBOT') => {
    if (!projectId || !currentDeployment || currentDeployment.version === null || !(action === 'BUILD_RELEASE' ? controls.build : controls.deploy)) return;
    const path = { projectId, deploymentId: currentDeployment.deploymentId };
    const revision = currentDeployment.version;
    await runWrite(action, async key => unwrap(await triggerDeployxDeploymentAction({ path, body: { action, expectedTaskRevision: revision, idempotencyKey: key } })));
  };

  const handleStop = async () => {
    if (!controls.stop || !projectId || !currentDeployment) return;
    await runWrite('STOP', async (key, acknowledge) => { const response = unwrap(await stopDeployxDeployment({ path: { projectId, deploymentId: currentDeployment.deploymentId }, headers: { 'Idempotency-Key': key }, body: { reason: 'User requested safety stop' } })); acknowledge(response.operation); return null; });
  };

  const handleCancel = async () => {
    if (!controls.cancel || !projectId || !currentDeployment) return;
    await runWrite('CANCEL', async (key, acknowledge) => {
      const result = unwrap(await cancelDeployxDeployment({ path: { projectId, deploymentId: currentDeployment.deploymentId }, headers: { 'Idempotency-Key': key }, body: { reason: 'User requested cancellation' } }));
      acknowledge(result.operation);
      return 'deployment' in result ? result.deployment : null;
    });
  };

  const handleRecover = async () => {
    if (!controls.recover || !projectId || !currentDeployment) return;
    await runWrite('RECOVER', async (key, acknowledge) => {
      const result = unwrap(await recoverDeployxDeployment({ path: { projectId, deploymentId: currentDeployment.deploymentId }, headers: { 'Idempotency-Key': key }, body: {} }));
      acknowledge(result.operation);
      return 'task' in result ? result.task : null;
    });
  };

  const handleFetchLogs = async () => {
    if (!controls.logs || !projectId || !currentDeployment) return;
    const generation = epoch.current, id = currentDeployment.deploymentId;
    setLogsLoading(true);
    try {
      const result = unwrap(await getDeployxDeploymentRobotLogs({ path: { projectId, deploymentId: id }, query: { lines: 200 } }));
      if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current && selectedDeployment.current === id) setRobotLogs(result.content);
    } catch (error) { if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) setActionError(deployxError(error)); }
    finally { if (generation === epoch.current && projectId === currentProject.current && accountId === currentAccount.current) setLogsLoading(false); }
  };

  const handleRestart = () => {
    if (!controls.restart || inFlight.current || pendingRef.current) return;
    ++epoch.current; ++requestSequence.current;
    selectedDeployment.current = null; setCurrentDeployment(null); setRobotLogs(''); setActionError(null);
    setPackageDetail(null); setPackageManifest(null); setPackageValidations([]); setRobotStatus(null);
    setSelectedPackageId(null); setSelectedModelAssetId(null); setSelectedRobotId(null); setSelectedTemplateId(null);
  };

  const prepScopeRef = useRef(capsScope);
  prepScopeRef.current = capsScope;

  // Observe the same operation key and then the authorised business resource. SUBMITTED is acceptance only.
  const observePreparation = (pointer: PendingPointer, generation: number, scope: string) => {
    if (!projectId || !accountId || !pointer.environmentKey || !pointer.intent) return;
    const version = prepVersion.current;
    const valid = () => generation === epoch.current && version === prepVersion.current && projectId === currentProject.current && accountId === currentAccount.current && scope === prepScopeRef.current;
    let attempts = 0, reading = false;
    const interval = setInterval(async () => {
      if (reading) return;
      if (!valid() || ++attempts > 15) {
        clearInterval(interval); activePrepTimers.current.delete(interval);
        if (valid()) setActionError('业务状态仍待确认，已暂停查询，请刷新继续核查。');
        return;
      }
      reading = true;
      try {
        const op = unwrap(await getDeployxPreparationOperation({ path: { projectId, operationId: pointer.key } }));
        if (!valid()) return;
        if (op.operationId !== pointer.key || op.projectId !== projectId || op.environmentKey !== pointer.environmentKey || op.operationType !== pointer.kind) throw new Error('准备操作上下文不匹配');
        setPreparationOperations(prev => ({ ...prev, [op.operationId]: op }));
        if (op.submitStatus === 'FAILED') {
          const result = await clearPrepPending(pointer, valid);
          if (!valid() || result === 'busy' || result === 'error' || result === 'stale') return;
          clearInterval(interval); activePrepTimers.current.delete(interval);
          if (result === 'updated') setActionError('准备操作失败，请核查后重新确认。');
          return;
        }
        if (op.submitStatus !== 'SUBMITTED') return;
        const pkg = String(pointer.intent?.packageId || op.resourceId || '');
        const robot = String(pointer.intent?.robotId || '');
        let done = false;
        let adopt: (() => void) | undefined;
        if (pointer.kind === 'UPLOAD_PACKAGE' || pointer.kind === 'UPLOAD_MODEL') {
          const res = unwrap(await listDeployxProjectResources({ path: { projectId } }));
          if (!valid()) return;
          const allowed = pointer.kind === 'UPLOAD_PACKAGE' ? res.packages.some(item => item.id === op.resourceId) : res.modelAssets.some(item => item.id === op.resourceId);
          if (allowed && op.resourceId) {
            const resourceId = op.resourceId;
            adopt = () => {
              setResources(res);
              if (pointer.kind === 'UPLOAD_PACKAGE') setSelectedPackageId(resourceId);
              else setSelectedModelAssetId(resourceId);
            };
            done = true;
          }
        } else if (pointer.kind === 'UNPACK' && pkg) {
          const detail = unwrap(await getDeployxPackageDetail({ path: { projectId, packageId: pkg } }));
          if (!valid()) return;
          setPackageDetail(detail);
          if (['UNPACKED', 'VALIDATING', 'VALIDATED', 'VALIDATION_FAILED'].includes(detail.status)) {
            const manifest = unwrap(await getDeployxPackageManifest({ path: { projectId, packageId: pkg } }));
            if (!valid()) return;
            if (manifest.packageId === pkg) { setPackageManifest(manifest); done = true; }
          } else if (['UNPACK_FAILED', 'REJECTED'].includes(detail.status)) {
            setActionError('解包失败，请核查算法包。'); done = true;
          }
        } else if ((pointer.kind === 'VALIDATE_STAGE1' || pointer.kind === 'VALIDATE_STAGE2') && pkg) {
          const val = unwrap(await getDeployxPackageValidation({ path: { projectId, packageId: pkg } }));
          if (!valid()) return;
          setPackageValidations(val.reports);
          const matching = val.reports.filter(r => r.packageId === pkg && r.stage === (pointer.kind === 'VALIDATE_STAGE1' ? 'stage1' : 'stage2') && (pointer.kind !== 'VALIDATE_STAGE2' || r.robotId === robot) && !String(pointer.intent?.existingReports || '').split(',').includes(`${r.id}:${r.status}`));
          done = matching.some(r => r.status === 'PASSED' || r.status === 'FAILED');
          if (matching.some(r => r.status === 'FAILED')) setActionError('校验失败，请查看报告。');
        } else if (pointer.kind === 'PREPARE' && robot) {
          const status = unwrap(await getDeployxRobotStatus({ path: { projectId, robotId: robot } }));
          if (!valid()) return;
          if (status.robotId === robot) setRobotStatus(status);
          // The response has no approved prepare-completion fact; keep observing within the budget.
        }
        if (done) {
          const result = await clearPrepPending(pointer, valid, adopt);
          if (!valid() || result === 'busy' || result === 'error' || result === 'stale') return;
          clearInterval(interval); activePrepTimers.current.delete(interval);
        }
      } catch (error) { if (valid()) setActionError(deployxError(error)); }
      finally { reading = false; }
    }, 2000);
    activePrepTimers.current.add(interval);
  };

  useEffect(() => {
    const pointer = prepPending?.intent ? prepPending : null;
    if (!pointer?.intent || pointer.intent.scope !== capsScope || !pointer.environmentKey || !localCapabilities || localCapabilities.environmentKey !== pointer.environmentKey) return;
    const generation = epoch.current;
    observePreparation(pointer, generation, capsScope);
    return () => { activePrepTimers.current.forEach(clearInterval); activePrepTimers.current.clear(); };
  }, [prepPending?.key, capsScope, localCapabilities?.environmentKey]);

  const runPreparationUnlocked = async (kind: string, intent: Record<string, string | number | null>, send: (key: string, signal: AbortSignal) => Promise<PreparationOperation>) => {
    if (!projectId || !accountId || accountId !== currentAccount.current || !localCapabilities || capsSnapshot?.sequence !== capsSequence.current || !environmentAnchor.current || prepInFlight.current || prepPendingRef.current) return;
    const generation = epoch.current, scope = capsScope;
    const version = prepVersion.current;
    const valid = () => generation === epoch.current && version === prepVersion.current && projectId === currentProject.current && accountId === currentAccount.current && scope === prepScopeRef.current;
    const pointer: PendingPointer = { key: crypto.randomUUID(), kind, deploymentId: null, environmentKey: localCapabilities.environmentKey, intent: { ...intent, scope } };
    prepInFlight.current = true;
    if (compareAndSetPrep(null, pointer) !== 'updated') { prepInFlight.current = false; return; }
    const controller = new AbortController();
    uploadAbort.current = controller;
    setPrepLoading(true); setActionError(null);
    try {
      const op = await send(pointer.key, controller.signal);
      if (!valid()) return;
      if (op.operationId !== pointer.key || op.projectId !== projectId || op.environmentKey !== pointer.environmentKey || op.operationType !== kind) throw new Error('准备操作响应上下文不匹配');
      setPreparationOperations(prev => ({ ...prev, [op.operationId]: op }));
      if (kind.startsWith('UPLOAD')) setUploadStatus(`平台已返回 ${op.submitStatus}；业务完成仍待确认。`);
      // Keep pointer until the preparation GET observes a definitive status.
    } catch (error) {
      if (!valid()) return;
      setActionError(controller.signal.aborted ? '传输已取消；远端结果未知，请勿重复提交，系统将按原操作查询。' : deployxError(error));
      if (kind.startsWith('UPLOAD')) setUploadStatus('传输中断，远端结果待核查。');
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if ([401, 403, 413, 415].includes(status) || (status === 400 && code === 'INVALID_REQUEST') || (status === 503 && code === 'DEPLOYX_CAPABILITY_UNAVAILABLE')) compareAndSetPrep(pointer, null);
    } finally {
      if (valid()) { if (uploadAbort.current === controller) uploadAbort.current = null; prepInFlight.current = false; setPrepLoading(false); }
    }
  };

  const runPreparation = (kind: string, intent: Record<string, string | number | null>, send: (key: string, signal: AbortSignal) => Promise<PreparationOperation>) => withWriteLock(() => runPreparationUnlocked(kind, intent, send));

  const upload = async (file: File, kind: 'UPLOAD_PACKAGE' | 'UPLOAD_MODEL') => {
    if (!projectId || !(kind === 'UPLOAD_PACKAGE' ? prepControls.uploadPackage : prepControls.uploadModel)) return;
    if (!(kind === 'UPLOAD_PACKAGE' ? /\.zip$/i : /\.tar$/i).test(file.name) || file.name.length > 255 || /[\\/:\x00-\x1f]/.test(file.name) || !file.size) { setActionError('请选择非空且名称有效的 ZIP 或 TAR 文件。'); return; }
    if (/[^\x20-\xff]/.test(file.name)) { setActionError('浏览器无法在文件名请求头中发送该名称，请先使用英文文件名。'); return; }
    setUploadStatus('准备传输文件…');
    const scope = capsScope;
    await runPreparation(kind, { filename: file.name, sizeBytes: file.size, lastModified: file.lastModified }, (key, signal) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/deployx/${kind === 'UPLOAD_PACKAGE' ? 'packages' : 'model-assets'}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Idempotency-Key', key); xhr.setRequestHeader('X-Filename', file.name); xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = event => { if (!signal.aborted && scope === prepScopeRef.current && event.lengthComputable) setUploadStatus(`已发送 ${event.loaded} / ${event.total} 字节，等待平台受理。`); };
      xhr.onload = () => { let body: any; try { body = JSON.parse(xhr.responseText); } catch { body = null; } if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body); else { const error = new Error(body?.error?.message || `上传失败 (${xhr.status})`) as Error & { status: number; code?: string }; error.status = xhr.status; error.code = body?.error?.code; reject(error); } };
      xhr.onerror = () => reject(new Error('连接中断，提交结果未知。'));
      xhr.onabort = () => reject(new Error('传输已取消，提交结果未知。'));
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(file);
    }));
  };
  const handleUploadPackage = (file: File) => upload(file, 'UPLOAD_PACKAGE');
  const handleUploadModelAsset = (file: File) => upload(file, 'UPLOAD_MODEL');
  const handleCancelUpload = () => uploadAbort.current?.abort();
  const handleUnpackPackage = async (packageId = selectedPackageId) => {
    if (!projectId || !packageId || packageId !== selectedPackageId || !prepControls.unpack || packageDetail?.id !== packageId || packageDetail.status !== 'UPLOADED') return;
    await runPreparation('UNPACK', { packageId }, async (key, signal) => unwrap(await unpackDeployxPackage({ path: { projectId, packageId }, headers: { 'Idempotency-Key': key }, body: {}, signal })));
  };
  const handleValidateStage1 = async (packageId = selectedPackageId) => {
    if (!projectId || !packageId || packageId !== selectedPackageId || packageManifest?.packageId !== packageId || !prepControls.validateStage1) return;
    await runPreparation('VALIDATE_STAGE1', { packageId, existingReports: packageValidations.map(r => `${r.id}:${r.status}`).join(',') }, async (key, signal) => unwrap(await validateDeployxStage1({ path: { projectId, packageId }, headers: { 'Idempotency-Key': key }, body: {}, signal })));
  };
  const handleValidateStage2 = async (robotId = selectedRobotId, packageId = selectedPackageId) => {
    if (!projectId || !packageId || packageId !== selectedPackageId || !robotId || robotId !== selectedRobotId || !prepControls.validateStage2) return;
    await runPreparation('VALIDATE_STAGE2', { packageId, robotId, existingReports: packageValidations.map(r => `${r.id}:${r.status}`).join(',') }, async (key, signal) => unwrap(await validateDeployxStage2({ path: { projectId, packageId }, headers: { 'Idempotency-Key': key }, body: { robotId }, signal })));
  };
  // No trusted approved-binding record source is available yet.
  const handleBindRobot = async (_robotId?: string, _approvedBindingId?: string, _bindingVersion?: string | number) => {};
  const handlePrepareRobot = async (robotId = selectedRobotId) => {
    if (!projectId || !robotId || robotId !== selectedRobotId || !prepControls.prepare) return;
    await runPreparation('PREPARE', { robotId }, async (key, signal) => unwrap(await prepareDeployxRobot({ path: { projectId, robotId }, headers: { 'Idempotency-Key': key }, body: { confirm: true }, signal })));
  };

  const invalidatePreparationTarget = () => {
    ++prepVersion.current; ++capsSequence.current;
    if (uploadAbort.current) { uploadAbort.current.abort(); uploadAbort.current = null; prepInFlight.current = false; setPrepLoading(false); }
    activePrepTimers.current.forEach(clearInterval); activePrepTimers.current.clear();
    setUploadStatus(null);
  };

  return {
    resources: contextReady ? resources : null, resourcesLoading, resourcesError,
    localCapabilities: contextReady ? localCapabilities : null,
    selectedPackageId, setSelectedPackageId: (id: string) => {
      if (id === selectedPackageId) return; invalidatePreparationTarget(); ++packageSequence.current; setPackageDetail(null); setPackageManifest(null); setPackageValidations([]); setSelectedPackageId(id);
    }, selectedModelAssetId, setSelectedModelAssetId: (id: string | null) => { if (id === selectedModelAssetId) return; invalidatePreparationTarget(); setSelectedModelAssetId(id); },
    selectedRobotId, setSelectedRobotId: (id: string) => {
      if (id === selectedRobotId) return; invalidatePreparationTarget(); ++robotSequence.current; setRobotStatus(null); setSelectedRobotId(id);
      setSelectedTemplateId(resources?.robots.find(robot => robot.id === id)?.templateId || null);
    }, selectedTemplateId, setSelectedTemplateId: (id: string) => { if (id === selectedTemplateId) return; invalidatePreparationTarget(); setSelectedTemplateId(id); },
    packageDetail: contextReady ? packageDetail : null, packageManifest: contextReady ? packageManifest : null,
    packageValidations: contextReady ? packageValidations : [], robotStatus: contextReady ? robotStatus : null,
    currentDeployment: contextReady ? currentDeployment : null,
    actionLoading, prepLoading, actionError, robotLogs, logsLoading, controls, prepControls, pending: pending || prepPending,
    stage2ValidationPassed: stage2Passed,
    uploadStatus, preparationOperations,
    handleCreateDeployment, handleConfirmBuild: () => confirmStage('BUILD_RELEASE'),
    handleConfirmDeploy: () => confirmStage('DEPLOY_TO_ROBOT'), handleStop, handleCancel,
    handleRecover, handleFetchLogs, handleRestart,
    handleUploadPackage, handleUploadModelAsset, handleCancelUpload, handleUnpackPackage,
    handleValidateStage1, handleValidateStage2, handleBindRobot, handlePrepareRobot,
  };
}
