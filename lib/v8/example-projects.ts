import type {
  Approval,
  Artifact,
  AssetKey,
  ConceptBranch,
  Project,
  RequirementRevision,
} from "./types";
import { MODEL_BYTES, TEMPLATE_CATALOG, modelSourceInfo } from "./catalog";
import { createDesignReport } from "./design-report";
import { V8Error } from "./state";
import {
  parseRequirementBrief,
  serializeRequirementsPurpose,
  serializeRequirementsConstraints,
} from "./requirements-brief";

/** Static developer examples, never loaded by LiveRepository or production. */
export const PREVIEW_EXAMPLE_VERSION = 3;
export const RETIRED_GO2_EXAMPLE_ID = "demo-example-go2-reference";
export const PREVIEW_EXAMPLE_IDS = [
  "demo-example-q4-inspection",
  "demo-example-c2-logistics",
  "demo-example-ai-review",
  "demo-example-complete-inspection",
] as const;
export const PREVIEW_EXAMPLE_LINKS = [
  {
    id: PREVIEW_EXAMPLE_IDS[0],
    name: "仓储巡检 · Q4 示例",
    stage: "library",
    route: "library",
  },
  {
    id: PREVIEW_EXAMPLE_IDS[1],
    name: "产线配送 · C2 示例",
    stage: "library",
    route: "library",
  },
  {
    id: PREVIEW_EXAMPLE_IDS[2],
    name: "巡检平台 · 版本确认示例",
    stage: "cad",
    route: "custom",
  },
  {
    id: PREVIEW_EXAMPLE_IDS[3],
    name: "仓储巡检 · 完整流程示例",
    stage: "delivery",
    route: "custom",
  },
] as const;
/** These IDs are verified by the original counter-based fixture builder tests. */
export const LEGACY_INITIAL_PROJECT_IDS = [
  "demo-project-1",
  "demo-project-5",
] as const;
export const RETIRED_EXAMPLE_REDIRECTS: Record<string, string> = {
  [LEGACY_INITIAL_PROJECT_IDS[0]]: PREVIEW_EXAMPLE_IDS[0],
  [LEGACY_INITIAL_PROJECT_IDS[1]]: PREVIEW_EXAMPLE_IDS[2],
  [RETIRED_GO2_EXAMPLE_ID]: PREVIEW_EXAMPLE_IDS[0],
};

/** Original catalog retained only to prove an untouched historical fixture. */
export const LEGACY_CONCEPT_FIXTURE: typeof import("./catalog").CONCEPT_CATALOG =
  [
    {
      assetKey: "compact",
      name: "紧凑轮式",
      differentiator: "低重心轮式底盘 · 紧凑上装",
      rationale: "样例方向 A：展示室内平整场地的紧凑布局思路。",
      limitation: "开发样例；通过能力、载荷与续航尚未工程验证。",
      mediaType: "model",
    },
    {
      assetKey: "quadruped",
      name: "四足越障",
      differentiator: "四足结构 · 高位感知平台",
      rationale: "样例方向 B：通过不同支撑结构比较通过性与复杂度。",
      limitation: "开发样例；关节运动、稳定性与制造条件尚未验证。",
      mediaType: "model",
    },
    {
      assetKey: "tripod",
      name: "三足探索",
      differentiator: "三点支撑 · 中央竖直躯干",
      rationale: "样例方向 C：比较三足布局，保留较大的中央设备空间。",
      limitation: "二维概念示意；不提供三维编辑与工程性能承诺。",
      mediaType: "image",
    },
  ];

/** Exact values, including unrecognized fields, participate in cleanup checks. */
export function sameProjectSnapshot(a: Project, b: Project): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map(
            (key) =>
              JSON.stringify(key) +
              ":" +
              canonical((value as Record<string, unknown>)[key]),
          )
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  };
  return canonical(a) === canonical(b);
}

function baseProject(
  id: string,
  name: string,
  text: string,
  purpose: string,
  constraints: string,
  timestamp: string,
  missingFields: string[],
): Project {
  const brief = parseRequirementBrief("", constraints);
  brief.task = purpose;
  brief.site =
    id === PREVIEW_EXAMPLE_IDS[1]
      ? "室内产线与目标工位"
      : id === PREVIEW_EXAMPLE_IDS[0]
        ? "室内仓储与设备测点"
        : "室内设备巡检场景";
  brief.payload =
    id === PREVIEW_EXAMPLE_IDS[1]
      ? "料箱与托盘，尺寸和质量待确认"
      : "相机及感知组件，安装空间待复核";
  const requirement: RequirementRevision = {
    id: `${id}-requirement-v01`,
    sequence: 1,
    projectId: id,
    text,
    purpose: serializeRequirementsPurpose(brief),
    constraints,
    sources: [
      {
        id: `${id}-source-brief`,
        name: "典型场景简报 · 开发样例",
        kind: "text",
        parseStatus: "ready",
        text,
        location: "local-preview",
      },
    ],
    missingFields,
    status: missingFields.length ? "needs_input" : "ready",
    createdAt: timestamp,
  };
  return {
    id,
    name,
    ownerId: "local-preview-user",
    projectType: "EMBODIED_AI",
    source: "preview",
    status: "开发样例",
    createdAt: timestamp,
    updatedAt: timestamp,
    requirements: [requirement],
    branches: [],
    approvals: [],
    cadRuns: [],
    tasks: [],
    artifacts: [],
    parameters: {},
    journey: [
      {
        id: `${id}-event-brief`,
        kind: "requirement",
        message: "典型场景开发样例：保存需求简报 V01，工程指标仍待核实。",
        refId: requirement.id,
        createdAt: timestamp,
      },
    ],
  };
}
function modelArtifact(
  project: Project,
  key: AssetKey,
  metadata: Partial<Artifact>,
): Artifact {
  const source = modelSourceInfo(key);
  return {
    id: `${project.id}-artifact-model`,
    projectId: project.id,
    kind: "model",
    fileName: `${key}.glb`,
    mimeType: "model/gltf-binary",
    sizeBytes: MODEL_BYTES[key],
    status: "ready",
    url: `/v8-assets/${key}.glb`,
    source: source.source,
    license: source.license,
    licenseUrl: source.licenseUrl,
    provenanceUrl: source.provenanceUrl,
    authorized: true,
    createdAt: project.updatedAt,
    assetKey: key,
    ...metadata,
  };
}
function addDocuments(
  project: Project,
  selector: {
    templateId?: string;
    approvalId?: string;
    revisionId?: string;
    requirementId: string;
    parameters?: Record<string, number>;
  },
  metadata: Partial<Artifact>,
  markdown: string,
) {
  const sourceKey = project.templateId
    ? TEMPLATE_CATALOG.find((item) => item.id === project.templateId)!.assetKey
    : project.branches[0].revisions.at(-1)!.assetKey;
  const source = modelSourceInfo(sourceKey);
  project.artifacts.push({
    id: `${project.id}-artifact-brief`,
    projectId: project.id,
    kind: "design_document",
    fileName: `${project.id}-design.md`,
    mimeType: "text/markdown;charset=utf-8",
    sizeBytes: new TextEncoder().encode(markdown).byteLength,
    status: "ready",
    content: markdown,
    source: source.source,
    license: source.license,
    licenseUrl: source.licenseUrl,
    provenanceUrl: source.provenanceUrl,
    authorized: true,
    createdAt: project.updatedAt,
    assetKey: sourceKey,
    ...metadata,
  });
  const report = createDesignReport(project, selector, {
    createdAt: project.updatedAt,
  });
  project.artifacts.push({
    id: `${project.id}-artifact-report`,
    projectId: project.id,
    kind: "design_document",
    fileName: report.fileName,
    mimeType: report.mimeType,
    sizeBytes: report.sizeBytes,
    status: "ready",
    content: report.html,
    assetKey: sourceKey,
    source: source.source,
    license: source.license,
    licenseUrl: source.licenseUrl,
    provenanceUrl: source.provenanceUrl,
    authorized: true,
    createdAt: project.updatedAt,
    ...metadata,
  });
}
function templateExample(
  id: string,
  name: string,
  templateId: string,
  brief: string,
  purpose: string,
  constraints: string,
  parameters: Record<string, number>,
  timestamp: string,
  missing: string[],
): Project {
  const project = baseProject(
    id,
    name,
    brief,
    purpose,
    constraints,
    timestamp,
    missing,
  );
  const template = TEMPLATE_CATALOG.find((item) => item.id === templateId)!;
  project.route = "library";
  project.templateId = templateId;
  project.parameters = { ...parameters };
  project.status = "样例成果可查看";
  const requirementId = project.requirements[0].id;
  project.journey.push({
    id: `${id}-event-template`,
    kind: "template",
    message: `样例保存“${template.name}”及视图配置；直接复用来源模型，未执行 CAD。`,
    refId: templateId,
    createdAt: timestamp,
  });
  const refs = {
    templateId,
    assetKey: template.assetKey,
    requirementId,
    parameterSnapshot: { ...parameters },
  };
  project.artifacts.push(modelArtifact(project, template.assetKey, refs));
  const markdown = `# ${name} — 设计方案\n\n> 典型场景开发样例；来源文件可实际打开。未执行真实 AI/CAD 或工程验证。\n\n## 需求简报\n\n${brief}\n\n用途：${purpose}\n\n约束：${constraints}\n\n## 选用模型\n\n${template.name}\n\n${template.description}\n\n## 视图配置\n\n${JSON.stringify(parameters, null, 2)}\n\n位置偏移仅作用于 Web3D 视图，源 GLB 保持原始几何。\n\n## 来源与许可\n\n${template.source}\n\n${template.license}\n\n${template.precisionNote}\n\n需求版本：${requirementId}\n\n许可：${template.licenseUrl}\n\n来源记录：${template.provenanceUrl}\n`;
  addDocuments(
    project,
    { templateId, requirementId, parameters },
    refs,
    markdown,
  );
  return project;
}
function reviewExample(complete = false): Project {
  const index = complete ? 3 : 2;
  const id = PREVIEW_EXAMPLE_IDS[index],
    at = "2026-11-12T09:20:00.000Z";
  const project = baseProject(
    id,
    PREVIEW_EXAMPLE_LINKS[index].name,
    "比较用于室内设备巡查的四足与轮式平台，重点复核感知安装、维护空间和模型来源。先形成可追溯的概念版本，再查看样例工程结果与设计方案。",
    "室内设备巡检方案比较与版本确认",
    "本例只演示方案与文件来源链路；地面条件、任务载荷、续航和验收指标待真实项目确认。详细来源几何不代表已完成定制 CAD。",
    "2026-11-12T08:50:00.000Z",
    ["请补充实际通道净宽、任务载荷与场景验收条件。"],
  );
  if (complete) {
    const brief = parseRequirementBrief();
    Object.assign(brief, {
      task: "对仪表、指示灯与设备表面进行定点巡查，留存图像和异常位置。",
      site: "室内仓库，规划 12 个设备测点，每日 2 轮。",
      payload: "沿用来源模型的相机总成与感知附件；本例不增加额外载荷。",
      workspace: "场景目标：约 5,000 m²，通道净宽不小于 1 m，无楼梯。",
      performance: "设计目标：覆盖全部 12 个测点；单轮预留 60 分钟。",
      environment: "干燥平整地面、室内常温；弱光测点安排补光。",
      safety: "人车接近时停机等待；异常任务交由操作员接管。",
      integration: "图像记录关联测点编号、时间与位置；本地导出任务记录。",
      acceptance: "后续验证目标：12/12 测点记录完整，模拟受阻能停止并保留事件。",
    });
    Object.assign(project.requirements[0], {
      text: "为室内仓库设计四足巡检方案，完成测点采集、异常复核与返航安排，并复核相机安装及维护空间。",
      purpose: serializeRequirementsPurpose(brief),
      constraints: serializeRequirementsConstraints(brief),
      missingFields: [], status: "ready",
    });
    project.requirements[0].sources[0].text = project.requirements[0].text;
    project.journey[0].message = "保存完整示例需求 V01 与场景设计目标。";
  }
  const requirementId = project.requirements[0].id;
  const a: ConceptBranch = {
    id: `${id}-branch-q4`,
    projectId: id,
    name: "四足巡检 · 感知维护优先",
    differentiator: "四足本体 · 来源相机总成 · 维护空间复核",
    rationale: "通过详细巡检参考构型，讨论相机安装与多关节结构的维护方式。",
    limitation:
      "来源可视网格与官网概念附件，仅用于结构讨论；未验证载荷、稳定性、感知性能或可制造性。",
    latestRevisionId: `${id}-q4-revision-v02`,
    revisions: [
      {
        id: `${id}-q4-revision-v01`,
        branchId: `${id}-branch-q4`,
        sequence: 1,
        descriptionId: `${id}-q4-description-v01`,
        description:
          "典型场景样例 V01：以官网精细巡检构型作为讨论参考，复核机身、腿部与感知总成。保留来源几何，不宣称生成了新的工程结构。",
        assetKey: "inspection-reference",
        mediaType: "model",
        changeSummary: "初始方向：保留来源结构，讨论巡检与维护需求。",
        status: "ready",
        requirementId,
        parameterSnapshot: { inspectionCameraHeight: 0 },
        createdAt: "2026-11-12T09:00:00.000Z",
      },
      {
        id: `${id}-q4-revision-v02`,
        branchId: `${id}-branch-q4`,
        sequence: 2,
        descriptionId: `${id}-q4-description-v02`,
        description:
          "典型场景样例 V02：在 V01 基础上优先核对相机支架的维护通道、线缆空间和来源部件关系。当前使用 inspection-reference 原始几何；本次修订是固定设计描述，未执行真实 AI/CAD 重建。地面、载荷、续航和验收指标仍待确认。",
        assetKey: "inspection-reference",
        mediaType: "model",
        changeSummary:
          "明确相机总成维护与线缆空间复核；保留 V01 与原始来源几何。",
        status: "ready",
        requirementId,
        parameterSnapshot: { inspectionCameraHeight: 0 },
        parentRevisionId: `${id}-q4-revision-v01`,
        createdAt: "2026-11-12T09:10:00.000Z",
      },
    ],
  };
  const b: ConceptBranch = {
    id: `${id}-branch-c2`,
    projectId: id,
    name: "轮式平台 · 模块布局优先",
    differentiator: "轮式底盘 · 举升与电控布局 · 独立版本历史",
    rationale: "以官网详细移动平台讨论平整地面上的巡检载体与设备布置。",
    limitation: "项目提供的详细概念参考，不代表已验证量产 AMR 或新增制造图纸。",
    latestRevisionId: `${id}-c2-revision-v01`,
    revisions: [
      {
        id: `${id}-c2-revision-v01`,
        branchId: `${id}-branch-c2`,
        sequence: 1,
        descriptionId: `${id}-c2-description-v01`,
        description:
          "典型场景样例：使用来源明确的 mobile-reference 详细概念模型，比较轮式底盘的设备布置、检修与对接空间。此方向保持独立 V01，未批准或生成工程任务。",
        assetKey: "mobile-reference",
        mediaType: "model",
        changeSummary: "独立轮式方向 V01；尚未确认。",
        status: "ready",
        requirementId,
        parameterSnapshot: { mobileCameraHeight: 0 },
        createdAt: "2026-11-12T09:00:00.000Z",
      },
    ],
  };
  project.route = "custom";
  project.status = "样例工程结果可查看";
  project.branches = [a, b];
  if (complete) {
    a.revisions[0].description = "示例设计 V01：以详细四足巡检来源构型覆盖室内仓库的 12 个设备测点，保持原始组件关系，规划采集、异常复核与返航。";
    a.revisions[1].description = "示例设计 V02：沿用四足巡检构型，核对相机安装、线缆与维护空间；相机总成高度偏移为 0 m。作业目标为每日 2 轮、每轮 12 个测点。保留来源网格与参数，不代表真实 CAD 执行或现场验收通过。";
    a.revisions[1].changeSummary = "补齐相机维护与线缆复核要求，确认 V02。";
  }
  project.updatedAt = at;
  const revision = a.revisions[1];
  const approval: Approval = {
    id: `${id}-approval-q4-v02`,
    projectId: id,
    branchId: a.id,
    revisionId: revision.id,
    descriptionId: revision.descriptionId,
    description: revision.description,
    requirementId,
    assetKey: revision.assetKey,
    parameterSnapshot: { ...revision.parameterSnapshot },
    approvedAt: "2026-11-12T09:15:00.000Z",
  };
  const taskId = `${id}-task-cad`,
    runId = `${id}-cad-q4-v02`,
    artifactId = `${id}-artifact-model`;
  project.approvals.push(approval);
  project.tasks.push({
    id: taskId,
    projectId: id,
    type: "cad",
    status: "succeeded",
    currentStep: "开发样例历史：来源模型文件已就绪，未执行真实 CAD。",
    createdAt: "2026-11-12T09:16:00.000Z",
    updatedAt: at,
    completedAt: at,
    scenario: "success",
    resultIds: [runId],
    requirementId,
    parameterSnapshot: { ...revision.parameterSnapshot },
    sourceDescriptionId: revision.descriptionId,
    sourceDescription: revision.description,
    approvalId: approval.id,
    submissionState: "accepted",
  });
  project.cadRuns.push({
    id: runId,
    projectId: id,
    taskId,
    sourceApprovalId: approval.id,
    branchId: a.id,
    revisionId: revision.id,
    sourceDescriptionId: revision.descriptionId,
    sourceDescription: revision.description,
    requirementId,
    parameterSnapshot: { ...revision.parameterSnapshot },
    assetKey: revision.assetKey,
    status: "succeeded",
    artifactIds: [artifactId],
    validationStatus: "not_run",
    createdAt: "2026-11-12T09:16:00.000Z",
  });
  const refs = {
    requirementId,
    assetKey: revision.assetKey,
    parameterSnapshot: { ...revision.parameterSnapshot },
    branchId: a.id,
    revisionId: revision.id,
    descriptionId: revision.descriptionId,
    approvalId: approval.id,
  };
  project.artifacts.push(
    modelArtifact(project, revision.assetKey, { ...refs, cadRunId: runId }),
  );
  project.journey.push(
    {
      id: `${id}-event-directions`,
      kind: "concept",
      message: "开发样例：四足与轮式两个方向保留独立历史。",
      refId: a.id,
      createdAt: "2026-11-12T09:00:00.000Z",
    },
    {
      id: `${id}-event-revision`,
      kind: "revision",
      message: "四足方向新增 V02；V01 与轮式 V01 保留不变。",
      refId: revision.id,
      createdAt: "2026-11-12T09:10:00.000Z",
    },
    {
      id: `${id}-event-approval`,
      kind: "approval",
      message: "样例确认锁定四足 V02 与同一份设计描述。",
      refId: approval.id,
      createdAt: approval.approvedAt,
    },
    {
      id: `${id}-event-cad`,
      kind: "cad",
      message: "预置样例任务与实际来源 GLB 已就绪；工程验证未执行。",
      refId: runId,
      createdAt: at,
    },
  );
  const markdown = `# ${project.name} — 已确认设计方案\n\n> 预置开发样例；实际复用详细来源模型，未执行真实 CAD，也未完成工程验证。\n\n## 已确认版本\n\n${a.name} · V02\n\n${approval.description}\n\n## 来源链路\n\n项目：${id}\n\n需求：${requirementId}\n\n方向：${a.id}\n\n修订：${revision.id}\n\n描述：${revision.descriptionId}\n\n批准：${approval.id}\n\n样例工程任务：${taskId}\n\n模型：inspection-reference.glb\n\n## 工程边界\n\n保持来源网格与组件坐标；文件可用不代表可制造、任务性能通过或真实 CAD 服务已接入。\n\n许可：/v8-assets/inspection-LICENSE.txt\n\n来源记录：/v8-assets/inspection-provenance.json\n`;
  addDocuments(
    project,
    { approvalId: approval.id, revisionId: revision.id, requirementId },
    refs,
    markdown,
  );
  return project;
}

/** Builds fresh objects with deterministic, namespaced IDs; never changes a store. */
export function createTypicalExampleProjects(): Project[] {
  if (process.env.NODE_ENV === "production")
    throw new V8Error("PREVIEW_DISABLED", "生产环境不创建典型场景样例。");
  return [
    templateExample(
      PREVIEW_EXAMPLE_IDS[0],
      PREVIEW_EXAMPLE_LINKS[0].name,
      "sample-inspection",
      "为室内仓储巡检整理一套机器人结构参考方案，查看机身、四足与相机总成，并记录相机安装位置和维护空间的复核要点。",
      "仓储设备巡检与感知安装复核",
      "仅在来源构型支持范围内预览相机位置；通道、采集点位、载荷与续航待现场确认。",
      { inspectionCameraHeight: 0 },
      "2026-11-12T08:30:00.000Z",
      ["请补充实际通道净宽、净高与采集点位。"],
    ),
    templateExample(
      PREVIEW_EXAMPLE_IDS[1],
      PREVIEW_EXAMPLE_LINKS[1].name,
      "sample-mobile",
      "以室内产线料箱周转为背景，复核移动平台底盘、举升、电控和对接感知布局，形成来源明确的设计参考和配置说明。",
      "产线物料周转与工位对接结构讨论",
      "使用官网提供的详细概念源；托盘尺寸、实际载荷、工位接口与验收条件待确认，当前不声称具备现场配送能力。",
      { mobileCameraHeight: 0 },
      "2026-11-12T08:20:00.000Z",
      ["请补充料箱与托盘尺寸、载荷、目标工位接口。"],
    ),
    reviewExample(),
    reviewExample(true),
  ];
}

/** Retired default only; retained to compare the exact v1 example before cleanup. */
export function createRetiredGo2Example(): Project {
  if (process.env.NODE_ENV === "production")
    throw new V8Error("PREVIEW_DISABLED", "生产环境不创建已停用的开发样例。");
  return templateExample(
    RETIRED_GO2_EXAMPLE_ID,
    "结构复核 · Go2 示例",
    "sample-go2",
    "使用保留来源网格与装配坐标的 Go2 参考模型，检查机壳、关节和足端结构，作为后续设计讨论的来源基线。",
    "四足本体结构与来源基线复核",
    "原始网格参考不提供任意工程参数编辑，不形成新的制造 BOM；所有应用性能须另行验证。",
    {},
    "2026-11-12T08:10:00.000Z",
    [],
  );
}
