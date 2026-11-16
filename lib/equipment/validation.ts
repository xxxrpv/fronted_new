import type {
  EquipmentConceptParameters,
  ParameterValidationResult,
} from './types';
import { PARAMETER_BOUNDS } from './types';

/**
 * 校验需求文本
 */
export function validateRequirement(requirement: string): string | null {
  const trimmed = requirement.trim();
  if (!trimmed) {
    return '设备需求不能为空，请输入具体的功能或结构描述';
  }
  if (trimmed.length > 8000) {
    return `设备需求字符数不能超过 8000 字（当前 ${trimmed.length} 字）`;
  }
  return null;
}

/**
 * 校验非标设备概念尺寸参数
 */
export function validateConceptParameters(
  params: Partial<EquipmentConceptParameters>
): ParameterValidationResult {
  const errors: Record<string, string> = {};

  const length = params.conveyor_length_mm;
  const width = params.conveyor_width_mm;
  const height = params.deck_height_mm;
  const thickness = params.deck_thickness_mm;
  const wpLength = params.workpiece_length_mm;
  const wpWidth = params.workpiece_width_mm;
  const wpHeight = params.workpiece_height_mm;

  // 1. 布局长度
  if (length === undefined || !Number.isFinite(length)) {
    errors.conveyor_length_mm = '布局长度必须为有效数值';
  } else if (
    length < PARAMETER_BOUNDS.conveyor_length_mm.min ||
    length > PARAMETER_BOUNDS.conveyor_length_mm.max
  ) {
    errors.conveyor_length_mm = `布局长度需在 ${PARAMETER_BOUNDS.conveyor_length_mm.min}-${PARAMETER_BOUNDS.conveyor_length_mm.max} mm 之间`;
  }

  // 2. 布局宽度
  if (width === undefined || !Number.isFinite(width)) {
    errors.conveyor_width_mm = '布局宽度必须为有效数值';
  } else if (
    width < PARAMETER_BOUNDS.conveyor_width_mm.min ||
    width > PARAMETER_BOUNDS.conveyor_width_mm.max
  ) {
    errors.conveyor_width_mm = `布局宽度需在 ${PARAMETER_BOUNDS.conveyor_width_mm.min}-${PARAMETER_BOUNDS.conveyor_width_mm.max} mm 之间`;
  }

  // 3. 台面高度
  if (height === undefined || !Number.isFinite(height)) {
    errors.deck_height_mm = '台面高度必须为有效数值';
  } else if (
    height < PARAMETER_BOUNDS.deck_height_mm.min ||
    height > PARAMETER_BOUNDS.deck_height_mm.max
  ) {
    errors.deck_height_mm = `台面高度需在 ${PARAMETER_BOUNDS.deck_height_mm.min}-${PARAMETER_BOUNDS.deck_height_mm.max} mm 之间`;
  }

  // 4. 台面厚度
  if (thickness === undefined || !Number.isFinite(thickness)) {
    errors.deck_thickness_mm = '台面厚度必须为有效数值';
  } else if (
    thickness < PARAMETER_BOUNDS.deck_thickness_mm.min ||
    thickness > PARAMETER_BOUNDS.deck_thickness_mm.max
  ) {
    errors.deck_thickness_mm = `台面厚度需在 ${PARAMETER_BOUNDS.deck_thickness_mm.min}-${PARAMETER_BOUNDS.deck_thickness_mm.max} mm 之间`;
  }

  // 5. 工件长
  if (wpLength === undefined || !Number.isFinite(wpLength) || wpLength <= 0) {
    errors.workpiece_length_mm = '工件长度必须为大于 0 的有效数值';
  }

  // 6. 工件宽
  if (wpWidth === undefined || !Number.isFinite(wpWidth) || wpWidth <= 0) {
    errors.workpiece_width_mm = '工件宽度必须为大于 0 的有效数值';
  }

  // 7. 工件高
  if (wpHeight === undefined || !Number.isFinite(wpHeight) || wpHeight <= 0) {
    errors.workpiece_height_mm = '工件高度必须为大于 0 的有效数值';
  }

  // 8. 联合约束 (Cross-field Validation)
  if (
    Number.isFinite(wpWidth) &&
    Number.isFinite(width) &&
    wpWidth! + 40 > width!
  ) {
    errors.workpiece_width_mm = `布局宽度 (${width} mm) 至少需比工件宽度大 40 mm (当前工件宽 ${wpWidth} mm)`;
  }

  if (
    Number.isFinite(wpLength) &&
    Number.isFinite(length) &&
    wpLength! > length! / 4
  ) {
    errors.workpiece_length_mm = `工件长度 (${wpLength} mm) 不能超过布局长度的 1/4 (${Math.floor(length! / 4)} mm)`;
  }

  if (
    Number.isFinite(wpHeight) &&
    wpHeight! > PARAMETER_BOUNDS.workpiece_height_mm.max
  ) {
    errors.workpiece_height_mm = `工件高度 (${wpHeight} mm) 不能超过 ${PARAMETER_BOUNDS.workpiece_height_mm.max} mm`;
  }

  const valid = Object.keys(errors).length === 0;
  const firstErrorKey = Object.keys(errors)[0];
  const generalError = firstErrorKey ? errors[firstErrorKey] : undefined;

  return {
    valid,
    errors,
    generalError,
  };
}
