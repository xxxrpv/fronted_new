/**
 * 封装非标页面的同源 API 请求与错误处理。
 * GLB 经平台转发并在渲染前核验哈希，浏览器不直接连接 Windows 服务。
 */
import {
  getEquipmentLocalPreview,
  createEquipmentBatch,
  createEquipmentRevision,
  createProjectEquipmentUeLoad,
  getEquipmentArtifactAccess,
  getEquipmentArtifactContent,
  getEquipmentBatch,
  getEquipmentOperation,
  getProjectEquipmentUeLoad,
  getProjectEquipmentUeRuntime,
  getProjectEquipmentUeViewerAccess,
  listEquipmentBatches,
  listEquipmentOperations,
  listProjectEquipmentUeLoads,
  selectEquipmentAlternative,
} from '../api';
import type {
  EquipmentAlternativeId,
  EquipmentBatchDetail,
  EquipmentBatchId,
  EquipmentBatchListResponse,
  EquipmentConceptParameters,
  EquipmentIdempotencyKey,
  EquipmentOperationDetail,
  EquipmentOperationListResponse,
  EquipmentOperationReceipt,
  PlatformId,
  ProjectEquipmentUeDetail,
  ProjectEquipmentUeList,
  ProjectEquipmentUeReceipt,
  ProjectEquipmentUeRuntime,
  ProjectEquipmentUeViewerAccess,
} from './types';

export class EquipmentApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status?: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'EquipmentApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function extractErrorMessage(error: any, fallbackMessage: string): string {
  if (!error) return fallbackMessage;
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.error?.message) return error.error.message;
  if (error.error?.code) return `${error.error.code}: ${fallbackMessage}`;
  return fallbackMessage;
}

/**
 * 统一校验 SDK 请求结果并安全解析错误
 * 保留真实 HTTP 状态码 (res.response.status) 与 AbortError 取消语义
 */
function checkServiceResult<T>(
  res: { data?: T; error?: any; response?: Response; status?: number },
  fallbackMessage: string,
  signal?: AbortSignal
): T {
  if (signal?.aborted) {
    if (res.error instanceof Error) throw res.error;
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  if (res.error && (res.error.name === 'AbortError' || res.error instanceof DOMException)) {
    throw res.error;
  }

  if (res.error || res.data === undefined) {
    const status = res.response?.status ?? (res as any).status;
    const msg = extractErrorMessage(res.error, fallbackMessage);
    const code = (res.error as any)?.error?.code || (res.error as any)?.code;
    throw new EquipmentApiError(msg, status, code, res.error);
  }

  return res.data;
}

/**
 * 1. 创建批次生成 5 方案
 */
export async function createBatch(
  projectId: PlatformId,
  idempotencyKey: EquipmentIdempotencyKey,
  requirement: string,
  parameters: EquipmentConceptParameters,
  signal?: AbortSignal
): Promise<EquipmentOperationReceipt> {
  const res = await createEquipmentBatch({
    path: { projectId },
    body: {
      idempotencyKey,
      requirement,
      parameters,
    },
    signal,
  });

  return checkServiceResult(res, '发起方案生成失败', signal);
}

/**
 * 2. 修订生成新批次
 */
export async function createRevision(
  projectId: PlatformId,
  batchId: EquipmentBatchId,
  sourceAlternativeId: EquipmentAlternativeId,
  idempotencyKey: EquipmentIdempotencyKey,
  requirement: string,
  parameters: EquipmentConceptParameters,
  signal?: AbortSignal
): Promise<EquipmentOperationReceipt> {
  const res = await createEquipmentRevision({
    path: { projectId, batchId },
    body: {
      idempotencyKey,
      sourceAlternativeId,
      requirement,
      parameters,
    },
    signal,
  });

  return checkServiceResult(res, '按当前参数生成修改版失败', signal);
}

/**
 * 3. 选型并启动 SolidWorks 异步建模
 */
export async function selectAlternative(
  projectId: PlatformId,
  batchId: EquipmentBatchId,
  alternativeId: EquipmentAlternativeId,
  idempotencyKey: EquipmentIdempotencyKey,
  signal?: AbortSignal
): Promise<EquipmentOperationReceipt> {
  const res = await selectEquipmentAlternative({
    path: { projectId, batchId },
    body: {
      idempotencyKey,
      alternativeId,
    },
    signal,
  });

  return checkServiceResult(res, '选择方案并导入 SolidWorks 失败', signal);
}

/**
 * 4. 获取批次详情（默认读取持久快照，显式刷新才传 refresh=true）
 */
export async function fetchBatchDetail(
  projectId: PlatformId,
  batchId: EquipmentBatchId,
  refresh: boolean = false,
  signal?: AbortSignal
): Promise<EquipmentBatchDetail> {
  const res = await getEquipmentBatch({
    path: { projectId, batchId },
    query: refresh ? { refresh: true } : undefined,
    signal,
  });

  return checkServiceResult(res, '获取设备方案详情失败', signal);
}

/**
 * 5. 轮询或恢复操作状态
 */
export async function fetchOperationDetail(
  projectId: PlatformId,
  operationId: PlatformId,
  signal?: AbortSignal
): Promise<EquipmentOperationDetail> {
  const res = await getEquipmentOperation({
    path: { projectId, operationId },
    signal,
  });

  return checkServiceResult(res, '获取建模操作进度失败', signal);
}

/**
 * 6. 分页查询批次历史
 */
export async function fetchBatchList(
  projectId: PlatformId,
  cursor?: string | null,
  limit: number = 20,
  signal?: AbortSignal
): Promise<EquipmentBatchListResponse> {
  const res = await listEquipmentBatches({
    path: { projectId },
    query: cursor ? { cursor, limit } : { limit },
    signal,
  });

  return checkServiceResult(res, '加载设备方案批次列表失败', signal);
}

/**
 * 7. 分页查询持久操作记录（含 batchId=null 的操作，用于未知提交恢复）
 */
export async function fetchOperationList(
  projectId: PlatformId,
  cursor?: string | null,
  limit: number = 20,
  signal?: AbortSignal
): Promise<EquipmentOperationListResponse> {
  const res = await listEquipmentOperations({
    path: { projectId },
    query: cursor ? { cursor, limit } : { limit },
    signal,
  });

  return checkServiceResult(res, '加载操作记录历史失败', signal);
}

/**
 * 8. 获取受控二进制流（GLB 渲染或文件下载）
 */
export async function fetchArtifactBinary(
  projectId: PlatformId,
  batchId: EquipmentBatchId,
  entryId: string,
  parseAs: 'arrayBuffer' | 'blob' = 'arrayBuffer',
  signal?: AbortSignal
): Promise<ArrayBuffer | Blob> {
  const res = await getEquipmentArtifactContent({
    path: { projectId, batchId, entryId },
    parseAs,
    signal,
  });

  return checkServiceResult(res, '下载产物文件内容失败', signal) as ArrayBuffer | Blob;
}

/**
 * 9. 获取短时下载授权（只读复用能力）
 */
export async function fetchArtifactAccess(
  projectId: PlatformId,
  batchId: EquipmentBatchId,
  entryId: string,
  signal?: AbortSignal
) {
  const res = await getEquipmentArtifactAccess({
    path: { projectId, batchId, entryId },
    signal,
  });

  return checkServiceResult(res, '获取产物授权失败', signal);
}

/**
 * 10. 获取 UE 运行时槽状态及当前 revision
 */
export async function fetchEquipmentUeRuntime(
  projectId: PlatformId,
  signal?: AbortSignal
): Promise<ProjectEquipmentUeRuntime> {
  const res = await getProjectEquipmentUeRuntime({
    path: { projectId },
    signal,
  });

  return checkServiceResult(res, '获取 UE 运行时槽状态失败', signal);
}

/**
 * 11. 发起非标自动化设备方案的 UE 静态装载
 */
export async function createEquipmentUeLoad(
  projectId: PlatformId,
  batchId: EquipmentBatchId,
  alternativeId: EquipmentAlternativeId,
  idempotencyKey: EquipmentIdempotencyKey,
  expectedRuntimeRevision: string,
  signal?: AbortSignal
): Promise<ProjectEquipmentUeReceipt> {
  const res = await createProjectEquipmentUeLoad({
    path: { projectId, batchId },
    body: {
      alternativeId,
      idempotencyKey,
      expectedRuntimeRevision,
    },
    signal,
  });

  return checkServiceResult(res, '发起设备 UE 静态装载失败', signal);
}

/**
 * 12. 查询项目的 UE 装载历史记录（支持分页和未知提交状态恢复）
 */
export async function fetchEquipmentUeLoads(
  projectId: PlatformId,
  cursor?: string | null,
  limit: number = 20,
  signal?: AbortSignal
): Promise<ProjectEquipmentUeList> {
  const res = await listProjectEquipmentUeLoads({
    path: { projectId },
    query: cursor ? { cursor, limit } : { limit },
    signal,
  });

  return checkServiceResult(res, '获取 UE 装载历史记录失败', signal);
}

/**
 * 13. 获取 UE 装载操作实时进度及可信状态
 */
export async function fetchEquipmentUeLoadDetail(
  projectId: PlatformId,
  operationId: PlatformId,
  signal?: AbortSignal
): Promise<ProjectEquipmentUeDetail> {
  const res = await getProjectEquipmentUeLoad({
    path: { projectId, operationId },
    signal,
  });

  return checkServiceResult(res, '获取 UE 装载详情失败', signal);
}

/**
 * 14. 申请受控观看凭据（安全单操作者/认证网关播放器入口）
 */
export async function fetchEquipmentUeViewerAccess(
  projectId: PlatformId,
  operationId: PlatformId,
  signal?: AbortSignal
): Promise<ProjectEquipmentUeViewerAccess> {
  const res = await getProjectEquipmentUeViewerAccess({
    path: { projectId, operationId },
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
  });

  return checkServiceResult(res, '获取 UE 观看入口失败', signal);
}


/** 从平台同源接口获取 Windows GLB；不把内部服务地址或 Token 暴露给浏览器。 */
export async function fetchLocalPreview(projectId: string, batchId: string, alternativeId: string,
  parseAs: 'arrayBuffer' | 'blob' = 'arrayBuffer', signal?: AbortSignal, expectedSha256?: string | null): Promise<ArrayBuffer | Blob> {
  const res = await getEquipmentLocalPreview({
    path: { projectId, batchId, alternativeId }, parseAs: 'arrayBuffer', signal,
  });
  const data: unknown = checkServiceResult(res, '读取本地预览模型失败', signal);
  if (!(data instanceof ArrayBuffer)) throw new EquipmentApiError('预览服务未返回二进制模型。');
  // 在渲染前完成整文件校验，不能只依赖服务端已发送部分数据后的哈希检查。
  if (expectedSha256) {
    const digest = await crypto.subtle.digest('SHA-256', data);
    const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedSha256) throw new EquipmentApiError('预览文件与所选方案不一致，请刷新批次。');
  }
  return parseAs === 'blob' ? new Blob([data], { type: 'model/gltf-binary' }) : data;
}
