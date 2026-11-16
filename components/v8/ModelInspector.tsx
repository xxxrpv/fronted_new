"use client";

import { useEffect, useState } from "react";
import type {
  ModelPartDetails,
  ModelViewerController,
  ViewerUiState,
  ViewerSensorView,
} from "./ModelViewer";
import type { ParameterDefinition, Template } from "../../lib/v8/types";
import "./model-workspace.css";

export default function ModelInspector({
  controller,
  details,
  viewState,
  template,
  parameter,
  offset,
  onOffsetChange,
}: {
  controller: ModelViewerController | null;
  details: ModelPartDetails | null;
  viewState: ViewerUiState | null;
  template?: Template;
  parameter?: ParameterDefinition;
  offset: number;
  onOffsetChange: (value: number) => void;
}) {
  const parts = controller?.getParts() || [];
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [catalogRoot, setCatalogRoot] = useState<string | null>(null);
  const mode = viewState?.mode || "whole";
  useEffect(() => {
    setSearch("");
    setCategory("");
    setCatalogRoot(null);
  }, [controller]);
  const categoryNames: Record<string, string> = {
    housing: "外壳",
    perception: "感知",
    sensor: "感知",
    sensors: "感知",
    mechanical: "机械",
    structure: "结构",
    drive: "驱动",
    electronics: "电控",
    electrical: "电气",
    actuator: "执行器",
    joint: "关节",
    leg: "腿部",
    payload: "载荷",
    fastener: "紧固件",
  };
  const categories = [
    ...new Set(parts.map((p) => p.category).filter(Boolean)),
  ] as string[];
  const filteredParts = parts.filter(
    (part) =>
      (!catalogRoot || part.parentId === catalogRoot) &&
      (mode !== "perception" ||
        /sensor|perception/.test(part.category || "") ||
        /相机|视觉|雷达|热像|感知|惯性/.test(part.label)) &&
      (!category || part.category === category) &&
      `${part.id} ${part.label} ${part.sourceMesh || ""} ${part.category || ""} ${categoryNames[part.category || ""] || ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selectedParameter =
    parameter &&
    details &&
    (() => {
      let id: string | undefined = details.id;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        if (id === parameter.part) return parameter;
        visited.add(id);
        id = parts.find((part) => part.id === id)?.parentId;
      }
      return undefined;
    })();
  return (
    <aside className="vmodel-inspector" aria-label="模型参数面板">
      <header className="vmodel-inspector-head">
        <div>
          <h2>
            {mode === "perception"
              ? "多模态感知"
              : mode === "exploded"
                ? "分层拆解"
                : "本体与组成"}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => {
            onOffsetChange(0);
            controller?.clearSelection?.();
            controller?.setMode("whole");
            controller?.setView("iso");
          }}
          disabled={!controller}
        >
          还原
        </button>
      </header>
      {mode === "exploded" && (
        <section className="vinspector-section" aria-label="拆解控制">
          <h3>拆解程度</h3>
          <label htmlFor="inspector-explode">
            展开
            <output>
              {Math.round((viewState?.separation || 0) * 100)} <small>%</small>
            </output>
          </label>
          <input
            id="inspector-explode"
            aria-label="拆解程度"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round((viewState?.separation || 0) * 100)}
            onChange={(e) =>
              controller?.setSeparation(Number(e.target.value) / 100)
            }
          />
          <div className="vinspector-actions">
            <button
              type="button"
              onClick={() => controller?.toggleExploded?.()}
            >
              {(viewState?.separation || 0) > 0.05 ? "合拢整机" : "一键拆解"}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(viewState?.xray)}
              onClick={() => controller?.setXray?.(!viewState?.xray)}
            >
              透视外壳
            </button>
          </div>
        </section>
      )}
      {mode === "perception" && (
        <section className="vinspector-section" aria-label="感知控制">
          <h3>
            传感器视场 <small className="vperception-badge">示意</small>
          </h3>
          <div className="vfov-toggles">
            {(
              [
                ["lidar", "雷达视场"],
                ["vision", "视觉视场"],
                ["thermal", "热像视场"],
              ] as const
            ).map(([kind, label]) => (
              <button
                type="button"
                key={kind}
                aria-pressed={Boolean(viewState?.fov[kind])}
                disabled={!viewState?.availableFov[kind]}
                onClick={() =>
                  controller?.setFov?.(kind, !viewState?.fov[kind])
                }
              >
                <i className={`vfov-dot ${kind}`} />
                {label}
                <span>{viewState?.fov[kind] ? "开" : "关"}</span>
              </button>
            ))}
          </div>
          {(viewState?.availableSensorViews.length || 0) > 1 && (
            <>
              <h3 className="vsensor-view-heading">传感器视图</h3>
              <div className="vsensor-view-buttons">
                {viewState?.availableSensorViews.map((view) => (
                  <button
                    type="button"
                    key={view}
                    aria-pressed={viewState.sensorView === view}
                    onClick={() => controller?.setSensorView?.(view)}
                  >
                    {
                      (
                        {
                          external: "外观",
                          rgb: "RGB",
                          thermal: "热像",
                          depth: "深度",
                          pointcloud: "点云",
                        } as Record<ViewerSensorView, string>
                      )[view]
                    }
                  </button>
                ))}
              </div>
              {viewState &&
                !["external", "rgb"].includes(viewState.sensorView) && (
                  <button
                    className="vsensor-comparison"
                    type="button"
                    aria-pressed={Boolean(viewState.comparison)}
                    onClick={() =>
                      controller?.setSensorComparison?.(!viewState.comparison)
                    }
                  >
                    同帧对照
                  </button>
                )}
            </>
          )}
        </section>
      )}
      <section className="vinspector-section">
        <div className="vcatalog-title">
          <h3>{mode === "perception" ? "传感器组件" : "零件目录"}</h3>
          {details && (
            <button
              type="button"
              className="vcatalog-clear"
              aria-label="返回整机与零件目录"
              onClick={() => {
                setCatalogRoot(null);
                controller?.clearSelection?.();
              }}
            >
              返回
            </button>
          )}
        </div>
        {catalogRoot && (
          <button
            className="vcatalog-parent"
            type="button"
            onClick={() => {
              setCatalogRoot(null);
              controller?.clearSelection?.();
            }}
          >
            ← 返回零件目录
          </button>
        )}
        <input
          className="vpart-search"
          aria-label="搜索零件"
          placeholder="搜索零件"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="vpart-category"
          aria-label="筛选零件分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">全部组件 · {parts.length}</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {categoryNames[value] || value}
            </option>
          ))}
        </select>
        <div className="vpart-catalog" aria-label="零件目录">
          {filteredParts.map((part) => (
            <button
              type="button"
              key={part.id}
              aria-pressed={details?.id === part.id}
              onClick={() => controller?.focusPart(part.id)}
            >
              <span>{part.label}</span>
              <small>{categoryNames[part.category || ""] || "组件"}</small>
            </button>
          ))}
          {!filteredParts.length && (
            <p className="vinspector-hint">没有匹配的零件</p>
          )}
        </div>
        {details ? (
          <div className="vinspector-part" aria-label="选中零件详情">
            <strong>{details.label}</strong>
            {parts.some((part) => part.parentId === details.id) && (
              <button
                type="button"
                className="vcatalog-drill"
                onClick={() => {
                  setCatalogRoot(details.id);
                  setSearch("");
                  setCategory("");
                }}
              >
                查看下级零件 ↗
              </button>
            )}
            <dl>
              <div>
                <dt>包围尺寸</dt>
                <dd>
                  {details.size.map((n) => (n * 1000).toFixed(1)).join(" × ")}{" "}
                  mm
                </dd>
              </div>
            </dl>
            <details>
              <summary>几何与来源</summary>
              <dl>
                <div>
                  <dt>三角面</dt>
                  <dd>{details.triangles.toLocaleString("zh-CN")}</dd>
                </div>
                {details.mesh && (
                  <div>
                    <dt>网格</dt>
                    <dd>{details.mesh}</dd>
                  </div>
                )}
                {details.body && (
                  <div>
                    <dt>装配体</dt>
                    <dd>{details.body}</dd>
                  </div>
                )}
                {details.joint && (
                  <div>
                    <dt>关节</dt>
                    <dd>{details.joint}</dd>
                  </div>
                )}
              </dl>
            </details>
          </div>
        ) : (
          <p className="vinspector-hint">点击模型选择零件</p>
        )}
      </section>
      {mode !== "perception" && (
        <section className="vinspector-section">
          <button
            type="button"
            className="vdimensions-toggle"
            aria-pressed={Boolean(viewState?.dimensions)}
            disabled={!controller?.setDimensions}
            onClick={() => controller?.setDimensions?.(!viewState?.dimensions)}
          >
            {viewState?.dimensions ? "隐藏尺寸" : "显示尺寸"}
          </button>
        </section>
      )}
      {selectedParameter && (
        <section className="vinspector-section">
          <h3>位置调整</h3>
          <label htmlFor="sensor-offset">
            {selectedParameter.label}
            <output>
              {offset} <small>mm</small>
            </output>
          </label>
          <input
            id="sensor-offset"
            aria-label={selectedParameter.label}
            type="range"
            min={selectedParameter.min * 1000}
            max={selectedParameter.max * 1000}
            step={selectedParameter.step * 1000}
            value={offset}
            onChange={(e) => onOffsetChange(Number(e.target.value))}
            disabled={!controller}
          />
          <div className="vinspector-bounds">
            <span>{selectedParameter.min * 1000} mm</span>
            <span>{selectedParameter.max * 1000} mm</span>
          </div>
        </section>
      )}
      <details className="vinspector-source">
        <summary>模型来源</summary>
        <p>{template?.source}</p>
        <p>{template?.precisionNote || "可视化参考模型"}</p>
        {template?.licenseUrl && (
          <a href={template.licenseUrl} target="_blank" rel="noreferrer">
            许可与使用说明 ↗
          </a>
        )}
        {template?.provenanceUrl && (
          <a href={template.provenanceUrl} target="_blank" rel="noreferrer">
            来源记录 ↗
          </a>
        )}
      </details>
    </aside>
  );
}
