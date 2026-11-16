// Adapted from Embodex headless-chat/chat-input.tsx; source bytes/provenance in Task-015 original-chat-implement/source.
"use client";

import React, { useState, useRef, type KeyboardEvent, type ChangeEvent } from "react";
import { useHeadlessChat } from "./index";

export function ChatInput() {
  const {
    sendMessage,
    isLoading,
    stopGeneration,
    uploadedImages,
    setUploadedImages,
    isDockVisible,
    canSend,
    navigate,
    setIsDockVisible,
  } = useHeadlessChat();
  const [inputValue, setInputValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue && uploadedImages.length === 0) return;
    if (isLoading || !canSend) return;

    // TODO: Handle image uploads when CopilotKit supports it in headless mode
    // For now, we just send text messages

    const submitted=inputValue;
    sendMessage({id:crypto.randomUUID(),role:"user",content:trimmedValue},()=>{
      setInputValue(value=>value===submitted?"":value);
      setUploadedImages([]);
      if(textareaRef.current)textareaRef.current.style.height="auto";
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setUploadedImages([...uploadedImages, ...Array.from(files)]);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(uploadedImages.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-600 p-3 bg-white dark:bg-neutral-800 shrink-0">
      {isDockVisible && <div className="chat-app-menu" aria-label="Project views">{(['parts','ue'] as const).map(view=><button key={view} type="button" onClick={()=>{navigate(view);setIsDockVisible(false);}}>{view==='parts'?'零件清单':'UE 交互'}</button>)}</div>}
      <div className="flex items-end gap-2">
        {/* Dock toggle button */}
            <button
              type="button"
              data-variant="ghost"
              data-size="icon"
              onClick={() => setIsDockVisible(!isDockVisible)}
              className={`h-9 w-9 shrink-0 ${
                isDockVisible
                  ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-50"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
              }`}
              aria-label="Toggle app dock" title={isDockVisible ? "Hide Apps" : "Show Apps"}
            >
              <span className="w-4 h-4" aria-hidden="true" style={{fontSize:22,lineHeight:1}}>∞</span>
            </button>


        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 min-h-[36px] max-h-[120px] resize-none bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-sm px-3 py-2 text-sm text-neutral-900 dark:text-neutral-50 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          rows={1}
          disabled={isLoading || !canSend}
        />

        {/* Send / Stop button */}
        {isLoading ? (
          <button
            type="button"
            data-variant="outline"
            data-size="icon"
            onClick={stopGeneration}
            className="h-9 w-9 shrink-0 border-neutral-200 dark:border-neutral-600"
            aria-label="Stop generation"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend || [...inputValue.trim()].length>16000 || (!inputValue.trim() && uploadedImages.length === 0)}
            className="h-9 w-9 shrink-0 bg-neutral-800 text-neutral-50 hover:bg-neutral-900 active:bg-neutral-950 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

