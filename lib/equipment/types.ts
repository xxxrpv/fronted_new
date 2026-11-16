import type {
  CreateProjectEquipmentUeLoad,
  EquipmentAlternative,
  EquipmentAlternativeId,
  EquipmentBatchDetail,
  EquipmentBatchId,
  EquipmentBatchListResponse,
  EquipmentBatchStatus,
  EquipmentBatchSummary,
  EquipmentConceptParameters,
  EquipmentFileReceipt,
  EquipmentIdempotencyKey,
  EquipmentOperationDetail,
  EquipmentOperationListResponse,
  EquipmentOperationReceipt,
  EquipmentOperationStatus,
  EquipmentSelection,
  EquipmentSubmissionState,
  PlatformId,
  ProjectEquipmentUeDetail,
  ProjectEquipmentUeList,
  ProjectEquipmentUeReceipt,
  ProjectEquipmentUeRuntime,
  ProjectEquipmentUeViewerAccess,
  Timestamp,
} from '../api/generated/types.gen';

export type {
  CreateProjectEquipmentUeLoad,
  EquipmentAlternative,
  EquipmentAlternativeId,
  EquipmentBatchDetail,
  EquipmentBatchId,
  EquipmentBatchListResponse,
  EquipmentBatchStatus,
  EquipmentBatchSummary,
  EquipmentConceptParameters,
  EquipmentFileReceipt,
  EquipmentIdempotencyKey,
  EquipmentOperationDetail,
  EquipmentOperationListResponse,
  EquipmentOperationReceipt,
  EquipmentOperationStatus,
  EquipmentSelection,
  EquipmentSubmissionState,
  PlatformId,
  ProjectEquipmentUeDetail,
  ProjectEquipmentUeList,
  ProjectEquipmentUeReceipt,
  ProjectEquipmentUeRuntime,
  ProjectEquipmentUeViewerAccess,
  Timestamp,
};

/**
 * 概念参数默认值（对应 OpenAPI Schema 定义）
 */
export const DEFAULT_EQUIPMENT_PARAMETERS: EquipmentConceptParameters = {
  conveyor_length_mm: 1000,
  conveyor_width_mm: 300,
  deck_height_mm: 750,
  deck_thickness_mm: 20,
  workpiece_length_mm: 100,
  workpiece_width_mm: 60,
  workpiece_height_mm: 30,
};

/**
 * 参数范围约束常量
 */
export const PARAMETER_BOUNDS = {
  conveyor_length_mm: { min: 600, max: 3000 },
  conveyor_width_mm: { min: 150, max: 2000 },
  deck_height_mm: { min: 400, max: 1200 },
  deck_thickness_mm: { min: 10, max: 60 },
  workpiece_height_mm: { max: 150 },
} as const;

/**
 * 参数校验错误映射
 */
export interface ParameterValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  generalError?: string;
}

/**
 * 明确的功能缺口定义（G01, G02, G03）
 */
export const FEATURE_GAPS = {
  G01_DETAIL_PACKAGE: {
    code: 'G01',
    name: '深化设计输入包',
    status: 'DISABLED',
    reason: '当前平台未定义 equipment-detail-input/1.0 产物及冻结 parts/selection 语义，不得使用 CAD ZIP 或 parts.json 冒充原包。',
  },
  G02_UE_RUNTIME: {
    code: 'G02',
    name: 'UE 实时交互展示',
    status: 'DISABLED',
    reason: '设备 OpenAPI v0.1 契约已明确排除 UE 运行时；不借用机器人 URDF/UE 接口或 iframe 嵌入。',
  },
  G03_ASSET_COUNT: {
    code: 'G03',
    name: '资产复用统计字段',
    status: 'OMITTED_HONESTLY',
    reason: '平台 OpenAPI Schema 无 asset_instance_count 字段，前端诚实省略该数值展示，不臆造虚假统计，仅展示真实 geometrySource 等属性。',
  },
} as const;

/**
 * 方案描述辅助
 */
export interface AlternativeDisplayInfo {
  title: string;
  condition: string;
  unverified: string;
  designRationale: string;
  componentCount: number;
  geometrySource?: string | null;
  engineeringVerified: boolean;
}
