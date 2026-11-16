import type { Project } from "./types";
import type { DeliverySource } from "./delivery-packages";

export type ModuleId = "embodex" | "simcore" | "deployx";
export const SIMCORE_AVAILABLE = false;

/** Workspace composition is UI metadata, separate from design/CAD facts. */
export interface WorkspaceProject {
  id: string;
  name: string;
  modules: ModuleId[];
  updatedAt: string;
  source: "embodex" | "workspace-example" | "workspace-local";
  embodexProjectId?: string;
  summary?: string;
  simulationHandoff?: {
    packageKey: string;
    modelArtifactId: string;
    fileName: string;
    sha256?: string;
    source: DeliverySource;
    savedAt: string;
  };
}

export interface WorkspaceView {
  modules: ModuleId[];
  search: string;
  projectId: string | null;
}
export const WORKSPACE_VIEW_KEY = "embomix-v8-workspace-view";
export const WORKSPACE_PROJECT_KEY = "embomix-v8-workspace-projects";
export const WORKSPACE_SCOPE_KEY = "embomix-v8-module-scope";

/** Restore UI state independently of design facts and saved module ownership. */
export function parseWorkspaceView(
  serialized: string | null,
  legacyScope: string | null = null,
): WorkspaceView {
  const empty: WorkspaceView = { modules: [], search: "", projectId: null };
  try {
    if (!serialized)
      return {
        ...empty,
        modules: normalizeModules(JSON.parse(legacyScope || "[]")),
      };
    const value = JSON.parse(serialized);
    return {
      modules: normalizeModules(value?.modules),
      search:
        typeof value?.search === "string" ? value.search.slice(0, 120) : "",
      projectId:
        typeof value?.projectId === "string" &&
        /^[\w-]{1,160}$/.test(value.projectId)
          ? value.projectId
          : null,
    };
  } catch {
    return empty;
  }
}

export function resolveDesignScope(
  projects: readonly WorkspaceProject[],
  activeId: string | undefined,
  requested: readonly ModuleId[],
): ModuleId[] {
  const owner = activeId
    ? projects.find((p) => p.embodexProjectId === activeId)
    : undefined;
  return (
    owner?.modules ||
    (requested.includes("embodex") ? normalizeModules(requested) : ["embodex"])
  );
}

export const MODULES = [
  {
    id: "embodex",
    name: "Embodex",
    label: "设计",
    description: "从需求到工程模型",
  },
  {
    id: "simcore",
    name: "Simcore",
    label: "仿真",
    description: "验证机器人与场景",
  },
  {
    id: "deployx",
    name: "Deployx",
    label: "部署",
    description: "连接设备与任务",
  },
] as const;

/** Module order follows the product workflow, independent of click order. */
export function normalizeModules(value: unknown): ModuleId[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value);
  return MODULES.map((module) => module.id).filter((id) => selected.has(id));
}

export function moduleSelectionKey(value: unknown): string {
  return normalizeModules(value).join("+");
}

export function toggleModule(
  selected: readonly ModuleId[],
  id: ModuleId,
): ModuleId[] {
  return normalizeModules(
    selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id],
  );
}

/** Empty selection lists all projects; a composition matches exactly. */
export function matchesModuleSelection(
  projectModules: readonly ModuleId[],
  selected: readonly ModuleId[],
): boolean {
  const selection = moduleSelectionKey(selected);
  return !selection || moduleSelectionKey(projectModules) === selection;
}

/** These examples contain workspace metadata only, never simulated task results. */
export const WORKSPACE_EXAMPLES: readonly WorkspaceProject[] = [
  {
    id: "workspace-example-simcore-navigation",
    name: "仓储导航验证",
    modules: ["simcore"],
    updatedAt: "2026-11-12T08:30:00.000Z",
    source: "workspace-example",
    summary: "导航场景 · 示例项目",
  },
  {
    id: "workspace-example-deployx-inspection",
    name: "园区巡检部署",
    modules: ["deployx"],
    updatedAt: "2026-11-12T08:00:00.000Z",
    source: "workspace-example",
    summary: "设备与任务 · 示例项目",
  },
  {
    id: "workspace-example-design-simulation",
    name: "巡检平台设计与验证",
    modules: ["embodex", "simcore"],
    updatedAt: "2026-11-12T07:30:00.000Z",
    source: "workspace-example",
    summary: "设计 → 仿真 · 示例项目",
  },
  {
    id: "workspace-example-simulation-deployment",
    name: "配送任务验证与部署",
    modules: ["simcore", "deployx"],
    updatedAt: "2026-11-12T07:00:00.000Z",
    source: "workspace-example",
    summary: "仿真 → 部署 · 示例项目",
  },
  {
    id: "workspace-example-design-deployment",
    name: "移动平台设计与部署",
    modules: ["embodex", "deployx"],
    updatedAt: "2026-11-12T06:30:00.000Z",
    source: "workspace-example",
    summary: "设计 → 部署 · 示例项目",
  },
  {
    id: "workspace-example-full-workflow",
    name: "仓储机器人全流程",
    modules: ["embodex", "simcore", "deployx"],
    updatedAt: "2026-11-12T06:00:00.000Z",
    source: "workspace-example",
    summary: "设计 → 仿真 → 部署 · 示例项目",
  },
];

export function buildWorkspaceProjects(
  projects: readonly Pick<Project, "id" | "name" | "updatedAt">[],
  extras: readonly WorkspaceProject[] = WORKSPACE_EXAMPLES,
): WorkspaceProject[] {
  const actualIds = new Set(projects.map((project) => project.id));
  const ownedDesignIds = new Set(
    extras
      .filter(
        (project) =>
          !actualIds.has(project.id) &&
          project.source !== "embodex" &&
          normalizeModules(project.modules).includes("embodex") &&
          project.embodexProjectId &&
          actualIds.has(project.embodexProjectId),
      )
      .map((project) => project.embodexProjectId),
  );
  const combined: WorkspaceProject[] = projects
    .filter((project) => !ownedDesignIds.has(project.id))
    .map((project) => ({
      id: project.id,
      name: project.name,
      modules: ["embodex"],
      updatedAt: project.updatedAt,
      source: "embodex",
      embodexProjectId: project.id,
    }));
  const ids = new Set(combined.map((project) => project.id));
  for (const project of extras) {
    const modules = normalizeModules(project.modules);
    if (
      !project.id ||
      actualIds.has(project.id) ||
      ids.has(project.id) ||
      !modules.length
    )
      continue;
    const design = projects.find((p) => p.id === project.embodexProjectId);
    combined.push({
      ...project,
      modules,
      updatedAt:
        design && design.updatedAt > project.updatedAt
          ? design.updatedAt
          : project.updatedAt,
      embodexProjectId:
        modules.includes("embodex") &&
        project.embodexProjectId &&
        actualIds.has(project.embodexProjectId)
          ? project.embodexProjectId
          : undefined,
    });
    ids.add(project.id);
  }
  return combined.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Read only known metadata fields; stored strings never become navigation URLs. */
export function parseWorkspaceProjects(
  serialized: string | null,
): WorkspaceProject[] {
  try {
    const value: unknown = JSON.parse(serialized || "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.flatMap((item): WorkspaceProject[] => {
      if (!item || typeof item !== "object") return [];
      const {
        id,
        name,
        modules: rawModules,
        updatedAt,
        source,
        embodexProjectId,
        summary,
        simulationHandoff,
      } = item;
      const modules = normalizeModules(rawModules);
      if (
        typeof id !== "string" ||
        !/^[\w-]{1,160}$/.test(id) ||
        seen.has(id) ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 120 ||
        source !== "workspace-local" ||
        !modules.length ||
        !Array.isArray(rawModules) ||
        rawModules.some(
          (module) => !MODULES.some((entry) => entry.id === module),
        ) ||
        typeof updatedAt !== "string" ||
        !Number.isFinite(Date.parse(updatedAt))
      )
        return [];
      seen.add(id);
      return [
        {
          id,
          name: name.trim(),
          modules,
          updatedAt,
          source,
          embodexProjectId:
            modules.includes("embodex") &&
            typeof embodexProjectId === "string" &&
            /^[\w-]{1,160}$/.test(embodexProjectId)
              ? embodexProjectId
              : undefined,
          summary:
            typeof summary === "string" ? summary.slice(0, 160) : undefined,
          simulationHandoff:
            simulationHandoff &&
            typeof simulationHandoff === "object" &&
            typeof simulationHandoff.packageKey === "string" &&
            typeof simulationHandoff.modelArtifactId === "string" &&
            typeof simulationHandoff.fileName === "string" &&
            typeof simulationHandoff.savedAt === "string" &&
            simulationHandoff.source?.projectId === embodexProjectId &&
            modules.includes("simcore")
              ? simulationHandoff
              : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function filterWorkspaceProjects(
  projects: readonly WorkspaceProject[],
  selected: readonly ModuleId[],
  search = "",
): WorkspaceProject[] {
  const query = search.trim().toLocaleLowerCase();
  return projects.filter(
    (project) =>
      matchesModuleSelection(project.modules, selected) &&
      (!query || project.name.toLocaleLowerCase().includes(query)),
  );
}
