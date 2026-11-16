import type { Approval, Artifact, AssetKey, CADRun, Project } from "./types";
import { approvalSourceValid, canDownload, runSourceValid } from "./state";
import { TEMPLATE_CATALOG } from "./catalog";

export interface DeliverySource {
  kind: "cad" | "approved-design" | "template" | "unresolved";
  projectId: string;
  branchId?: string;
  revisionId?: string;
  descriptionId?: string;
  approvalId?: string;
  cadRunId?: string;
  templateId?: string;
  requirementId?: string;
  assetKey?: AssetKey;
  parameterSnapshot?: Record<string, number>;
}
export interface DeliveryIssue {
  code: string;
  message: string;
  artifactId?: string;
}
export interface DeliveryPackage {
  key: string;
  title: string;
  source: DeliverySource;
  artifacts: Artifact[];
  readyArtifacts: Artifact[];
  status: "ready" | "preparing" | "partial" | "blocked";
  isCurrent: boolean;
  issues: DeliveryIssue[];
  createdAt: string;
  modelReady: boolean;
  documentReady: boolean;
}

/** Delivery is current-only. Historical files are exposed by the history drawer. */
export function selectDeliveryPackage(
  packages: DeliveryPackage[],
  _requested?: string | null,
) {
  return packages.find((item) => item.isCurrent);
}

/** Undefined is incomplete metadata; it differs from an explicit empty snapshot. */
function parameters(
  value: Record<string, number> | undefined,
): string | undefined {
  if (
    !value ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return undefined;
  const entries = Object.entries(value).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (entries.some(([, v]) => typeof v !== "number" || !Number.isFinite(v)))
    return undefined;
  return JSON.stringify(Object.fromEntries(entries));
}

export function finalReportReadiness(
  project: Project,
  packages = groupDeliveryPackages(project),
) {
  const current = selectDeliveryPackage(packages);
  let missing = "",
    continueStage = "start";
  if (!project.requirements.length) {
    missing = "先保存设计需求";
    continueStage = "requirements";
  } else if (!project.route) missing = "先选择设计路线";
  else if (project.route === "library") {
    continueStage = "library";
    if (!project.templateId) missing = "先选择模型";
    else if (!current) missing = "先保存当前需求下的模型适配";
  } else {
    continueStage = "concepts";
    if (!current || current.source.kind === "approved-design") {
      const approval = project.approvals
        .filter(
          (a) =>
            approvalSourceValid(project, a) &&
            a.requirementId === project.requirements.at(-1)?.id &&
            project.branches.some(
              (b) => b.id === a.branchId && b.latestRevisionId === a.revisionId,
            ),
        )
        .at(-1);
      missing = approval
        ? "已确认设计，需完成对应工程模型"
        : "先确认当前需求对应的具体概念版本";
      if (approval) continueStage = "cad";
    } else if (current.source.kind !== "cad") missing = "需完成对应工程模型";
  }
  if (!missing && current) {
    continueStage = project.route === "library" ? "library" : "cad";
    const run = project.cadRuns.find((r) => r.id === current.source.cadRunId);
    const task = project.tasks.find((t) => t.id === run?.taskId);
    if (run && (run.status !== "succeeded" || task?.status !== "succeeded"))
      missing =
        run.status === "failed" || task?.status === "failed"
          ? "工程任务失败，请重试"
          : "工程任务尚未完成";
    else if (
      !current.modelReady ||
      !canDownload(
        project,
        current.artifacts.filter((a) => a.kind === "model").at(-1)!,
      )
    ) {
      const model = current.artifacts.filter((a) => a.kind === "model").at(-1);
      missing =
        model?.status === "failed"
          ? "模型文件准备失败，请刷新文件状态重试"
          : "对应模型文件尚未就绪";
    }
  }
  return {
    ready: !missing && Boolean(current?.modelReady),
    missing,
    continueStage,
    package: current,
  };
}
function sameParameters(
  a?: Record<string, number>,
  b?: Record<string, number>,
) {
  const first = parameters(a);
  return first !== undefined && first === parameters(b);
}
function ownedRequirement(project: Project, id?: string): id is string {
  return (
    !!id &&
    project.requirements.some((r) => r.id === id && r.projectId === project.id)
  );
}
function approvedSource(
  project: Project,
  approval: Approval,
): DeliverySource | undefined {
  const revision = project.branches
    .find((b) => b.id === approval.branchId)
    ?.revisions.find((r) => r.id === approval.revisionId);
  if (
    !revision ||
    !approvalSourceValid(project, approval) ||
    !ownedRequirement(project, approval.requirementId) ||
    approval.requirementId !== revision.requirementId ||
    approval.assetKey !== revision.assetKey ||
    !sameParameters(approval.parameterSnapshot, revision.parameterSnapshot)
  )
    return undefined;
  return {
    kind: "approved-design",
    projectId: project.id,
    branchId: approval.branchId,
    revisionId: approval.revisionId,
    descriptionId: approval.descriptionId,
    approvalId: approval.id,
    requirementId: approval.requirementId,
    assetKey: approval.assetKey,
    parameterSnapshot: { ...approval.parameterSnapshot },
  };
}
function fileMatches(artifact: Artifact, source: DeliverySource): boolean {
  // A nonzero view offset beside raw GLB bytes is not configured geometry proof.
  if (
    artifact.kind === "model" &&
    !artifact.modelRecipe &&
    Object.values(artifact.parameterSnapshot || {}).some((value) => value !== 0)
  )
    return false;
  if (
    artifact.projectId !== source.projectId ||
    artifact.requirementId !== source.requirementId ||
    artifact.assetKey !== source.assetKey ||
    !sameParameters(artifact.parameterSnapshot, source.parameterSnapshot)
  )
    return false;
  for (const key of [
    "templateId",
    "branchId",
    "revisionId",
    "descriptionId",
    "approvalId",
  ] as const)
    if (artifact[key] !== source[key]) return false;
  if (artifact.modelRecipe) {
    if (
      artifact.modelRecipe.assetKey !== source.assetKey ||
      !sameParameters(
        artifact.modelRecipe.parameterSnapshot,
        source.parameterSnapshot,
      )
    )
      return false;
    for (const key of [
      "projectId",
      "requirementId",
      "templateId",
      "branchId",
      "revisionId",
      "descriptionId",
      "approvalId",
    ] as const) {
      const supplied = artifact.modelRecipe.provenance[key];
      if (supplied !== undefined && supplied !== source[key]) return false;
    }
    const runId = artifact.modelRecipe.provenance.cadRunId;
    if (runId !== undefined && runId !== source.cadRunId) return false;
  }
  return true;
}

/** Pure grouping of frozen facts. It never fills historical gaps from project.parameters. */
export function groupDeliveryPackages(project: Project): DeliveryPackage[] {
  const result: DeliveryPackage[] = [],
    claimed = new Set<string>();
  const sources = new Map<string, DeliverySource>();
  for (const approval of project.approvals) {
    const source = approvedSource(project, approval);
    if (source) sources.set(approval.id, source);
  }
  const latestApproval = project.approvals
    .filter((a) => sources.has(a.id))
    .at(-1);
  const currentRequirement = project.requirements.at(-1)?.id;
  const currentApproved = (source: DeliverySource) =>
    project.route === "custom" &&
    source.approvalId === latestApproval?.id &&
    source.requirementId === currentRequirement &&
    project.branches.find((b) => b.id === source.branchId)?.latestRevisionId ===
      source.revisionId;
  const title = (source: DeliverySource) => {
    const branch = project.branches.find((b) => b.id === source.branchId);
    const revision = branch?.revisions.find((r) => r.id === source.revisionId);
    return branch && revision
      ? `${branch.name} · V${String(revision.sequence).padStart(2, "0")}`
      : TEMPLATE_CATALOG.find((t) => t.id === source.templateId)?.name ||
          source.templateId ||
          "历史文件 · 来源信息不完整";
  };
  function add(
    key: string,
    source: DeliverySource,
    artifacts: Artifact[],
    createdAt: string,
    isCurrent: boolean,
    run?: CADRun,
    initialIssues: DeliveryIssue[] = [],
  ) {
    const issues = [...initialIssues];
    const readyArtifacts = artifacts.filter((a) => canDownload(project, a));
    const modelReady = readyArtifacts.some((a) => a.kind === "model"),
      documentReady = readyArtifacts.some(
        (a) =>
          a.kind === "design_document" && a.mimeType.startsWith("text/html"),
      );
    const unresolved = source.kind === "unresolved" || initialIssues.length > 0;
    for (const artifact of artifacts)
      if (!canDownload(project, artifact))
        issues.push({
          code: "file-unavailable",
          artifactId: artifact.id,
          message: `${artifact.fileName}：${!artifact.authorized ? "无访问权限" : artifact.status}`,
        });
    const requiresModel = source.kind === "cad" || source.kind === "template";
    if (requiresModel && !artifacts.some((a) => a.kind === "model"))
      issues.push({
        code: "model-missing",
        message: "此来源尚无对应模型文件。",
      });
    if (source.kind !== "unresolved" && !documentReady)
      issues.push({
        code: "document-unavailable",
        message: "此来源的设计文档尚不可用。",
      });
    let status: DeliveryPackage["status"];
    if (unresolved || run?.status === "failed") status = "blocked";
    else if (
      (run && ["queued", "running", "unknown"].includes(run.status)) ||
      artifacts.some((a) => ["uploading", "validating"].includes(a.status))
    )
      status = "preparing";
    else if (
      readyArtifacts.length === artifacts.length &&
      documentReady &&
      (!requiresModel || modelReady)
    )
      status = "ready";
    else status = readyArtifacts.length ? "partial" : "blocked";
    result.push({
      key,
      title:
        source.kind === "unresolved"
          ? `${artifacts[0]?.fileName || "历史文件"} · 来源信息不完整`
          : title(source),
      source,
      artifacts: [...artifacts],
      readyArtifacts,
      status,
      isCurrent: isCurrent && !unresolved,
      issues,
      createdAt,
      modelReady,
      documentReady,
    });
    for (const artifact of artifacts) claimed.add(artifact.id);
  }
  for (const run of project.cadRuns) {
    const approved = sources.get(run.sourceApprovalId);
    const source: DeliverySource = {
      ...(approved || {
        projectId: project.id,
        approvalId: run.sourceApprovalId,
        branchId: run.branchId,
        revisionId: run.revisionId,
        descriptionId: run.sourceDescriptionId,
      }),
      kind: "cad",
      cadRunId: run.id,
    };
    const valid =
      !!approved &&
      runSourceValid(project, run) &&
      run.requirementId === approved.requirementId &&
      run.assetKey === approved.assetKey &&
      sameParameters(run.parameterSnapshot, approved.parameterSnapshot);
    const artifacts = valid
      ? project.artifacts.filter(
          (a) =>
            fileMatches(a, source) &&
            ((a.cadRunId === run.id && run.artifactIds.includes(a.id)) ||
              (!a.cadRunId && a.kind === "design_document")),
        )
      : [];
    const latestRun = project.cadRuns
      .filter((r) => r.sourceApprovalId === run.sourceApprovalId)
      .at(-1);
    add(
      `cad:${run.id}`,
      source,
      artifacts,
      run.createdAt,
      valid && currentApproved(source) && latestRun?.id === run.id,
      run,
      valid
        ? []
        : [
            {
              code: "source-incomplete-or-mismatch",
              message: "工程记录的冻结来源信息不完整或不一致，未拼接其他文件。",
            },
          ],
    );
  }
  for (const approval of project.approvals) {
    const source = sources.get(approval.id);
    if (
      !source ||
      result.some(
        (p) =>
          p.source.kind === "cad" &&
          p.source.approvalId === approval.id &&
          !p.issues.some((i) => i.code === "source-incomplete-or-mismatch"),
      )
    )
      continue;
    const artifacts = project.artifacts.filter(
      (a) =>
        !a.cadRunId && a.kind === "design_document" && fileMatches(a, source),
    );
    if (artifacts.length)
      add(
        `approval:${approval.id}`,
        source,
        artifacts,
        approval.approvedAt,
        currentApproved(source),
      );
  }
  const templateGroups = new Map<
    string,
    { source: DeliverySource; artifacts: Artifact[] }
  >();
  for (const artifact of project.artifacts) {
    if (
      !artifact.templateId ||
      !ownedRequirement(project, artifact.requirementId) ||
      parameters(artifact.parameterSnapshot) === undefined ||
      TEMPLATE_CATALOG.find((t) => t.id === artifact.templateId)?.assetKey !==
        artifact.assetKey
    )
      continue;
    const source: DeliverySource = {
      kind: "template",
      projectId: project.id,
      templateId: artifact.templateId,
      requirementId: artifact.requirementId,
      assetKey: artifact.assetKey,
      parameterSnapshot: { ...artifact.parameterSnapshot },
    };
    if (!fileMatches(artifact, source) || artifact.cadRunId) continue;
    const key = `template:${source.templateId}:${source.requirementId}:${parameters(source.parameterSnapshot)}`;
    const group = templateGroups.get(key) || { source, artifacts: [] };
    group.artifacts.push(artifact);
    templateGroups.set(key, group);
  }
  for (const [key, group] of templateGroups)
    add(
      key,
      group.source,
      group.artifacts,
      group.artifacts.at(-1)!.createdAt,
      project.route === "library" &&
        project.templateId === group.source.templateId &&
        currentRequirement === group.source.requirementId &&
        sameParameters(project.parameters, group.source.parameterSnapshot),
    );
  for (const artifact of project.artifacts)
    if (!claimed.has(artifact.id))
      add(
        `unresolved:${artifact.id}`,
        {
          kind: "unresolved",
          projectId: project.id,
          templateId: artifact.templateId,
          approvalId: artifact.approvalId,
          cadRunId: artifact.cadRunId,
          revisionId: artifact.revisionId,
          descriptionId: artifact.descriptionId,
          requirementId: artifact.requirementId,
          assetKey: artifact.assetKey,
          parameterSnapshot:
            parameters(artifact.parameterSnapshot) === undefined
              ? undefined
              : { ...artifact.parameterSnapshot },
        },
        [artifact],
        artifact.createdAt,
        false,
        undefined,
        [
          {
            code: "source-incomplete-or-mismatch",
            artifactId: artifact.id,
            message:
              "历史文件的冻结来源信息不完整或不一致；只允许独立读取，不与新成果混包。",
          },
        ],
      );
  return result.sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      Number(a.source.kind === "unresolved") -
        Number(b.source.kind === "unresolved") ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.key.localeCompare(b.key),
  );
}
