import { missingRequirementItems } from "./requirements-brief";
import type {
  Approval,
  AssetKey,
  Artifact,
  CADRun,
  ConceptBranch,
  ConceptRevision,
  CreateInput,
  Mode,
  ModelRecipe,
  Project,
  RequirementInput,
  RequirementRevision,
  Scenario,
  SourceRef,
  Task,
  V8Repository,
} from "./types";
import {
  CONCEPT_CATALOG,
  MODEL_BYTES,
  TEMPLATE_CATALOG,
  modelSourceInfo,
} from "./catalog";
import {
  approvalSourceValid,
  artifactSourceValid,
  canDownload,
  currentRequirement,
  findRevision,
  normalizeParameterSnapshot,
  parameterSnapshotsEqual,
  runSourceValid,
  V8Error,
} from "./state";
import { createDesignReport, type DesignReportSource } from "./design-report";
import {
  createTypicalExampleProjects,
  PREVIEW_EXAMPLE_VERSION,
  createRetiredGo2Example,
  LEGACY_INITIAL_PROJECT_IDS,
  LEGACY_CONCEPT_FIXTURE,
  RETIRED_GO2_EXAMPLE_ID,
  sameProjectSnapshot,
} from "./example-projects";
import { finalReportReadiness } from "./delivery-packages";
import { previewModelUrl } from "./preview-model-url";
import { validateGlbSecurity } from "../equipment/glb-security";
export * from "./types";
export * from "./catalog";
export * from "./state";

const STORAGE_KEY = "embodex-v8-preview-v1";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const iso = (time: number) => new Date(time).toISOString();
interface Store {
  schema: 1;
  sequence: number;
  scenario: Scenario;
  projects: Project[];
  intents: Record<string, { projectId: string; signature: string }>;
  exampleSeedVersion?: number;
}
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface PreviewRepositoryOptions {
  /** Isolated state-machine unit fixtures; never selected by the application. */
  seedPreset?: "legacy-fixture";
  materializeArtifact?: (
    artifact: Artifact,
  ) => Promise<ArtifactMaterialization>;
}
export interface ArtifactMaterialization {
  sizeBytes: number;
  sha256: string;
  sourceSha256: string;
}
const CONFIGURED_ASSETS = new Set<AssetKey>([
  "inspection-reference",
  "mobile-reference",
  "go2-high-fidelity",
]);
const shaPattern = /^[a-f0-9]{64}$/;

async function materializePreviewArtifact(
  artifact: Artifact,
): Promise<ArtifactMaterialization> {
  if (!artifact.url || !artifact.modelRecipe)
    throw new V8Error("MODEL_RECIPE_MISSING", "模型缺少冻结导出配置。");
  const response = await fetch(artifact.url, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new V8Error(
      "MODEL_EXPORT_FAILED",
      `配置模型暂时无法准备（${response.status}）。请重试文件同步。`,
    );
  const buffer = await response.arrayBuffer();
  validateGlbSecurity(buffer);
  const sizeBytes = Number(response.headers.get("Content-Length"));
  const sha256 = response.headers.get("X-V8-Sha256") || "";
  const sourceSha256 = response.headers.get("X-V8-Source-Sha256") || "";
  const actualHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (
    !buffer.byteLength ||
    sizeBytes !== buffer.byteLength ||
    sha256 !== actualHash ||
    !shaPattern.test(sourceSha256)
  )
    throw new V8Error(
      "MODEL_EXPORT_INVALID",
      "配置模型的实际字节数或摘要不一致，已阻止交付。",
    );
  return { sizeBytes, sha256, sourceSha256 };
}

/** Developer-only fixture repository. Never instantiate this from a production route. */
export class PreviewRepository implements V8Repository {
  readonly mode = "preview" as const;
  private memory?: Store;
  private materializing = new Map<string, Promise<ArtifactMaterialization>>();
  private configuredAsset(assetKey: AssetKey) {
    return (
      this.options.seedPreset !== "legacy-fixture" &&
      CONFIGURED_ASSETS.has(assetKey)
    );
  }
  private async materializePending(id: string): Promise<Project> {
    const store = this.read();
    this.ensureOnline(store);
    const snapshot = clone(this.project(store, id));
    const candidates = snapshot.artifacts.filter(
      (artifact) =>
        artifact.kind === "model" &&
        artifact.modelRecipe &&
        ["validating", "failed"].includes(artifact.status),
    );
    await Promise.all(
      candidates.map(async (artifact) => {
        if (!artifactSourceValid(snapshot, artifact)) return;
        const identity = JSON.stringify([artifact.id, artifact.url]);
        let result: ArtifactMaterialization | undefined,
          error: string | undefined;
        try {
          if (
            artifact.sha256 &&
            artifact.sourceSha256 &&
            artifact.sizeBytes > 0
          )
            result = {
              sizeBytes: artifact.sizeBytes,
              sha256: artifact.sha256,
              sourceSha256: artifact.sourceSha256,
            };
          else {
            let request = this.materializing.get(identity);
            if (!request) {
              request = (
                this.options.materializeArtifact || materializePreviewArtifact
              )(clone(artifact));
              this.materializing.set(identity, request);
            }
            try {
              result = await request;
            } finally {
              if (this.materializing.get(identity) === request)
                this.materializing.delete(identity);
            }
          }
          if (
            !Number.isInteger(result.sizeBytes) ||
            result.sizeBytes <= 0 ||
            !shaPattern.test(result.sha256) ||
            !shaPattern.test(result.sourceSha256)
          )
            throw new V8Error(
              "MODEL_EXPORT_INVALID",
              "导出文件没有有效的实际大小和摘要。",
            );
        } catch (cause) {
          error =
            cause instanceof Error
              ? cause.message
              : "配置模型准备失败，请重试文件同步。";
        }
        // Other saves may have completed while the actual GLB bytes were read.
        const latest = this.read();
        this.ensureOnline(latest);
        const project = latest.projects.find((item) => item.id === id);
        const current = project?.artifacts.find(
          (item) => item.id === artifact.id,
        );
        if (
          !project ||
          !current ||
          current.url !== artifact.url ||
          !["validating", "failed"].includes(current.status) ||
          !artifactSourceValid(project, current)
        )
          return;
        if (error) {
          current.status = "failed";
          current.error = error;
        } else if (result) {
          Object.assign(current, result);
          current.status =
            latest.scenario === "files-pending" ? "validating" : "ready";
          delete current.error;
        }
        project.updatedAt = iso(this.now());
        this.write(latest);
      }),
    );
    return clone(this.project(this.read(), id));
  }
  constructor(
    private storage?: StoragePort,
    private now: () => number = Date.now,
    private options: PreviewRepositoryOptions = {},
  ) {
    this.assertPreviewEnabled();
  }
  private assertPreviewEnabled() {
    if (process.env.NODE_ENV === "production")
      throw new V8Error(
        "PREVIEW_DISABLED",
        "生产环境禁用开发样例。请使用真实接口模式。",
      );
  }
  private getStorage() {
    return (
      this.storage ??
      (typeof window !== "undefined" ? window.localStorage : undefined)
    );
  }
  private read(): Store {
    this.assertPreviewEnabled();
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        let store: Store;
        try {
          store = JSON.parse(raw) as Store;
        } catch {
          throw new V8Error(
            "CACHE_CORRUPT",
            "样例缓存损坏。请使用“重置样例”重新体验。",
          );
        }
        if (store.schema === 1 && Array.isArray(store.projects)) {
          // Development fixtures can gain assembly metadata without discarding
          // saved branches. Refresh only the known authored fixture byte counts.
          for (const project of store.projects) {
            for (const artifact of project.artifacts) {
              const assetKey = artifact.url?.match(
                /^\/v8-assets\/(compact|quadruped|tripod|conveyor)\.glb$/,
              )?.[1];
              if (
                artifact.source === "authored-sample" &&
                artifact.kind === "model" &&
                assetKey
              )
                artifact.sizeBytes =
                  MODEL_BYTES[assetKey as keyof typeof MODEL_BYTES];
            }
          }
          if (this.addTypicalExamples(store)) this.write(store);
          return store;
        }
        throw new V8Error("CACHE_SCHEMA", "样例缓存版本不兼容。请重置样例。");
      }
    }
    if (this.memory) return clone(this.memory);
    const store: Store = {
      schema: 1,
      sequence: 0,
      scenario: "success",
      projects: [],
      intents: {},
    };
    if (this.options.seedPreset === "legacy-fixture") {
      store.projects = this.buildLegacyProjects(store, iso(this.now()));
    } else {
      // Do not reuse the retired counter-based sample IDs for a new user design.
      store.sequence = 64;
      this.addTypicalExamples(store);
    }
    this.write(store);
    return clone(store);
  }
  private buildLegacyProjects(
    store: Store,
    timestamp: string,
    catalog = CONCEPT_CATALOG,
  ): Project[] {
    const first = this.newProject(
      store,
      {
        name: "园区巡检机器人",
        text: "设计一台用于园区日常巡检的机器人，需要搭载视觉传感器，便于维护。",
        purpose: "园区巡检",
        constraints: "需确认地形、负载与续航；可先比较已有模板。",
      },
      timestamp,
    );
    const second = this.newProject(
      store,
      {
        name: "三足服务机器人 · 概念探索",
        text: "探索三足服务机器人的不同结构方向，用于室内服务与引导。",
        purpose: "室内服务与引导",
        constraints: "三足布局；概念探索阶段，未提供工程性能要求。",
      },
      timestamp,
    );
    second.route = "custom";
    this.appendBranches(store, second, 3, timestamp, undefined, catalog);
    return [first, second];
  }
  /** Remove only fully matched untouched default fixtures, not edited projects. */
  private isUntouchedOriginal(project: Project): boolean {
    if (
      !(LEGACY_INITIAL_PROJECT_IDS as readonly string[]).includes(project.id) ||
      project.source !== "preview" ||
      project.updatedAt !== project.createdAt
    )
      return false;
    const created = Date.parse(project.createdAt);
    if (!Number.isFinite(created)) return false;
    for (const catalog of [CONCEPT_CATALOG, LEGACY_CONCEPT_FIXTURE]) {
      const known = new PreviewRepository(undefined, () => created, {
        seedPreset: "legacy-fixture",
      });
      const scratch: Store = {
        schema: 1,
        sequence: 0,
        scenario: "success",
        projects: [],
        intents: {},
      };
      const baseline = known
        .buildLegacyProjects(scratch, project.createdAt, catalog)
        .find((item) => item.id === project.id);
      if (!baseline || baseline.journey.length !== project.journey.length)
        continue;
      // Original Date.now() calls could differ by a few milliseconds. Those
      // creation-clock values are replayed only within the initial seed window;
      // every other field, key and historical event must still match exactly.
      if (
        project.journey.some(
          (event) =>
            !Number.isFinite(Date.parse(event.createdAt)) ||
            Date.parse(event.createdAt) < created ||
            Date.parse(event.createdAt) > created + 1000,
        )
      )
        continue;
      baseline.journey.forEach((event, index) => {
        event.createdAt = project.journey[index].createdAt;
      });
      if (sameProjectSnapshot(project, baseline)) return true;
    }
    return false;
  }
  /** One-time conservative cleanup plus missing-default insertion. */
  private addTypicalExamples(store: Store): boolean {
    if (this.options.seedPreset === "legacy-fixture") return false;
    if ((store.exampleSeedVersion || 0) >= PREVIEW_EXAMPLE_VERSION)
      return false;
    store.projects = store.projects.filter((project) => {
      if (this.isUntouchedOriginal(project)) return false;
      if (
        project.id === RETIRED_GO2_EXAMPLE_ID &&
        sameProjectSnapshot(project, createRetiredGo2Example())
      )
        return false;
      return true;
    });
    const existing = new Set(store.projects.map((project) => project.id));
    for (const project of createTypicalExampleProjects()) {
      if (!existing.has(project.id)) store.projects.push(project);
    }
    store.exampleSeedVersion = PREVIEW_EXAMPLE_VERSION;
    return true;
  }
  private write(store: Store) {
    const serialized = JSON.stringify(store);
    try {
      this.getStorage()?.setItem(STORAGE_KEY, serialized);
    } catch {
      throw new V8Error(
        "CACHE_WRITE_FAILED",
        "浏览器未能保存样例状态。请检查存储权限或空间后重试。",
      );
    }
    this.memory = clone(store);
  }
  private id(store: Store, prefix: string) {
    return `demo-${prefix}-${++store.sequence}`;
  }
  private project(store: Store, id: string) {
    const p = store.projects.find((item) => item.id === id);
    if (!p)
      throw new V8Error("NOT_FOUND", "项目不存在或不属于当前样例空间。", 404);
    return p;
  }
  private ensureOnline(store: Store) {
    if (
      store.scenario === "offline" ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    )
      throw new V8Error(
        "NETWORK_ERROR",
        "网络已中断。已保存的内容仍保留，恢复连接后请刷新状态。",
      );
  }
  private event(
    store: Store,
    p: Project,
    kind: string,
    message: string,
    refId?: string,
  ) {
    p.journey.push({
      id: this.id(store, "event"),
      kind,
      message,
      refId,
      createdAt: iso(this.now()),
    });
  }
  private requirement(
    store: Store,
    projectId: string,
    input: RequirementInput,
    sequence: number,
    at: string,
  ): RequirementRevision {
    const text = input.text.trim();
    if (!text)
      throw new V8Error("INVALID_INPUT", "请先写下需要设计的对象和用途。");
    if (text.length > 50000)
      throw new V8Error(
        "INVALID_INPUT",
        "需求文本超过 50,000 字，请缩短后保存。",
      );
    return {
      id: this.id(store, "req"),
      sequence,
      projectId,
      text,
      purpose: input.purpose?.trim() || "",
      constraints: input.constraints?.trim() || "",
      sources: [
        {
          id: this.id(store, "source"),
          name: "用户直接输入",
          kind: "text",
          parseStatus: "ready",
          location: "local-preview",
          text,
        },
        ...(input.attachments || []),
      ],
      missingFields: missingRequirementItems(
        input.purpose || "",
        input.constraints || "",
      ),
      status: missingRequirementItems(
        input.purpose || "",
        input.constraints || "",
      ).length
        ? "needs_input"
        : "ready",
      createdAt: at,
    };
  }
  private newProject(store: Store, input: CreateInput, at: string): Project {
    const id = this.id(store, "project");
    const project: Project = {
      id,
      name: input.name?.trim() || input.text.trim().slice(0, 24),
      ownerId: "local-preview-user",
      projectType: input.projectType || "EMBODIED_AI",
      status: "明确需求",
      updatedAt: at,
      createdAt: at,
      requirements: [],
      branches: [],
      approvals: [],
      cadRuns: [],
      tasks: [],
      artifacts: [],
      journey: [],
      parameters: {},
      source: "preview",
    };
    project.requirements.push(this.requirement(store, id, input, 1, at));
    this.event(
      store,
      project,
      "requirement",
      "创建需求 V01（本机样例）",
      project.requirements[0].id,
    );
    return project;
  }
  private mutate(
    id: string | undefined,
    key: string | undefined,
    signature: string,
    fn: (store: Store, p?: Project) => Project,
    loseResponse = false,
  ): Project {
    const store = this.read();
    this.ensureOnline(store);
    if (key && store.intents[key]) {
      const intent = store.intents[key];
      if (intent.signature !== signature)
        throw new V8Error(
          "IDEMPOTENCY_CONFLICT",
          "同一个提交标识不能用于不同操作。请刷新后重新提交。",
          409,
        );
      return clone(this.project(store, intent.projectId));
    }
    const p = fn(store, id ? this.project(store, id) : undefined);
    p.updatedAt = iso(this.now());
    if (key) store.intents[key] = { projectId: p.id, signature };
    this.write(store);
    if (loseResponse && store.scenario === "response-lost")
      throw new V8Error(
        "UNKNOWN_SUBMISSION",
        "提交响应丢失，任务可能已被受理。请先“刷新状态”核实，勿重复提交。",
      );
    return clone(p);
  }
  snapshot() {
    return clone(this.read().projects);
  }
  // Offline reads remain available from this explicitly local sample store.
  // Mutations and task synchronization still fail until connectivity is restored.
  async list() {
    const store = this.read();
    return clone(store.projects).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  async get(id: string) {
    const store = this.read();
    return clone(this.project(store, id));
  }
  async create(input: CreateInput, key?: string) {
    return this.mutate(
      undefined,
      key,
      `create:${JSON.stringify(input)}`,
      (store) => {
        const p = this.newProject(store, input, iso(this.now()));
        store.projects.unshift(p);
        return p;
      },
    );
  }
  async saveRequirements(id: string, input: RequirementInput, key?: string) {
    return this.mutate(
      id,
      key,
      `requirements:${id}:${JSON.stringify(input)}`,
      (store, p) => {
        p!.requirements.push(
          this.requirement(
            store,
            id,
            input,
            p!.requirements.length + 1,
            iso(this.now()),
          ),
        );
        this.event(
          store,
          p!,
          "requirement",
          `保存需求 V${String(p!.requirements.length).padStart(2, "0")}；既有概念和成果保留历史归属。`,
          p!.requirements.at(-1)!.id,
        );
        return p!;
      },
    );
  }
  async chooseRoute(id: string, route: "library" | "custom") {
    return this.mutate(id, undefined, `route:${route}`, (store, p) => {
      p!.route = route;
      if (route === "custom" && p!.templateId)
        p!.referenceTemplateId = p!.templateId;
      p!.status = route === "library" ? "资源适配" : "概念探索";
      this.event(
        store,
        p!,
        "route",
        route === "library" ? "进入模板库" : "进入 专业定制",
      );
      return p!;
    });
  }
  async upload(file: File): Promise<SourceRef> {
    const store = this.read();
    this.ensureOnline(store);
    if (file.size > 5 * 1024 * 1024)
      throw new V8Error(
        "FILE_TOO_LARGE",
        "附件超过 5 MB，请缩小文件或继续使用文本。",
      );
    const supported =
      /\.(txt|md|csv)$/i.test(file.name) &&
      (!file.type ||
        /^text\//.test(file.type) ||
        file.type === "application/octet-stream");
    const ref: SourceRef = {
      id: "",
      name: file.name,
      kind: "file",
      mimeType: file.type,
      sizeBytes: file.size,
      parseStatus: supported ? "ready" : "failed",
      location: "local-preview",
    };
    if (supported) {
      const text = await file.text();
      if (text.length > 100000)
        throw new V8Error(
          "FILE_TOO_LARGE",
          "文本附件超过 100,000 字，请截取相关内容。",
        );
      ref.text = text;
    } else
      ref.error =
        "本机预览只解析 TXT、Markdown、CSV；此文件尚未上传或解析。可改用文本继续。";
    // File.text() yields; re-read before writing so another save is never overwritten.
    const latest = this.read();
    this.ensureOnline(latest);
    ref.id = this.id(latest, "attachment");
    this.write(latest);
    return ref;
  }
  private appendBranches(
    store: Store,
    p: Project,
    count: number,
    at: string,
    requirementId?: string,
    candidates = CONCEPT_CATALOG,
    reference?: {
      templateId: string;
      assetKey: AssetKey;
      parameterSnapshot: Record<string, number>;
    },
  ) {
    const requirement = requirementId
      ? p.requirements.find(
          (r) => r.id === requirementId && r.projectId === p.id,
        )
      : currentRequirement(p);
    if (!requirement)
      throw new V8Error(
        "SOURCE_MISSING",
        "找不到任务冻结的需求版本，未用当前需求替代。",
      );
    const existing = new Set(
      p.branches.flatMap((b) => b.revisions.slice(0, 1).map((r) => r.assetKey)),
    );
    const catalog = candidates
      .filter((c) => !existing.has(c.assetKey))
      .slice(0, count);
    const ids: string[] = [];
    for (const item of catalog) {
      const branchId = this.id(store, "branch");
      const revision: ConceptRevision = {
        id: this.id(store, "revision"),
        branchId,
        sequence: 1,
        descriptionId: this.id(store, "description"),
        description: `开发样例方向：${item.name}。${item.differentiator}。\n用户需求（作为来源保留，不代表样例已满足）：${requirement.text}\n${item.limitation}${reference ? `\n参考模板：${reference.templateId}；冻结参考配置：${JSON.stringify(reference.parameterSnapshot)}。${reference.assetKey === item.assetKey ? "当前方向复用同一来源模型的受支持配置。" : "当前方向结构不同，只保留参考依据，不套用其他模型参数。"}` : ""}`,
        assetKey: item.assetKey,
        mediaType: item.mediaType,
        changeSummary: "初始概念 · 开发样例",
        status: "ready",
        requirementId: requirement.id,
        ...(this.options.seedPreset === "legacy-fixture"
          ? {}
          : {
              parameterSnapshot: normalizeParameterSnapshot(
                item.assetKey,
                reference?.assetKey === item.assetKey
                  ? reference.parameterSnapshot
                  : undefined,
              ),
            }),
        ...(reference
          ? {
              referenceTemplateId: reference.templateId,
              referenceParameterSnapshot: { ...reference.parameterSnapshot },
            }
          : {}),
        createdAt: at,
      };
      const branch: ConceptBranch = {
        id: branchId,
        projectId: p.id,
        name: item.name,
        differentiator: item.differentiator,
        rationale: item.rationale,
        limitation: item.limitation,
        revisions: [revision],
        latestRevisionId: revision.id,
      };
      p.branches.push(branch);
      ids.push(branchId);
      this.event(
        store,
        p,
        "concept",
        `新增方向“${branch.name}” V01`,
        branch.id,
      );
    }
    return ids;
  }
  private newTask(
    store: Store,
    p: Project,
    type: Task["type"],
    extra: Partial<Task>,
  ): Task {
    const at = iso(this.now());
    const task: Task = {
      id: this.id(store, "task"),
      projectId: p.id,
      type,
      status: "queued",
      currentStep: "已受理，等待执行",
      createdAt: at,
      updatedAt: at,
      scenario: store.scenario,
      requirementId: currentRequirement(p)!.id,
      resultIds: [],
      submissionState:
        store.scenario === "response-lost" ? "unknown" : "accepted",
      ...extra,
    };
    p.tasks.push(task);
    return task;
  }
  async generateConcepts(id: string, quantity = 3, key?: string) {
    return this.mutate(
      id,
      key,
      `concepts:${id}:${quantity}`,
      (store, p) => {
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
          throw new V8Error("INVALID_INPUT", "方向数量应为 1–10。");
        if (
          p!.tasks.some(
            (t) =>
              t.type === "concepts" &&
              ["queued", "running", "unknown"].includes(t.status),
          )
        )
          throw new V8Error("TASK_ACTIVE", "概念任务已在执行，请先刷新状态。");
        p!.route = "custom";
        const referenceTemplate = TEMPLATE_CATALOG.find(
          (item) => item.id === p!.referenceTemplateId,
        );
        const referenceModel = referenceTemplate
          ? p!.artifacts
              .filter(
                (item) =>
                  item.kind === "model" &&
                  item.templateId === referenceTemplate.id,
              )
              .at(-1)
          : undefined;
        this.newTask(store, p!, "concepts", {
          requestedCount: quantity,
          ...(referenceTemplate
            ? {
                referenceTemplateId: referenceTemplate.id,
                referenceParameterSnapshot: normalizeParameterSnapshot(
                  referenceTemplate.assetKey,
                  referenceModel?.parameterSnapshot,
                ),
              }
            : {}),
        });
        return p!;
      },
      true,
    );
  }
  async refine(
    id: string,
    branchId: string,
    revisionId: string,
    prompt: string,
    key?: string,
    parameterSnapshot?: Record<string, number>,
  ) {
    return this.mutate(
      id,
      key,
      `refine:${id}:${branchId}:${revisionId}:${prompt}:${JSON.stringify(parameterSnapshot || null)}`,
      (store, p) => {
        const source = findRevision(p!, branchId, revisionId);
        const frozenParameters = normalizeParameterSnapshot(
          source.assetKey,
          parameterSnapshot === undefined
            ? source.parameterSnapshot
            : { ...source.parameterSnapshot, ...parameterSnapshot },
        );
        if (!prompt.trim())
          throw new V8Error("INVALID_INPUT", "请描述希望修改的内容。");
        if (prompt.length > 10000)
          throw new V8Error(
            "INVALID_INPUT",
            "修改说明过长，请缩短到 10,000 字以内。",
          );
        if (
          p!.tasks.some(
            (t) =>
              t.type === "refine" &&
              t.branchId === branchId &&
              ["queued", "running", "unknown"].includes(t.status),
          )
        )
          throw new V8Error(
            "TASK_ACTIVE",
            "这个方向已有修改任务，请刷新状态。",
          );
        this.newTask(store, p!, "refine", {
          branchId,
          sourceRevisionId: revisionId,
          prompt: prompt.trim(),
          parameterSnapshot: frozenParameters,
          sourceDescriptionId: source.descriptionId,
          sourceDescription: source.description,
        });
        return p!;
      },
      true,
    );
  }
  async approve(
    id: string,
    branchId: string,
    revisionId: string,
    key?: string,
  ) {
    return this.mutate(
      id,
      key,
      `approve:${id}:${branchId}:${revisionId}`,
      (store, p) => {
        const revision = findRevision(p!, branchId, revisionId);
        normalizeParameterSnapshot(
          revision.assetKey,
          revision.parameterSnapshot,
        );
        const existing = p!.approvals.find(
          (a) =>
            a.revisionId === revisionId &&
            a.descriptionId === revision.descriptionId,
        );
        if (existing) {
          if (!approvalSourceValid(p!, existing))
            throw new V8Error(
              "SOURCE_MISMATCH",
              "现有批准与固定版本来源不一致，不能覆盖或重新解释。",
            );
          return p!;
        }
        const approval: Approval = {
          id: this.id(store, "approval"),
          projectId: id,
          branchId,
          revisionId,
          descriptionId: revision.descriptionId,
          description: revision.description,
          requirementId: revision.requirementId,
          assetKey: revision.assetKey,
          parameterSnapshot: { ...(revision.parameterSnapshot || {}) },
          approvedAt: iso(this.now()),
        };
        p!.approvals.push(approval);
        this.addDesignDocument(store, p!, approval);
        this.event(
          store,
          p!,
          "approval",
          `确认“${p!.branches.find((b) => b.id === branchId)!.name}” V${String(revision.sequence).padStart(2, "0")}，锁定设计描述。`,
          approval.id,
        );
        return p!;
      },
    );
  }
  private addDesignDocument(store: Store, p: Project, a: Approval) {
    const branch = p.branches.find((b) => b.id === a.branchId)!;
    const revision = findRevision(p, a.branchId, a.revisionId);
    const source = modelSourceInfo(revision.assetKey);
    const content = `# ${p.name} — 设计方案\n\n> Embodex 开发样例。本文件由已确认的不可变描述快照生成；未进行工程验证，不是制造文件。\n\n## 方案\n\n${branch.name} · V${String(revision.sequence).padStart(2, "0")}\n\n${a.description}\n\n## 来源\n\n- 项目：${p.id}\n- 方向：${a.branchId}\n- 版本：${a.revisionId}\n- 描述：${a.descriptionId}\n- 确认：${a.id}\n- 需求：${revision.requirementId}\n\n## 模型说明\n\n模型来源：${source.label}；${source.license}。${source.precisionNote}。仅交付来源明确的 GLB 参考文件，不包含 STEP 或原生 CAD。\n许可：${source.licenseUrl}\n来源校验：${source.provenanceUrl}\n`;
    p.artifacts.push({
      id: this.id(store, "artifact"),
      projectId: p.id,
      kind: "design_document",
      fileName: `design-${a.revisionId}.md`,
      mimeType: "text/markdown;charset=utf-8",
      sizeBytes: new TextEncoder().encode(content).byteLength,
      status: "ready",
      content,
      source: source.source,
      license: source.license,
      licenseUrl: source.licenseUrl,
      provenanceUrl: source.provenanceUrl,
      requirementId: revision.requirementId,
      assetKey: revision.assetKey,
      parameterSnapshot: { ...(a.parameterSnapshot || {}) },
      branchId: a.branchId,
      revisionId: a.revisionId,
      descriptionId: a.descriptionId,
      approvalId: a.id,
      authorized: true,
      createdAt: iso(this.now()),
    });
  }

  private addHtmlReport(
    store: Store,
    p: Project,
    selector: DesignReportSource,
    refs: Partial<Artifact>,
  ) {
    const report = createDesignReport(p, selector, {
      createdAt: iso(this.now()),
    });
    const source = modelSourceInfo(report.source.assetKey);
    p.artifacts.push({
      id: this.id(store, "artifact"),
      projectId: p.id,
      kind: "design_document",
      fileName: report.fileName,
      mimeType: report.mimeType,
      sizeBytes: report.sizeBytes,
      status: "ready",
      content: report.html,
      source: source.source,
      license: source.license,
      licenseUrl: source.licenseUrl,
      provenanceUrl: source.provenanceUrl,
      authorized: true,
      createdAt: iso(this.now()),
      ...refs,
    });
  }
  private ensureFinalReport(id: string, required = false): Project {
    const store = this.read();
    this.ensureOnline(store);
    const project = this.project(store, id),
      readiness = finalReportReadiness(project);
    if (!readiness.ready || !readiness.package) {
      if (required)
        throw new V8Error(
          "FINAL_REPORT_NOT_READY",
          readiness.missing || "对应模型文件尚未就绪",
        );
      return clone(project);
    }
    const pack = readiness.package;
    if (
      pack.artifacts.some(
        (a) =>
          a.kind === "design_document" && a.mimeType.startsWith("text/html"),
      )
    )
      return clone(project);
    const refs: Partial<Artifact> = {
      templateId: pack.source.templateId,
      approvalId: pack.source.approvalId,
      revisionId: pack.source.revisionId,
      branchId: pack.source.branchId,
      descriptionId: pack.source.descriptionId,
      cadRunId: pack.source.cadRunId,
      requirementId: pack.source.requirementId,
      assetKey: pack.source.assetKey,
      parameterSnapshot: pack.source.parameterSnapshot,
    };
    this.addHtmlReport(
      store,
      project,
      {
        templateId: refs.templateId,
        approvalId: refs.approvalId,
        revisionId: refs.revisionId,
        requirementId: refs.requirementId,
        parameters: refs.parameterSnapshot,
      },
      { ...refs, cadRunId: refs.cadRunId },
    );
    const report = project.artifacts.at(-1)!;
    if (refs.cadRunId)
      project.cadRuns
        .find((r) => r.id === refs.cadRunId)!
        .artifactIds.push(report.id);
    this.event(store, project, "delivery", "生成当前最终 HTML 方案", report.id);
    project.updatedAt = iso(this.now());
    this.write(store);
    return clone(project);
  }
  async finalizeReport(id: string) {
    return this.ensureFinalReport(id, true);
  }
  async startCad(id: string, approvalId: string, key?: string) {
    return this.mutate(
      id,
      key,
      `cad:${id}:${approvalId}`,
      (store, p) => {
        const approval = p!.approvals.find((a) => a.id === approvalId);
        if (!approval)
          throw new V8Error(
            "APPROVAL_REQUIRED",
            "请先确认一个明确的概念版本。",
          );
        if (!approvalSourceValid(p!, approval))
          throw new V8Error(
            "SOURCE_MISMATCH",
            "批准来源与设计描述不一致，已阻止工程生成。",
          );
        const revision = findRevision(
          p!,
          approval.branchId,
          approval.revisionId,
        );
        const existing = p!.cadRuns.find(
          (r) =>
            r.sourceApprovalId === approvalId &&
            ["queued", "running", "unknown", "succeeded"].includes(r.status),
        );
        if (existing) {
          if (!runSourceValid(p!, existing))
            throw new V8Error(
              "SOURCE_MISMATCH",
              "已有工程任务的冻结来源不一致，不能复用。",
            );
          return p!;
        }
        const task = this.newTask(store, p!, "cad", {
          approvalId,
          requirementId: revision.requirementId,
          sourceDescriptionId: approval.descriptionId,
          sourceDescription: approval.description,
          parameterSnapshot: { ...(approval.parameterSnapshot || {}) },
        });
        const run: CADRun = {
          id: this.id(store, "cad"),
          projectId: id,
          taskId: task.id,
          sourceApprovalId: approvalId,
          branchId: approval.branchId,
          revisionId: approval.revisionId,
          sourceDescriptionId: approval.descriptionId,
          sourceDescription: approval.description,
          requirementId: revision.requirementId,
          parameterSnapshot: { ...(approval.parameterSnapshot || {}) },
          assetKey: revision.assetKey,
          status: "queued",
          artifactIds: [],
          validationStatus: "not_run",
          createdAt: iso(this.now()),
        };
        p!.cadRuns.push(run);
        this.event(store, p!, "cad", "工程任务已受理（开发样例）", run.id);
        return p!;
      },
      true,
    );
  }
  async useTemplate(
    id: string,
    templateId: string,
    parameters: Record<string, number>,
    key?: string,
  ) {
    const result = this.mutate(
      id,
      key,
      `template:${id}:${templateId}:${JSON.stringify(parameters)}`,
      (store, p) => {
        const template = TEMPLATE_CATALOG.find((t) => t.id === templateId);
        if (!template)
          throw new V8Error("TEMPLATE_MISSING", "这个模板不存在，请重新选择。");
        parameters = normalizeParameterSnapshot(template.assetKey, parameters);
        const requirement = currentRequirement(p!)!;
        const existing = p!.artifacts.find(
          (a) =>
            a.kind === "model" &&
            a.templateId === templateId &&
            a.requirementId === requirement.id &&
            parameterSnapshotsEqual(a.parameterSnapshot, parameters),
        );
        if (existing) {
          p!.route = "library";
          p!.templateId = templateId;
          p!.parameters = { ...parameters };
          return p!;
        }
        const configured = this.configuredAsset(template.assetKey);
        const recipe: ModelRecipe | undefined = configured
          ? {
              assetKey: template.assetKey,
              parameterSnapshot: { ...parameters },
              provenance: {
                projectId: id,
                requirementId: requirement.id,
                templateId,
              },
            }
          : undefined;
        p!.route = "library";
        p!.templateId = templateId;
        p!.parameters = { ...parameters };
        p!.status = "成果可查看";
        const content = `# ${p!.name} — 模板适配说明\n\n> 开发预览 · ${template.sourceKind === "licensed-reference" ? "已注明来源的开源参考模型" : template.sourceKind === "supplied-concept-reference" ? "项目提供的精细概念参考" : "原创结构示意模型"}。未进行工程验证。\n\n模板：${template.name}\n\n需求：${requirement.text}\n\n## 冻结配置\n\n${JSON.stringify(parameters, null, 2)}\n\n${configured ? "受支持参数已冻结。配置 GLB 仅在实际导出与字节校验后就绪；不调用真实 Agent 或 SolidWorks，不修改原始源文件。" : "调整仅作用于 Web3D 显示。下载的 GLB 是原始模板几何；本文件保存视图配置，不声称已重新生成 CAD。"}\n\n来源：${template.source}，${template.license}\n${template.precisionNote || "原创示意几何"}\n许可文件：${template.licenseUrl || "/v8-assets/LICENSE"}\n来源记录：${template.provenanceUrl || "/v8-assets/manifest.json"}\n项目：${id}\n需求版本：${requirement.id}\n模板：${template.id}\n`;
        p!.artifacts.push({
          id: this.id(store, "artifact"),
          projectId: id,
          kind: "design_document",
          fileName: `template-${template.assetKey}-design.md`,
          mimeType: "text/markdown;charset=utf-8",
          sizeBytes: new TextEncoder().encode(content).byteLength,
          status: "ready",
          content,
          source: template.sourceKind || "authored-sample",
          license: template.license,
          licenseUrl: template.licenseUrl,
          provenanceUrl: template.provenanceUrl,
          templateId,
          requirementId: requirement.id,
          assetKey: template.assetKey,
          parameterSnapshot: { ...parameters },
          authorized: true,
          createdAt: iso(this.now()),
        });
        p!.artifacts.push({
          id: this.id(store, "artifact"),
          projectId: id,
          kind: "model",
          fileName: `${template.assetKey}.glb`,
          mimeType: "model/gltf-binary",
          sizeBytes: configured ? 0 : MODEL_BYTES[template.assetKey],
          status: configured ? "validating" : "ready",
          url: recipe
            ? previewModelUrl(recipe)
            : `/v8-assets/${template.assetKey}.glb`,
          source: template.sourceKind || "authored-sample",
          license: template.license,
          licenseUrl: template.licenseUrl,
          provenanceUrl: template.provenanceUrl,
          templateId,
          requirementId: requirement.id,
          assetKey: template.assetKey,
          parameterSnapshot: { ...parameters },
          ...(recipe ? { modelRecipe: recipe } : {}),
          authorized: true,
          createdAt: iso(this.now()),
        });
        if (configured) {
          const model = p!.artifacts.at(-1)!;
          model.fileName = `${template.assetKey}-${model.id}.glb`;
        }
        this.event(
          store,
          p!,
          "template",
          `保存“${template.name}”模板及视图配置；未发起 CAD。`,
          templateId,
        );
        return p!;
      },
    );
    const model = result.artifacts
      .filter(
        (artifact) =>
          artifact.kind === "model" && artifact.templateId === templateId,
      )
      .at(-1);
    if (model?.modelRecipe) await this.materializePending(id);
    return this.ensureFinalReport(id);
  }

  async syncTask(id: string, taskId?: string) {
    const result = this.mutate(id, undefined, "sync", (store, p) => {
      for (const task of p!.tasks) {
        if (taskId && task.id !== taskId) continue;
        task.submissionState = "accepted";
        if (!["queued", "running", "unknown"].includes(task.status)) continue;
        const elapsed = this.now() - Date.parse(task.createdAt);
        if (elapsed < 700) continue;
        task.status = "running";
        task.currentStep =
          task.type === "cad"
            ? "计算样例工程结果"
            : task.type === "refine"
              ? "整理本次修改，创建新版本"
              : "读取样例方向与预览资产";
        task.updatedAt = iso(this.now());
        if (task.type === "cad") {
          const run = p!.cadRuns.find((r) => r.taskId === task.id);
          if (run) run.status = "running";
        }
        if (elapsed < 2200) continue;
        task.completedAt = iso(this.now());
        if (task.scenario === "failure") {
          task.status = "failed";
          task.error =
            "本次演示任务失败。此前成功的方案与文件仍保留，可调整要求后重试。";
          task.currentStep = "执行失败";
          const run = p!.cadRuns.find((r) => r.taskId === task.id);
          if (run) run.status = "failed";
          continue;
        }
        task.status = "succeeded";
        task.currentStep = "样例处理完成";
        if (task.type === "concepts") {
          const amount =
            task.scenario === "empty"
              ? 0
              : task.scenario === "single"
                ? 1
                : task.scenario === "partial"
                  ? Math.min(2, task.requestedCount || 3)
                  : task.requestedCount || 3;
          task.resultIds = this.appendBranches(
            store,
            p!,
            amount,
            iso(this.now()),
            task.requirementId,
            CONCEPT_CATALOG,
            task.referenceTemplateId
              ? {
                  templateId: task.referenceTemplateId,
                  assetKey: TEMPLATE_CATALOG.find(
                    (item) => item.id === task.referenceTemplateId,
                  )!.assetKey,
                  parameterSnapshot: {
                    ...(task.referenceParameterSnapshot || {}),
                  },
                }
              : undefined,
          );
          if (task.scenario === "partial") {
            task.status = "partial";
            task.error =
              "部分方向生成失败，已保留成功方向。可继续探索剩余方向。";
          }
          if (!task.resultIds.length)
            task.currentStep = "没有新增方向；现有样例集合已保留";
        } else if (task.type === "refine") {
          const branch = p!.branches.find((b) => b.id === task.branchId)!;
          const source = findRevision(p!, branch.id, task.sourceRevisionId!);
          const requirement = p!.requirements.find(
            (item) => item.id === task.requirementId && item.projectId === id,
          );
          if (
            !requirement ||
            (task.sourceDescriptionId !== undefined &&
              (task.sourceDescriptionId !== source.descriptionId ||
                task.sourceDescription !== source.description))
          ) {
            task.status = "failed";
            task.error = "修改来源的需求或描述快照不一致，未创建新版本。";
            continue;
          }
          const parameters = normalizeParameterSnapshot(
            source.assetKey,
            task.parameterSnapshot || source.parameterSnapshot,
          );
          const revision: ConceptRevision = {
            ...source,
            id: this.id(store, "revision"),
            sequence: branch.revisions.length + 1,
            descriptionId: this.id(store, "description"),
            description: `${source.description}\n\n本次修订基于 V${String(source.sequence).padStart(2, "0")}（${source.id}）。\n本次需求版本：${requirement.id}\n本次需求：${requirement.text}\n本次修改要求：${task.prompt}\n冻结的受支持配置：${JSON.stringify(parameters)}\n本机预览创建新的设计描述；仅受支持参数可用于确定性配置导出，文字要求不会自动重建任意拓扑，未执行真实 AI/SolidWorks。`,
            changeSummary: task.prompt!,
            requirementId: task.requirementId,
            parameterSnapshot: { ...parameters },
            parentRevisionId: source.id,
            createdAt: iso(this.now()),
          };
          branch.revisions.push(revision);
          branch.latestRevisionId = revision.id;
          task.resultIds = [revision.id];
          this.event(
            store,
            p!,
            "revision",
            `“${branch.name}”新增 V${String(revision.sequence).padStart(2, "0")}，旧批准与工程成果保持原归属。`,
            revision.id,
          );
        } else {
          const run = p!.cadRuns.find((r) => r.taskId === task.id)!;
          if (!runSourceValid(p!, run)) {
            task.status = "failed";
            task.error = "工程来源校验失败，已阻止交付。";
            run.status = "failed";
            continue;
          }
          run.status = "succeeded";
          const recipe: ModelRecipe | undefined = this.configuredAsset(
            run.assetKey,
          )
            ? {
                assetKey: run.assetKey,
                parameterSnapshot: { ...(run.parameterSnapshot || {}) },
                provenance: {
                  projectId: id,
                  requirementId: run.requirementId!,
                  branchId: run.branchId,
                  revisionId: run.revisionId,
                  descriptionId: run.sourceDescriptionId,
                  approvalId: run.sourceApprovalId,
                  cadRunId: run.id,
                },
              }
            : undefined;
          const artifact: Artifact = {
            id: this.id(store, "artifact"),
            projectId: id,
            kind: "model",
            fileName: recipe
              ? `${run.assetKey}-V${String(findRevision(p!, run.branchId, run.revisionId).sequence).padStart(2, "0")}-${run.id}.glb`
              : `${run.assetKey}.glb`,
            mimeType: "model/gltf-binary",
            sizeBytes: recipe ? 0 : MODEL_BYTES[run.assetKey],
            status: "uploading",
            url: recipe
              ? previewModelUrl(recipe)
              : `/v8-assets/${run.assetKey}.glb`,
            ...modelSourceInfo(run.assetKey),
            branchId: run.branchId,
            revisionId: run.revisionId,
            descriptionId: run.sourceDescriptionId,
            approvalId: run.sourceApprovalId,
            cadRunId: run.id,
            requirementId: run.requirementId,
            assetKey: run.assetKey,
            parameterSnapshot: { ...(run.parameterSnapshot || {}) },
            ...(recipe ? { modelRecipe: recipe } : {}),
            authorized: true,
            createdAt: iso(this.now()),
          };
          p!.artifacts.push(artifact);
          run.artifactIds.push(artifact.id);
          task.resultIds = [run.id];
          task.currentStep = "计算完成，文件正在准备";
          this.event(
            store,
            p!,
            "cad",
            "样例工程计算完成；文件就绪与工程验证分别跟踪。",
            run.id,
          );
        }
      }
      for (const artifact of p!.artifacts) {
        if (
          !artifact.cadRunId ||
          !["uploading", "validating"].includes(artifact.status)
        )
          continue;
        const elapsed = this.now() - Date.parse(artifact.createdAt);
        if (elapsed > 800) artifact.status = "validating";
        if (
          elapsed > 1800 &&
          store.scenario !== "files-pending" &&
          !artifact.modelRecipe
        )
          artifact.status = "ready";
      }
      return p!;
    });
    if (
      result.artifacts.some(
        (artifact) =>
          artifact.modelRecipe &&
          ["validating", "failed"].includes(artifact.status),
      )
    )
      await this.materializePending(id);
    return this.ensureFinalReport(id);
  }
  setScenario(scenario: Scenario) {
    const store = this.read();
    store.scenario = scenario;
    this.write(store);
  }
  getScenario() {
    return this.read().scenario;
  }
  async reset() {
    this.getStorage()?.removeItem(STORAGE_KEY);
    this.memory = undefined;
    return this.snapshot();
  }
  async download(artifact: Artifact) {
    const store = this.read();
    this.ensureOnline(store);
    const p = this.project(store, artifact.projectId);
    const authoritative = p.artifacts.find((a) => a.id === artifact.id);
    if (!authoritative || !canDownload(p, authoritative))
      throw new V8Error(
        "FILE_UNAVAILABLE",
        "文件尚未就绪、来源不一致或无访问权限，请刷新文件状态。",
      );
    return {
      url: authoritative.url,
      content: authoritative.content,
      fileName: authoritative.fileName,
      mimeType: authoritative.mimeType,
    };
  }
}

const GAP =
  "多分支、需求持久化与不可变批准契约尚未得到后端验证。请进入现有项目工作区继续已有功能，或使用独立开发预览。";
export class LiveRepository implements V8Repository {
  readonly mode = "live" as const;
  private gap(): never {
    throw new V8Error("CAPABILITY_UNAVAILABLE", GAP);
  }
  private map(p: {
    id: string;
    name: string;
    projectType: Project["projectType"];
    createdAt: string;
    updatedAt: string;
  }): Project {
    return {
      id: p.id,
      name: p.name,
      projectType: p.projectType,
      ownerId: "server-authorized",
      status: "平台项目",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      requirements: [],
      branches: [],
      approvals: [],
      cadRuns: [],
      tasks: [],
      artifacts: [],
      journey: [],
      parameters: {},
      source: "platform",
    };
  }
  private error(status?: number): never {
    if (status === 401)
      throw new V8Error(
        "AUTHENTICATION_REQUIRED",
        "会话已失效，请重新登录。",
        401,
      );
    if (status === 403)
      throw new V8Error("FORBIDDEN", "没有访问此项目的权限。", 403);
    if (status === 404)
      throw new V8Error("NOT_FOUND", "项目不存在或对当前账户不可见。", 404);
    throw new V8Error(
      status ? "SERVICE_ERROR" : "NETWORK_ERROR",
      status
        ? "平台服务暂不可用，请重试。"
        : "网络连接失败，请恢复连接后重试。",
      status,
    );
  }
  async list() {
    const { listProjects } = await import("../api/client");
    const result = await listProjects({
      credentials: "same-origin",
      query: { limit: 50 },
    });
    if (result.error || !result.data) this.error(result.response?.status);
    return result.data.items.map((p) => this.map(p));
  }
  async get(id: string) {
    const { getProject } = await import("../api/client");
    const result = await getProject({
      credentials: "same-origin",
      path: { projectId: id },
    });
    if (result.error || !result.data) this.error(result.response?.status);
    return this.map(result.data);
  }
  // Real facts are read under the current Cookie session; never retain account-scoped
  // project data inside the shared repository singleton across account changes.
  snapshot(): Project[] {
    return [];
  }
  async create(_input: CreateInput, _key?: string): Promise<Project> {
    return this.gap();
  }
  async saveRequirements(
    _id: string,
    _input: RequirementInput,
    _key?: string,
  ): Promise<Project> {
    return this.gap();
  }
  async chooseRoute(
    _id: string,
    _route: "library" | "custom",
  ): Promise<Project> {
    return this.gap();
  }
  async useTemplate(
    _id: string,
    _templateId: string,
    _parameters: Record<string, number>,
    _key?: string,
  ): Promise<Project> {
    return this.gap();
  }
  async generateConcepts(
    _id: string,
    _quantity?: number,
    _key?: string,
  ): Promise<Project> {
    return this.gap();
  }
  async refine(
    _id: string,
    _branchId: string,
    _revisionId: string,
    _prompt: string,
    _key?: string,
    _parameterSnapshot?: Record<string, number>,
  ): Promise<Project> {
    return this.gap();
  }
  async approve(
    _id: string,
    _branchId: string,
    _revisionId: string,
    _key?: string,
  ): Promise<Project> {
    return this.gap();
  }
  async startCad(
    _id: string,
    _approvalId: string,
    _key?: string,
  ): Promise<Project> {
    return this.gap();
  }
  async finalizeReport(_id: string): Promise<Project> {
    return this.gap();
  }
  async syncTask(id: string, _taskId?: string) {
    return this.get(id);
  }
  async upload(_file: File): Promise<SourceRef> {
    return this.gap();
  }
  setScenario(_scenario: Scenario) {
    this.gap();
  }
  getScenario(): Scenario {
    return "success";
  }
  async reset(): Promise<Project[]> {
    return this.gap();
  }
  async download(_artifact: Artifact): Promise<{
    url?: string;
    content?: string;
    fileName: string;
    mimeType: string;
  }> {
    return this.gap();
  }
}

let preview: PreviewRepository | undefined;
let live: LiveRepository | undefined;
export function getRepository(mode: Mode): V8Repository {
  if (mode === "preview") {
    if (process.env.NODE_ENV === "production")
      throw new V8Error(
        "PREVIEW_DISABLED",
        "生产环境禁用开发样例。请使用真实接口模式。",
      );
    return (preview ??= new PreviewRepository());
  }
  return (live ??= new LiveRepository());
}
