import type { AssetKey, ModelRecipe } from "./types";

const ASSETS = new Set<AssetKey>([
  "go2-high-fidelity",
  "inspection-reference",
  "mobile-reference",
]);
const REFS = new Set([
  "projectId",
  "requirementId",
  "templateId",
  "branchId",
  "revisionId",
  "descriptionId",
  "approvalId",
  "cadRunId",
]);

/** Local resource export only: this endpoint does not call an Agent or CAD service. */
export function parsePreviewModelRecipe(value: unknown): ModelRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("缺少有效的模型配置快照。");
  const input = value as Record<string, unknown>;
  if (!ASSETS.has(input.assetKey as AssetKey))
    throw new Error("此来源模型未开放配置导出。");
  if (
    Object.keys(input).some(
      (key) => !["assetKey", "parameterSnapshot", "provenance"].includes(key),
    )
  )
    throw new Error("模型配置包含未支持的字段。");
  if (
    !input.parameterSnapshot ||
    typeof input.parameterSnapshot !== "object" ||
    Array.isArray(input.parameterSnapshot)
  )
    throw new Error("缺少冻结参数快照。");
  const parameters: Record<string, number> = {};
  const expectedKey =
    input.assetKey === "inspection-reference"
      ? "inspectionCameraHeight"
      : input.assetKey === "mobile-reference"
        ? "mobileCameraHeight"
        : undefined;
  for (const [key, value] of Object.entries(input.parameterSnapshot).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (
      key !== expectedKey ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 0.05
    )
      throw new Error("参数未获支持或超过 ±50 mm 范围。");
    parameters[key] = Object.is(value, -0) ? 0 : value;
  }
  if (
    !input.provenance ||
    typeof input.provenance !== "object" ||
    Array.isArray(input.provenance)
  )
    throw new Error("缺少模型版本来源。");
  const provenance: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.provenance).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (
      !REFS.has(key) ||
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new Error("模型版本来源标识无效。");
    provenance[key] = value;
  }
  if (!provenance.projectId || !provenance.requirementId)
    throw new Error("模型缺少项目或需求来源。");
  if (
    !provenance.templateId &&
    ![
      "branchId",
      "revisionId",
      "descriptionId",
      "approvalId",
      "cadRunId",
    ].every((key) => provenance[key])
  )
    throw new Error("工程模型缺少完整的确认版本来源。");
  if (
    provenance.templateId &&
    ["branchId", "revisionId", "descriptionId", "approvalId", "cadRunId"].some(
      (key) => provenance[key],
    )
  )
    throw new Error("模板和工程模型来源不能混用。");
  return {
    assetKey: input.assetKey as AssetKey,
    parameterSnapshot: parameters,
    provenance,
  };
}

export function previewModelUrl(recipe: ModelRecipe): string {
  const frozen = parsePreviewModelRecipe(recipe);
  return `/api/v8-preview/models/${frozen.assetKey}?recipe=${encodeURIComponent(JSON.stringify(frozen))}`;
}
