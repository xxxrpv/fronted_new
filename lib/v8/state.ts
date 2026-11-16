import type {
  Approval,
  Artifact,
  CADRun,
  ConceptRevision,
  Project,
} from "./types";
import { TEMPLATE_CATALOG } from "./catalog";
import { previewModelUrl } from "./preview-model-url";

export class V8Error extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "V8Error";
  }
}

export function currentRequirement(project: Project) {
  return project.requirements.at(-1);
}
export function latestRevision(project: Project, branchId: string) {
  return project.branches.find((b) => b.id === branchId)?.revisions.at(-1);
}

export function parameterSnapshotsEqual(
  a?: Record<string, number>,
  b?: Record<string, number>,
): boolean {
  const left = Object.entries(a || {}).sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(b || {}).sort(([x], [y]) => x.localeCompare(y));
  return (
    left.length === right.length &&
    left.every(
      ([key, value], index) =>
        key === right[index][0] &&
        Number.isFinite(value) &&
        value === right[index][1],
    )
  );
}

/** Canonical supported source parameters, never copied from mutable project state. */
export function normalizeParameterSnapshot(
  assetKey: ConceptRevision["assetKey"],
  input: Record<string, number> = {},
): Record<string, number> {
  const definitions =
    TEMPLATE_CATALOG.find((item) => item.assetKey === assetKey)?.parameters ||
    [];
  for (const [key, value] of Object.entries(input)) {
    const definition = definitions.find((item) => item.key === key);
    if (
      !definition ||
      !Number.isFinite(value) ||
      value < definition.min ||
      value > definition.max
    )
      throw new V8Error("PARAMETER_RANGE", "参数不在当前来源模型支持范围内。");
  }
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.key,
      Object.is(input[definition.key], -0)
        ? 0
        : (input[definition.key] ?? definition.defaultValue),
    ]),
  );
}

function parametersSupported(
  assetKey: ConceptRevision["assetKey"],
  input?: Record<string, number>,
): boolean {
  try {
    normalizeParameterSnapshot(assetKey, input);
    return true;
  } catch {
    return false;
  }
}
export function findRevision(
  project: Project,
  branchId: string,
  revisionId: string,
): ConceptRevision {
  const revision = project.branches
    .find((b) => b.id === branchId)
    ?.revisions.find((r) => r.id === revisionId);
  if (!revision)
    throw new V8Error(
      "SOURCE_MISSING",
      "未找到这个方向的指定版本，请重新加载项目。",
    );
  return revision;
}
export function matchingApproval(
  project: Project,
  branchId: string,
  revisionId: string,
): Approval | undefined {
  const revision = findRevision(project, branchId, revisionId);
  return project.approvals.find(
    (a) =>
      a.branchId === branchId &&
      a.revisionId === revision.id &&
      approvalSourceValid(project, a),
  );
}

/** Validate the immutable stored source, never the branch's latest revision. */
export function approvalSourceValid(
  project: Project,
  approval: Approval,
): boolean {
  const stored = project.approvals.find((item) => item.id === approval.id);
  const branch = project.branches.find((item) => item.id === approval.branchId);
  const revision = branch?.revisions.find(
    (item) => item.id === approval.revisionId,
  );
  return Boolean(
    stored &&
      stored.projectId === approval.projectId &&
      stored.branchId === approval.branchId &&
      stored.revisionId === approval.revisionId &&
      stored.descriptionId === approval.descriptionId &&
      stored.description === approval.description &&
      stored.requirementId === approval.requirementId &&
      stored.assetKey === approval.assetKey &&
      parameterSnapshotsEqual(
        stored.parameterSnapshot,
        approval.parameterSnapshot,
      ) &&
      approval.projectId === project.id &&
      branch?.projectId === project.id &&
      revision?.branchId === branch.id &&
      revision?.status === "ready" &&
      revision.descriptionId === approval.descriptionId &&
      revision.description === approval.description &&
      parametersSupported(revision.assetKey, revision.parameterSnapshot) &&
      parameterSnapshotsEqual(
        revision.parameterSnapshot,
        approval.parameterSnapshot,
      ) &&
      (revision.parameterSnapshot === undefined ||
        (approval.requirementId === revision.requirementId &&
          approval.assetKey === revision.assetKey &&
          approval.parameterSnapshot !== undefined)) &&
      (approval.requirementId === undefined ||
        approval.requirementId === revision.requirementId) &&
      (approval.assetKey === undefined ||
        approval.assetKey === revision.assetKey) &&
      project.requirements.some(
        (item) =>
          item.id === revision.requirementId && item.projectId === project.id,
      ),
  );
}

export function runSourceValid(project: Project, run: CADRun): boolean {
  const approval = project.approvals.find((a) => a.id === run.sourceApprovalId);
  const revision = project.branches
    .find((b) => b.id === run.branchId)
    ?.revisions.find((r) => r.id === run.revisionId);
  const task = project.tasks.find((item) => item.id === run.taskId);
  return (
    !!approval &&
    !!revision &&
    approvalSourceValid(project, approval) &&
    run.projectId === project.id &&
    approval.branchId === run.branchId &&
    approval.revisionId === run.revisionId &&
    approval.descriptionId === run.sourceDescriptionId &&
    revision.descriptionId === run.sourceDescriptionId &&
    run.assetKey === revision.assetKey &&
    parameterSnapshotsEqual(
      run.parameterSnapshot,
      approval.parameterSnapshot,
    ) &&
    (approval.parameterSnapshot === undefined ||
      (run.requirementId === approval.requirementId &&
        run.sourceDescription === approval.description &&
        run.parameterSnapshot !== undefined &&
        !!task &&
        task.type === "cad" &&
        task.projectId === project.id &&
        task.approvalId === approval.id &&
        task.requirementId === approval.requirementId &&
        task.sourceDescriptionId === approval.descriptionId &&
        task.sourceDescription === approval.description &&
        parameterSnapshotsEqual(
          task.parameterSnapshot,
          approval.parameterSnapshot,
        )))
  );
}
/** Source identity is checked while files are still being materialized, too. */
export function artifactSourceValid(
  project: Project,
  artifact: Artifact,
): boolean {
  if (artifact.projectId !== project.id) return false;
  if (artifact.modelRecipe) {
    const recipe = artifact.modelRecipe;
    if (
      artifact.kind !== "model" ||
      artifact.assetKey !== recipe.assetKey ||
      !parameterSnapshotsEqual(
        artifact.parameterSnapshot,
        recipe.parameterSnapshot,
      )
    )
      return false;
    try {
      if (artifact.url !== previewModelUrl(recipe)) return false;
    } catch {
      return false;
    }
    const refs = recipe.provenance;
    if (
      refs.projectId !== project.id ||
      refs.requirementId !== artifact.requirementId
    )
      return false;
    for (const key of [
      "templateId",
      "branchId",
      "revisionId",
      "descriptionId",
      "approvalId",
      "cadRunId",
    ] as const)
      if ((refs[key] || undefined) !== artifact[key]) return false;
  }
  if (artifact.templateId) {
    const template = TEMPLATE_CATALOG.find(
      (item) => item.id === artifact.templateId,
    );
    return (
      project.journey.some(
        (event) =>
          event.kind === "template" && event.refId === artifact.templateId,
      ) &&
      (artifact.requirementId === undefined ||
        project.requirements.some(
          (item) =>
            item.id === artifact.requirementId && item.projectId === project.id,
        )) &&
      (artifact.assetKey === undefined ||
        (template?.assetKey === artifact.assetKey &&
          artifact.requirementId !== undefined &&
          artifact.parameterSnapshot !== undefined &&
          parametersSupported(artifact.assetKey, artifact.parameterSnapshot)))
    );
  }
  const approval = project.approvals.find((a) => a.id === artifact.approvalId);
  if (
    !approval ||
    approval.projectId !== project.id ||
    approval.branchId !== artifact.branchId ||
    approval.revisionId !== artifact.revisionId ||
    approval.descriptionId !== artifact.descriptionId ||
    !approvalSourceValid(project, approval)
  )
    return false;
  if (
    approval.parameterSnapshot !== undefined &&
    (artifact.requirementId !== approval.requirementId ||
      artifact.assetKey !== approval.assetKey ||
      artifact.parameterSnapshot === undefined ||
      !parameterSnapshotsEqual(
        artifact.parameterSnapshot,
        approval.parameterSnapshot,
      ))
  )
    return false;
  if (!artifact.cadRunId) return artifact.kind === "design_document";
  const run = project.cadRuns.find((r) => r.id === artifact.cadRunId);
  return (
    !!run &&
    run.status === "succeeded" &&
    run.artifactIds.includes(artifact.id) &&
    runSourceValid(project, run) &&
    parameterSnapshotsEqual(artifact.parameterSnapshot, run.parameterSnapshot)
  );
}
export function canDownload(project: Project, artifact: Artifact): boolean {
  if (
    artifact.projectId !== project.id ||
    !artifact.authorized ||
    artifact.status !== "ready" ||
    (!artifact.url && artifact.content === undefined)
  )
    return false;
  if (
    artifact.modelRecipe &&
    (!Number.isInteger(artifact.sizeBytes) ||
      artifact.sizeBytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256 || "") ||
      !/^[a-f0-9]{64}$/.test(artifact.sourceSha256 || ""))
  )
    return false;
  return artifactSourceValid(project, artifact);
}
export function canDeliver(project: Project): boolean {
  return project.artifacts.some((artifact) => canDownload(project, artifact));
}

/** Engineering is reachable after a real saved template or immutable approval. */
export function canEnterEngineering(project: Project): boolean {
  if (!project.requirements.length) return false;
  const savedTemplate =
    project.route === "library" &&
    Boolean(project.templateId) &&
    project.artifacts.some(
      (artifact) =>
        artifact.kind === "model" &&
        artifact.templateId === project.templateId &&
        canDownload(project, artifact),
    );
  return (
    Boolean(savedTemplate) ||
    project.approvals.some((approval) =>
      approvalSourceValid(project, approval),
    ) ||
    project.cadRuns.some((run) => runSourceValid(project, run))
  );
}
export type Stage =
  | "requirements"
  | "start"
  | "library"
  | "concepts"
  | "concept"
  | "cad"
  | "delivery";
export function legalStage(project: Project, requested: string): Stage {
  if (!project.requirements.length) return "requirements";
  if (requested === "requirements" || requested === "start") return requested;
  if (requested === "library") return "library";
  if (requested === "concepts")
    return project.route === "custom" || project.branches.length > 0
      ? "concepts"
      : "start";
  if (requested === "concept")
    return project.branches.length ? "concept" : "concepts";
  if (requested === "cad")
    return canEnterEngineering(project)
      ? "cad"
      : project.branches.length || project.route === "custom"
        ? "concepts"
        : "start";
  if (requested === "delivery")
    return project.artifacts.length
      ? "delivery"
      : canEnterEngineering(project)
        ? "cad"
        : "start";
  return "requirements";
}

export function humanStatus(status: string): string {
  return (
    (
      {
        queued: "排队中",
        running: "进行中",
        partial: "部分完成",
        succeeded: "计算完成",
        failed: "失败",
        unknown: "状态待核实",
        uploading: "上传中",
        validating: "校验中",
        ready: "文件可用",
        missing: "文件缺失",
        expired: "链接已过期",
      } as Record<string, string>
    )[status] || status
  );
}
