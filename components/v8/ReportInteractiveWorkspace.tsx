"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Artifact, Mode, Project } from "../../lib/v8/types";
import {
  canDownload,
  getRepository,
  TEMPLATE_CATALOG,
} from "../../lib/v8/repository";
import type {
  ModelPartDetails,
  ModelViewerController,
  ViewerUiState,
} from "./ModelViewer";
import ModelInspector from "./ModelInspector";
import { reportModelMatches } from "../../lib/v8/report-model-source";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });
const TASK_RULE =
  /(?:\.v8\b|ModelViewer|\.vmodel-|\.vstudio-canvas|\.vinspector|\.vpart-|\.vfov|\.vperception|\.vsensor|\.vcatalog|\.vdimensions)/;

/** Parent-realm React/WebGL can mount in the same-origin sandbox without enabling report scripts. */
function installWorkspaceStyles(target: Document) {
  if (target === document) return () => {};
  const style = target.createElement("style");
  style.dataset.reportWorkspace = "true";
  const collect = (rules: CSSRuleList): string =>
    Array.from(rules)
      .map((rule) => {
        if (rule instanceof CSSStyleRule)
          return TASK_RULE.test(rule.selectorText) ? rule.cssText : "";
        if (rule instanceof CSSKeyframesRule) return rule.cssText;
        if ("cssRules" in rule) {
          const content = collect((rule as CSSGroupingRule).cssRules);
          return content
            ? `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${content}}`
            : "";
        }
        return "";
      })
      .join("\n");
  const update = () => {
    style.textContent =
      Array.from(document.styleSheets)
        .map((sheet) => {
          try {
            return collect(sheet.cssRules);
          } catch {
            return "";
          }
        })
        .join("\n") +
      `
      .v8.report-embedded-workspace{min-height:0;background:transparent;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#274361;letter-spacing:0}
      .report-embedded-workspace .vmodel-workspace{grid-template-columns:minmax(0,1fr) 200px;gap:12px}
      .v8.report-embedded-workspace .vmodel-workspace .vstudio-canvas{position:relative;isolation:isolate;overflow:hidden;height:620px;min-height:500px;background:#eaf0f5;border:1px solid #c7dbea;border-radius:20px;box-shadow:inset 0 1px 0 #fff,0 10px 27px #4d719010}
      .report-embedded-workspace .vstudio-canvas>section{height:100%;border:0;border-radius:0}
      .report-embedded-workspace .vmodel-inspector{height:620px;min-height:500px}
      @media(max-width:820px){.report-embedded-workspace .vmodel-workspace{grid-template-columns:1fr}.v8.report-embedded-workspace .vmodel-workspace .vstudio-canvas{height:440px;min-height:360px}.report-embedded-workspace .vmodel-inspector{height:auto;min-height:0}}
      @media print{.report-embedded-workspace{display:none}}
    `;
  };
  target.head.appendChild(style);
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.head, { childList: true });
  document.addEventListener("load", update, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("load", update, true);
    style.remove();
  };
}

export default function ReportInteractiveWorkspace({
  mode,
  project,
  artifact,
  onControllerReady,
}: {
  mode: Mode;
  project: Project;
  artifact: Artifact;
  onControllerReady?: (controller: ModelViewerController | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const saved = project.artifacts.find((item) => item.id === artifact.id);
  const revision = project.branches
    .find((item) => item.id === saved?.branchId)
    ?.revisions.find((item) => item.id === saved?.revisionId);
  const template = TEMPLATE_CATALOG.find((item) =>
    saved?.templateId
      ? item.id === saved.templateId
      : Boolean(revision) && item.assetKey === revision?.assetKey,
  );
  const parameter = template?.parameters[0];
  const recordedModel = project.artifacts
    .filter((item) => saved && reportModelMatches(saved, item))
    .at(-1);
  const actualModel =
    recordedModel && canDownload(project, recordedModel)
      ? recordedModel
      : undefined;
  const valid = Boolean(saved && canDownload(project, saved));
  const key = JSON.stringify([
    mode,
    project.id,
    saved?.id,
    valid,
    saved?.templateId,
    saved?.approvalId,
    saved?.revisionId,
    saved?.parameterSnapshot,
    recordedModel?.id,
    recordedModel?.url,
    recordedModel?.status,
    recordedModel?.authorized,
    recordedModel?.sha256,
    recordedModel?.modelRecipe,
    Boolean(actualModel),
    template?.assetKey,
    revision?.assetKey,
    revision?.mediaType,
    revision?.parameterSnapshot,
  ]);
  const initialOffset = useMemo(() => {
    const value = parameter
      ? ((saved?.parameterSnapshot ?? revision?.parameterSnapshot)?.[
          parameter.key
        ] ?? 0)
      : 0;
    return parameter &&
      Number.isFinite(value) &&
      value >= parameter.min &&
      value <= parameter.max
      ? value * 1000
      : 0;
  }, [parameter, saved, revision]);
  const baselineOffset = useMemo(() => {
    const value = parameter
      ? actualModel?.modelRecipe?.parameterSnapshot[parameter.key]
      : undefined;
    return parameter &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= parameter.min &&
      value <= parameter.max
      ? value * 1000
      : 0;
  }, [parameter, actualModel]);
  const [result, setResult] = useState<{
    key: string;
    url?: string;
    error?: string;
  }>();
  const [controller, setController] = useState<ModelViewerController | null>(
    null,
  );
  const [details, setDetails] = useState<ModelPartDetails | null>(null);
  const [view, setView] = useState<ViewerUiState | null>(null);
  const [offset, setOffset] = useState(initialOffset);
  const applied = useRef(baselineOffset / 1000);
  useEffect(() => {
    if (!host.current) return;
    return installWorkspaceStyles(host.current.ownerDocument);
  }, []);
  useEffect(() => {
    const fallback = host.current?.ownerDocument.querySelector<HTMLElement>(
      "#interactive .report-interactive-fallback",
    );
    if (!fallback) return;
    const previous = fallback.hidden;
    fallback.hidden = Boolean(controller);
    const frameWindow = fallback.ownerDocument.defaultView;
    const beforePrint = () => {
      fallback.hidden = false;
    };
    const afterPrint = () => {
      fallback.hidden = Boolean(controller);
    };
    frameWindow?.addEventListener("beforeprint", beforePrint);
    frameWindow?.addEventListener("afterprint", afterPrint);
    return () => {
      fallback.hidden = previous;
      frameWindow?.removeEventListener("beforeprint", beforePrint);
      frameWindow?.removeEventListener("afterprint", afterPrint);
    };
  }, [controller, key]);
  useEffect(() => {
    let active = true;
    setOffset(initialOffset);
    applied.current = baselineOffset / 1000;
    setController(null);
    setDetails(null);
    setView(null);
    void (async () => {
      try {
        if (!saved || !canDownload(project, saved))
          throw new Error("方案来源暂不可用。");
        if (recordedModel && !actualModel)
          throw new Error("模型文件尚未就绪或没有读取权限。");
        let url: string | undefined;
        if (actualModel)
          url = (await getRepository(mode).download(actualModel)).url;
        else if (
          mode === "preview" &&
          (template || revision?.mediaType === "model")
        )
          url = `/v8-assets/${template?.assetKey || revision?.assetKey}.glb`;
        if (!url) throw new Error("当前方案没有可交互的三维文件。");
        const address = new URL(url, window.location.origin);
        if (
          address.origin !== window.location.origin ||
          !["http:", "https:"].includes(address.protocol)
        )
          throw new Error("模型地址不可用。");
        if (active) setResult({ key, url: address.href });
      } catch (error) {
        if (active)
          setResult({
            key,
            error: error instanceof Error ? error.message : "模型暂不可用。",
          });
      }
    })();
    return () => {
      active = false;
    };
    // The key contains all authorized source facts; unrelated project polling
    // must not reset an active, unsaved interactive view.
  }, [key]);
  useEffect(() => {
    if (!controller || !parameter || parameter.part === "sensor") return;
    const next = offset / 1000,
      delta = next - applied.current;
    if (Math.abs(delta) < 1e-9) return;
    const receipt = controller.setPartOffset(parameter.part, [0, delta, 0]);
    if (receipt.ok) applied.current = next;
    else setOffset(applied.current * 1000);
  }, [controller, parameter, offset]);
  const current = result?.key === key ? result : undefined;
  return (
    <div
      ref={host}
      className="v8 report-embedded-workspace"
      data-report-interactive-model={current?.url || ""}
      data-report-model-artifact={actualModel?.id || "source-reference"}
      data-frozen-offset-mm={baselineOffset}
      data-report-offset-mm={offset}
    >
      {current?.url ? (
        <div className="vmodel-workspace">
          <div className="vstudio-canvas">
            <ModelViewer
              key={key}
              url={current.url}
              expectedSha256={actualModel?.sha256}
              label={
                template?.name ||
                project.branches.find((item) => item.id === saved?.branchId)
                  ?.name ||
                "方案模型"
              }
              inspectorPlacement="external"
              onControllerReady={(next) => {
                applied.current = baselineOffset / 1000;
                setController(next);
                onControllerReady?.(next);
              }}
              onPartDetailsChange={setDetails}
              onViewStateChange={setView}
              visualOffset={parameter?.part === "sensor" ? offset / 1000 : 0}
            />
          </div>
          <ModelInspector
            controller={controller}
            details={details}
            viewState={view}
            template={template}
            parameter={parameter}
            offset={offset}
            onOffsetChange={setOffset}
          />
        </div>
      ) : (
        <p
          className="report-workspace-loading"
          role={current?.error ? "alert" : "status"}
        >
          {current?.error || "正在载入交互式方案…"}
        </p>
      )}
    </div>
  );
}
