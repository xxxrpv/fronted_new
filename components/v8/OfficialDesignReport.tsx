"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { Artifact, Project } from "../../lib/v8/types";
import type { ModelViewerController } from "./ModelViewer";
import { canDownload } from "../../lib/v8/state";
import {
  REPORT_FORMAT,
  embedDesignReportHtml,
} from "../../lib/v8/design-report";
import {
  mountOfficialReport,
  officialReportDocument,
  readOfficialReportFacts,
  snapshotOfficialReading,
} from "../../lib/v8/official-report";
import "./DesignReport.css";
import "./official-design-report.css";

const ReportInteractiveWorkspace = dynamic(
  () => import("./ReportInteractiveWorkspace"),
  {
    ssr: false,
    loading: () => (
      <p className="report-workspace-loading" role="status">
        正在载入交互式方案…
      </p>
    ),
  },
);

function saveBlob(content: string, mime: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function OfficialDesignReport({
  project,
  artifact,
  onClose,
}: {
  project: Project;
  artifact?: Artifact;
  onClose?: () => void;
  onOpenModel?: () => void;
}) {
  const saved = project.artifacts.find((a) => a.id === artifact?.id);
  const valid = Boolean(
    saved &&
      canDownload(project, saved) &&
      saved.content?.includes(`content="${REPORT_FORMAT}"`),
  );
  const html = valid ? saved!.content! : "";
  const [mounted, setMounted] = useState(false);
  const [modelHost, setModelHost] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const controller = useRef<ModelViewerController | null>(null);
  const pendingMode = useRef<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const exportBusy = useRef(false);
  const facts = useMemo(
    () => (html && saved ? readOfficialReportFacts(project, saved) : null),
    // The report and its authorized source are immutable; polling must not reset its reader state.
    [html, saved?.id, project.id],
  );
  const srcDoc = useMemo(
    () => (facts ? officialReportDocument(facts) : ""),
    [facts],
  );
  const changeMode = useCallback((mode: string) => {
    if (mode === "application") {
      queueMicrotask(() =>
        frame.current?.contentDocument
          ?.getElementById("solution-engineering")
          ?.scrollIntoView({ block: "start" }),
      );
      return;
    }
    const next =
      mode === "sensors"
        ? "perception"
        : mode === "exploded"
          ? "exploded"
          : "whole";
    if (controller.current) controller.current.setMode(next);
    else pendingMode.current = mode;
  }, []);
  const exportReading = useCallback(
    async (kind: "print" | "html") => {
      const doc = frame.current?.contentDocument;
      if (!doc || !facts || exportBusy.current) return;
      exportBusy.current = true;
      setError("");
      const status = doc.querySelector<HTMLElement>(
        "[data-business-export-status]",
      );
      const controls = [
        ...doc.querySelectorAll<HTMLButtonElement>(
          "[data-report-export],[data-business-export]",
        ),
      ];
      const disabled = controls.map((control) => control.disabled);
      controls.forEach((control) => {
        control.disabled = true;
        control.setAttribute("aria-busy", "true");
      });
      const topStatus = doc.querySelector<HTMLElement>(".report-action-status");
      try {
        if (kind === "print") {
          if (topStatus) topStatus.textContent = "正在打开打印…";
          frame.current?.contentWindow?.print();
        } else {
          if (status) status.textContent = "正在准备方案…";
          const content = snapshotOfficialReading(doc);
          const embedded = await embedDesignReportHtml(content, {
            baseUrl: window.location.origin,
          });
          saveBlob(
            embedded.html,
            "text/html;charset=utf-8",
            `${facts.projectName}-完整方案.html`,
          );
        }
        if (status) status.textContent = kind === "print" ? "" : "已下载";
        if (topStatus) topStatus.textContent = kind === "print" ? "" : "已下载";
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "暂时无法下载方案，请重试。",
        );
      } finally {
        exportBusy.current = false;
        controls.forEach((control, index) => {
          control.disabled = disabled[index];
          control.removeAttribute("aria-busy");
        });
      }
    },
    [facts],
  );
  const handleFrame = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    controller.current = null;
    const doc = frame.current?.contentDocument;
    if (!doc || !facts) return;
    try {
      const reader = mountOfficialReport(doc, facts, {
        onClose: () => close.current?.(),
        onMode: changeMode,
        onExport: (kind) => void exportReading(kind),
      });
      setModelHost(reader.modelHost);
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close.current?.();
        }
        if (event.key === "Tab") {
          const controls = [
            ...doc.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),a[href],summary,[tabindex="0"]',
            ),
          ].filter((n) => n.getClientRects().length);
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && doc.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && doc.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      };
      doc.addEventListener("keydown", onKey);
      const expandedForPrint: HTMLDetailsElement[] = [];
      const beforePrint = () => {
        doc
          .querySelectorAll<HTMLDetailsElement>("details:not([open])")
          .forEach((detail) => {
            expandedForPrint.push(detail);
            detail.open = true;
          });
      };
      const afterPrint = () => {
        expandedForPrint.splice(0).forEach((detail) => {
          detail.open = false;
        });
      };
      const frameWindow = frame.current?.contentWindow;
      frameWindow?.addEventListener("beforeprint", beforePrint);
      frameWindow?.addEventListener("afterprint", afterPrint);
      doc
        .querySelector<HTMLButtonElement>(".report-close")
        ?.focus({ preventScroll: true });
      cleanup.current = () => {
        doc.removeEventListener("keydown", onKey);
        frameWindow?.removeEventListener("beforeprint", beforePrint);
        frameWindow?.removeEventListener("afterprint", afterPrint);
        reader.dispose();
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "方案暂时无法打开。");
    }
  }, [facts, changeMode, exportReading]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setMounted(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cleanup.current?.();
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="design-report-backdrop official-report-backdrop">
      <div
        className="design-report-dialog official-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="完整设计方案"
      >
        {error && (
          <div className="design-report-feedback error" role="alert">
            {error}
            <button onClick={() => close.current?.()}>关闭方案</button>
          </div>
        )}
        {valid && facts ? (
          <iframe
            title={`${facts.projectName}完整设计方案正文`}
            ref={frame}
            srcDoc={srcDoc}
            sandbox="allow-same-origin allow-modals"
            onLoad={handleFrame}
          />
        ) : (
          <div className="design-report-empty">
            <h3>方案文件暂不可用</h3>
            <button onClick={() => close.current?.()}>返回方案交付</button>
          </div>
        )}
        {valid &&
          saved &&
          modelHost &&
          createPortal(
            <ReportInteractiveWorkspace
              mode={project.source === "preview" ? "preview" : "live"}
              project={project}
              artifact={saved}
              onControllerReady={(next) => {
                controller.current = next;
                if (next && pendingMode.current) {
                  const mode = pendingMode.current;
                  pendingMode.current = null;
                  changeMode(mode);
                }
              }}
            />,
            modelHost,
          )}
      </div>
    </div>,
    document.body,
  );
}
