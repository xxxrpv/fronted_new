// Adapted from Embodex headless-chat/chat-header.tsx; source bytes/provenance in Task-015 original-chat-implement/source.
"use client";

import React, { useState } from "react";
import { useHeadlessChat } from "./index";

export function ChatHeader() {
  const { setIsOpen, isMinimized, setIsMinimized, clearHistory } = useHeadlessChat();
  const [isClearing, setIsClearing] = useState(false);

  const handleClearHistory = async () => {
    if (isClearing) return;
    setIsClearing(true);

    try {
      await clearHistory();
    } catch (error) {
      console.error("Failed to clear chat history:", error);
    } finally {
      setIsClearing(false);
    }
  };

  // Minimized sidebar view - just show expand button
  if (isMinimized) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 h-full">
        {/* Expand button */}
        <button
          type="button"
          data-variant="ghost"
          data-size="icon"
          onClick={() => setIsMinimized(false)}
          className="h-9 w-9 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          aria-label="Expand chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Status indicator */}
        <div className="w-2 h-2 rounded-full bg-emerald-500" />

        {/* Vertical title */}
        <div
          className="text-xs font-medium text-neutral-500 dark:text-neutral-400"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          Simplaix Agent
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shrink-0 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
          Simplaix Agent
        </h3>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          data-variant="ghost"
          data-size="sm"
          onClick={handleClearHistory}
          disabled={isClearing}
          className="h-8 px-2 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          aria-label="Clear chat history"
        >
          {isClearing ? "正在开启..." : "新会话"}
        </button>

        {/* Minimize button (collapse to thin sidebar) */}
        <button
          type="button"
          data-variant="ghost"
          data-size="icon"
          onClick={() => setIsMinimized(true)}
          className="h-8 w-7 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          aria-label="Minimize chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Close button */}
        <button
          type="button"
          data-variant="ghost"
          data-size="icon"
          onClick={() => setIsOpen(false)}
          className="h-7 w-7 text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          aria-label="Close chat"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
