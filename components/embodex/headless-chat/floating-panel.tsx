// Adapted from Embodex headless-chat/floating-panel.tsx; source bytes/provenance in Task-015 original-chat-implement/source.
"use client";

import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { useHeadlessChat } from "./index";

interface FloatingChatPanelProps {
  children: ReactNode;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 360;
const MAX_WIDTH = 760;
const STORAGE_KEY = "simplaix-chat-panel-width";

export function FloatingChatPanel({ children }: FloatingChatPanelProps) {
  const { isMinimized } = useHeadlessChat();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDraggingRef = useRef(false);
  const priorBodyStyle=useRef({cursor:"",userSelect:""});

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(savedWidth)) {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, savedWidth)));
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const nextWidth = window.innerWidth - event.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      document.body.style.cursor = priorBodyStyle.current.cursor;
      document.body.style.userSelect = priorBodyStyle.current.userSelect;
      window.localStorage.setItem(STORAGE_KEY, String(width));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if(isDraggingRef.current){document.body.style.cursor=priorBodyStyle.current.cursor;document.body.style.userSelect=priorBodyStyle.current.userSelect;isDraggingRef.current=false;}
    };
  }, [width]);

  const startResize = () => {
    if (isMinimized) return;

    priorBodyStyle.current={cursor:document.body.style.cursor,userSelect:document.body.style.userSelect};
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      className={`
        relative flex flex-col shrink-0
        bg-neutral-50 dark:bg-neutral-800
        border-l border-neutral-200 dark:border-neutral-700
        h-full overflow-hidden
      `}
      style={{
        width: isMinimized ? "56px" : `${width}px`,
      }}
    >
      {!isMinimized && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          title="Drag to resize chat panel"
          onMouseDown={startResize}
          className="group absolute left-0 top-0 z-20 flex h-full w-4 -translate-x-2 cursor-col-resize touch-none items-center justify-center"
        >
          <span className="h-16 w-1 rounded-full bg-neutral-400/40 opacity-60 transition group-hover:bg-sky-400 group-hover:opacity-100" />
        </div>
      )}
      {children}
    </div>
  );
}
