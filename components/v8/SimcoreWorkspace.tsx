"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Project } from "../../lib/v8/types";
import type { WorkspaceProject } from "../../lib/v8/module-workspace";
import { groupDeliveryPackages } from "../../lib/v8/delivery-packages";
import { planInterfaceCommand } from "../../lib/v8/interface-commands";
import StudioAssistant from "./StudioAssistant";
import type { ModelViewerController } from "./ModelViewer";
import "./simcore-workspace.css";
const ArtifactModel = dynamic(
  () => import("./ArtifactPreview").then((m) => m.ArtifactModel),
  { ssr: false },
);
const scenes = [
  {
    id: "warehouse",
    name: "仓储物流",
    image: "simulation-warehouse",
    task: "导航与避障",
  },
  {
    id: "workcell",
    name: "工业工作站",
    image: "simulation-workcell",
    task: "操作与协作",
  },
] as const;
type Config = {
  scene: string;
  duration: number;
  speed: number;
  obstacles: boolean;
};
const defaults: Config = {
  scene: "warehouse",
  duration: 60,
  speed: 1,
  obstacles: true,
};
export default function SimcoreWorkspace({
  project,
  projects,
  design,
  onWorkspace,
  onProject,
  onDesign,
}: {
  project?: WorkspaceProject;
  projects: WorkspaceProject[];
  design?: Project;
  onWorkspace: () => void;
  onProject: (id: string) => void;
  onDesign: () => void;
}) {
  const [config, setConfig] = useState<Config>(defaults);
  const [saved, setSaved] = useState<Config>(defaults);
  const [tab, setTab] = useState<"scene" | "model">("scene");
  const [notice, setNotice] = useState("");
  const [controller, setController] = useState<ModelViewerController | null>(
    null,
  );
  const handoff = project?.simulationHandoff;
  const delivery =
    design && handoff
      ? groupDeliveryPackages(design).find((p) => p.key === handoff.packageKey)
      : undefined;
  const model = delivery?.modelReady
    ? delivery.readyArtifacts.find(
        (a) =>
          a.id === handoff?.modelArtifactId &&
          a.kind === "model" &&
          a.sha256 === handoff?.sha256,
      )
    : undefined;
  const sourceReady = Boolean(
    model && design && handoff?.source.projectId === design.id,
  );
  const revision = design?.branches
    .flatMap((b) => b.revisions)
    .find((r) => r.id === handoff?.source.revisionId);
  const key = `embomix-v8-simulation-config:${project?.id || "new"}:${handoff?.packageKey || "unbound"}`;
  useEffect(() => {
    let next = defaults;
    try {
      const data = JSON.parse(localStorage.getItem(key) || "null");
      if (
        data &&
        scenes.some((s) => s.id === data.scene) &&
        Number.isFinite(data.duration) &&
        data.duration >= 10 &&
        data.duration <= 600 &&
        Number.isFinite(data.speed) &&
        data.speed >= 0.25 &&
        data.speed <= 2 &&
        typeof data.obstacles === "boolean"
      )
        next = {
          scene: data.scene,
          duration: data.duration,
          speed: data.speed,
          obstacles: data.obstacles,
        };
    } catch {
      /* New configuration remains usable. */
    }
    setConfig(next);
    setSaved(next);
    setNotice("");
    setTab("scene");
  }, [key]);
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const save = () => {
    if (!project) {
      setNotice("请先选择项目。");
      return false;
    }
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...config,
          sourceArtifactId: handoff?.modelArtifactId,
          sourceSha256: handoff?.sha256,
          updatedAt: new Date().toISOString(),
        }),
      );
      setSaved(config);
      setNotice("仿真配置已保存");
      return true;
    } catch {
      setNotice("保存失败，请检查浏览器存储。");
      return false;
    }
  };
  // Configuration edits are auto-saved on explicit navigation, never written into design facts.
  const leave = (next: () => void) => {
    if (dirty && !save()) return false;
    next();
    return true;
  };
  const scene = scenes.find((s) => s.id === config.scene) || scenes[0];
  return (
    <div className="sc-workspace mx-workspace">
      <header className="sc-header">
        <button
          className="sc-back"
          onClick={() => leave(onWorkspace)}
          aria-label="返回工作空间"
        >
          ← <span>工作空间</span>
        </button>
        <a
          href="/v8/simcore"
          className="sc-brand"
          onClick={(e) => e.preventDefault()}
        >
          <span className="sc-brand-symbol">◉</span>Simcore
        </a>
        <span className="sc-header-status">
          <i />
          仿真准备
        </span>
      </header>
      <main className="sc-layout">
        <aside className="sc-scenarios" aria-label="仿真场景">
          <label className="sc-project-select">
            项目
            <select
              aria-label="仿真项目"
              value={project?.id || ""}
              onChange={(e) => leave(() => onProject(e.target.value))}
            >
              <option value="" disabled>
                选择项目
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <h2>场景库</h2>
          {scenes.map((s) => (
            <button
              key={s.id}
              className={`sc-scene-card ${config.scene === s.id ? "active" : ""}`}
              aria-pressed={config.scene === s.id}
              onClick={() => {
                setConfig({ ...config, scene: s.id });
                setTab("scene");
                setNotice("");
              }}
            >
              <img src={`/v8-assets/cinematic/${s.image}.webp`} alt="" />
              <span>
                <strong>{s.name}</strong>
                <small>{s.task}</small>
              </span>
              {config.scene === s.id && <i>✓</i>}
            </button>
          ))}
          <div className="sc-source">
            <h2>机器人</h2>
            {handoff ? (
              <>
                <span className={`sc-state ${sourceReady ? "ready" : ""}`}>
                  <i />
                  {sourceReady ? "模型已就绪" : "文件待核验"}
                </span>
                <strong>{handoff.fileName}</strong>
                <small>
                  {revision
                    ? `概念 V${String(revision.sequence).padStart(2, "0")}`
                    : "模板适配快照"}
                </small>
                <button disabled={!sourceReady} onClick={() => setTab("model")}>
                  查看来源模型 ↗
                </button>
                <details>
                  <summary>版本来源</summary>
                  <dl>
                    <dt>文件</dt>
                    <dd>{handoff.modelArtifactId}</dd>
                    <dt>交付版本</dt>
                    <dd>{handoff.packageKey}</dd>
                    <dt>SHA-256</dt>
                    <dd>{handoff.sha256 || "待核验"}</dd>
                  </dl>
                </details>
              </>
            ) : (
              <p>尚未关联模型</p>
            )}
            {design && (
              <button onClick={() => leave(onDesign)}>
                返回 Embodex 设计 ↗
              </button>
            )}
          </div>
        </aside>
        <section className="sc-center">
          <div className="sc-title">
            <div>
              <span className="sc-kicker">SIMULATION</span>
              <h1>{project?.name || "仿真准备"}</h1>
            </div>
            <span className="sc-stage-chip">准备</span>
          </div>
          <div className="sc-viewport">
            <div className="sc-view-tabs" role="tablist" aria-label="仿真视图">
              <button
                role="tab"
                aria-selected={tab === "scene"}
                onClick={() => setTab("scene")}
              >
                场景预览
              </button>
              <button
                role="tab"
                aria-selected={tab === "model"}
                disabled={!sourceReady}
                onClick={() => setTab("model")}
              >
                机器人模型
              </button>
            </div>
            {tab === "model" && model && design ? (
              <ArtifactModel
                mode="preview"
                project={design}
                artifact={model}
                onControllerReady={setController}
              />
            ) : (
              <div className="sc-scene-visual" key={scene.id}>
                <img
                  src={`/v8-assets/cinematic/${scene.image}.webp`}
                  alt={scene.name}
                />
                <span className="sc-scene-watermark">场景示意</span>
                <div className="sc-scene-caption">
                  <span>{scene.name}</span>
                  <strong>{scene.task}</strong>
                </div>
              </div>
            )}
          </div>
          <div className="sc-runbar">
            <span>
              <i />
              尚未运行
            </span>
            <div>
              <span>{config.duration} s</span>
              <span>{config.speed}×</span>
            </div>
            <button disabled title="尚未连接仿真执行服务">
              运行仿真 <span>▷</span>
            </button>
          </div>
          <div className="sc-notice" role="status">
            {notice || (dirty ? "有未保存的设置" : "")}
          </div>
        </section>
        <aside className="sc-inspector" aria-label="仿真设置">
          <h2>仿真设置</h2>
          <div className="sc-field">
            <label htmlFor="sc-duration">
              运行时长 <span>s</span>
            </label>
            <input
              id="sc-duration"
              type="number"
              min={10}
              max={600}
              step={10}
              value={config.duration}
              onChange={(e) =>
                setConfig({
                  ...config,
                  duration: Math.min(
                    600,
                    Math.max(10, Number(e.target.value) || 10),
                  ),
                })
              }
            />
          </div>
          <div className="sc-field">
            <label htmlFor="sc-speed">
              播放倍率 <output>{config.speed}×</output>
            </label>
            <input
              id="sc-speed"
              type="range"
              min={0.25}
              max={2}
              step={0.25}
              value={config.speed}
              onChange={(e) =>
                setConfig({ ...config, speed: Number(e.target.value) })
              }
            />
          </div>
          <label className="sc-switch">
            <span>动态障碍物</span>
            <input
              type="checkbox"
              checked={config.obstacles}
              onChange={(e) =>
                setConfig({ ...config, obstacles: e.target.checked })
              }
            />
            <i />
          </label>
          <button className="sc-save" onClick={save} disabled={!project}>
            保存配置
          </button>
          <details className="sc-engine">
            <summary>
              执行服务 <span>未连接</span>
            </summary>
            <p>场景和参数可保存。连接仿真服务后可执行任务并查看结果。</p>
          </details>
        </aside>
      </main>
      <StudioAssistant
        mode="preview"
        controller={tab === "model" ? controller : null}
        projectId={`simcore:${project?.id || "workspace"}`}
        modelName={tab === "model" ? handoff?.fileName : undefined}
        contextLabel="Simcore · 仿真准备"
        pageSuggestions={[
          "打开仓储场景",
          "查看来源模型",
          "保存仿真配置",
          "返回工作空间",
        ]}
        onPageCommand={(text) => {
          if (/^(打开|切换到?)(仓储|仓库|工业|工作站)场景$/.test(text)) {
            const warehouse = /仓储|仓库/.test(text);
            setConfig({
              ...config,
              scene: warehouse ? "warehouse" : "workcell",
            });
            setTab("scene");
            return {
              ok: true,
              message: `已切换到${warehouse ? "仓储物流" : "工业工作站"}场景。`,
            };
          }
          if (text === "查看来源模型") {
            if (!sourceReady)
              return { ok: false, message: "此项目尚未关联可用的来源模型。" };
            setTab("model");
            return { ok: true, message: "已打开关联的交付模型。" };
          }
          if (text === "保存仿真配置") {
            const ok = save();
            return {
              ok,
              message: ok
                ? "配置已保存。"
                : "配置未保存，请检查项目与浏览器存储。",
            };
          }
          if (/运行|开始仿真/.test(text))
            return {
              ok: false,
              message: "仿真执行服务尚未连接，配置可以先保存。",
            };
          if (planInterfaceCommand(text)?.kind === "workspace") {
            const ok = leave(onWorkspace);
            return {
              ok,
              message: ok ? "返回工作空间。" : "配置未保存，仍停留在当前页面。",
            };
          }
          return null;
        }}
      />
    </div>
  );
}
