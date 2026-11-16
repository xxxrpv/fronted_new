"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { readableDesignText } from "../../lib/v8/presentation";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact, Mode, Project } from "../../lib/v8/types";
import { getRepository } from "../../lib/v8/repository";
import { canDownload } from "../../lib/v8/state";
import type { ModelViewerController } from "./ModelViewer";
import "./artifact-preview.css";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });
interface ArtifactProps {
  mode: Mode;
  project: Project;
  artifact: Artifact;
}
type ReadResult = {
  key: string;
  url?: string;
  content?: string;
  error?: string;
};
const MARKDOWN_LIMIT = 2 * 1024 * 1024;

function sameOriginUrl(value: string): string {
  const url = new URL(value, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("文件地址未通过同源读取检查。");
  return url.href;
}

/** Read permission and bytes come from the repository, never from a guessed asset key. */
function useArtifactRead(
  { mode, project, artifact }: ArtifactProps,
  kind: "model" | "markdown",
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ReadResult>();
  const saved = project.artifacts.find((item) => item.id === artifact.id);
  const valid = Boolean(
    artifact.projectId === project.id &&
      saved &&
      canDownload(project, saved) &&
      (kind === "model"
        ? saved.kind === "model" && saved.mimeType === "model/gltf-binary"
        : saved.kind === "design_document" &&
          /^text\/markdown(?:;|$)/i.test(saved.mimeType)),
  );
  const key = JSON.stringify([
    mode,
    project.id,
    project.ownerId,
    artifact.projectId,
    saved,
    attempt,
  ]);

  useEffect(() => {
    if (!valid || !saved) return;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        // download re-reads the authoritative artifact and source relationship.
        const returned = await getRepository(mode).download(saved);
        if (!active) return;
        if (kind === "model") {
          if (returned.mimeType !== "model/gltf-binary" || !returned.url)
            throw new Error("此文件没有可在线读取的 GLB 地址。");
          setResult({ key, url: sameOriginUrl(returned.url) });
          return;
        }
        if (!/^text\/markdown(?:;|$)/i.test(returned.mimeType))
          throw new Error("此文件不是 Markdown 文档。");
        let content = returned.content;
        if (content === undefined) {
          if (!returned.url) throw new Error("文档内容暂不可用。");
          const response = await fetch(sameOriginUrl(returned.url), {
            credentials: "same-origin",
            signal: controller.signal,
            redirect: "error",
          });
          if (!response.ok)
            throw new Error(
              response.status === 401
                ? "会话已失效，请重新登录。"
                : response.status === 403
                  ? "没有此文件的读取权限。"
                  : `文档读取失败（${response.status}）。`,
            );
          if (Number(response.headers.get("content-length")) > MARKDOWN_LIMIT)
            throw new Error("文档超过 2 MB 在线预览限制。");
          content = await response.text();
        }
        if (new TextEncoder().encode(content).byteLength > MARKDOWN_LIMIT)
          throw new Error("文档超过 2 MB 在线预览限制。");
        if (active) setResult({ key, content });
      } catch (error) {
        if (active)
          setResult({
            key,
            error: error instanceof Error ? error.message : "文件读取失败。",
          });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [mode, valid, kind, key]);

  return {
    saved,
    result: valid && result?.key === key ? result : undefined,
    error: valid
      ? undefined
      : artifact.projectId === project.id &&
          saved?.projectId === project.id &&
          saved.authorized &&
          saved.error
        ? saved.error
        : "文件尚未就绪、来源不一致或没有读取权限。",
    retry: () => setAttempt((value) => value + 1),
  };
}

function ReadFeedback({
  error,
  retry,
}: {
  error?: string;
  retry?: () => void;
}) {
  return (
    <div
      className="artifact-preview-feedback"
      role={error ? "alert" : "status"}
    >
      <p>{error || "正在读取文件…"}</p>
      {error && retry && <button onClick={retry}>重新读取文件</button>}
    </div>
  );
}

/** Inline engineering viewer: only an authorized, source-checked, ready GLB is loaded. */
export function ArtifactModel({
  onControllerReady,
  ...props
}: ArtifactProps & {
  onControllerReady?: (controller: ModelViewerController | null) => void;
}) {
  const { saved, result, error, retry } = useArtifactRead(props, "model");
  return (
    <div className="artifact-inline-model">
      {result?.url ? (
        <ModelViewer
          key={`${props.mode}:${props.project.id}:${saved!.id}:${result.url}`}
          url={result.url}
          expectedSha256={saved!.sha256}
          label={saved!.fileName}
          onControllerReady={onControllerReady}
        />
      ) : (
        <ReadFeedback
          error={error || result?.error}
          retry={error ? undefined : retry}
        />
      )}
    </div>
  );
}

function MarkdownFile(props: ArtifactProps) {
  const { result, error, retry } = useArtifactRead(props, "markdown");
  if (result?.content === undefined)
    return (
      <ReadFeedback
        error={error || result?.error}
        retry={error ? undefined : retry}
      />
    );
  return (
    <article className="artifact-markdown" aria-label="Markdown 方案正文">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          // A document cannot trigger remote image requests merely by opening.
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {readableDesignText(props.project, result.content)}
      </ReactMarkdown>
    </article>
  );
}

export default function ArtifactPreview({
  mode,
  project,
  artifact,
  onClose,
}: ArtifactProps & { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  const saved = project.artifacts.find((item) => item.id === artifact.id);
  const owned = artifact.projectId === project.id && saved;
  const isModel = owned && saved.kind === "model";
  const isMarkdown = owned && /^text\/markdown(?:;|$)/i.test(saved.mimeType);

  useEffect(() => {
    setMounted(true);
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!mounted) return;
    close.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAction.current();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter(
        (element) =>
          element.getClientRects().length > 0 && element.tabIndex >= 0,
      );
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div className="artifact-preview-backdrop">
      <div
        className="artifact-preview-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="在线查看文件"
        tabIndex={-1}
      >
        <header className="artifact-preview-toolbar">
          <div>
            <h2>{owned ? saved.fileName : "文件预览"}</h2>
            <p>{isModel ? "GLB 三维模型" : "Markdown 设计方案"}</p>
          </div>
          <button ref={close} onClick={onClose} aria-label="关闭文件预览">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </header>
        <div
          className={`artifact-preview-body ${isModel ? "model" : "document"}`}
        >
          {isModel ? (
            <ArtifactModel mode={mode} project={project} artifact={artifact} />
          ) : isMarkdown ? (
            <MarkdownFile mode={mode} project={project} artifact={artifact} />
          ) : (
            <p className="artifact-preview-feedback" role="alert">
              此文件不支持在这里预览。
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
