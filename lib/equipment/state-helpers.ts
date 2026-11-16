import type {
  EquipmentAlternative,
  EquipmentBatchStatus,
  EquipmentFileReceipt,
  EquipmentOperationDetail,
  EquipmentOperationReceipt,
  EquipmentOperationStatus,
  EquipmentSubmissionState,
} from './types';

/**
 * 格式化时间戳展示
 */
export function formatEquipmentTimestamp(timestamp?: string | null): string {
  if (!timestamp) return '未知时间';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return timestamp;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export interface OperationStatusDisplay {
  label: string;
  description: string;
  tone: 'info' | 'success' | 'warning' | 'error' | 'pending';
  isTerminal: boolean;
  canRetry: boolean;
  needsAttention: boolean;
}

/**
 * 操作状态映射（严格区分 batch status, operation status, submissionState, operation kind 与 file status）
 */
export function getOperationStatusDisplay(
  status: EquipmentOperationStatus | null | undefined,
  submissionState?: EquipmentSubmissionState,
  kind?: 'generate_alternatives' | 'select_cad' | string | null
): OperationStatusDisplay {
  const isUnknownSync = submissionState === 'upstream_unknown';
  const isGeneration = kind === 'generate_alternatives';

  // 1. 本地已持久化或状态未确认
  if (submissionState === 'local_persisted' || status === null || status === undefined) {
    if (isUnknownSync) {
      return {
        label: '上游连接未确认',
        description: '本地已受理操作，正在同步上游确认状态；请勿重复提交。',
        tone: 'warning',
        isTerminal: false,
        canRetry: false,
        needsAttention: false,
      };
    }
    return {
      label: '本地已受理',
      description: '请求已在本地持久化，正在等待上游响应回执...',
      tone: 'pending',
      isTerminal: false,
      canRetry: false,
      needsAttention: false,
    };
  }

  // 2. 根据 operation kind 获取基准展示信息
  let base: OperationStatusDisplay;

  if (isGeneration) {
    switch (status) {
      case 'queued':
        base = {
          label: '方案生成排队中',
          description: '五方案求解任务已进入上游计算队列，等待调度。',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'running':
        base = {
          label: 'AI 方案求解生成中',
          description: '算法引擎正在根据需求与工件尺寸参数生成 5 组概念结构方案...',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'cad_succeeded':
        base = {
          label: '方案计算完成 (上传预览中)',
          description: '概念设计方案已生成完毕，正在上传 3D 预览资源入库。',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'uploading':
        base = {
          label: '方案预览资产上传中',
          description: '概念方案 3D 预览模型正在上传至受控存储...',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'verifying':
        base = {
          label: '方案元数据校验中',
          description: '正在校验方案产物完整性与格式规范...',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'succeeded':
        base = {
          label: '方案已生成',
          description: '五组对比方案已全部就绪，请在上方卡片中查看并选择。',
          tone: 'success',
          isTerminal: true,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'needs_attention':
        base = {
          label: '方案生成需人工核实',
          description: '方案生成过程或约束校验触发异常，已停止自动重试，请核查参数。',
          tone: 'warning',
          isTerminal: true,
          canRetry: false,
          needsAttention: true,
        };
        break;
      case 'failed':
        base = {
          label: '方案生成失败',
          description: '五方案求解或传输遇到错误，详情见错误信息。',
          tone: 'error',
          isTerminal: true,
          canRetry: true,
          needsAttention: false,
        };
        break;
      default:
        base = {
          label: String(status),
          description: '方案生成进展更新中...',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
    }
  } else {
    // 默认或 select_cad
    switch (status) {
      case 'queued':
        base = {
          label: 'CAD 排队等待中',
          description: '任务已进入上游 SolidWorks 建模队列，等待调度执行。',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'running':
        base = {
          label: 'CAD 建模计算中',
          description: 'SolidWorks 异步建模引擎正在运行求解与装配生成。',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'cad_succeeded':
        base = {
          label: 'CAD 建模完成 (正在上传)',
          description: 'SolidWorks 几何计算已完成，模型资产正在安全回传与入库。',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'uploading':
        base = {
          label: '文件上传入库中',
          description: 'CAD 产物正在向受控对象存储上传...',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'verifying':
        base = {
          label: '文件完整性校验中',
          description: '正在校验产物哈希与大小，确保模型无损坏。',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'succeeded':
        base = {
          label: 'CAD 全部就绪',
          description: 'CAD 装配及工程文件已成功就绪并可通过受控流下载。',
          tone: 'success',
          isTerminal: true,
          canRetry: false,
          needsAttention: false,
        };
        break;
      case 'needs_attention':
        base = {
          label: '需人工介入核实',
          description: '建模过程或工程校验触发异常，已停止自动重试，请人工核查日志。',
          tone: 'warning',
          isTerminal: true,
          canRetry: false,
          needsAttention: true,
        };
        break;
      case 'failed':
        base = {
          label: '处理失败',
          description: '建模或传输执行遇到错误，详情见错误信息。',
          tone: 'error',
          isTerminal: true,
          canRetry: true,
          needsAttention: false,
        };
        break;
      default:
        base = {
          label: String(status),
          description: '当前状态更新中...',
          tone: 'info',
          isTerminal: false,
          canRetry: false,
          needsAttention: false,
        };
        break;
    }
  }

  // 3. 如果上游同步状态未知，即使有最后已知业务状态也必须明确标注未确认
  if (isUnknownSync) {
    return {
      label: `${base.label} (同步未确认)`,
      description: `最后已知状态为【${base.label}】，但当前与上游同步中断或尚未确认最新进展；请等待同步恢复，切勿重复提交。`,
      tone: 'warning',
      isTerminal: false,
      canRetry: false,
      needsAttention: false,
    };
  }

  return base;
}

/**
 * 批次状态映射
 */
export function getBatchStatusDisplay(status: EquipmentBatchStatus): {
  label: string;
  tone: 'info' | 'success' | 'warning' | 'error' | 'pending';
} {
  switch (status) {
    case 'generating':
      return { label: '方案生成中', tone: 'pending' };
    case 'uploading_previews':
      return { label: '预览上传中', tone: 'info' };
    case 'awaiting_user_selection':
      return { label: '待选型', tone: 'info' };
    case 'selecting':
      return { label: '选型确认中', tone: 'pending' };
    case 'cad_completed':
      return { label: 'CAD 已完成', tone: 'info' };
    case 'uploading_cad':
      return { label: 'CAD 上传中', tone: 'info' };
    case 'completed':
      return { label: '已完成', tone: 'success' };
    case 'needs_attention':
      return { label: '需人工核实', tone: 'warning' };
    case 'failed':
      return { label: '生成失败', tone: 'error' };
    default:
      return { label: String(status), tone: 'info' };
  }
}

/**
 * 同步快照标记提示
 */
export function getSyncStatusLabel(syncStatus?: string | null): string {
  switch (syncStatus) {
    case 'persisted_snapshot':
      return '本地持久快照';
    case 'upstream_synced':
      return '已与上游实时同步';
    case 'upstream_unavailable':
      return '上游不可用 (展示持久快照)';
    default:
      return '历史数据';
  }
}

/**
 * 查找指定 alternative 的可用 preview_glb 文件
 */
export function findAlternativeGlbReceipt(
  files?: EquipmentFileReceipt[] | null,
  alternativeId?: string
): EquipmentFileReceipt | undefined {
  if (!files || !Array.isArray(files)) return undefined;
  return files.find(
    (f) =>
      f.kind === 'preview_glb' &&
      (!alternativeId || f.alternativeId === alternativeId) &&
      f.status === 'available' &&
      Boolean(f.entryId)
  );
}

/**
 * 查找指定 alternative 或批次/选型中的可用 cad_zip 文件
 * 支持传入单组文件数组或多组文件集合（如 selection.files, batch.files, operation.files）
 */
export function findCadZipReceipt(
  files?: (EquipmentFileReceipt | null | undefined)[] | (EquipmentFileReceipt[] | null | undefined)[] | null,
  alternativeId?: string
): EquipmentFileReceipt | undefined {
  if (!files || !Array.isArray(files)) return undefined;
  const flat: EquipmentFileReceipt[] = [];
  for (const item of files) {
    if (!item) continue;
    if (Array.isArray(item)) {
      for (const sub of item) {
        if (sub && typeof sub === 'object' && 'kind' in sub) flat.push(sub);
      }
    } else if (typeof item === 'object' && 'kind' in item) {
      flat.push(item);
    }
  }

  return flat.find(
    (f) =>
      f.kind === 'cad_zip' &&
      (!alternativeId || !f.alternativeId || f.alternativeId === alternativeId) &&
      f.status === 'available' &&
      Boolean(f.entryId)
  );
}

/**
 * 方案展示信息格式化：严格使用后端返回字段，不硬编码 5 个 ID
 */
export function getAlternativeDisplay(option: EquipmentAlternative, index: number) {
  return {
    id: option.id,
    displayNumber: index + 1,
    title: option.title || `方案 ${index + 1} (${option.id})`,
    condition: option.condition || '适用工况待核验',
    unverified: option.unverified || '工程适用性待校核',
    designRationale: option.designRationale || '',
    componentCount: option.componentCount,
    geometrySource: option.geometrySource || null,
    engineeringVerified: option.engineeringVerified ?? false,
  };
}

const CHINESE_NUM_MAP = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * 将方案 ID 转换为友好的中文展示编号，如“方案一”、“方案五”
 * 优先依据 alternatives 数组的索引匹配（0 -> 方案一）
 */
export function getAlternativeDisplayName(
  alternativeId?: string | null,
  alternatives?: EquipmentAlternative[] | null
): string {
  if (!alternativeId) return '未选方案';
  if (alternatives && Array.isArray(alternatives) && alternatives.length > 0) {
    const idx = alternatives.findIndex((a) => a.id === alternativeId);
    if (idx >= 0) {
      return idx < CHINESE_NUM_MAP.length ? `方案${CHINESE_NUM_MAP[idx]}` : `方案${idx + 1}`;
    }
  }
  const match = alternativeId.match(/(\d+)/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= CHINESE_NUM_MAP.length) {
      return `方案${CHINESE_NUM_MAP[num - 1]}`;
    }
    if (num >= 1) {
      return `方案${num}`;
    }
  }
  return alternativeId;
}
