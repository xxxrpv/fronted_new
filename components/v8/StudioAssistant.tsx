"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ModelViewerController,
  ViewerCommandReceipt,
} from "./ModelViewer";
import {
  executeViewerCommand,
  planViewerCommand,
} from "../../lib/v8/assistant-commands";
import "./assistant.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  status?: "done" | "unsupported";
  asset?: string;
}
interface Props {
  hideTrigger?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  projectId?: string;
  controller: ModelViewerController | null;
  modelName?: string;
  mode: "preview" | "live";
  onAdjustment?: (receipt: ViewerCommandReceipt) => void;
  onRefine?: (text: string) => void;
  onOpenReport?: () => void;
  onPageCommand?: (
    text: string,
  ) => ViewerCommandReceipt | null | Promise<ViewerCommandReceipt | null>;
  pageSuggestions?: string[];
  contextLabel?: string;
}
export default function StudioAssistant({
  hideTrigger = false,
  isOpen,
  onOpenChange,
  projectId,
  controller,
  modelName,
  mode,
  onAdjustment,
  onRefine,
  onOpenReport,
  onPageCommand,
  pageSuggestions,
  contextLabel,
}: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = isOpen ?? localOpen;
  const setOpen = (value: boolean) => {
    setLocalOpen(value);
    onOpenChange?.(value);
  };
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messageScope, setMessageScope] = useState("");
  const scope = `embodex-v8-chat:${mode}:${projectId || "workspace"}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const inFlight = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", escape);
    };
    // setOpen delegates controlled and local state; only the dialog lifetime matters.
  }, [open]);
  useEffect(() => {
    setLoaded(false);
    setMessages([]);
    setDraft("");
    if (mode !== "preview") {
      setMessageScope(scope);
      setLoaded(true);
      return;
    }
    try {
      const value = JSON.parse(
        localStorage.getItem(scope) || "[]",
      ) as Message[];
      if (Array.isArray(value))
        setMessages(
          value
            .filter(
              (v) =>
                v &&
                typeof v.text === "string" &&
                ["user", "assistant"].includes(v.role),
            )
            .slice(-80),
        );
    } catch {
      setStorageError(true);
    }
    setMessageScope(scope);
    setLoaded(true);
  }, [scope, mode]);
  useEffect(() => {
    if (!loaded || messageScope !== scope || mode !== "preview") return;
    try {
      localStorage.setItem(scope, JSON.stringify(messages.slice(-80)));
    } catch {
      setStorageError(true);
    }
  }, [scope, messages, loaded, mode, messageScope]);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages, pending, open]);
  async function send(value = draft) {
    const text = value.trim();
    if (!text || inFlight.current || mode !== "preview") return;
    const requestScope = scope;
    inFlight.current = true;
    setPending(true);
    setDraft("");
    const stamp = new Date().toISOString();
    const id = crypto.randomUUID();
    setMessages((old) => [
      ...old,
      { id, role: "user", text, at: stamp, asset: modelName },
    ]);
    try {
      const pageResult = await onPageCommand?.(text);
      const plan = planViewerCommand(text);
      let response: ViewerCommandReceipt;
      if (pageResult) response = pageResult;
      else if (plan.kind === "discussion")
        response = {
          ok: false,
          message:
            "当前预览支持页面导航、项目筛选和模型操作。试试下方的快捷指令。",
        };
      else if (!controller)
        response = {
          ok: false,
          message: "请先打开一个模型，再进行查看或调整。",
        };
      else response = executeViewerCommand(controller, plan.command);
      if (activeScope.current !== requestScope) return;
      setMessages((old) => [
        ...old,
        {
          id: `reply-${id}`,
          role: "assistant",
          text: response.message,
          at: new Date().toISOString(),
          status: response.ok ? "done" : "unsupported",
          asset: modelName,
        },
      ]);
      if (response.ok && response.after) onAdjustment?.(response);
    } catch {
      if (activeScope.current === requestScope)
        setMessages((old) => [
          ...old,
          {
            id: `reply-${id}`,
            role: "assistant",
            text: "操作没有完成，模型与已保存版本保持原状态。请检查当前模型后重试。",
            at: new Date().toISOString(),
            status: "unsupported",
          },
        ]);
    } finally {
      inFlight.current = false;
      setPending(false);
      inputRef.current?.focus();
    }
  }
  const latestUser = [...messages].reverse().find((m) => m.role === "user");
  const suggestions = controller
    ? ["拆解到 70%", "还原整机", "查看感知结构", "列出部件"]
    : pageSuggestions || ["打开模板库", "返回工作空间"];
  return (
    <div className={`vassistant ${open ? "open" : ""}`}>
      {open && (
        <section
          className="vassistant-window"
          role="dialog"
          aria-label="常驻设计助手"
        >
          <header>
            <span className="vassistant-orb">✦</span>
            <div>
              <strong>AI 助手</strong>
              {mode === "live" && <small>Agent 尚未接入</small>}
            </div>
            <button aria-label="收起设计助手" onClick={() => setOpen(false)}>
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
          <div className="vassistant-context">
            <i className={controller ? "ready" : ""} />
            {modelName || contextLabel || "当前工作空间"}
          </div>
          <div
            className="vassistant-messages"
            ref={scrollRef}
            role="log"
            aria-live="polite"
          >
            {!messages.length && (
              <div className="vassistant-welcome">
                <b>想从哪里开始？</b>
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`vassistant-message ${message.role}`}
              >
                <div>
                  <strong>{message.role === "user" ? "你" : "AI"}</strong>
                  {message.status && (
                    <span>
                      {message.status === "done" ? "已执行" : "未执行"}
                    </span>
                  )}
                </div>
                <p>{message.text}</p>
              </article>
            ))}
            {pending && (
              <p className="vassistant-pending">正在核对并执行当前操作…</p>
            )}
          </div>
          {storageError && (
            <p className="vassistant-storage" role="status">
              浏览器未能持久化对话，当前对话仍可继续。
            </p>
          )}
          <div className="vassistant-suggestions">
            {suggestions.map((s) => (
              <button
                key={s}
                disabled={pending || mode === "live"}
                onClick={() => void send(s)}
              >
                {s}
              </button>
            ))}
          </div>
          {onRefine && latestUser && (
            <button
              className="vassistant-refine"
              onClick={() => {
                onRefine(latestUser.text);
                setOpen(false);
              }}
            >
              把这条要求带入概念修订 <span>→</span>
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="assistant-message">
              与设计助手交流
            </label>
            <textarea
              id="assistant-message"
              ref={inputRef}
              rows={2}
              value={draft}
              maxLength={8000}
              placeholder={
                mode === "preview"
                  ? controller
                    ? "查看、拆解或调整模型…"
                    : "打开页面、筛选项目…"
                  : "真实 Agent 请从平台原有工作台进入"
              }
              onChange={(e) => setDraft(e.target.value)}
              disabled={mode === "live"}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="submit"
              aria-label="发送设计助手消息"
              disabled={!draft.trim() || pending || mode === "live"}
            >
              ↑
            </button>
          </form>
          {controller && <footer>参数调整需保存</footer>}
        </section>
      )}
      {!hideTrigger && (
        <div className="vassistant-dock">
          {onOpenReport && (
            <button className="vassistant-report" onClick={onOpenReport}>
              查看完整方案 ↗
            </button>
          )}
          <button
            className="vassistant-toggle"
            aria-label="打开 AI 助手"
            title="AI 助手"
            onClick={() => {
              setOpen(!open);
              if (!open) requestAnimationFrame(() => inputRef.current?.focus());
            }}
            aria-expanded={open}
          >
            <svg
              viewBox="0 0 28 28"
              width="27"
              height="27"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden="true"
            >
              <path d="M14 4c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10Z" />
              <path d="M23 3v6M20 6h6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
