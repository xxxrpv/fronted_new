"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import {
  getRepository,
  canDownload,
  runSourceValid,
  approvalSourceValid,
  canEnterEngineering,
  legalStage,
  assetPreviewUrl,
  TEMPLATE_CATALOG,
  CONCEPT_CATALOG,
} from "../../lib/v8/repository";
import type {
  Artifact,
  ConceptBranch,
  ConceptRevision,
  Mode,
  Project,
  Scenario,
  SourceRef,
  Template,
} from "../../lib/v8/types";
import type {
  ModelPartDetails,
  ModelViewerController,
  ViewerUiState,
} from "./ModelViewer";
import StudioAssistant from "./StudioAssistant";
import ModelInspector from "./ModelInspector";
import ModuleArtwork from "./ModuleArtwork";
import RequirementsBrief from "./RequirementsBrief";
import { missingRequirementItems } from "../../lib/v8/requirements-brief";
import { RETIRED_EXAMPLE_REDIRECTS } from "../../lib/v8/example-projects";
import { embedDesignReportHtml } from "../../lib/v8/design-report";
import {
  groupDeliveryPackages,
  selectDeliveryPackage,
  finalReportReadiness,
} from "../../lib/v8/delivery-packages";
import { reportModelMatches } from "../../lib/v8/report-model-source";
import { recommendTemplates } from "../../lib/v8/catalog";
import { projectResumePath } from "../../lib/v8/project-navigation";
import { useModuleWorkspace } from "../../lib/v8/workspace-context";
import { projectTag } from "../../lib/v8/project-tags";
import { readableDesignText } from "../../lib/v8/presentation";
import { planInterfaceCommand } from "../../lib/v8/interface-commands";
import "./v8.css";
import "./template-picker.css";
import "./product-review.css";
import "./silver-studio.css";
import "./liquid-glass.css";

const ModelViewer = dynamic(() => import("./ModelViewer"), {
  ssr: false,
  loading: () => <div className="viewer-loading">正在载入三维查看器…</div>,
});
const DesignReport = dynamic(() => import("./OfficialDesignReport"), {
  ssr: false,
  loading: () => (
    <div className="vreport-opening" role="status">
      正在打开方案…
    </div>
  ),
});
const ArtifactPreview = dynamic(() => import("./ArtifactPreview"), {
  ssr: false,
});
const ArtifactModel = dynamic(
  () => import("./ArtifactPreview").then((mod) => mod.ArtifactModel),
  { ssr: false },
);
const statusText: Record<string, string> = {
  queued: "等待执行",
  running: "正在处理",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "未完成",
  unknown: "状态待核实",
  ready: "文件可用",
  uploading: "文件上传中",
  validating: "文件校验中",
  missing: "文件缺失",
  expired: "授权已过期",
};
const stages = [
  ["requirements", "明确需求"],
  ["start", "设计探索"],
  ["concepts", "模型概览"],
  ["cad", "工程模型"],
  ["delivery", "方案交付"],
];
const version = (n: number) => `V${String(n).padStart(2, "0")}`;
const date = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
function Icon({ name, size: sz = 19 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 9 5v9l-9 5-9-5V8Z" />
        <path d="m3 8 9 5 9-5M12 13v9M7 5l9 5" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
        <path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z" />
      </>
    ),
    folder: <path d="M3 6h7l2 3h9v11H3ZM3 6V4h7l2 2" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    file: (
      <>
        <path d="M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" />
      </>
    ),
    check: <path d="m5 12 4 4L20 5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sliders: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01" />
      </>
    ),
    link: (
      <>
        <path d="m9 15 6-6M8 17l-2 2a4 4 0 0 1-6-6l4-4m12-2 2-2a4 4 0 0 1 6 6l-4 4" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7a9 9 0 1 0 1 9M20 3v5h-5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
  };
  return (
    <svg
      width={sz}
      height={sz}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.box}
    </svg>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`vbadge ${tone}`}>{children}</span>;
}
function Button({
  children,
  onClick,
  disabled = false,
  primary = false,
  icon,
  "aria-expanded": expanded,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  icon?: string;
  "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      className={`vbutton ${primary ? "primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
    >
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="vempty">
      <Icon name="folder" size={30} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button,a[href],input,textarea,select",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      old?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="vmodal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="vmodal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <div className="vmodal-head">
          <h2>{title}</h2>
          <button className="vicon" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Studio({ mode }: { mode: Mode }) {
  const moduleWorkspace = useModuleWorkspace();
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = mode === "preview" ? "/v8" : "/design";
  const repo = getRepository(mode);
  const parts = pathname.slice(base.length).split("/").filter(Boolean);
  const projectId = parts[0] === "projects" ? parts[1] : undefined;
  const stage = parts[2] || "requirements";
  const libraryDetail =
    stage === "library" &&
    Boolean(searchParams.get("template") || searchParams.get("report"));
  const branchId = parts[3];
  const activeStage =
    stage === "library"
      ? libraryDetail
        ? "concepts"
        : "start"
      : stage === "concepts" && !branchId
        ? "start"
        : stage;
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [viewerController, setViewerController] =
    useState<ModelViewerController | null>(null);
  const stageNavigation = useRef<HTMLElement>(null);
  useEffect(() => {
    // Reveal only the horizontal stage strip; don't move the user's page scroll.
    const reveal = () => {
      const nav = stageNavigation.current;
      const selected = nav?.querySelector<HTMLElement>('[aria-current="step"]');
      if (!nav || !selected || nav.scrollWidth <= nav.clientWidth) return;
      const bounds = nav.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      const history = nav.querySelector<HTMLElement>(".vhistory-trigger");
      const right =
        history && getComputedStyle(history).position === "sticky"
          ? history.getBoundingClientRect().left - 8
          : bounds.right - 12;
      const delta =
        item.left < bounds.left + 12
          ? item.left - bounds.left - 12
          : item.right > right
            ? item.right - right
            : 0;
      if (delta) nav.scrollLeft += delta;
    };
    const frame = requestAnimationFrame(reveal);
    window.addEventListener("resize", reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reveal);
    };
  }, [activeStage, project?.id]);
  useEffect(() => {
    if (!["library", "concepts", "cad"].includes(stage)) return;
    const dock = document.querySelector<HTMLElement>(".v8 .vassistant-dock");
    const assistant = dock?.closest<HTMLElement>(".vassistant");
    const main = document.querySelector<HTMLElement>(".v8 .vmain");
    if (!assistant || !main) return;
    let frame = 0,
      appliedLift = 0;
    const update = () => {
      frame = 0;
      if (assistant.classList.contains("open")) {
        assistant.style.transform = "";
        appliedLift = 0;
        return;
      }
      const rect = assistant.getBoundingClientRect();
      const top = rect.top + appliedLift,
        bottom = rect.bottom + appliedLift;
      const controls = [
        ...main.querySelectorAll<HTMLElement>(
          ".vstudio-footer button,.vtemplate-copy > button,.vbranch-switch button,.vstudio-canvas button,.vstudio-canvas input,.vstudio-canvas select",
        ),
      ]
        .map((control) => control.getBoundingClientRect())
        .filter((box) => box.width && box.bottom > 0 && box.top < innerHeight);
      let lift = 0;
      while (
        lift < 384 &&
        controls.some(
          (box) =>
            rect.left < box.right + 8 &&
            rect.right > box.left - 8 &&
            top - lift < box.bottom + 8 &&
            bottom - lift > box.top - 8,
        )
      )
        lift += 64;
      if (lift !== appliedLift) {
        appliedLift = lift;
        assistant.style.transform = lift ? `translateY(-${lift}px)` : "";
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(main);
    observer.observe(assistant);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      assistant.style.transform = "";
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [stage, branchId, project?.id, viewerController]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState("");
  const [constraints, setConstraints] = useState("");
  const [attachments, setAttachments] = useState<SourceRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("updated");
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<
    "assistant" | "parameters" | "history" | null
  >(null);
  const [dialog, setDialog] = useState<
    "approve" | "compare" | "reset" | "help" | "unsaved" | "library" | null
  >(null);
  const [prompt, setPrompt] = useState("");
  const [views, setViews] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [scenario, setScenario] = useState<Scenario>("success");
  const [debugTools, setDebugTools] = useState(false);
  const [chosenTemplateId, setChosenTemplateId] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(
    null,
  );
  const [partDetails, setPartDetails] = useState<ModelPartDetails | null>(null);
  const [viewerUiState, setViewerUiState] = useState<ViewerUiState | null>(
    null,
  );
  const closeArtifactPreview = useCallback(
    () => setPreviewArtifactId(null),
    [],
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const closeReport = useCallback(() => setReportId(null), []);
  useEffect(() => {
    if (panel !== "history" || dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLButtonElement>(".vdrawer-head button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPanel(null);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [panel, dialog]);
  const appliedPartOffset = useRef({ asset: "", part: "", value: 0 });
  const applyingPartOffset = useRef(false);
  const receiveController = useCallback(
    (controller: ModelViewerController | null) => {
      appliedPartOffset.current = {
        asset: controller?.assetUrl || "",
        part: "",
        value: 0,
      };
      setViewerController(controller);
    },
    [],
  );
  const templates: Template[] = mode === "preview" ? TEMPLATE_CATALOG : [];
  const [offline, setOffline] = useState(false);
  const [viewCad, setViewCad] = useState(false);
  const [runIndex, setRunIndex] = useState(-1);
  const pendingRefinement = useRef<{
    projectId: string;
    branchId: string;
    sourceRevisionId: string;
    taskId: string;
  } | null>(null);
  useEffect(() => setRunIndex(-1), [projectId]);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const allowNavigate = useRef(false);
  const authScope =
    mode === "live" ? `${auth.status}:${auth.user?.id || ""}` : "preview";
  const fence = useRef(0);
  const busyRef = useRef(false);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const requirement = project?.requirements.at(-1);
  const briefMissing = missingRequirementItems(purpose, constraints);
  const branch = branchId
    ? project?.branches.find((b) => b.id === branchId)
    : project?.branches[0];
  const requestedRevision =
    searchParams.get("revision") || (branch && views[branch.id]);
  const revision = requestedRevision
    ? branch?.revisions.find((r) => r.id === requestedRevision)
    : branch?.revisions.at(-1);
  const currentApproval = project?.approvals.find(
    (a) => a.revisionId === revision?.id && approvalSourceValid(project, a),
  );
  const engineeringApproval = project?.approvals
    .filter((a) => approvalSourceValid(project, a))
    .at(-1);
  const requestedRun = searchParams.get("run");
  const run = requestedRun
    ? project?.cadRuns.find((item) => item.id === requestedRun)
    : project?.cadRuns.at(runIndex >= 0 ? runIndex : -1);
  const deliveryPackages = project ? groupDeliveryPackages(project) : [];
  const requestedPackage = searchParams.get("package");
  const deliveryPackage = selectDeliveryPackage(
    deliveryPackages,
    requestedPackage,
  );
  const panelLocation = useRef<string | null>(null);
  const currentLocation = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
  const finalReadiness = project
    ? finalReportReadiness(project, deliveryPackages)
    : undefined;
  const deliveryArtifacts = (deliveryPackage?.artifacts || [])
    .filter(
      (a) =>
        a.kind === "model" ||
        (finalReadiness?.ready && a.mimeType.startsWith("text/html")),
    )
    .filter(
      (a, index, all) =>
        a.kind !== "design_document" ||
        all.findIndex((item) => item.kind === "design_document") === index,
    );
  useEffect(() => {
    if (panelLocation.current === currentLocation) return;
    panelLocation.current = currentLocation;
    setPanel(null);
  }, [currentLocation]);
  useEffect(() => {
    if (mode !== "preview") return;
    if (searchParams.get("debug") === "1")
      sessionStorage.setItem("embodex-v8-debug", "1");
    if (searchParams.get("debug") === "0")
      sessionStorage.removeItem("embodex-v8-debug");
    setDebugTools(sessionStorage.getItem("embodex-v8-debug") === "1");
  }, [mode, searchParams]);
  const conceptDirectionsRemaining =
    project && mode === "preview"
      ? CONCEPT_CATALOG.filter(
          (item) =>
            !project.branches.some(
              (b) => b.revisions[0]?.assetKey === item.assetKey,
            ),
        ).length
      : undefined;
  const running =
    project?.tasks.filter((t) =>
      ["queued", "running", "unknown"].includes(t.status),
    ) || [];
  const requirementDirty =
    mode === "preview" &&
    Boolean(project) &&
    stage === "requirements" &&
    !loading &&
    (text !== requirement?.text ||
      purpose !== requirement?.purpose ||
      constraints !== requirement?.constraints ||
      JSON.stringify(attachments) !==
        JSON.stringify(
          requirement?.sources.filter((s) => s.kind === "file") || [],
        ));
  const editTemplate =
    TEMPLATE_CATALOG.find((t) =>
      stage === "concepts"
        ? revision?.mediaType === "model" && t.assetKey === revision.assetKey
        : t.id === (chosenTemplateId || project?.templateId),
    ) || (stage === "library" ? TEMPLATE_CATALOG[0] : undefined);
  const editParameter = editTemplate?.parameters[0];
  const viewedReport =
    stage === "library"
      ? project?.artifacts.find(
          (a) =>
            a.id === searchParams.get("report") &&
            a.templateId === editTemplate?.id &&
            canDownload(project, a),
        )
      : undefined;
  const savedOffset =
    stage === "concepts"
      ? revision?.parameterSnapshot?.[editParameter?.key || ""]
      : viewedReport
        ? viewedReport.parameterSnapshot?.[editParameter?.key || ""]
        : editTemplate?.id === project?.templateId
          ? project?.parameters[editParameter?.key || ""]
          : 0;
  const parameterDirty = Boolean(
    project &&
      editParameter &&
      (stage === "concepts" || libraryDetail) &&
      Math.abs(offset / 1000 - (savedOffset ?? 0)) > 1e-8,
  );
  const refinementDirty = Boolean(
    stage === "concepts" && branchId && prompt.trim(),
  );
  const dirty =
    !loading && (requirementDirty || parameterDirty || refinementDirty);
  const guardNavigation = (next: () => void) => {
    if (dirty && !allowNavigate.current) {
      pendingNavigation.current = next;
      setDialog("unsaved");
    } else next();
  };
  const navigate = (
    id?: string,
    to = "requirements",
    bid?: string,
    rid?: string,
  ) => {
    const url = id
      ? `${base}/projects/${encodeURIComponent(id)}/${to}${bid ? `/${encodeURIComponent(bid)}` : ""}${rid ? `?revision=${encodeURIComponent(rid)}` : ""}`
      : mode === "preview"
        ? "/v8/embodex"
        : base;
    guardNavigation(() => {
      setPanel(null);
      setError("");
      setViewCad(false);
      router.push(url);
    });
  };
  const refresh = useCallback(async () => {
    if (mode === "live" && auth.status !== "authenticated") {
      setLoading(false);
      return;
    }
    const request = ++fence.current;
    setLoading(true);
    setError("");
    try {
      const list = await repo.list();
      const replacement =
        mode === "preview" && projectId && !list.some((p) => p.id === projectId)
          ? RETIRED_EXAMPLE_REDIRECTS[projectId]
          : undefined;
      const replacementProject =
        replacement && list.find((p) => p.id === replacement);
      if (replacementProject && request === fence.current) {
        setProjects(list);
        setProject(null);
        router.replace(
          `${base}/projects/${replacementProject.id}/${replacementProject.route === "library" ? "library" : "concepts"}${window.location.search}`,
        );
        return;
      }
      const p = projectId ? await repo.get(projectId) : null;
      if (request !== fence.current) return;
      setProjects(list);
      setProject(p);
      const modelParams =
        mode === "preview" ? new URLSearchParams(window.location.search) : null;
      const sourceReport = p?.artifacts.find(
        (a) =>
          a.id === modelParams?.get("report") &&
          a.kind === "design_document" &&
          a.mimeType.startsWith("text/html") &&
          a.templateId &&
          canDownload(p, a),
      );
      const requestedTemplate =
        mode === "preview"
          ? sourceReport?.templateId || modelParams?.get("template")
          : null;
      const selectedTemplate =
        requestedTemplate &&
        TEMPLATE_CATALOG.some(
          (t) =>
            t.id === requestedTemplate &&
            (!t.retired || sourceReport?.templateId === t.id),
        )
          ? requestedTemplate
          : p?.templateId || "";
      setChosenTemplateId(selectedTemplate);
      const sourceParameter = TEMPLATE_CATALOG.find(
        (t) => t.id === selectedTemplate,
      )?.parameters[0];
      const sourceValue = sourceParameter
        ? (sourceReport?.parameterSnapshot?.[sourceParameter.key] ??
          (selectedTemplate === p?.templateId
            ? p?.parameters[sourceParameter.key]
            : 0) ??
          0)
        : 0;
      setOffset(
        sourceParameter &&
          Number.isFinite(sourceValue) &&
          sourceValue >= sourceParameter.min &&
          sourceValue <= sourceParameter.max
          ? sourceValue * 1000
          : 0,
      );
      if (mode === "preview") setScenario(repo.getScenario());
      if (p?.requirements.length) {
        const req = p.requirements.at(-1)!;
        setText(req.text);
        setPurpose(req.purpose);
        setConstraints(req.constraints);
        setAttachments(req.sources.filter((s) => s.kind === "file"));
      } else {
        setText("");
        setPurpose("");
        setConstraints("");
        setAttachments([]);
      }
    } catch (e) {
      if (request === fence.current) {
        setProject(null);
        setProjects([]);
        setError(e instanceof Error ? e.message : "数据暂时无法载入，请重试。");
        if (
          mode === "live" &&
          e instanceof Error &&
          "status" in e &&
          e.status === 401
        )
          void auth.refreshUser();
      }
    } finally {
      if (request === fence.current) setLoading(false);
    }
  }, [repo, projectId, mode, authScope]);
  useEffect(() => {
    void refresh();
    return () => {
      fence.current++;
    };
  }, [refresh, mode === "live" ? auth.user?.id : undefined]);
  useEffect(() => {
    try {
      setLocations(
        JSON.parse(
          localStorage.getItem(`embodex-v8-locations:${mode}`) || "{}",
        ),
      );
    } catch {
      /* Optional view preference. */
    }
  }, [mode]);
  useEffect(() => {
    if (
      !project ||
      loading ||
      ![
        "requirements",
        "start",
        "library",
        "concepts",
        "cad",
        "delivery",
      ].includes(stage)
    )
      return;
    const route =
      stage === "delivery"
        ? "delivery"
        : `${stage}${branchId ? `/${branchId}` : ""}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
    if (project.id !== projectId || projectResumePath(project, route) !== route)
      return;
    setLocations((previous) => {
      if (previous[project.id] === route) return previous;
      const next = { ...previous, [project.id]: route };
      try {
        localStorage.setItem(
          `embodex-v8-locations:${mode}`,
          JSON.stringify(next),
        );
      } catch {
        /* Optional view preference. */
      }
      return next;
    });
  }, [project?.id, projectId, loading, stage, branchId, searchParams, mode]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    const online = () => {
      setOffline(false);
      if (projectId)
        void repo
          .syncTask(projectId)
          .then((p) => {
            if (projectRef.current === p.id) setProject(p);
          })
          .catch((e) => setError(String(e.message)));
    };
    const off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    setOffline(!navigator.onLine);
    try {
      const stored = JSON.parse(
        localStorage.getItem("embodex-v8-ui") || "{}",
      ) as Record<string, string>;
      setViews(stored);
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("notice") === "stage")
        setNotice("请先完成前面的设计步骤，再继续此阶段。");
      const query = searchParams.get("revision");
      if (query && branchId) setViews((v) => ({ ...v, [branchId]: query }));
    } catch {
      /* UI preference only */
    }
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
    };
  }, [branchId, projectId, repo]);
  useEffect(() => {
    if (mode === "preview")
      try {
        localStorage.setItem("embodex-v8-ui", JSON.stringify(views));
      } catch {
        /* User can still inspect current view */
      }
  }, [views, mode]);
  useEffect(() => {
    if (
      !projectId ||
      !(
        running.length ||
        project?.artifacts.some((a) =>
          ["uploading", "validating"].includes(a.status),
        )
      ) ||
      offline ||
      scenario === "offline"
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      repo
        .syncTask(projectId)
        .then((p) => {
          if (active && projectRef.current === p.id) setProject(p);
        })
        .catch((e) => {
          if (active)
            setError(e instanceof Error ? e.message : "任务同步失败。");
        });
    }, 900);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    projectId,
    running.length,
    project?.artifacts.some((a) =>
      ["uploading", "validating"].includes(a.status),
    ),
    repo,
    offline,
    scenario,
  ]);
  useEffect(() => {
    if (!project || loading || mode === "live") return;
    let dest = "";
    if (stage === "cad" && !canEnterEngineering(project))
      dest = legalStage(project, "cad");
    if (stage === "delivery" && !project.artifacts.length)
      dest = project.cadRuns.length
        ? "cad"
        : project.templateId
          ? "library"
          : project.branches.length
            ? "concepts"
            : "start";
    if (stage === "concepts" && !project.route) dest = "start";
    if (dest) {
      setNotice("请先完成前面的设计步骤，再继续此阶段。");
      router.replace(`${base}/projects/${project.id}/${dest}?notice=stage`);
    }
  }, [project, loading, stage, base, router, mode]);
  const action = async (
    fn: () => Promise<Project>,
    next?: (p: Project) => void,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const id = projectId;
    const request = fence.current;
    try {
      const p = await fn();
      if (request !== fence.current || projectRef.current !== id) return;
      if (!projects.some((item) => item.id === p.id))
        moduleWorkspace?.onDesignCreated(p);
      setProject(p);
      setProjects(repo.snapshot());
      allowNavigate.current = true;
      next?.(p);
      allowNavigate.current = false;
    } catch (e) {
      if (request === fence.current)
        setError(
          e instanceof Error ? e.message : "操作没有完成，请检查后重试。",
        );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const key = (intent: string) =>
    `${projectId || "new"}:${intent}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  const closeDialog = useCallback(() => setDialog(null), []);
  const openEngineering = (updated: Project, approvalId?: string) => {
    const records = updated.cadRuns.filter(
      (item) => item.sourceApprovalId === approvalId,
    );
    const record =
      records
        .filter((item) =>
          ["queued", "running", "unknown", "succeeded"].includes(item.status),
        )
        .at(-1) || records.at(-1);
    setRunIndex(-1);
    navigate(
      updated.id,
      record ? `cad?run=${encodeURIComponent(record.id)}` : "cad",
    );
  };
  const chooseVersion = (r: ConceptRevision, sourceBranch = branch) => {
    if (!sourceBranch || !project) return;
    guardNavigation(() => {
      setViews((v) => ({ ...v, [sourceBranch.id]: r.id }));
      setPanel(null);
      const url = `${base}/projects/${project.id}/concepts/${sourceBranch.id}?revision=${encodeURIComponent(r.id)}`;
      if (stage === "concepts" && branchId === sourceBranch.id)
        window.history.replaceState(null, "", url);
      else router.push(url);
    });
  };
  const chooseBranch = (b: ConceptBranch) =>
    navigate(
      projectId,
      "concepts",
      b.id,
      b.revisions.find((r) => r.id === views[b.id])?.id,
    );
  const refinementSubmitted = (updated: Project) => {
    const task = updated.tasks
      .filter(
        (item) =>
          item.type === "refine" &&
          item.branchId === branch?.id &&
          item.sourceRevisionId === revision?.id,
      )
      .at(-1);
    if (task?.branchId && task.sourceRevisionId)
      pendingRefinement.current = {
        projectId: updated.id,
        branchId: task.branchId,
        sourceRevisionId: task.sourceRevisionId,
        taskId: task.id,
      };
    setPrompt("");
    setPanel(null);
  };
  useEffect(() => {
    const pending = pendingRefinement.current;
    if (!pending || pending.projectId !== project?.id) return;
    const task = project.tasks.find((item) => item.id === pending.taskId);
    if (!task || ["queued", "running", "unknown"].includes(task.status)) return;
    pendingRefinement.current = null;
    const result = project.branches
      .find((item) => item.id === pending.branchId)
      ?.revisions.find((item) => task.resultIds.includes(item.id));
    if (task.status !== "succeeded" || !result) return;
    if (
      stage === "concepts" &&
      branchId === pending.branchId &&
      revision?.id === pending.sourceRevisionId
    ) {
      setViews((items) => ({ ...items, [pending.branchId]: result.id }));
      window.history.replaceState(
        null,
        "",
        `${base}/projects/${project.id}/concepts/${pending.branchId}?revision=${encodeURIComponent(result.id)}`,
      );
    }
    setNotice(`${version(result.sequence)} 已就绪，原版本和工程结果继续保留。`);
  }, [project, stage, branchId, revision?.id, base]);
  async function upload(file?: File) {
    if (!file) return;
    const request = fence.current;
    setUploading(true);
    setError("");
    try {
      const ref = await repo.upload(file);
      if (request !== fence.current) return;
      setAttachments((s) => [...s, ref]);
      setNotice(
        ref.parseStatus === "ready"
          ? "文件已在本地读取，保存需求后可回溯来源。"
          : "文件解析未完成，可重试或继续输入文字。",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件无法读取。");
    } finally {
      setUploading(false);
    }
  }
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadLock = useRef(false);
  async function download(a: Artifact) {
    if (downloadLock.current) return;
    downloadLock.current = true;
    setDownloadingId(a.id);
    setError("");
    try {
      const result = await repo.download(a);
      let url = result.url;
      let fileName = result.fileName;
      let owned = false;
      if (result.content !== undefined) {
        const content = result.mimeType.startsWith("text/html")
          ? project
            ? await (
                await import("../../lib/v8/official-report")
              ).createOfficialReadingExport(project, {
                ...a,
                content: result.content,
              })
            : (await embedDesignReportHtml(result.content)).html
          : result.content;
        if (result.mimeType.startsWith("text/html"))
          fileName = fileName.replace(/\.html?$/i, "") + "-offline.html";
        url = URL.createObjectURL(
          new Blob([content], { type: result.mimeType }),
        );
        owned = true;
      } else if (url) {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "没有此文件的下载权限。"
              : "文件暂时不可用，请刷新文件状态。",
          );
        const bytes = await response.arrayBuffer();
        if (a.sha256) {
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const actual = Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, "0"),
          ).join("");
          if (actual !== a.sha256 || bytes.byteLength !== a.sizeBytes)
            throw new Error("文件校验与此版本记录不一致，下载已停止。");
        }
        url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
        owned = true;
      }
      if (!url) throw new Error("文件尚未就绪。");
      const aEl = document.createElement("a");
      aEl.href = url;
      aEl.download = fileName;
      aEl.click();
      if (owned) setTimeout(() => URL.revokeObjectURL(url!), 1000);
      setNotice(`已下载 ${fileName}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载没有完成。");
    } finally {
      downloadLock.current = false;
      setDownloadingId(null);
    }
  }
  const canStage = (s: string) => {
    if (!project) return false;
    if (["requirements", "start"].includes(s)) return true;
    if (s === "concepts")
      return libraryView
        ? Boolean(libraryDetail || project.templateId)
        : Boolean(
            (stage !== "concepts" || branchId) &&
              (branchId || engineeringApproval),
          );
    if (s === "cad") return canEnterEngineering(project);
    if (s === "delivery") return project.artifacts.length > 0;
    return false;
  };
  const completedStage = (s: string) => {
    if (!project) return false;
    if (s === "requirements") return project.requirements.length > 0;
    if (s === "start") return Boolean(project.route);
    if (s === "concepts")
      return Boolean(project.templateId || project.approvals.length);
    if (s === "cad")
      return deliveryPackages.some((item) => item.isCurrent && item.modelReady);
    if (s === "delivery")
      return deliveryPackages.some(
        (item) =>
          item.isCurrent &&
          item.status === "ready" &&
          item.modelReady &&
          item.documentReady,
      );
    return false;
  };
  const currentTemplate =
    templates.find((t) => t.id === (chosenTemplateId || project?.templateId)) ||
    templates[0];
  const requestedTemplateId = searchParams.get("template");
  useEffect(() => {
    if (
      stage !== "library" ||
      !requestedTemplateId ||
      searchParams.get("report")
    )
      return;
    const selected = templates.find(
      (t) => t.id === requestedTemplateId && !t.retired,
    );
    if (!selected) return;
    setChosenTemplateId(selected.id);
    const definition = selected.parameters[0];
    setOffset(
      definition && selected.id === project?.templateId
        ? (project.parameters[definition.key] || 0) * 1000
        : 0,
    );
    setPanel(null);
  }, [stage, requestedTemplateId, templates, project?.id]);
  const recommendedTemplate = project
    ? recommendTemplates(project).templates[0]
    : undefined;
  const scopedProjects = moduleWorkspace?.projectIds
    ? projects.filter(
        (p) => moduleWorkspace.projectIds!.includes(p.id) || p.id === projectId,
      )
    : projects;
  const visibleProjects = scopedProjects
    .filter(
      (p) =>
        p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (filter === "all" || p.route === filter),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  const conceptTemplate =
    revision?.mediaType === "model"
      ? templates.find(
          (item) => item.assetKey === revision.assetKey && !item.retired,
        )
      : undefined;
  const savedTemplate = templates.find((t) => t.id === project?.templateId);
  const savedModelArtifact = project?.templateId
    ? project.artifacts
        .filter(
          (a) => a.kind === "model" && a.templateId === project.templateId,
        )
        .at(-1)
    : undefined;
  const isTemplateEngineering = Boolean(
    project?.route === "library" && !requestedRun && savedModelArtifact,
  );
  const libraryView =
    stage === "library" ||
    (project?.route === "library" && stage !== "concepts");
  const engineeringTitle = isTemplateEngineering
    ? "模型与配置"
    : !run
      ? "待生成工程模型"
      : project && !runSourceValid(project, run)
        ? "工程结果待核实"
        : run.status === "queued" || run.status === "running"
          ? "工程模型生成中"
          : run.status === "failed"
            ? "工程模型生成失败"
            : run.status === "unknown"
              ? "工程任务待核实"
              : run.status === "succeeded"
                ? project?.artifacts.some(
                    (a) =>
                      a.kind === "model" &&
                      a.cadRunId === run.id &&
                      canDownload(project, a),
                  )
                  ? "工程模型已生成"
                  : project?.artifacts.some(
                        (a) =>
                          a.kind === "model" &&
                          a.cadRunId === run.id &&
                          a.status === "failed",
                      )
                    ? "模型文件准备失败"
                    : "模型文件待就绪"
                : "工程结果待核实";
  const engineeringReady = Boolean(
    project &&
      (isTemplateEngineering && savedModelArtifact
        ? canDownload(project, savedModelArtifact)
        : run?.status === "succeeded" &&
          runSourceValid(project, run) &&
          project.artifacts.some(
            (a) =>
              a.kind === "model" &&
              a.cadRunId === run.id &&
              canDownload(project, a),
          )),
  );
  const parameter =
    stage === "concepts"
      ? conceptTemplate?.parameters[0]
      : currentTemplate?.parameters[0];
  const conceptParametersDirty = Boolean(
    stage === "concepts" &&
      parameter &&
      revision &&
      Math.abs(
        offset / 1000 - (revision.parameterSnapshot?.[parameter.key] ?? 0),
      ) > 1e-8,
  );
  useEffect(() => {
    if (stage !== "concepts" || !revision) return;
    const definition = conceptTemplate?.parameters[0];
    setOffset(
      definition
        ? (revision.parameterSnapshot?.[definition.key] ?? 0) * 1000
        : 0,
    );
  }, [stage, revision?.id, conceptTemplate?.id]);
  useEffect(() => {
    if (panel || reportId || previewArtifactId) setAssistantOpen(false);
  }, [panel, reportId, previewArtifactId]);
  useEffect(() => {
    setPreviewArtifactId(null);
    setPartDetails(null);
  }, [projectId, stage]);
  const templateAsset = currentTemplate?.assetKey || "quadruped";
  const openedReport = project?.artifacts.find((a) => a.id === reportId);
  const openedReportRevision = project?.branches
    .find((b) => b.id === openedReport?.branchId)
    ?.revisions.find((r) => r.id === openedReport?.revisionId);
  const openedReportModel =
    openedReport &&
    project &&
    canDownload(project, openedReport) &&
    project.artifacts
      .filter(
        (a) => canDownload(project, a) && reportModelMatches(openedReport, a),
      )
      .at(-1);
  const openReportModel =
    project &&
    openedReport &&
    canDownload(project, openedReport) &&
    (openedReportModel ||
      openedReport.templateId ||
      openedReportRevision?.mediaType === "model")
      ? () => {
          setReportId(null);
          if (openedReportModel && !openedReport.templateId) {
            setPreviewArtifactId(openedReportModel.id);
            return;
          }
          if (!project || !openedReport) return;
          if (openedReport.templateId) {
            setChosenTemplateId(openedReport.templateId);
            const definition = templates.find(
              (t) => t.id === openedReport.templateId,
            )?.parameters[0];
            setOffset(
              definition
                ? (openedReport.parameterSnapshot?.[definition.key] || 0) * 1000
                : 0,
            );
            navigate(
              project.id,
              `library?template=${encodeURIComponent(openedReport.templateId)}&report=${encodeURIComponent(openedReport.id)}`,
            );
          } else
            navigate(
              project.id,
              "concepts",
              openedReport.branchId,
              openedReport.revisionId,
            );
        }
      : undefined;
  useEffect(() => {
    if (
      !["library", "concepts"].includes(stage) ||
      !viewerController ||
      !parameter ||
      parameter.part === "sensor"
    )
      return;
    const state = appliedPartOffset.current;
    if (state.asset !== viewerController.assetUrl) return;
    const previous = state.part === parameter.part ? state.value : 0;
    const desired = offset / 1000;
    const delta = desired - previous;
    if (Math.abs(delta) < 1e-8) return;
    applyingPartOffset.current = true;
    const result = viewerController.setPartOffset(parameter.part, [
      0,
      delta,
      0,
    ]);
    applyingPartOffset.current = false;
    if (result.ok) {
      appliedPartOffset.current = {
        asset: viewerController.assetUrl,
        part: parameter.part,
        value: desired,
      };
    } else {
      setOffset(previous * 1000);
      setNotice(result.message);
    }
  }, [viewerController, parameter, offset, stage]);
  const model = (asset: string, label: string, compact = false) => (
    <ModelViewer
      key={asset}
      url={`/v8-assets/${asset}.glb`}
      label={label}
      onPartSelect={(part) => {
        if (applyingPartOffset.current) return;
        let matched = false;
        let current: string | undefined = part;
        const seen = new Set<string>();
        const sourceParts = viewerController?.getParts() || [];
        while (current && !seen.has(current)) {
          if (current === parameter?.part) {
            matched = true;
            break;
          }
          seen.add(current);
          current = sourceParts.find((item) => item.id === current)?.parentId;
        }
        if (stage === "concepts" && panel === "parameters" && !matched)
          setPanel(null);
        if (stage !== "library" && !assistantOpen && parameter && matched)
          setPanel("parameters");
      }}
      visualOffset={
        stage === "library" && parameter?.part === "sensor" ? offset / 1000 : 0
      }
      compact={compact}
      inspectorPlacement={stage === "library" ? "external" : "overlay"}
      onPartDetailsChange={setPartDetails}
      onViewStateChange={setViewerUiState}
      onControllerReady={(controller) => {
        receiveController(controller);
        if (controller && stage === "cad" && viewCad && run) {
          const source = project?.branches
            .find((b) => b.id === run.branchId)
            ?.revisions.find((r) => r.id === run.revisionId);
          const definition = TEMPLATE_CATALOG.find((t) => t.assetKey === asset)
            ?.parameters[0];
          const value =
            definition && source?.parameterSnapshot?.[definition.key];
          if (definition && value)
            controller.setPartOffset(definition.part, [0, value, 0]);
        }
      }}
    />
  );
  const artwork = (asset: string, label: string) => (
    <img
      src={assetPreviewUrl(asset as import("../../lib/v8/types").AssetKey)}
      alt={label}
      loading="lazy"
      width="520"
      height="320"
    />
  );
  const templateArtwork = (asset: string, label: string) =>
    mode === "preview" &&
    ["go2-high-fidelity", "inspection-reference", "mobile-reference"].includes(
      asset,
    ) ? (
      <img
        src={`/v8-assets/catalog/${asset}.png`}
        alt={label}
        loading="lazy"
        width="1000"
        height="760"
      />
    ) : (
      <img
        src={`/v8-assets/catalog/${asset}.svg`}
        alt={label}
        loading="lazy"
        width="512"
        height="320"
      />
    );
  const openTemplate = (template: Template) => {
    if (!project) return;
    setChosenTemplateId(template.id);
    setOffset(
      template.id === project.templateId && template.parameters[0]
        ? (project.parameters[template.parameters[0].key] || 0) * 1000
        : 0,
    );
    navigate(project.id, `library?template=${encodeURIComponent(template.id)}`);
  };
  const pendingWarning =
    revision && requirement && revision.requirementId !== requirement.id;
  if (mode === "live" && auth.status !== "authenticated")
    return (
      <div className="v8 vauth">
        <div className="vbrand">
          <span className="vbrand-mark">
            <Icon name="box" />
          </span>
          Embodex
        </div>
        <section className="vpanel">
          <Badge>平台账号</Badge>
          <h1>
            {auth.status === "loading"
              ? "正在核验平台会话"
              : auth.status === "error"
                ? "认证服务暂时不可用"
                : "登录后继续你的设计"}
          </h1>
          <p>
            {auth.status === "error"
              ? "暂时无法确认登录状态，请重试。"
              : "登录后继续查看当前项目。"}
          </p>
          {auth.status === "error" ? (
            <Button primary onClick={() => void auth.refreshUser()}>
              重新检查
            </Button>
          ) : (
            auth.status !== "loading" && (
              <Link
                className="vbutton primary"
                href={`/login?next=${encodeURIComponent(pathname)}`}
              >
                前往平台登录 <Icon name="arrow" />
              </Link>
            )
          )}
          {process.env.NODE_ENV !== "production" && (
            <Link className="vtext-link" href="/v8">
              打开开发预览
            </Link>
          )}
        </section>
      </div>
    );
  return (
    <div className="v8">
      <aside className="vsidebar">
        <Link
          className="vbrand"
          href={mode === "preview" ? "/v8/embodex" : base}
          onClick={(e) => {
            e.preventDefault();
            navigate();
          }}
        >
          <span className="vbrand-mark">
            <Icon name="box" size={22} />
          </span>
          Embodex
        </Link>
        {moduleWorkspace && (
          <button
            className="vnav"
            onClick={() => guardNavigation(moduleWorkspace.openWorkspace)}
          >
            <Icon name="back" />
            EmboMiX 工作空间
          </button>
        )}
        <div className="vworkspace-label">
          {moduleWorkspace?.scopeLabel || "设计工作空间"}
        </div>
        <button
          className={`vnav ${!projectId ? "active" : ""}`}
          onClick={() => navigate()}
        >
          <Icon name="home" />
          开始设计
        </button>
        <button
          className={`vnav ${stage === "library" ? "active" : ""}`}
          onClick={() => {
            if (projectId) navigate(projectId, "library");
            else if (mode === "preview") setDialog("library");
            else router.push("/resources");
          }}
        >
          <Icon name="box" />
          模板库
        </button>
        <button
          className={`vnav ${stage === "concepts" ? "active" : ""}`}
          onClick={() => {
            if (projectId)
              navigate(
                projectId,
                project?.route === "custom" || project?.branches.length
                  ? "concepts"
                  : "start",
              );
            else if (mode === "live") {
              setNotice("请选择平台项目，进入已接通的智能设计工作台。");
            } else {
              document.getElementById("idea")?.focus();
            }
          }}
        >
          <Icon name="spark" />
          专业定制
        </button>
        <div className="vside-divider" />
        <div className="vworkspace-label">你的项目</div>
        {scopedProjects.slice(0, 8).map((p) => (
          <button
            className={`vnav project-nav ${p.id === projectId ? "selected" : ""}`}
            key={p.id}
            onClick={() =>
              navigate(p.id, projectResumePath(p, locations[p.id]))
            }
          >
            <span
              className="project-dot"
              style={{ backgroundColor: projectTag(p.name).color }}
              title={projectTag(p.name).label}
            />
            <span>{p.name}</span>
          </button>
        ))}
        <button className="vnav subtle" onClick={() => navigate()}>
          <Icon name="plus" />
          新建设计项目
        </button>
        <div className="vsidebar-bottom">
          {mode === "live" && (
            <Link className="vnav" href="/workspace">
              <Icon name="folder" />
              平台资源文件
              <Icon name="chevron" size={14} />
            </Link>
          )}
          <button className="vnav" onClick={() => setDialog("help")}>
            <Icon name="help" />
            使用说明
          </button>
          <div className="vaccount">
            <span className="vavatar">
              {mode === "preview"
                ? "E"
                : auth.user?.displayName?.slice(0, 1) || "E"}
            </span>
            <div>
              <strong>
                {mode === "preview"
                  ? "设计体验空间"
                  : auth.user?.displayName || "平台账户"}
              </strong>
            </div>
            {mode === "live" && (
              <Link href="/account/settings" aria-label="账户设置">
                <Icon name="sliders" size={17} />
              </Link>
            )}
          </div>
        </div>
      </aside>
      <div className="vbody">
        <header className="vtopbar">
          <div className="vbreadcrumbs">
            <button onClick={() => navigate()}>工作空间</button>
            {project && (
              <>
                <Icon name="chevron" size={13} />
                <span>{project.name}</span>
              </>
            )}
          </div>
          <div className="vtop-actions">
            {mode === "preview" ? (
              <>
                <Badge tone="demo">
                  <i />
                  演示模式
                </Badge>
              </>
            ) : (
              <Badge tone="success">平台真实接口</Badge>
            )}
            <span className="vtop-separator" />
            <span className="vavatar small">E</span>
          </div>
        </header>
        {project && (
          <nav
            ref={stageNavigation}
            className="vstagebar"
            aria-label="设计阶段"
          >
            {stages.map(([s, label], i) => (
              <button
                key={s}
                disabled={!canStage(s)}
                title={
                  s === "cad" && !canStage(s)
                    ? "保存模板适配，或确认概念版本后进入"
                    : undefined
                }
                aria-current={activeStage === s ? "step" : undefined}
                className={activeStage === s ? "current" : ""}
                onClick={() => {
                  if (s === "concepts") {
                    if (libraryView)
                      navigate(
                        project.id,
                        "library?template=" +
                          encodeURIComponent(
                            searchParams.get("template") ||
                              project.templateId ||
                              currentTemplate?.id ||
                              "",
                          ),
                      );
                    else {
                      const target =
                        project.branches.find((b) => b.id === branchId) ||
                        project.branches.find(
                          (b) => b.id === engineeringApproval?.branchId,
                        ) ||
                        project.branches[0];
                      if (target) chooseBranch(target);
                    }
                  } else navigate(project.id, s);
                }}
              >
                <span className="vstage-number">
                  {completedStage(s) && activeStage !== s ? (
                    <Icon name="check" size={12} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span className="vstage-label">{label}</span>
              </button>
            ))}
            <button
              className="vhistory-trigger"
              aria-label="设计历程"
              aria-expanded={panel === "history"}
              title="设计历程"
              onClick={() => setPanel(panel === "history" ? null : "history")}
            >
              <Icon name="history" size={16} />
              设计历程
            </button>
          </nav>
        )}
        <main
          data-stage={project ? stage : "workspace"}
          data-detail={Boolean(branchId)}
          className={`vmain ${project ? "project-main" : ""} ${stage === "library" ? "model-workspace-main" : ""}`}
        >
          {notice && (
            <div className="vnotice" role="status">
              <Icon name="check" size={16} />
              {notice}
              <button aria-label="关闭提示" onClick={() => setNotice("")}>
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {(offline || scenario === "offline") && (
            <div className="vmessage warn" role="status">
              连接已中断。已保存的版本仍可查看，任务未被取消。
              <Button
                onClick={() => {
                  repo.setScenario("success");
                  setScenario("success");
                  setOffline(false);
                  if (projectId) void action(() => repo.syncTask(projectId));
                  else void refresh();
                }}
                icon="refresh"
              >
                恢复连接并同步
              </Button>
            </div>
          )}
          {error && (
            <div className="vmessage error" role="alert">
              <div>
                <strong>暂时无法完成此操作</strong>
                <p>{error}</p>
              </div>
              <Button
                onClick={() => {
                  if (projectId) void action(() => repo.syncTask(projectId));
                  else void refresh();
                }}
                icon="refresh"
              >
                核实并刷新
              </Button>
            </div>
          )}
          {loading ? (
            <div className="vskeleton">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <>
              {!projectId && mode === "preview" && (
                <>
                  <div className="vpage-intro">
                    <h1>今天，想设计什么？</h1>
                  </div>
                  <section className="vprompt">
                    <label htmlFor="idea">描述你的设计目标</label>
                    <textarea
                      id="idea"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="例如：设计一台用于仓库巡检的四足机器人，需要搭载相机，适应狭窄通道…"
                      maxLength={24000}
                    />
                    <div className="vprompt-footer">
                      <label className="vattach">
                        <Icon name="plus" size={17} />
                        {uploading ? "正在读取文件…" : "添加需求文件"}
                        <input
                          aria-label="添加需求文件"
                          type="file"
                          accept=".txt,.md,.pdf,.docx"
                          onChange={(e) => void upload(e.target.files?.[0])}
                          disabled={uploading || busy}
                        />
                      </label>
                      <span className="vfile-hint">TXT / Markdown</span>
                      <Button
                        primary
                        disabled={!text.trim() || busy || uploading}
                        onClick={() =>
                          void action(
                            () =>
                              repo.create({ text, attachments }, key("create")),
                            (p) => navigate(p.id),
                          )
                        }
                        icon="arrow"
                      >
                        {busy ? "正在保存…" : "开始设计"}
                      </Button>
                    </div>
                    {attachments.length > 0 && (
                      <div className="vsources">
                        {attachments.map((a) => (
                          <span key={a.id}>
                            <Icon name="file" size={14} />
                            {a.name} ·{" "}
                            {a.parseStatus === "ready"
                              ? "本地已读取"
                              : "待解析"}
                            <button
                              aria-label={`移除 ${a.name}`}
                              onClick={() =>
                                setAttachments((s) =>
                                  s.filter((x) => x.id !== a.id),
                                )
                              }
                            >
                              <Icon name="close" size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                  <div className="vsuggestions">
                    <span>试试这些想法</span>
                    {[
                      "仓库巡检四足机器人",
                      "三足机器人概念探索",
                      "智能输送分拣设备",
                    ].map((s, i) => (
                      <button
                        key={s}
                        onClick={() =>
                          setText(
                            [
                              "设计一台仓库巡检四足机器人，搭载相机，在狭窄通道工作。",
                              "设计一台三足机器人，稳定站立，适用于室内巡检，模块化维护。",
                              "设计一套智能输送分拣设备，支持工件检测与分流，优先紧凑布局。",
                            ][i],
                          )
                        }
                      >
                        {s}
                        <Icon name="arrow" size={13} />
                      </button>
                    ))}
                  </div>
                  <div className="ventry-options" aria-label="设计起点">
                    <button onClick={() => setDialog("library")}>
                      <Icon name="box" />
                      <span>
                        <strong>模板库</strong>
                        <small>查看已有模型，完成适配</small>
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                    <button
                      onClick={() => document.getElementById("idea")?.focus()}
                    >
                      <Icon name="spark" />
                      <span>
                        <strong>专业定制</strong>
                        <small>从需求探索多个概念方向</small>
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  <section id="recent-projects" className="vrecent">
                    <div className="vsection-head">
                      <h2>
                        最近项目{" "}
                        <span>
                          {scopedProjects.length.toString().padStart(2, "0")}
                        </span>
                      </h2>
                      <div className="vlist-tools">
                        <div className="vsearch">
                          <Icon name="search" size={15} />
                          <input
                            aria-label="搜索项目"
                            placeholder="搜索项目"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <select
                          aria-label="筛选项目"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">全部路线</option>
                          <option value="library">模板库</option>
                          <option value="custom">专业定制</option>
                        </select>
                        <select
                          aria-label="排序项目"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="updated">最近更新</option>
                          <option value="name">项目名称</option>
                        </select>
                      </div>
                    </div>
                    <div className="vproject-list">
                      {visibleProjects.map((p) => (
                        <button
                          key={p.id}
                          className="vproject-row"
                          onClick={() =>
                            navigate(
                              p.id,
                              projectResumePath(p, locations[p.id]),
                            )
                          }
                        >
                          <span
                            className={`vproject-icon ${p.route === "custom" ? "purple" : ""}`}
                          >
                            <Icon
                              name={p.route === "custom" ? "spark" : "box"}
                              size={21}
                            />
                          </span>
                          <div className="vproject-title">
                            <strong>{p.name}</strong>
                            <small>
                              {p.requirements.at(-1)?.purpose ||
                                p.requirements.at(-1)?.text?.slice(0, 36) ||
                                "平台项目"}
                            </small>
                          </div>
                          <Badge tone={p.route === "custom" ? "ai" : "blue"}>
                            {p.route === "custom"
                              ? "专业定制"
                              : p.route === "library"
                                ? "模板库"
                                : "待设计探索"}
                          </Badge>
                          <span className="vproject-time">
                            {date(p.updatedAt)}
                          </span>
                          <span className="vcontinue">
                            继续设计 <Icon name="arrow" size={16} />
                          </span>
                        </button>
                      ))}
                      {!visibleProjects.length && (
                        <Empty
                          title={
                            scopedProjects.length
                              ? "没有找到匹配的项目"
                              : "还没有设计项目"
                          }
                        >
                          <p>
                            {scopedProjects.length
                              ? "试试其他关键词或路线。"
                              : "描述你的目标，创建第一个项目。"}
                          </p>
                        </Empty>
                      )}
                    </div>
                  </section>
                  {projects.some((p) =>
                    p.tasks.some((t) =>
                      ["queued", "running", "unknown"].includes(t.status),
                    ),
                  ) && (
                    <section className="vrunning">
                      <h2>运行中的任务</h2>
                      {projects.flatMap((p) =>
                        p.tasks
                          .filter((t) =>
                            ["queued", "running", "unknown"].includes(t.status),
                          )
                          .map((t) => (
                            <button
                              className="vproject-row"
                              key={t.id}
                              onClick={() =>
                                navigate(
                                  p.id,
                                  t.type === "cad" ? "cad" : "concepts",
                                )
                              }
                            >
                              <Icon name="clock" />
                              <strong>{p.name}</strong>
                              <span>{t.currentStep}</span>
                              <Badge>{statusText[t.status]}</Badge>
                            </button>
                          )),
                      )}
                    </section>
                  )}
                </>
              )}
              {!projectId && mode === "live" && (
                <>
                  <div className="vpage-intro">
                    <h1>继续你的设计项目</h1>
                    <p>打开项目，继续已有设计。</p>
                  </div>
                  <section className="vpanel">
                    <h2>设计服务暂未开放</h2>
                    <p>
                      当前可查看平台项目。生成与修改功能待服务接入，也可进入已有工作台继续。
                    </p>
                    <div className="vactions" style={{ marginTop: 20 }}>
                      <Link className="vbutton primary" href="/projects/new">
                        创建平台项目 <Icon name="plus" />
                      </Link>
                      <Link className="vbutton" href="/workspace">
                        资源文件目录
                      </Link>
                    </div>
                  </section>
                  <section className="vrecent">
                    <div className="vsection-head">
                      <h2>平台项目</h2>
                      <Button onClick={() => void refresh()} icon="refresh">
                        刷新
                      </Button>
                    </div>
                    <div className="vproject-list">
                      {projects.map((p) => (
                        <button
                          className="vproject-row"
                          key={p.id}
                          onClick={() => navigate(p.id)}
                        >
                          <Icon name="folder" />
                          <div className="vproject-title">
                            <strong>{p.name}</strong>
                            <small>平台项目 · {p.projectType}</small>
                          </div>
                          <Icon name="arrow" size={17} />
                        </button>
                      ))}
                      {!projects.length && (
                        <Empty
                          title={
                            error ? "项目暂时无法读取" : "尚未创建平台项目"
                          }
                        />
                      )}
                    </div>
                  </section>
                </>
              )}
              {project && mode === "live" && (
                <section className="vpanel vlive-gap">
                  <Badge>平台项目</Badge>
                  <h1>{project.name}</h1>
                  <p>此项目的设计功能尚未开放，可进入已有工作台继续。</p>
                  <Link
                    className="vbutton primary"
                    href={`/projects/${project.id}/${project.projectType === "AUTOMATION" ? "equipment" : "embodex"}`}
                  >
                    进入已有业务工作台 <Icon name="arrow" />
                  </Link>
                  <Link className="vbutton" href="/workspace">
                    查看平台资源目录
                  </Link>
                </section>
              )}
              {project && mode === "preview" && (
                <>
                  {stage === "requirements" && (
                    <>
                      <div className="vheading">
                        <div>
                          <h1>让设计目标更清晰</h1>
                          <p>确认用途与关键约束。</p>
                        </div>
                        <Badge>
                          需求 {version(requirement?.sequence || 1)}
                        </Badge>
                      </div>
                      <div className="vbrief-layout">
                        <section className="vpanel vform">
                          <label htmlFor="requirement">设计目标</label>
                          <textarea
                            id="requirement"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={6}
                            maxLength={24000}
                          />
                          <RequirementsBrief
                            purpose={purpose}
                            constraints={constraints}
                            onPurposeChange={setPurpose}
                            onConstraintsChange={setConstraints}
                          />
                          {(project.branches.length > 0 ||
                            project.cadRuns.length > 0) && (
                            <div className="vmessage warn">
                              需求修改后，后续设计需重新确认；已有成果保留为历史版本。
                            </div>
                          )}
                          <div className="vform-actions">
                            <Button
                              primary
                              disabled={!text.trim() || busy}
                              onClick={() =>
                                void action(
                                  () =>
                                    repo.saveRequirements(
                                      project.id,
                                      {
                                        text,
                                        purpose,
                                        constraints,
                                        attachments,
                                      },
                                      key("requirements"),
                                    ),
                                  (p) => navigate(p.id, "start"),
                                )
                              }
                              icon="check"
                            >
                              保存需求，设计探索
                            </Button>
                          </div>
                        </section>
                        <aside className="vbrief-aside">
                          <section className="vpanel">
                            <span className="vmini-label">
                              {briefMissing.length ? "优先确认" : "明确需求"}
                            </span>
                            <h3>{briefMissing[0] || "任务与验收信息已记录"}</h3>
                            <p>
                              {briefMissing.length
                                ? "可以补充后继续，也可以暂时保留待确认项。"
                                : "确认后选择设计起点。"}
                            </p>
                          </section>
                          <section className="vpanel">
                            <h3>需求来源</h3>
                            <div className="vsource-item">
                              <Icon name="file" />
                              <div>
                                <strong>用户输入</strong>
                                <p>当前文本 · {text.length} 字</p>
                              </div>
                              <Badge
                                tone={requirementDirty ? "warn" : "success"}
                              >
                                {requirementDirty ? "未保存" : "已记录"}
                              </Badge>
                            </div>
                            {attachments.map((a) => (
                              <div className="vsource-item" key={a.id}>
                                <Icon name="file" />
                                <div>
                                  <strong>{a.name}</strong>
                                  <p>{a.error || size(a.sizeBytes || 0)}</p>
                                </div>
                                <Badge
                                  tone={
                                    a.parseStatus === "ready"
                                      ? "success"
                                      : "warn"
                                  }
                                >
                                  {a.parseStatus === "ready"
                                    ? "已读取"
                                    : "解析失败"}
                                </Badge>
                                {a.parseStatus === "failed" && (
                                  <label className="vattach">
                                    重新选择
                                    <input
                                      aria-label={`重新读取 ${a.name}`}
                                      type="file"
                                      onChange={(e) =>
                                        void upload(e.target.files?.[0])
                                      }
                                    />
                                  </label>
                                )}
                              </div>
                            ))}
                            <label className="vattach">
                              <Icon name="plus" size={16} />
                              添加需求文件
                              <input
                                aria-label="添加需求附件"
                                type="file"
                                accept=".txt,.md,.pdf,.docx"
                                onChange={(e) =>
                                  void upload(e.target.files?.[0])
                                }
                              />
                            </label>
                          </section>
                        </aside>
                      </div>
                    </>
                  )}
                  {stage === "start" && (
                    <>
                      <div className="vheading">
                        <div>
                          <h1>从哪里开始这项设计？</h1>
                        </div>
                        <Button
                          onClick={() => navigate(project.id)}
                          icon="file"
                        >
                          编辑需求
                        </Button>
                      </div>
                      <div className="vstart-grid">
                        <section className="vpanel vstart-card">
                          <div className="vstart-art">
                            {recommendedTemplate ? (
                              artwork(
                                recommendedTemplate.assetKey,
                                recommendedTemplate.name,
                              )
                            ) : (
                              <Icon name="box" size={70} />
                            )}
                          </div>
                          <h2>模板库</h2>
                          <p>
                            {recommendedTemplate
                              ? `已关联 ${recommendedTemplate.name}，也可浏览其他模型。`
                              : "浏览机器人模型，选择合适的设计起点。"}
                          </p>
                          <Button
                            disabled={busy}
                            onClick={() => navigate(project.id, "library")}
                            icon="box"
                          >
                            浏览模板库
                          </Button>
                        </section>
                        <section className="vpanel vstart-card custom">
                          <div className="vstart-art">
                            {mode === "preview" ? (
                              <ModuleArtwork module="embodex" />
                            ) : (
                              <Icon name="spark" size={70} />
                            )}
                          </div>
                          <h2>专业定制</h2>
                          <p>比较概念、逐版修改，确认后进入工程建模。</p>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () => repo.chooseRoute(project.id, "custom"),
                                (p) => navigate(p.id, "concepts"),
                              )
                            }
                            icon="spark"
                          >
                            开始专业定制
                          </Button>
                        </section>
                      </div>
                    </>
                  )}
                  {stage === "library" && !libraryDetail && (
                    <>
                      <div className="vheading">
                        <div>
                          <h1>模板库</h1>
                        </div>
                        <Badge>
                          {templates.filter((t) => !t.retired).length} 个模型
                        </Badge>
                      </div>
                      <section
                        className="vtemplate-grid"
                        aria-label="机器人模板"
                      >
                        {templates
                          .filter((t) => !t.retired)
                          .map((t) => (
                            <article key={t.id} className="vtemplate-card">
                              <button
                                className="vtemplate-preview"
                                aria-label={`预览${t.name}`}
                                onClick={() => openTemplate(t)}
                              >
                                {templateArtwork(t.assetKey, t.name)}
                              </button>
                              <div className="vtemplate-copy">
                                <span className="vmini-label">
                                  {t.category}
                                </span>
                                <h2>{t.name}</h2>
                                <p>
                                  {(
                                    {
                                      "sample-go2": "四足本体与关节结构",
                                      "sample-inspection": "巡检感知与设备搭载",
                                      "sample-mobile": "移动配送与对接感知",
                                    } as Record<string, string>
                                  )[t.id] || t.description}
                                </p>
                                <div className="vtemplate-capabilities">
                                  {t.capabilities.slice(0, 3).map((c) => (
                                    <span key={c}>{c}</span>
                                  ))}
                                </div>
                                <details>
                                  <summary>模型来源与可调范围</summary>
                                  <p>{t.source}</p>
                                  <p>
                                    {t.parameters.length
                                      ? t.parameters
                                          .map(
                                            (p) =>
                                              `${p.label} ${p.min}–${p.max} ${p.unit}`,
                                          )
                                          .join("；")
                                      : "支持整机与零件查看"}
                                  </p>
                                </details>
                                <Button
                                  onClick={() => openTemplate(t)}
                                  icon="arrow"
                                >
                                  查看模型
                                </Button>
                              </div>
                            </article>
                          ))}
                      </section>
                      <div className="vstudio-footer">
                        <Button
                          onClick={() => navigate(project.id, "start")}
                          icon="back"
                        >
                          返回设计探索
                        </Button>
                      </div>
                    </>
                  )}
                  {stage === "library" && libraryDetail && (
                    <>
                      <div className="vmodel-breadcrumb">
                        <Button
                          onClick={() => navigate(project.id, "library")}
                          icon="back"
                        >
                          返回模板库
                        </Button>
                      </div>
                      <div className="vheading">
                        <div>
                          <h1>{currentTemplate?.name || "模板库"}</h1>
                        </div>
                        <div className="vactions">
                          <Badge tone="blue">参考模型 · GLB</Badge>
                        </div>
                      </div>
                      <div className="vmodel-workspace">
                        <div className="vstudio-canvas">
                          {model(
                            templateAsset,
                            currentTemplate?.name || "四足巡检机器人",
                          )}
                        </div>
                        <ModelInspector
                          controller={viewerController}
                          details={partDetails}
                          viewState={viewerUiState}
                          template={currentTemplate}
                          parameter={parameter}
                          offset={offset}
                          onOffsetChange={setOffset}
                        />
                      </div>
                      <div className="vstudio-footer">
                        <div className="vactions">
                          <Button
                            disabled={busy || !currentTemplate}
                            onClick={() =>
                              void action(
                                async () => {
                                  await repo.useTemplate(
                                    project.id,
                                    currentTemplate!.id,
                                    parameter
                                      ? { [parameter.key]: offset / 1000 }
                                      : {},
                                    key("reference-template"),
                                  );
                                  return repo.chooseRoute(project.id, "custom");
                                },
                                (p) => navigate(p.id, "concepts"),
                              )
                            }
                            icon="spark"
                          >
                            参考此模型重新设计
                          </Button>
                          <Button
                            primary
                            disabled={busy || !currentTemplate}
                            onClick={() =>
                              void action(
                                () =>
                                  repo.useTemplate(
                                    project.id,
                                    currentTemplate?.id || "template-quadruped",
                                    parameter
                                      ? { [parameter.key]: offset / 1000 }
                                      : {},
                                    key("template"),
                                  ),
                                (p) => navigate(p.id, "delivery"),
                              )
                            }
                            icon="check"
                          >
                            {parameter
                              ? "保存适配并查看成果"
                              : "使用此模型并查看成果"}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                  {stage === "concepts" && !branchId && (
                    <>
                      <div className="vheading">
                        <div>
                          <h1>专业定制</h1>
                        </div>
                        <div className="vactions">
                          <Badge>{project.branches.length} 个方案</Badge>
                          <Button
                            disabled={project.branches.length < 2}
                            onClick={() => setDialog("compare")}
                            icon="grid"
                          >
                            比较方向
                          </Button>
                        </div>
                      </div>
                      {project.branches.length > 0 ? (
                        <div className="vtemplate-grid" aria-label="概念方案">
                          {project.branches.map((b) => {
                            const r = b.revisions.at(-1)!;
                            const source = TEMPLATE_CATALOG.find(
                              (t) => t.assetKey === r.assetKey,
                            );
                            return (
                              <article
                                className="vtemplate-card vconcept-card"
                                key={b.id}
                              >
                                <button
                                  className="vtemplate-preview"
                                  aria-label={`预览${b.name}`}
                                  onClick={() => chooseBranch(b)}
                                >
                                  {templateArtwork(r.assetKey, b.name)}
                                </button>
                                <div className="vtemplate-copy">
                                  <div className="vconcept-meta">
                                    <span className="vmini-label">
                                      {r.mediaType === "image"
                                        ? "概念图片"
                                        : source?.category || "概念模型"}
                                    </span>
                                    <span>{version(r.sequence)}</span>
                                  </div>
                                  <h2>{b.name}</h2>
                                  <p>{b.differentiator}</p>
                                  {r.mediaType === "model" && source && (
                                    <div className="vtemplate-capabilities">
                                      {source.capabilities
                                        .slice(0, 3)
                                        .map((c) => (
                                          <span key={c}>{c}</span>
                                        ))}
                                    </div>
                                  )}
                                  <details>
                                    <summary>设计取舍</summary>
                                    <p>{b.rationale}</p>
                                    <p>{b.limitation}</p>
                                  </details>
                                  <Button
                                    onClick={() => chooseBranch(b)}
                                    icon="arrow"
                                  >
                                    查看并深化
                                  </Button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        !running.length && (
                          <Empty title="准备好探索不同方向了吗？">
                            <Button
                              primary
                              disabled={busy}
                              onClick={() =>
                                void action(() =>
                                  repo.generateConcepts(
                                    project.id,
                                    3,
                                    key("concepts"),
                                  ),
                                )
                              }
                              icon="spark"
                            >
                              生成概念方向
                            </Button>
                          </Empty>
                        )
                      )}
                      {running
                        .filter((t) => t.type === "concepts")
                        .map((t) => (
                          <TaskCard
                            key={t.id}
                            task={t}
                            onSync={() =>
                              void action(() => repo.syncTask(project.id, t.id))
                            }
                          />
                        ))}
                      {project.tasks
                        .filter(
                          (t) =>
                            t.type === "concepts" &&
                            ["partial", "failed"].includes(t.status),
                        )
                        .slice(-1)
                        .map((t) => (
                          <div className="vmessage warn" key={t.id}>
                            {t.error ||
                              "部分方向未生成，已经完成的方向仍可使用。"}
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void action(() =>
                                  repo.generateConcepts(
                                    project.id,
                                    Math.max(
                                      1,
                                      (t.requestedCount || 3) -
                                        t.resultIds.length,
                                    ),
                                    key("retry-concepts"),
                                  ),
                                )
                              }
                            >
                              重试未完成方向
                            </Button>
                          </div>
                        ))}
                      {project.tasks
                        .filter(
                          (t) =>
                            t.type === "concepts" &&
                            t.status === "succeeded" &&
                            t.resultIds.length === 0,
                        )
                        .slice(-1)
                        .map((t) => (
                          <div className="vmessage" key={t.id}>
                            {t.currentStep}
                          </div>
                        ))}
                      {project.branches.length > 0 &&
                        conceptDirectionsRemaining !== 0 && (
                          <div className="vexplore-more">
                            <Button
                              disabled={
                                busy ||
                                conceptDirectionsRemaining === 0 ||
                                running.some((t) => t.type === "concepts")
                              }
                              onClick={() =>
                                void action(() =>
                                  repo.generateConcepts(
                                    project.id,
                                    2,
                                    key("more"),
                                  ),
                                )
                              }
                              icon="plus"
                            >
                              {conceptDirectionsRemaining === 0
                                ? "已展示全部样例方向"
                                : "再探索更多方向"}
                            </Button>
                          </div>
                        )}
                      <div className="vstudio-footer">
                        <Button
                          onClick={() => navigate(project.id, "start")}
                          icon="back"
                        >
                          返回设计探索
                        </Button>
                      </div>
                    </>
                  )}
                  {stage === "concepts" &&
                    branchId &&
                    (!branch || !revision) && (
                      <Empty title="未找到指定的概念版本">
                        <p>请返回方案集选择已有方向和版本。</p>
                        <Button
                          primary
                          onClick={() => navigate(project.id, "concepts")}
                        >
                          返回全部概念方向
                        </Button>
                      </Empty>
                    )}
                  {stage === "concepts" && branchId && branch && revision && (
                    <>
                      <div className="vdetail-top">
                        <button
                          className="vtext-link"
                          onClick={() => navigate(project.id, "concepts")}
                        >
                          <Icon name="back" size={16} />
                          全部概念方向
                        </button>
                      </div>
                      <div className="vheading studio-heading">
                        <div>
                          <h1>
                            {branch.name}
                            <Badge tone="blue">
                              {version(revision.sequence)}
                            </Badge>
                          </h1>
                        </div>
                        <div className="vactions">
                          <Badge tone={currentApproval ? "success" : "neutral"}>
                            {revision.id !== branch.latestRevisionId
                              ? currentApproval
                                ? "历史版本 · 已确认"
                                : "历史版本"
                              : currentApproval
                                ? "此版本已确认"
                                : "待确认版本"}
                          </Badge>
                        </div>
                      </div>
                      <div className="vbranch-switch">
                        {project.branches.map((b) => (
                          <button
                            key={b.id}
                            className={branch.id === b.id ? "active" : ""}
                            onClick={() => chooseBranch(b)}
                          >
                            {artwork(b.revisions.at(-1)!.assetKey, b.name)}
                            <span>{b.name}</span>
                            <small>{b.revisions.length} 个版本</small>
                          </button>
                        ))}
                      </div>
                      {pendingWarning && (
                        <div className="vmessage warn">
                          此概念来自较早的需求，请在确认前核对设计描述。
                        </div>
                      )}
                      <div className="vstudio-canvas">
                        {revision.mediaType === "model" ? (
                          model(
                            revision.assetKey,
                            `${branch.name} ${version(revision.sequence)}`,
                          )
                        ) : (
                          <div className="vimage-only">
                            {artwork(revision.assetKey, branch.name)}
                          </div>
                        )}
                        <div className="vcanvas-caption">
                          <span className="vsignal" />
                          {revision.mediaType === "model"
                            ? "概念模型"
                            : "概念图片"}
                          <span>·</span>未工程验证
                        </div>
                        <div className="vcanvas-tools">
                          {parameter && (
                            <button
                              aria-label="调整此概念支持的参数"
                              onClick={() => {
                                if (panel !== "parameters")
                                  viewerController?.focusPart(parameter.part);
                                setPanel(
                                  panel === "parameters" ? null : "parameters",
                                );
                              }}
                            >
                              <Icon name="sliders" />
                            </button>
                          )}
                        </div>
                      </div>
                      {running
                        .filter(
                          (t) =>
                            t.type === "refine" && t.branchId === branch.id,
                        )
                        .map((t) => (
                          <TaskCard
                            key={t.id}
                            task={t}
                            onSync={() =>
                              void action(() => repo.syncTask(project.id, t.id))
                            }
                          />
                        ))}
                      {project.tasks
                        .filter(
                          (t) =>
                            t.type === "refine" &&
                            t.branchId === branch.id &&
                            t.status === "failed",
                        )
                        .slice(-1)
                        .map((t) => (
                          <div className="vmessage warn" key={t.id}>
                            {t.error || "修改未完成，原版本已保留。"}
                            <Button
                              onClick={() => {
                                const source = branch.revisions.find(
                                  (r) => r.id === t.sourceRevisionId,
                                );
                                if (source) chooseVersion(source);
                                setPrompt(t.prompt || "");
                                setPanel("assistant");
                              }}
                            >
                              重新编辑修改
                            </Button>
                          </div>
                        ))}
                      <div className="vstudio-footer">
                        <Button
                          onClick={() =>
                            setPanel(panel === "assistant" ? null : "assistant")
                          }
                          icon="spark"
                        >
                          继续修改这个方向
                        </Button>
                        <div className="vactions">
                          <span className="vmuted">
                            {conceptParametersDirty
                              ? "先保存参数为新版本，再确认方案"
                              : ""}
                          </span>
                          <Button
                            primary
                            disabled={
                              busy ||
                              conceptParametersDirty ||
                              running.some(
                                (t) =>
                                  t.type === "refine" &&
                                  t.branchId === branch.id,
                              )
                            }
                            onClick={() => setDialog("approve")}
                            icon="check"
                          >
                            确认 {version(revision.sequence)}，开始 CAD 建模
                          </Button>
                        </div>
                      </div>
                      <details className="vsource-details">
                        <summary>设计说明</summary>
                        <p>
                          {readableDesignText(project, revision.description)}
                        </p>
                      </details>
                    </>
                  )}
                  {stage === "cad" && (
                    <>
                      <div className="vheading">
                        <div>
                          <h1>{engineeringTitle}</h1>
                        </div>
                        <div className="vactions">
                          <Badge tone={engineeringReady ? "success" : "blue"}>
                            {isTemplateEngineering
                              ? engineeringReady
                                ? "配置模型"
                                : "文件待就绪"
                              : run
                                ? run.status === "succeeded"
                                  ? engineeringReady
                                    ? "文件可用"
                                    : "文件待就绪"
                                  : statusText[run.status]
                                : engineeringApproval
                                  ? "方案已确认"
                                  : "待确认方案"}
                          </Badge>
                        </div>
                      </div>
                      {isTemplateEngineering && savedModelArtifact ? (
                        <>
                          <div className="vstudio-canvas">
                            <ArtifactModel
                              mode={mode}
                              project={project}
                              artifact={savedModelArtifact}
                              onControllerReady={receiveController}
                            />
                          </div>
                          <dl className="vengineering-meta">
                            <div>
                              <dt>来源模型</dt>
                              <dd>
                                {savedTemplate?.name ||
                                  savedModelArtifact.fileName}
                              </dd>
                            </div>
                            <div>
                              <dt>保存配置</dt>
                              <dd>
                                {Object.entries(
                                  savedModelArtifact.parameterSnapshot || {},
                                ).length
                                  ? Object.entries(
                                      savedModelArtifact.parameterSnapshot ||
                                        {},
                                    )
                                      .map(
                                        ([key, value]) =>
                                          `${savedTemplate?.parameters.find((p) => p.key === key)?.label || key} ${Math.round(value * 1000)} mm`,
                                      )
                                      .join(" · ")
                                  : "原始装配"}
                              </dd>
                            </div>
                            <div>
                              <dt>工程验证</dt>
                              <dd>未执行</dd>
                            </div>
                          </dl>
                          <div className="vstudio-footer">
                            <Button
                              onClick={() =>
                                navigate(
                                  project.id,
                                  `library?template=${encodeURIComponent(savedModelArtifact.templateId || project.templateId || "")}`,
                                )
                              }
                              icon="back"
                            >
                              返回模型适配
                            </Button>
                            <Button
                              primary
                              onClick={() => navigate(project.id, "delivery")}
                              icon="arrow"
                            >
                              查看交付成果
                            </Button>
                          </div>
                        </>
                      ) : !run && requestedRun ? (
                        <Empty title="未找到指定的工程记录">
                          <Button
                            onClick={() => {
                              setRunIndex(-1);
                              navigate(project.id, "cad");
                            }}
                          >
                            返回工程记录
                          </Button>
                        </Empty>
                      ) : !run ? (
                        <Empty
                          title={
                            engineeringApproval
                              ? "已确认方案，等待生成模型"
                              : project.templateId
                                ? "保存适配后查看模型"
                                : "先确定一个设计方案"
                          }
                        >
                          {engineeringApproval && (
                            <details className="vengineering-description">
                              <summary>设计说明</summary>
                              <p>
                                {readableDesignText(
                                  project,
                                  engineeringApproval.description,
                                )}
                              </p>
                            </details>
                          )}
                          <div className="vactions">
                            <Button
                              onClick={() =>
                                navigate(
                                  project.id,
                                  project.route === "library"
                                    ? "library"
                                    : "concepts",
                                )
                              }
                              icon="back"
                            >
                              {project.route === "library"
                                ? "前往模型适配"
                                : "查看概念方案"}
                            </Button>
                            {engineeringApproval && (
                              <Button
                                primary
                                disabled={busy}
                                onClick={() =>
                                  void action(
                                    () =>
                                      repo.startCad(
                                        project.id,
                                        engineeringApproval.id,
                                        key("cad"),
                                      ),
                                    (updated) =>
                                      openEngineering(
                                        updated,
                                        engineeringApproval.id,
                                      ),
                                  )
                                }
                                icon="box"
                              >
                                生成工程模型
                              </Button>
                            )}
                          </div>
                        </Empty>
                      ) : null}
                      {!isTemplateEngineering &&
                        run &&
                        (() => {
                          const sourceBranch = project.branches.find(
                            (b) => b.id === run.branchId,
                          );
                          const sourceRevision = sourceBranch?.revisions.find(
                            (r) => r.id === run.revisionId,
                          );
                          const task = project.tasks.find(
                            (t) => t.id === run.taskId,
                          );
                          const matching = runSourceValid(project, run);
                          const current =
                            sourceBranch?.latestRevisionId === run.revisionId &&
                            sourceRevision?.requirementId === requirement?.id;
                          const engineeringArtifact = project.artifacts.find(
                            (a) =>
                              a.kind === "model" &&
                              a.cadRunId === run.id &&
                              run.artifactIds.includes(a.id),
                          );
                          const runFiles = run.artifactIds.map((id) =>
                            project.artifacts.find(
                              (a) => a.id === id && a.cadRunId === run.id,
                            ),
                          );
                          const fileState = !matching
                            ? "来源待核实"
                            : run.status === "failed"
                              ? "未生成新文件"
                              : runFiles.some((a) => a && !a.authorized)
                                ? "无访问权限"
                                : runFiles.some((a) => a?.status === "expired")
                                  ? "链接已过期"
                                  : runFiles.some((a) => a?.status === "failed")
                                    ? "文件准备失败"
                                    : runFiles.some(
                                          (a) => a?.status === "missing",
                                        )
                                      ? "文件缺失"
                                      : runFiles.length &&
                                          runFiles.every(
                                            (a) => a && canDownload(project, a),
                                          )
                                        ? "文件可用"
                                        : "等待上传 / 校验";
                          return (
                            <>
                              <div className="vsource-strip">
                                <span>
                                  <Icon name="link" size={17} />
                                  确认来源
                                </span>
                                <strong>
                                  {sourceBranch?.name || "来源待核实"}
                                </strong>
                                <Badge tone="blue">
                                  {sourceRevision
                                    ? version(sourceRevision.sequence)
                                    : "版本待核实"}
                                </Badge>
                                <span>
                                  {!matching
                                    ? "来源待核实"
                                    : current
                                      ? "当前版本"
                                      : "历史成果 · 需求或概念已更新"}
                                </span>
                              </div>

                              {!matching && (
                                <div className="vmessage error">
                                  来源关系不一致，已阻止当前工程方案交付。请核实任务与批准记录。
                                </div>
                              )}
                              {run.status === "succeeded" && matching ? (
                                <>
                                  <div className="vmodel-compare">
                                    <button
                                      className={!viewCad ? "active" : ""}
                                      onClick={() => setViewCad(false)}
                                    >
                                      三维结果
                                    </button>
                                    <button
                                      className={viewCad ? "active" : ""}
                                      onClick={() => setViewCad(true)}
                                    >
                                      已确认概念
                                    </button>
                                  </div>
                                  <div className="vstudio-canvas">
                                    {viewCad &&
                                    sourceRevision?.mediaType === "image" ? (
                                      <div className="vimage-only">
                                        {artwork(
                                          sourceRevision.assetKey,
                                          sourceBranch?.name || "确认概念",
                                        )}
                                      </div>
                                    ) : viewCad && sourceRevision ? (
                                      model(
                                        sourceRevision.assetKey,
                                        "已确认概念",
                                      )
                                    ) : engineeringArtifact ? (
                                      <ArtifactModel
                                        mode={mode}
                                        project={project}
                                        artifact={engineeringArtifact}
                                        onControllerReady={receiveController}
                                      />
                                    ) : (
                                      <Empty title="模型文件暂不可用" />
                                    )}
                                  </div>
                                </>
                              ) : (
                                task && (
                                  <TaskCard
                                    task={task}
                                    large
                                    onSync={() =>
                                      void action(() =>
                                        repo.syncTask(project.id, task.id),
                                      )
                                    }
                                  />
                                )
                              )}
                              <div className="vstudio-footer">
                                <Button
                                  onClick={() =>
                                    navigate(
                                      project.id,
                                      "concepts",
                                      run.branchId,
                                      run.revisionId,
                                    )
                                  }
                                  icon="back"
                                >
                                  返回来源概念
                                </Button>
                                {run.status === "failed" ? (
                                  <Button
                                    primary
                                    disabled={busy}
                                    onClick={() =>
                                      void action(
                                        () =>
                                          repo.startCad(
                                            project.id,
                                            run.sourceApprovalId,
                                            key("cad-retry"),
                                          ),
                                        (updated) =>
                                          openEngineering(
                                            updated,
                                            run.sourceApprovalId,
                                          ),
                                      )
                                    }
                                  >
                                    重试样例任务
                                  </Button>
                                ) : (
                                  <Button
                                    primary
                                    disabled={
                                      run.status !== "succeeded" || !matching
                                    }
                                    onClick={() => {
                                      navigate(project.id, "delivery");
                                    }}
                                    icon="arrow"
                                  >
                                    查看交付成果
                                  </Button>
                                )}
                              </div>
                              <div className="vengineering-facts">
                                <div>
                                  <Icon name="check" />
                                  <span>
                                    计算任务
                                    <strong>{statusText[run.status]}</strong>
                                  </span>
                                </div>
                                <div>
                                  <Icon name="file" />
                                  <span>
                                    文件状态
                                    <strong>{fileState}</strong>
                                  </span>
                                </div>
                                <div>
                                  <Icon name="sliders" />
                                  <span>
                                    工程验证<strong>尚未执行</strong>
                                  </span>
                                </div>
                              </div>
                              <details className="vengineering-description">
                                <summary>已确认的设计描述</summary>
                                <p>
                                  {matching
                                    ? readableDesignText(
                                        project,
                                        run.sourceDescription ??
                                          sourceRevision?.description ??
                                          "",
                                      )
                                    : "来源关系待核实。"}
                                </p>
                              </details>
                            </>
                          );
                        })()}
                    </>
                  )}
                  {stage === "delivery" && (
                    <>
                      <div className="vheading">
                        <div>
                          <h1>方案交付</h1>
                        </div>
                      </div>
                      {deliveryPackage?.issues.length ? (
                        <details className="vdelivery-source-note">
                          <summary>来源与文件状态</summary>
                          {deliveryPackage.issues.map((issue) => (
                            <p key={`${issue.code}:${issue.artifactId || ""}`}>
                              {issue.message}
                            </p>
                          ))}
                        </details>
                      ) : null}
                      {(!finalReadiness?.ready ||
                        !deliveryArtifacts.some(
                          (a) => a.kind === "design_document",
                        )) && (
                        <div className="vdelivery-prepare" role="status">
                          <span>
                            {finalReadiness?.ready
                              ? "模型文件已就绪，可生成最终方案"
                              : finalReadiness?.missing}
                          </span>
                          <Button
                            disabled={busy}
                            onClick={() => {
                              if (finalReadiness?.ready)
                                void action(() =>
                                  repo.finalizeReport(project.id),
                                );
                              else
                                navigate(
                                  project.id,
                                  finalReadiness?.continueStage || "start",
                                );
                            }}
                            icon="arrow"
                          >
                            {busy
                              ? "正在准备…"
                              : finalReadiness?.ready
                                ? "生成最终方案"
                                : "继续完善设计"}
                          </Button>
                        </div>
                      )}
                      <div
                        className="vdelivery-grid"
                        data-delivery-source={deliveryPackage?.key || ""}
                      >
                        {[
                          [
                            "design_document",
                            "设计方案",
                            "方案与设计记录",
                            "file",
                          ],
                          ["model", "三维模型", "交互查看与下载", "box"],
                        ].map(([kind, title, , icon]) => (
                          <section className="vpanel vdelivery-card" key={kind}>
                            <span className="vdelivery-icon">
                              <Icon name={icon} size={25} />
                            </span>
                            <h2>{title}</h2>

                            <div className="vartifact-list">
                              {deliveryArtifacts
                                .filter((a) => a.kind === kind)
                                .sort(
                                  (a, b) =>
                                    Number(b.mimeType.startsWith("text/html")) -
                                    Number(a.mimeType.startsWith("text/html")),
                                )
                                .map((a) => (
                                  <div className="vartifact" key={a.id}>
                                    <div>
                                      <strong>{a.fileName}</strong>
                                      <small>
                                        {a.mimeType.startsWith("text/html")
                                          ? "HTML"
                                          : a.kind === "model"
                                            ? "GLB"
                                            : "Markdown"}{" "}
                                        · {size(a.sizeBytes)}
                                      </small>
                                      <Badge
                                        tone={
                                          canDownload(project, a)
                                            ? "success"
                                            : "warn"
                                        }
                                      >
                                        {!a.authorized
                                          ? "无访问权限"
                                          : a.status === "ready" &&
                                              !canDownload(project, a)
                                            ? "来源待核实"
                                            : statusText[a.status]}
                                      </Badge>
                                      {a.error && <small>{a.error}</small>}
                                    </div>
                                    <div className="vartifact-actions">
                                      <Button
                                        primary={a.mimeType.startsWith(
                                          "text/html",
                                        )}
                                        disabled={!canDownload(project, a)}
                                        onClick={() => {
                                          setPanel(null);
                                          if (
                                            a.mimeType.startsWith("text/html")
                                          )
                                            setReportId(a.id);
                                          else setPreviewArtifactId(a.id);
                                        }}
                                        icon={
                                          a.kind === "model" ? "box" : "file"
                                        }
                                      >
                                        {a.mimeType.startsWith("text/html")
                                          ? "查看完整方案"
                                          : a.kind === "model"
                                            ? "在线查看"
                                            : "查看文本"}
                                      </Button>
                                      <button
                                        className="vdownload"
                                        disabled={
                                          !canDownload(project, a) ||
                                          Boolean(downloadingId)
                                        }
                                        aria-busy={downloadingId === a.id}
                                        onClick={() => void download(a)}
                                        aria-label={`下载 ${a.fileName}`}
                                      >
                                        <Icon name="download" size={19} />
                                        {downloadingId === a.id
                                          ? "准备中…"
                                          : "下载"}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              {!deliveryArtifacts.some(
                                (a) => a.kind === kind,
                              ) && (
                                <div className="vdelivery-empty">
                                  <p>待生成</p>
                                  <div className="vartifact-actions">
                                    <Button
                                      disabled
                                      icon={kind === "model" ? "box" : "file"}
                                    >
                                      {kind === "model"
                                        ? "在线查看"
                                        : "查看完整方案"}
                                    </Button>
                                    <button
                                      className="vdownload"
                                      disabled
                                      aria-label={`下载${title}`}
                                    >
                                      <Icon name="download" size={19} /> 下载
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </section>
                        ))}
                      </div>
                      <div className="vstudio-footer">
                        <Button
                          onClick={() =>
                            navigate(
                              project.id,
                              !deliveryPackage
                                ? finalReadiness?.continueStage || "start"
                                : deliveryPackage.source.kind === "template"
                                  ? `library?template=${encodeURIComponent(deliveryPackage.source.templateId || "")}`
                                  : "concepts",
                              deliveryPackage?.source.branchId,
                              deliveryPackage?.source.revisionId,
                            )
                          }
                          icon="back"
                        >
                          继续完善设计
                        </Button>
                        <Button
                          onClick={() =>
                            void action(() => repo.syncTask(project.id))
                          }
                          icon="refresh"
                        >
                          刷新文件状态
                        </Button>
                      </div>
                      {moduleWorkspace && (
                        <section
                          className="vsimulation-entry"
                          aria-label="继续到仿真"
                        >
                          <div>
                            <h2>让设计进入仿真</h2>
                            {!moduleWorkspace.simulationAvailable && (
                              <p>Simcore 即将开放</p>
                            )}
                            {!deliveryPackage?.modelReady && (
                              <p>模型就绪后即可继续</p>
                            )}
                          </div>
                          <Button
                            primary
                            disabled={
                              busy ||
                              !deliveryPackage?.modelReady ||
                              deliveryPackage?.source.kind === "unresolved"
                            }
                            onClick={() => {
                              if (busyRef.current || !deliveryPackage) return;
                              busyRef.current = true;
                              setBusy(true);
                              setError("");
                              Promise.resolve()
                                .then(() =>
                                  moduleWorkspace.openSimulation(
                                    project,
                                    deliveryPackage.key,
                                  ),
                                )
                                .catch((cause) =>
                                  setError(
                                    cause instanceof Error
                                      ? cause.message
                                      : "暂时无法进入 Simcore，请重试。",
                                  ),
                                )
                                .finally(() => {
                                  busyRef.current = false;
                                  setBusy(false);
                                });
                            }}
                            icon="arrow"
                          >
                            {busy ? "正在衔接…" : "进入 Simcore"}
                          </Button>
                        </section>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>
        {mode === "preview" && debugTools && (
          <details className="vpreview-controls">
            <summary>
              <Icon name="sliders" size={14} />
              开发调试
            </summary>
            <div>
              <label htmlFor="scenario">仅控制样例适配层</label>
              <select
                id="scenario"
                value={scenario}
                onChange={(e) => {
                  const value = e.target.value as Scenario;
                  repo.setScenario(value);
                  setScenario(value);
                  setNotice(
                    value === "success"
                      ? "已恢复正常样例场景"
                      : "已切换样例场景；用于下一次提交或同步。",
                  );
                }}
              >
                {[
                  ["success", "正常完成"],
                  ["partial", "部分成功"],
                  ["single", "仅一个方向"],
                  ["empty", "没有结果"],
                  ["failure", "任务失败"],
                  ["offline", "网络中断"],
                  ["response-lost", "提交响应丢失"],
                  ["files-pending", "计算完成、文件待校验"],
                ].map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <button onClick={() => setDialog("reset")}>
                清空样例，重新体验
              </button>
            </div>
          </details>
        )}
      </div>
      <StudioAssistant
        isOpen={assistantOpen}
        onOpenChange={(open) => {
          setAssistantOpen(open);
          if (open) setPanel(null);
        }}
        projectId={projectId}
        controller={viewerController}
        modelName={
          stage === "library"
            ? currentTemplate?.name
            : stage === "cad" && project?.route === "library"
              ? savedTemplate?.name
              : branch?.name
        }
        mode={mode}
        contextLabel={project?.name || "Embodex"}
        pageSuggestions={
          project
            ? ["打开模板库", "打开方案交付", "查看设计历程", "返回工作空间"]
            : ["打开模板库", "显示全部项目", "新建项目", "返回工作空间"]
        }
        onPageCommand={(input) => {
          const command = planInterfaceCommand(input);
          if (!command) return null;
          if (busy || loading)
            return { ok: false, message: "正在处理当前操作，请稍候。" };
          const moved = {
            ok: !dirty,
            message: dirty
              ? "当前修改尚未保存，请在弹窗中选择后继续。"
              : "已打开。",
          };
          if (command.kind === "workspace") {
            if (!moduleWorkspace)
              return { ok: false, message: "请从平台工作空间进入。" };
            guardNavigation(moduleWorkspace.openWorkspace);
            return moved;
          }
          if (command.kind === "stage") {
            if (command.stage === "library") {
              if (projectId) navigate(projectId, "library");
              else setDialog("library");
              return moved;
            }
            if (!project || !canStage(command.stage))
              return {
                ok: false,
                message:
                  command.stage === "cad"
                    ? "请先保存模板适配，或确认设计描述。"
                    : "请先完成当前设计阶段。",
              };
            navigate(
              project.id,
              command.stage === "concepts" && project.route === "library"
                ? `library?template=${encodeURIComponent(project.templateId || "")}`
                : command.stage,
            );
            return moved;
          }
          if (command.kind === "history") {
            setPanel("history");
            setAssistantOpen(false);
            return { ok: true, message: "已打开设计历程。" };
          }
          if (command.kind === "report") {
            const document = deliveryPackage?.readyArtifacts.find(
              (a) =>
                a.kind === "design_document" &&
                a.mimeType.startsWith("text/html"),
            );
            if (!document)
              return { ok: false, message: "当前版本还没有可查看的设计方案。" };
            setReportId(document.id);
            setAssistantOpen(false);
            return { ok: true, message: "已打开当前交付版本的设计方案。" };
          }
          if (command.kind === "all-projects") {
            navigate();
            setSearch("");
            return moved;
          }
          if (command.kind === "search") {
            navigate();
            setSearch(command.query);
            return moved;
          }
          if (command.kind === "create") {
            navigate();
            return moved;
          }
          if (command.kind === "project") {
            const found = scopedProjects.filter(
              (p) => p.name === command.query,
            );
            if (found.length !== 1)
              return {
                ok: false,
                message: "请从当前项目列表中选择，或输入完整且唯一的项目名称。",
              };
            navigate(
              found[0].id,
              projectResumePath(found[0], locations[found[0].id]),
            );
            return moved;
          }
          return { ok: false, message: "请返回工作空间后选择或组合模块。" };
        }}
        onAdjustment={(receipt) => {
          if (
            !parameter ||
            !viewerController ||
            receipt.partId !== parameter.part ||
            !receipt.before ||
            !receipt.after
          )
            return;
          const delta = receipt.after[1] - receipt.before[1];
          const state = appliedPartOffset.current;
          const next =
            (state.part === parameter.part ? state.value : 0) + delta;
          appliedPartOffset.current = {
            asset: viewerController.assetUrl,
            part: parameter.part,
            value: next,
          };
          setOffset(Math.round(next * 1000000) / 1000);
        }}
        onRefine={
          branch && revision
            ? (message) => {
                setPrompt(message);
                setPanel("assistant");
              }
            : undefined
        }
      />
      {previewArtifactId &&
        project &&
        project.artifacts.some((a) => a.id === previewArtifactId) && (
          <ArtifactPreview
            mode={mode}
            project={project}
            artifact={
              project.artifacts.find((a) => a.id === previewArtifactId)!
            }
            onClose={closeArtifactPreview}
          />
        )}
      {reportId && project && (
        <DesignReport
          project={project}
          artifact={project.artifacts.find((a) => a.id === reportId)}
          onOpenModel={openReportModel}
          onClose={closeReport}
        />
      )}
      {panel && (
        <div
          className="vdrawer"
          role="dialog"
          aria-modal="false"
          aria-label={
            panel === "assistant"
              ? "AI 修改"
              : panel === "history"
                ? "设计历程"
                : "部件参数"
          }
        >
          <div className="vdrawer-head">
            <span>
              <Icon
                name={
                  panel === "assistant"
                    ? "spark"
                    : panel === "history"
                      ? "history"
                      : "sliders"
                }
              />
              {panel === "assistant"
                ? "继续深化概念"
                : panel === "history"
                  ? "设计历程"
                  : "部件与参数"}
            </span>
            <button
              className="vicon"
              onClick={() => setPanel(null)}
              aria-label="关闭面板"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="vdrawer-body">
            {panel === "assistant" && branch && revision && (
              <>
                <Badge tone="ai">
                  {branch.name} · {version(revision.sequence)}
                </Badge>
                <h3>希望调整什么？</h3>
                <label htmlFor="refine">修改要求</label>
                <textarea
                  id="refine"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例如：降低机身重心，为顶部传感器增加防护结构"
                  rows={6}
                />
                <div className="vmessage">
                  预览支持参数修改；其他要求只记录到新版本描述。
                </div>
                <Button
                  primary
                  disabled={
                    !prompt.trim() ||
                    busy ||
                    running.some(
                      (t) => t.type === "refine" && t.branchId === branch.id,
                    )
                  }
                  onClick={() =>
                    void action(
                      () =>
                        repo.refine(
                          project!.id,
                          branch.id,
                          revision.id,
                          prompt,
                          key("refine"),
                          parameter
                            ? {
                                ...(revision.parameterSnapshot || {}),
                                [parameter.key]: offset / 1000,
                              }
                            : revision.parameterSnapshot,
                        ),
                      refinementSubmitted,
                    )
                  }
                  icon="spark"
                >
                  创建新修订
                </Button>
              </>
            )}
            {panel === "parameters" && (
              <>
                <Badge tone="blue">{partDetails?.label || "未选中部件"}</Badge>
                <h3>{parameter?.label || "部件详情"}</h3>
                <p>{parameter?.description || "此部件支持查看与拆解。"}</p>
                {["library", "concepts"].includes(stage) && parameter && (
                  <>
                    <label htmlFor="sensor-offset">
                      竖向偏移 <strong>{offset} mm</strong>
                    </label>
                    <input
                      id="sensor-offset"
                      aria-label={parameter.label}
                      type="range"
                      min={(parameter?.min || 0) * 1000}
                      max={(parameter?.max || 0) * 1000}
                      step={(parameter?.step || 0.01) * 1000}
                      value={offset}
                      onChange={(e) => setOffset(Number(e.target.value))}
                    />
                    <div className="vrange-bounds">
                      <span>{(parameter?.min || 0) * 1000} mm</span>
                      <span>{(parameter?.max || 0) * 1000} mm</span>
                    </div>
                    <div className="vmessage warn">
                      {stage === "concepts"
                        ? "保存为新版本后可确认方案。"
                        : "保存后更新配置模型。"}
                    </div>
                    {stage === "concepts" && branch && revision && (
                      <div className="vparameter-actions">
                        <Button
                          primary
                          disabled={
                            !conceptParametersDirty ||
                            busy ||
                            running.some(
                              (task) =>
                                task.type === "refine" &&
                                task.branchId === branch.id,
                            )
                          }
                          onClick={() =>
                            void action(
                              () =>
                                repo.refine(
                                  project!.id,
                                  branch.id,
                                  revision.id,
                                  `${parameter.label}调整为 ${offset} mm`,
                                  key("refine-parameters"),
                                  {
                                    ...(revision.parameterSnapshot || {}),
                                    [parameter.key]: offset / 1000,
                                  },
                                ),
                              refinementSubmitted,
                            )
                          }
                        >
                          保存参数为新版本
                        </Button>
                        <Button
                          onClick={() =>
                            setOffset(
                              (revision.parameterSnapshot?.[parameter.key] ??
                                0) * 1000,
                            )
                          }
                        >
                          还原此版本参数
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {panel === "history" && (
              <>
                {project && project.branches.length > 0 && (
                  <section className="vhistory-versions" aria-label="概念版本">
                    <h3>概念版本</h3>
                    {project.branches.map((b) => (
                      <details
                        key={b.id}
                        className="vhistory-delivery"
                        open={b.id === branchId || undefined}
                      >
                        <summary>
                          <span>{b.name}</span>
                          <small>{b.revisions.length} 个版本</small>
                        </summary>
                        <div className="vversion-track">
                          {b.revisions
                            .slice()
                            .reverse()
                            .map((r) => (
                              <button
                                key={r.id}
                                className={
                                  b.id === branchId && r.id === revision?.id
                                    ? "active"
                                    : ""
                                }
                                aria-pressed={
                                  b.id === branchId && r.id === revision?.id
                                }
                                onClick={() => chooseVersion(r, b)}
                              >
                                <b>
                                  {version(r.sequence)}
                                  {project.approvals.some(
                                    (a) => a.revisionId === r.id,
                                  ) && <Icon name="check" size={13} />}
                                </b>
                                <span>{r.changeSummary}</span>
                                <small>{date(r.createdAt)}</small>
                              </button>
                            ))}
                        </div>
                      </details>
                    ))}
                  </section>
                )}
                {project && project.requirements.length > 0 && (
                  <details className="vhistory-delivery">
                    <summary>
                      <span>需求记录</span>
                      <small>{project.requirements.length} 个版本</small>
                    </summary>
                    {project.requirements
                      .slice()
                      .reverse()
                      .map((r) => (
                        <div className="vhistory-item" key={r.id}>
                          <strong>
                            {version(r.sequence)} · {date(r.createdAt)}
                          </strong>
                          <p>{r.text}</p>
                        </div>
                      ))}
                  </details>
                )}
                {project && project.cadRuns.length > 0 && (
                  <label className="vrun-select">
                    工程记录
                    <select
                      value={
                        stage === "cad" && run
                          ? project.cadRuns.findIndex(
                              (item) => item.id === run.id,
                            )
                          : ""
                      }
                      onChange={(e) => {
                        const index = Number(e.target.value);
                        setRunIndex(index);
                        navigate(
                          project.id,
                          `cad?run=${encodeURIComponent(project.cadRuns[index].id)}`,
                        );
                      }}
                    >
                      {(stage !== "cad" || !run) && (
                        <option value="" disabled>
                          选择已有工程记录
                        </option>
                      )}
                      {project.cadRuns.map((r, i) => (
                        <option value={i} key={r.id}>
                          第 {i + 1} 次 ·{" "}
                          {version(
                            project.branches
                              .find((b) => b.id === r.branchId)
                              ?.revisions.find((v) => v.id === r.revisionId)
                              ?.sequence || 1,
                          )}{" "}
                          · {statusText[r.status]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {deliveryPackages.length > 0 && (
                  <section className="vhistory-files" aria-label="历史交付文件">
                    <h3>交付记录</h3>
                    {requestedPackage &&
                      !deliveryPackages.some(
                        (item) => item.key === requestedPackage,
                      ) && (
                        <p className="vmessage warn">未找到这条交付记录。</p>
                      )}
                    {deliveryPackages.map((item) => (
                      <details
                        key={item.key}
                        open={requestedPackage === item.key || undefined}
                        className="vhistory-delivery"
                        data-history-source={item.key}
                      >
                        <summary>
                          <span>
                            {item.title}
                            <small>{date(item.createdAt)}</small>
                          </span>
                          {item.isCurrent && <Badge>当前</Badge>}
                        </summary>
                        {item.artifacts.map((file) => (
                          <div className="vhistory-file" key={file.id}>
                            <strong>
                              {file.kind === "model"
                                ? "三维模型"
                                : file.mimeType.startsWith("text/html")
                                  ? "设计方案"
                                  : "设计记录"}
                            </strong>
                            <span>{file.fileName}</span>
                            <div>
                              <Button
                                disabled={
                                  !project || !canDownload(project, file)
                                }
                                onClick={() => {
                                  setPanel(null);
                                  if (file.mimeType.startsWith("text/html"))
                                    setReportId(file.id);
                                  else setPreviewArtifactId(file.id);
                                }}
                                icon={file.kind === "model" ? "box" : "file"}
                              >
                                查看
                              </Button>
                              <Button
                                disabled={
                                  !project ||
                                  !canDownload(project, file) ||
                                  Boolean(downloadingId)
                                }
                                onClick={() => void download(file)}
                                icon="download"
                              >
                                {downloadingId === file.id ? "准备中…" : "下载"}
                              </Button>
                              <small>
                                {!file.authorized
                                  ? "无访问权限"
                                  : statusText[file.status]}
                              </small>
                            </div>
                          </div>
                        ))}
                        {item.issues.length > 0 && (
                          <div className="vhistory-origin">
                            {item.issues.map((issue) => (
                              <p
                                key={`${issue.code}:${issue.artifactId || ""}`}
                              >
                                {issue.message}
                              </p>
                            ))}
                          </div>
                        )}
                      </details>
                    ))}
                  </section>
                )}
                <h3 className="vhistory-events-title">设计事件</h3>
                {project?.journey.length ? (
                  project.journey
                    .slice()
                    .reverse()
                    .map((event) => (
                      <div className="vjourney-item" key={event.id}>
                        <span />
                        <div>
                          <small>{date(event.createdAt)}</small>
                          <strong>{event.message}</strong>
                        </div>
                      </div>
                    ))
                ) : (
                  <p>保存需求后，关键设计决策会出现在这里。</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {dialog === "unsaved" && (
        <Modal
          title={
            requirementDirty
              ? "还有未保存的需求修改"
              : refinementDirty
                ? "还有未提交的修改要求"
                : "还有未保存的参数修改"
          }
          onClose={closeDialog}
        >
          <p className="vmodal-copy">离开前保存修改，或放弃本次更改。</p>
          <div className="vmodal-actions">
            <Button onClick={closeDialog}>继续编辑</Button>
            <Button
              onClick={() => {
                setText(requirement?.text || "");
                setPurpose(requirement?.purpose || "");
                setConstraints(requirement?.constraints || "");
                setAttachments(
                  requirement?.sources.filter((s) => s.kind === "file") || [],
                );
                setOffset((savedOffset || 0) * 1000);
                setPrompt("");
                closeDialog();
                pendingNavigation.current?.();
                pendingNavigation.current = null;
              }}
            >
              放弃修改
            </Button>
            <Button
              primary
              disabled={
                busy ||
                (requirementDirty && !text.trim()) ||
                (stage === "concepts" &&
                  running.some(
                    (t) => t.type === "refine" && t.branchId === branch?.id,
                  ))
              }
              onClick={() => {
                closeDialog();
                void action(
                  () =>
                    requirementDirty
                      ? repo.saveRequirements(
                          project!.id,
                          { text, purpose, constraints, attachments },
                          key("requirements"),
                        )
                      : stage === "library"
                        ? repo.useTemplate(
                            project!.id,
                            currentTemplate!.id,
                            parameter ? { [parameter.key]: offset / 1000 } : {},
                            key("template"),
                          )
                        : repo.refine(
                            project!.id,
                            branch!.id,
                            revision!.id,
                            prompt.trim() ||
                              `${parameter!.label}调整为 ${offset} mm`,
                            key("refine"),
                            parameter
                              ? {
                                  ...(revision!.parameterSnapshot || {}),
                                  [parameter.key]: offset / 1000,
                                }
                              : revision!.parameterSnapshot,
                          ),
                  () => {
                    setPrompt("");
                    pendingNavigation.current?.();
                    pendingNavigation.current = null;
                  },
                );
              }}
            >
              保存后继续
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "library" && (
        <Modal title="模板库" onClose={closeDialog}>
          <div className="vcatalog-grid">
            {templates
              .filter((t) => !t.retired)
              .map((t) => (
                <article key={t.id}>
                  {templateArtwork(t.assetKey, t.name)}
                  <h3>{t.name}</h3>
                  <p>{t.capabilities.slice(0, 3).join(" · ")}</p>
                  <details>
                    <summary>模型来源与支持范围</summary>
                    <p>{t.source}</p>
                    <p>
                      {t.parameters.length
                        ? t.parameters
                            .map((p) => `${p.label} ±${p.max * 1000} mm`)
                            .join(" · ")
                        : "支持查看与拆解"}
                    </p>
                    <p>{t.precisionNote}</p>
                  </details>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void action(
                        async () => {
                          const created = await repo.create(
                            {
                              name: `${t.name} · 适配设计`,
                              text: `以 ${t.name} 为起点，查看结构并完成受支持的参数适配。`,
                            },
                            key("library-create"),
                          );
                          return repo.chooseRoute(created.id, "library");
                        },
                        (p) => {
                          closeDialog();
                          navigate(
                            p.id,
                            `library?template=${encodeURIComponent(t.id)}`,
                          );
                        },
                      )
                    }
                    icon="arrow"
                  >
                    用此模型开始设计
                  </Button>
                </article>
              ))}
          </div>
        </Modal>
      )}
      {dialog === "approve" && branch && revision && (
        <Modal title="确认这个具体版本" onClose={closeDialog}>
          <div className="vconfirm-preview">
            {artwork(revision.assetKey, branch.name)}
            <div>
              <Badge tone="blue">{version(revision.sequence)}</Badge>
              <h3>{branch.name}</h3>
              <p>{revision.changeSummary}</p>
            </div>
          </div>
          <p className="vmodal-copy">
            确认此版本用于工程建模，后续修改将另存为新版本。
          </p>
          <div className="vdescription">
            {readableDesignText(project!, revision.description)}
          </div>
          {Object.entries(revision.parameterSnapshot || {}).length > 0 && (
            <dl className="vconfirm-config">
              {Object.entries(revision.parameterSnapshot || {}).map(
                ([parameterKey, value]) => (
                  <div key={parameterKey}>
                    <dt>
                      {conceptTemplate?.parameters.find(
                        (item) => item.key === parameterKey,
                      )?.label || parameterKey}
                    </dt>
                    <dd>{Math.round(value * 1000)} mm</dd>
                  </div>
                ),
              )}
            </dl>
          )}
          <div className="vmessage">样例工程任务 · 不调用 SolidWorks</div>
          <div className="vmodal-actions">
            <Button onClick={closeDialog}>继续查看</Button>
            <Button
              primary
              disabled={busy}
              onClick={() => {
                closeDialog();
                void action(
                  async () => {
                    const p = await repo.approve(
                      project!.id,
                      branch.id,
                      revision.id,
                      key("approve"),
                    );
                    const a = p.approvals.find(
                      (a) => a.revisionId === revision.id,
                    )!;
                    return repo.startCad(p.id, a.id, `cad:${a.id}`);
                  },
                  (p) => {
                    openEngineering(
                      p,
                      p.approvals.find(
                        (item) =>
                          item.revisionId === revision.id &&
                          approvalSourceValid(p, item),
                      )?.id,
                    );
                  },
                );
              }}
              icon="check"
            >
              确认并创建样例工程任务
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "compare" && project && (
        <Modal title="比较概念方向" onClose={closeDialog}>
          <div className="vcompare-grid">
            {project.branches.map((b) => (
              <div key={b.id}>
                {artwork(b.revisions.at(-1)!.assetKey, b.name)}
                <h3>{b.name}</h3>
                <p>{b.differentiator}</p>
                <hr />
                <strong>适用理由</strong>
                <p>{b.rationale}</p>
                <strong>需要权衡</strong>
                <p>{b.limitation}</p>
                <Button
                  onClick={() => {
                    closeDialog();
                    chooseBranch(b);
                  }}
                >
                  进入这个方向
                </Button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {dialog === "reset" && (
        <Modal title="重新体验样例流程" onClose={closeDialog}>
          <p className="vmodal-copy">
            这会清除当前浏览器中的开发样例项目和版本，重新加载初始样例。平台真实数据不受影响。
          </p>
          <div className="vmodal-actions">
            <Button onClick={closeDialog}>保留当前样例</Button>
            <Button
              primary
              onClick={() => {
                void repo.reset().then((list) => {
                  setProjects(list);
                  setProject(null);
                  setViews({});
                  setDialog(null);
                  navigate();
                  void refresh();
                });
              }}
            >
              重置开发样例
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="从需求到可追溯的成果" onClose={closeDialog}>
          <div className="vhelp">
            <p>
              模板库：明确需求 → 选择模板 → 查看与支持范围内的适配 → 下载成果。
            </p>
            <p>
              专业定制：明确需求 → 多概念方向 → 独立版本迭代 → 确认具体版本 →
              工程任务 → 下载成果。
            </p>
            <p>
              当前为本地开发预览。概念与任务使用样例数据，未连接真实 Agent 或
              SolidWorks；支持参数可导出为实际 GLB。
            </p>
            <p>示例项目与修改保存在当前浏览器。模型可视化不等于工程验证。</p>
            <Link className="vtext-link" href="/design">
              打开平台工作空间 <Icon name="arrow" size={15} />
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onSync,
  large = false,
}: {
  task: Project["tasks"][number];
  onSync: () => void;
  large?: boolean;
}) {
  return (
    <section className={`vtask ${large ? "large" : ""}`} role="status">
      <div
        className={`vtask-symbol ${task.status === "failed" ? "failed" : ""}`}
      >
        <Icon
          name={
            task.status === "failed"
              ? "close"
              : task.status === "succeeded"
                ? "check"
                : "clock"
          }
          size={large ? 35 : 21}
        />
      </div>
      <div>
        <Badge tone={task.status === "failed" ? "warn" : "blue"}>
          {statusText[task.status]}
        </Badge>
        <h3>{task.currentStep}</h3>
        {task.error && <p>{task.error}</p>}
        <small>
          {task.submissionState === "unknown"
            ? "提交结果待核实，请先同步状态，避免重复提交。"
            : `更新于 ${date(task.updatedAt)}`}
        </small>
      </div>
      <Button onClick={onSync} icon="refresh">
        同步状态
      </Button>
    </section>
  );
}
