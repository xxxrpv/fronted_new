// Adapted from Embodex headless-chat/message-list.tsx; source bytes/provenance in Task-015 original-chat-implement/source.
"use client";

import React, { useEffect, useRef, useMemo } from "react";
import { useHeadlessChat } from "./index";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageListProps { welcomeMessage:string }
export function MarkdownContent({content}:{content:string}) {
  return <div className="headless-chat-markdown prose prose-sm dark:prose-invert max-w-none min-w-0 break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({children})=><span>{children}</span>,img:({alt})=><span>{alt||''}</span>}}>{content}</ReactMarkdown>
  </div>;
}

export function MessageList({ welcomeMessage }: MessageListProps) {
  const { messages, isLoading } = useHeadlessChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const viewport=scrollRef.current;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 px-4 py-2 chat-message-scroll" role="log" aria-label="Agent messages">
      <div className="min-w-0 space-y-4">
        {/* Welcome message when no messages */}
        {messages.length === 0 && (
          <div className="flex min-w-0 justify-start">
            <div className="min-w-0 w-full px-4 py-3 rounded-sm bg-white dark:bg-neutral-700 shadow-sm">
              <div className="text-sm text-neutral-900 dark:text-neutral-50">
                <MarkdownContent content={welcomeMessage} />
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((message, index) => {
          const isLastMessage = index === messages.length - 1;
          const isAssistantLoading = isLoading && isLastMessage && message.role === "assistant";
          const hasContent = message.content && message.content.trim().length > 0;
          const hasGenerativeUI = typeof message.generativeUI === "function";

          // User message
          if (message.role === "user") {
            return (
              <div key={message.id} className="flex min-w-0 justify-end">
                <div className="min-w-0 max-w-[92%] px-4 py-3 rounded-sm bg-neutral-800 dark:bg-neutral-600 text-neutral-50 shadow-sm">
                  <div className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                    {message.content}
                  </div>
                </div>
              </div>
            );
          }

          // Assistant message - only render if has content, generativeUI, or is loading
          if (message.role === "assistant" && (hasContent || hasGenerativeUI || isAssistantLoading)) {
            // If only generativeUI (no text content), render without message box styling
            const isUIOnly = hasGenerativeUI && !hasContent && !isAssistantLoading;
            
            if (isUIOnly) {
              return (
                <div key={message.id} className="flex min-w-0 justify-start">
                  <div className="min-w-0 w-full">
                    {message.generativeUI?.()}
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="flex min-w-0 justify-start">
                <div className="min-w-0 w-full px-4 py-3 rounded-sm bg-white dark:bg-neutral-700 shadow-sm">
                  <div className="min-w-0 text-sm text-neutral-900 dark:text-neutral-50">
                    {/* Show content if available */}
                    {hasContent && message.content && <MarkdownContent content={message.content} />}
                    
                    {/* Render generativeUI for HITL components */}
                    {hasGenerativeUI && (
                      <div className={`${hasContent ? "mt-3" : ""} min-w-0 overflow-hidden`}>{message.generativeUI?.()}</div>
                    )}
                    
                    {/* Show thinking indicator only when loading with no content yet */}
                    {isAssistantLoading && !hasContent && !hasGenerativeUI && (
                      <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span>Thinking...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // Skip other message types (system, etc.)
          return null;
        })}

        {/* Loading indicator when no assistant message yet */}
        {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role !== "assistant") && (
          <div className="flex min-w-0 justify-start">
            <div className="min-w-0 w-full px-4 py-3 rounded-sm bg-white dark:bg-neutral-700 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div />
      </div>
    </div>
  );
}
