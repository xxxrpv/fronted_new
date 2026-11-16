"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import PreviewSignIn from "./PreviewSignIn";
import ModuleArtwork from "./ModuleArtwork";
import StudioAssistant from "./StudioAssistant";
import { useModuleDrag } from "./useModuleDrag";
import { projectTag } from "../../lib/v8/project-tags";
import WorkspaceProjectOverview from "./WorkspaceProjectOverview";
import { SIMCORE_AVAILABLE } from "../../lib/v8/module-workspace";
import { planInterfaceCommand } from "../../lib/v8/interface-commands";
import { getRepository } from "../../lib/v8/repository";
import { groupDeliveryPackages } from "../../lib/v8/delivery-packages";
import type { Project } from "../../lib/v8/types";
import { projectResumePath } from "../../lib/v8/project-navigation";
import { ModuleWorkspaceContext } from "../../lib/v8/workspace-context";
import {
  MODULES,
  WORKSPACE_EXAMPLES,
  buildWorkspaceProjects,
  filterWorkspaceProjects,
  normalizeModules,
  parseWorkspaceProjects,
  toggleModule,
  parseWorkspaceView,
  resolveDesignScope,
  moduleSelectionKey,
  WORKSPACE_VIEW_KEY,
  WORKSPACE_PROJECT_KEY,
  WORKSPACE_SCOPE_KEY,
  type ModuleId,
  type WorkspaceProject,
  type WorkspaceView,
} from "../../lib/v8/module-workspace";
import {
  hasPreviewSession,
  startPreviewSession,
  endPreviewSession,
  PREVIEW_SESSION_KEY,
} from "../../lib/v8/preview-session";
import "./module-workspace.css";
import "./liquid-glass.css";

const Studio = dynamic(() => import("./Studio"), {
  loading: () => (
    <div className="mx-loading" role="status">
      正在打开设计…
    </div>
  ),
});
const SimcoreWorkspace = dynamic(() => import("./SimcoreWorkspace"), {
  loading: () => (
    <div className="mx-loading" role="status">
      正在打开仿真…
    </div>
  ),
});

const RETURN_KEY = "embomix-v8-workspace-return";
const names = (ids: readonly ModuleId[]) =>
  MODULES.filter((m) => ids.includes(m.id))
    .map((m) => m.name)
    .join(" + ");
function Glyph({
  name,
}: {
  name:
    | "box"
    | "plus"
    | "arrow"
    | "search"
    | "close"
    | "exit"
    | "grid"
    | "check"
    | "link";
}) {
  const path = {
    box: "m12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v9M7.5 5.5l9 5",
    plus: "M12 5v14M5 12h14",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    close: "m6 6 12 12M6 18 18 6",
    exit: "M9 4H4v16h5m5-13 5 5-5 5M8 12h11",
    grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
    check: "m5 12 4 4L19 6",
    link: "m9 15 6-6M8 16l-2 2a4 4 0 0 1-6-6l5-5m11 1 2-2a4 4 0 0 1 6 6l-5 5",
  }[name];
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export default function PreviewExperience() {
  const path = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [identity, setIdentity] = useState("123");
  const [designModules, setDesignModules] = useState<ModuleId[]>(["embodex"]);
  const [view, setView] = useState<WorkspaceView>({
    modules: [],
    search: "",
    projectId: null,
  });
  const { modules: scope, search, projectId: selectedId } = view;
  const [actual, setActual] = useState<Project[]>([]);
  const [projectsReady, setProjectsReady] = useState(false);
  const [local, setLocal] = useState<WorkspaceProject[]>([]);
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [draftModules, setDraftModules] = useState<ModuleId[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const modalRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const isPortal = path === "/v8" || path === "/v8/workspace";
  const isLogin = path === "/v8/login";
  const isSimulation = path === "/v8/simcore";
  const repo = getRepository("preview");
  const refresh = useCallback(async () => {
    try {
      setActual(await getRepository("preview").list());
    } catch {
      setError("项目暂时无法读取，请刷新重试。");
    } finally {
      setProjectsReady(true);
    }
  }, []);
  useEffect(() => {
    try {
      setSignedIn(hasPreviewSession(localStorage));
      const session = JSON.parse(
        localStorage.getItem(PREVIEW_SESSION_KEY) || "null",
      );
      if (typeof session?.account === "string") setIdentity(session.account);
      const context = parseWorkspaceView(
        sessionStorage.getItem("embomix-v8-design-context"),
      );
      if (context.modules.includes("embodex"))
        setDesignModules(context.modules);
      setView(
        parseWorkspaceView(
          localStorage.getItem(WORKSPACE_VIEW_KEY),
          localStorage.getItem(WORKSPACE_SCOPE_KEY),
        ),
      );
      setLocal(
        parseWorkspaceProjects(localStorage.getItem(WORKSPACE_PROJECT_KEY)),
      );
    } catch {
      setError("浏览器存储不可用，请允许本地存储后重试。");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, path, refresh]);
  useEffect(() => {
    if (!ready) return;
    if (!signedIn && !isLogin) router.replace("/v8/login");
  }, [ready, signedIn, isLogin, router]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(WORKSPACE_VIEW_KEY, JSON.stringify(view));
      localStorage.setItem(WORKSPACE_SCOPE_KEY, JSON.stringify(scope));
    } catch {
      setError("当前查看位置未保存，请检查浏览器存储。");
    }
  }, [ready, view, scope]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === PREVIEW_SESSION_KEY || event.key === null)
        setSignedIn(hasPreviewSession(localStorage));
      if (event.key === WORKSPACE_PROJECT_KEY || event.key === null)
        setLocal(
          parseWorkspaceProjects(localStorage.getItem(WORKSPACE_PROJECT_KEY)),
        );
      if (event.key === "embodex-v8-preview-v1" || event.key === null)
        void refresh();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [refresh]);
  useEffect(() => {
    if (newProject) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [newProject]);
  useEffect(() => {
    if (isPortal && selectedId)
      detailRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, isPortal]);
  const choose = (selection: ModuleId[]) => {
    setView((previous) => ({
      ...previous,
      modules: normalizeModules(selection),
      projectId: null,
    }));
    setDropActive(false);
  };
  const moduleDrag = useModuleDrag((module) => {
    if (!busyRef.current) choose(normalizeModules([...scope, module]));
  }, setDropActive);
  const saveLocal = (items: WorkspaceProject[]) => {
    localStorage.setItem(WORKSPACE_PROJECT_KEY, JSON.stringify(items));
    setLocal(items);
  };
  const allProjects = buildWorkspaceProjects(actual, [
    ...WORKSPACE_EXAMPLES.filter(
      (p) => !local.some((item) => item.id === p.id),
    ),
    ...local,
  ]);
  const projects = filterWorkspaceProjects(allProjects, scope, search);
  const selected = projects.find((p) => p.id === selectedId);
  const handoffDesign = actual.find((p) => p.id === selected?.embodexProjectId);
  const activeId = path.startsWith("/v8/projects/")
    ? path.split("/")[3]
    : undefined;
  const activeScopeKey = activeId
    ? moduleSelectionKey(
        allProjects.find((p) => p.embodexProjectId === activeId)?.modules,
      )
    : "";
  useEffect(() => {
    if (!ready) return;
    const modules = activeScopeKey
      ? normalizeModules(activeScopeKey.split("+"))
      : designModules;
    if (moduleSelectionKey(modules) !== moduleSelectionKey(designModules))
      setDesignModules(modules);
    try {
      sessionStorage.setItem(
        "embomix-v8-design-context",
        JSON.stringify({ modules }),
      );
    } catch {
      /* The active context still works within this tab. */
    }
  }, [ready, activeScopeKey, designModules]);
  const rememberReturn = (returnView: WorkspaceView, modules: ModuleId[]) => {
    setDesignModules(modules);
    try {
      sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({ view: returnView, modules }),
      );
    } catch {
      /* UI memory remains available in this tab */
    }
    setView(returnView);
  };
  const openDesign = (
    projectId?: string,
    returnView: WorkspaceView = view,
    modules: ModuleId[] = ["embodex"],
  ) => {
    const project = actual.find((p) => p.id === projectId);
    let location: string | undefined;
    try {
      location = JSON.parse(
        localStorage.getItem("embodex-v8-locations:preview") || "{}",
      )[projectId || ""];
    } catch {
      /* use legal stage */
    }
    rememberReturn(returnView, modules);
    router.push(
      project
        ? `/v8/projects/${encodeURIComponent(project.id)}/${projectResumePath(project, location)}`
        : "/v8/embodex",
    );
  };
  const enterModule = (module: ModuleId) => {
    const next: WorkspaceView = {
      modules: [module],
      search: "",
      projectId: null,
    };
    setView(next);
    if (module === "embodex") openDesign(undefined, next, [module]);
    else if (module === "simcore" && SIMCORE_AVAILABLE)
      router.push("/v8/simcore");
  };
  const openProject = (project: WorkspaceProject) => {
    const next = { ...view, projectId: project.id };
    setView(next);
  };
  async function beginDesign(project: WorkspaceProject) {
    if (busyRef.current) return;
    if (project.embodexProjectId) {
      openDesign(project.embodexProjectId, view, project.modules);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const design = await repo.create(
        { name: project.name, text: project.name },
        `workspace-${project.id}`,
      );
      const item: WorkspaceProject = {
        ...project,
        source: "workspace-local",
        embodexProjectId: design.id,
        updatedAt: design.updatedAt,
      };
      saveLocal([...local.filter((p) => p.id !== item.id), item]);
      setActual(await repo.list());
      rememberReturn({ ...view, projectId: item.id }, item.modules);
      router.push(
        `/v8/projects/${encodeURIComponent(design.id)}/${projectResumePath(design)}`,
      );
    } catch {
      setError("暂时无法开始设计，请重试。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function openNewProject() {
    setDraftModules(scope);
    setProjectName("");
    setNewProject(true);
  }
  async function openSimulation(suppliedProject: Project, packageKey: string) {
    const project = await repo.get(suppliedProject.id);
    const delivery = groupDeliveryPackages(project).find(
      (item) => item.key === packageKey,
    );
    const model = delivery?.readyArtifacts.find(
      (item) => item.kind === "model",
    );
    if (
      !delivery?.modelReady ||
      !model ||
      delivery.source.kind === "unresolved"
    ) {
      throw new Error("当前交付版本的三维模型不可用，请刷新文件状态后重试。");
    }
    if (!SIMCORE_AVAILABLE) {
      router.push(
        `/v8/simcore?design=${encodeURIComponent(project.id)}&package=${encodeURIComponent(delivery.key)}`,
      );
      return;
    }
    const owner = allProjects.find(
      (item) => item.embodexProjectId === project.id,
    );
    const item: WorkspaceProject = {
      id:
        owner && owner.source !== "embodex"
          ? owner.id
          : `workspace-${project.id}`,
      name: owner?.name || project.name,
      modules: normalizeModules([
        ...(owner?.modules || ["embodex"]),
        "simcore",
      ]),
      updatedAt: new Date().toISOString(),
      source: "workspace-local",
      embodexProjectId: project.id,
      simulationHandoff: {
        packageKey: delivery.key,
        modelArtifactId: model.id,
        fileName: model.fileName,
        sha256: model.sha256,
        source: structuredClone(delivery.source),
        savedAt: new Date().toISOString(),
      },
    };
    try {
      saveLocal([
        ...local.filter(
          (p) => p.id !== item.id && p.embodexProjectId !== project.id,
        ),
        item,
      ]);
      setView({ modules: item.modules, search: "", projectId: item.id });
      setDesignModules(item.modules);
      router.push(`/v8/simcore?project=${encodeURIComponent(item.id)}`);
    } catch {
      throw new Error("暂时无法保存仿真入口，请重试。");
    }
  }
  function createProject(event: FormEvent) {
    event.preventDefault();
    if (!projectName.trim() || !draftModules.length) return;
    try {
      const item: WorkspaceProject = {
        id: `workspace-${crypto.randomUUID()}`,
        name: projectName.trim(),
        modules: normalizeModules(draftModules),
        updatedAt: new Date().toISOString(),
        source: "workspace-local",
      };
      saveLocal([...local, item]);
      setView({ modules: item.modules, search: "", projectId: item.id });
      setNewProject(false);
      setProjectName("");
    } catch {
      setError("项目暂时无法保存，请重试。");
    }
  }
  if (!ready || (!signedIn && !isLogin))
    return (
      <div className="mx-loading" role="status">
        正在打开工作空间…
      </div>
    );
  if (isLogin)
    return (
      <PreviewSignIn
        onContinue={signedIn ? () => router.push("/v8") : undefined}
        onSignIn={(account = "123") => {
          startPreviewSession(localStorage, account);
          setIdentity(account);
          setSignedIn(true);
          router.replace("/v8");
        }}
      />
    );
  if (isSimulation) {
    const sourceDesign = actual.find(
      (p) => p.id === searchParams.get("design"),
    );
    const sourcePackage = sourceDesign
      ? groupDeliveryPackages(sourceDesign).find(
          (p) => p.key === searchParams.get("package") && p.modelReady,
        )
      : undefined;
    const sourceModel = sourcePackage?.readyArtifacts.find(
      (a) => a.kind === "model",
    );
    if (!SIMCORE_AVAILABLE)
      return (
        <main className="mx-module-closed">
          <span className="mx-eyebrow">Simcore</span>
          <h1>暂未开放</h1>
          {sourceDesign && sourceModel && (
            <div className="mx-simulation-source">
              <span>来自方案交付</span>
              <strong>{sourceDesign.name}</strong>
              <p>{sourceModel.fileName}</p>
              <button
                className="mx-overview-continue"
                onClick={() =>
                  router.push(
                    `/v8/projects/${encodeURIComponent(sourceDesign.id)}/delivery`,
                  )
                }
              >
                返回方案交付 <span aria-hidden="true">↗</span>
              </button>
            </div>
          )}
          <button className="mx-module-open" onClick={() => router.push("/v8")}>
            返回工作空间 <Glyph name="arrow" />
          </button>
        </main>
      );
    const requestedSimulation = allProjects.find(
      (p) =>
        p.id === searchParams.get("project") && p.modules.includes("simcore"),
    );
    const simulationScope =
      requestedSimulation?.modules ||
      (scope.includes("simcore") ? scope : ["simcore" as const]);
    const simulationProjects = filterWorkspaceProjects(
      allProjects,
      simulationScope,
    );
    const selectedProject =
      simulationProjects.find((p) => p.id === searchParams.get("project")) ||
      (searchParams.has("project")
        ? undefined
        : simulationProjects.find((p) => p.id === selectedId) ||
          simulationProjects[0]);
    return (
      <SimcoreWorkspace
        key={selectedProject?.id || "simcore"}
        project={selectedProject}
        projects={simulationProjects}
        design={actual.find((p) => p.id === selectedProject?.embodexProjectId)}
        onWorkspace={() => {
          if (selectedProject)
            setView({
              modules: selectedProject.modules,
              projectId: selectedProject.id,
              search: "",
            });
          router.push("/v8");
        }}
        onProject={(id) => {
          const project = simulationProjects.find((p) => p.id === id);
          if (project)
            setView({ modules: project.modules, search: "", projectId: id });
          router.push(`/v8/simcore?project=${encodeURIComponent(id)}`);
        }}
        onDesign={() => {
          if (selectedProject)
            openDesign(
              selectedProject.embodexProjectId,
              {
                modules: selectedProject.modules,
                projectId: selectedProject.id,
                search: "",
              },
              selectedProject.modules,
            );
        }}
      />
    );
  }
  if (!isPortal) {
    if (!projectsReady)
      return (
        <div className="mx-loading" role="status">
          正在打开项目…
        </div>
      );
    const designScope = resolveDesignScope(
      allProjects,
      activeId,
      designModules,
    );
    const projectIds = filterWorkspaceProjects(allProjects, designScope)
      .map((p) => p.embodexProjectId)
      .filter((id): id is string => Boolean(id));
    return (
      <ModuleWorkspaceContext.Provider
        value={{
          projectIds,
          simulationAvailable: SIMCORE_AVAILABLE,
          openSimulation,
          scopeLabel: names(designScope),
          openWorkspace: () => {
            const owner = allProjects.find(
              (p) => p.embodexProjectId === activeId,
            );
            let target: WorkspaceView = {
              modules: designScope,
              search: "",
              projectId: owner?.id || null,
            };
            try {
              const saved = JSON.parse(
                sessionStorage.getItem(RETURN_KEY) || "null",
              );
              if (
                saved &&
                moduleSelectionKey(saved.modules) ===
                  moduleSelectionKey(designScope)
              )
                target = parseWorkspaceView(JSON.stringify(saved.view));
            } catch {
              /* default to actual project ownership */
            }
            setView(target);
            router.push("/v8");
          },
          onDesignCreated: (project) => {
            if (designScope.length > 1)
              saveLocal([
                ...local,
                {
                  id: `workspace-${project.id}`,
                  name: project.name,
                  modules: designScope,
                  updatedAt: project.updatedAt,
                  source: "workspace-local",
                  embodexProjectId: project.id,
                },
              ]);
            setActual((previous) => [
              ...previous.filter((p) => p.id !== project.id),
              project,
            ]);
          },
        }}
      >
        <Studio mode="preview" />
      </ModuleWorkspaceContext.Provider>
    );
  }
  return (
    <div className="mx-workspace">
      <aside className="mx-sidebar" aria-label="工作空间项目">
        <a
          className="mx-brand"
          href="/v8"
          onClick={(e) => {
            e.preventDefault();
            setView({ modules: [], search: "", projectId: null });
          }}
        >
          <span className="mx-brand-mark">
            <Glyph name="box" />
          </span>
          EmboMiX
        </a>
        <button
          className={`mx-all ${!scope.length ? "active" : ""}`}
          onClick={() => choose([])}
        >
          <Glyph name="grid" />
          全部项目<span>{allProjects.length}</span>
        </button>
        <div className="mx-project-label">
          <span>{scope.length ? names(scope) : "你的项目"}</span>
          <span aria-live="polite">
            {projects.length.toString().padStart(2, "0")}
          </span>
        </div>
        <label className="mx-search">
          <Glyph name="search" />
          <input
            aria-label="搜索工作空间项目"
            value={search}
            onChange={(e) => setView({ ...view, search: e.target.value })}
            placeholder="搜索项目"
            maxLength={120}
          />
          {search && (
            <button
              aria-label="清空项目搜索"
              onClick={() => setView({ ...view, search: "" })}
            >
              <Glyph name="close" />
            </button>
          )}
        </label>
        <nav className="mx-projects" aria-label="项目列表">
          {projects.map((p) => (
            <button
              className={`mx-project ${selectedId === p.id ? "active" : ""}`}
              aria-current={selectedId === p.id ? "true" : undefined}
              title={p.name}
              data-project-id={p.id}
              data-project-modules={p.modules.join("+")}
              disabled={busy}
              key={p.id}
              onClick={() => openProject(p)}
            >
              <span
                className="mx-project-dot"
                style={{ backgroundColor: projectTag(p.name).color }}
                title={projectTag(p.name).label}
              />
              <span>
                <strong>{p.name}</strong>
              </span>
              {selectedId === p.id && <i />}
            </button>
          ))}
          {!projectsReady ? (
            <p className="mx-empty" role="status">
              正在读取项目…
            </p>
          ) : (
            !projects.length && (
              <div className="mx-empty">
                <Glyph name="search" />
                <p>{search ? "未找到项目" : "暂无此组合的项目"}</p>
                {search && (
                  <button onClick={() => setView({ ...view, search: "" })}>
                    清空搜索
                  </button>
                )}
              </div>
            )
          )}
        </nav>
        <button
          className="mx-new-project"
          onClick={openNewProject}
          disabled={busy}
        >
          <Glyph name="plus" />
          新建项目
        </button>
        <div className="mx-user">
          <span className="mx-avatar" aria-label={`账户 ${identity}`}>
            {identity.slice(-1)}
          </span>
          <div>
            <strong>我的工作空间</strong>
            <small>
              {identity === "123"
                ? "123 · 示例账户"
                : `${identity.slice(0, 3)} · 本地账户`}
            </small>
          </div>
          <button
            aria-label="退出登录"
            title="退出登录"
            disabled={busy}
            onClick={() => {
              endPreviewSession(localStorage);
              sessionStorage.removeItem(RETURN_KEY);
              setSignedIn(false);
              router.replace("/v8/login");
            }}
          >
            <Glyph name="exit" />
          </button>
        </div>
      </aside>
      <div className="mx-body">
        <header className="mx-topbar">
          <span>
            EmboMiX<span className="mx-divider">/</span>工作空间
          </span>
          <span className="mx-preview-label">
            <i />
            本地预览
          </span>
        </header>
        <main className="mx-main">
          {!selected && (
            <div className="mx-intro">
              <div>
                <h1>让想法，连接起来。</h1>
              </div>
            </div>
          )}
          {error && (
            <div className="mx-error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  void refresh();
                }}
              >
                重试
              </button>
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <Glyph name="close" />
              </button>
            </div>
          )}
          {selected && (
            <div ref={detailRef}>
              <WorkspaceProjectOverview
                project={selected}
                design={handoffDesign}
                busy={busy}
                onClose={() => setView({ ...view, projectId: null })}
                onContinue={() => void beginDesign(selected)}
              />
            </div>
          )}
          {!selected && (
            <>
              <section className="mx-modules" aria-label="选择模块">
                {MODULES.map((module, index) => (
                  <article
                    className={`mx-module mx-${module.id} ${scope.includes(module.id) ? "selected" : ""}`}
                    key={module.id}
                    onPointerDown={(e) => {
                      if (!busy) moduleDrag.start(e, module.id);
                    }}
                    onClickCapture={(e) =>
                      moduleDrag.captureClick(e, module.id)
                    }
                    onDragStart={(e) => e.preventDefault()}
                  >
                    <button
                      type="button"
                      className="mx-module-surface"
                      aria-label={`选择 ${module.name} 模块`}
                      aria-pressed={scope.includes(module.id)}
                      disabled={busy}
                      onClick={() => choose(toggleModule(scope, module.id))}
                    />
                    <div className="mx-module-top">
                      <span>
                        0{index + 1}
                        <i /> {module.label}
                      </span>
                      <div className="mx-module-actions">
                        <button
                          className="mx-module-select"
                          title={
                            scope.includes(module.id)
                              ? "从组合中移除"
                              : "加入组合"
                          }
                          aria-label={`${scope.includes(module.id) ? "移除" : "加入"}${module.name}模块`}
                          aria-pressed={scope.includes(module.id)}
                          disabled={busy}
                          onClick={() => choose(toggleModule(scope, module.id))}
                        >
                          <Glyph
                            name={scope.includes(module.id) ? "check" : "plus"}
                          />
                        </button>
                      </div>
                    </div>
                    <div className="mx-module-image">
                      <ModuleArtwork module={module.id} priority />
                    </div>
                    <div className="mx-module-copy">
                      <div className="mx-module-name">
                        <h2>{module.name}</h2>
                        {(module.id === "deployx" ||
                          (module.id === "simcore" && !SIMCORE_AVAILABLE)) && (
                          <span>即将开放</span>
                        )}
                      </div>
                      <p>{module.description}</p>
                      <button
                        className="mx-module-open"
                        disabled={busy}
                        onClick={() => enterModule(module.id)}
                      >
                        {module.id === "deployx" ||
                        (module.id === "simcore" && !SIMCORE_AVAILABLE)
                          ? `查看 ${module.name} 项目`
                          : `进入 ${module.name}`}
                        <span>
                          <Glyph name="arrow" />
                        </span>
                      </button>
                    </div>
                  </article>
                ))}
              </section>
              <section
                className={`mx-composer ${dropActive ? "drag-active" : ""}`}
                aria-label="模块组合"
                onDragOver={(e) => {
                  if (
                    e.dataTransfer.types.includes(
                      "application/x-embomix-module",
                    )
                  ) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const value = e.dataTransfer.getData(
                    "application/x-embomix-module",
                  );
                  if (!busy && MODULES.some((m) => m.id === value))
                    choose(normalizeModules([...scope, value]));
                  setDropActive(false);
                }}
              >
                <div className="mx-section-label">
                  <span>
                    <Glyph name="link" />{" "}
                    {scope.length > 1 ? "模块组合" : "工作流"}
                  </span>
                  <span>
                    {scope.length
                      ? `${scope.length} 个模块`
                      : "点击 + 或拖入模块"}
                  </span>
                </div>
                <div className="mx-composer-main">
                  <div
                    className={`mx-flow ${!scope.length ? "empty" : ""}`}
                    aria-live="polite"
                  >
                    {scope.length ? (
                      MODULES.filter((m) => scope.includes(m.id)).map(
                        (module, index) => (
                          <div className="mx-flow-segment" key={module.id}>
                            {index > 0 && (
                              <span className="mx-connector">
                                <Glyph name="arrow" />
                              </span>
                            )}
                            <span className={`mx-node mx-node-${module.id}`}>
                              <i />
                              {module.name}
                              <button
                                aria-label={`从工作流移除${module.name}`}
                                disabled={busy}
                                onClick={() =>
                                  choose(toggleModule(scope, module.id))
                                }
                              >
                                <Glyph name="close" />
                              </button>
                            </span>
                          </div>
                        ),
                      )
                    ) : (
                      <span>选择模块，构建你的工作流</span>
                    )}
                  </div>
                  <button
                    className="mx-primary"
                    disabled={busy}
                    onClick={openNewProject}
                  >
                    {scope.length > 1 ? "新建组合项目" : "新建项目"}
                    <Glyph name="arrow" />
                  </button>
                </div>
              </section>
            </>
          )}
          <footer className="mx-footer">
            <span>EmboMiX</span>
            <span>Human intent. Engineering intelligence.</span>
          </footer>
        </main>
      </div>
      <dialog
        className="mx-modal"
        ref={modalRef}
        onCancel={() => setNewProject(false)}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom
          )
            setNewProject(false);
        }}
        aria-labelledby="mx-project-title"
      >
        <div className="mx-modal-heading">
          <div>
            <h2 id="mx-project-title">新建项目</h2>
          </div>
          <button
            aria-label="关闭新建项目"
            onClick={() => setNewProject(false)}
          >
            <Glyph name="close" />
          </button>
        </div>
        <form onSubmit={createProject}>
          <label htmlFor="mx-project-name">项目名称</label>
          <input
            id="mx-project-name"
            autoFocus
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="给项目取个名字"
            maxLength={100}
            required
          />
          <fieldset className="mx-modal-modules">
            <legend>使用模块</legend>
            {MODULES.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={draftModules.includes(m.id)}
                onClick={() =>
                  setDraftModules(toggleModule(draftModules, m.id))
                }
              >
                <Glyph name={draftModules.includes(m.id) ? "check" : "plus"} />
                {m.name}
              </button>
            ))}
          </fieldset>
          <button
            className="mx-primary"
            type="submit"
            disabled={!projectName.trim() || !draftModules.length}
          >
            创建项目
            <Glyph name="arrow" />
          </button>
        </form>
      </dialog>
      <StudioAssistant
        mode="preview"
        controller={null}
        contextLabel="EmboMiX · 工作空间"
        pageSuggestions={[
          "组合 Embodex 和 Simcore",
          "打开 Simcore",
          "显示全部项目",
          "新建项目",
        ]}
        onPageCommand={(text) => {
          const command = planInterfaceCommand(text);
          if (!command) return null;
          if (busy) return { ok: false, message: "正在打开项目，请稍候。" };
          if (command.kind === "modules") {
            if (command.enter) enterModule(command.modules[0]);
            else choose(command.modules);
            return {
              ok: true,
              message:
                command.enter &&
                command.modules[0] === "simcore" &&
                !SIMCORE_AVAILABLE
                  ? "Simcore 暂未开放，已显示对应项目。"
                  : `${command.enter && command.modules[0] === "embodex" ? "已进入" : "已筛选"} ${names(command.modules)}。`,
            };
          }
          if (command.kind === "workspace" || command.kind === "all-projects") {
            setView({ modules: [], search: "", projectId: null });
            return { ok: true, message: "已显示全部项目。" };
          }
          if (command.kind === "search") {
            setView({ ...view, search: command.query, projectId: null });
            return { ok: true, message: `已搜索“${command.query}”。` };
          }
          if (command.kind === "project") {
            const matches = allProjects.filter((p) => p.name === command.query);
            if (matches.length !== 1)
              return {
                ok: false,
                message:
                  matches.length > 1
                    ? "有多个同名项目，请在项目列表中选择。"
                    : "没有找到这个项目，请使用完整项目名称。",
              };
            const found = matches[0];
            setView({
              modules: found.modules,
              search: "",
              projectId: found.id,
            });
            return { ok: true, message: `已显示“${found.name}”的项目概览。` };
          }
          if (command.kind === "create") {
            openNewProject();
            setProjectName(command.name);
            return {
              ok: true,
              message: "新建项目窗口已打开，请选择模块并确认。",
            };
          }
          return {
            ok: false,
            message: "请先进入 Embodex 并选择一个设计项目。",
          };
        }}
      />
    </div>
  );
}
