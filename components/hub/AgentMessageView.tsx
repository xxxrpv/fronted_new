'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolCall } from '../../lib/hub/types';

interface AgentMessageViewProps {
  message: Message;
}

/**
 * 单个可折叠区块（用于详细参数、产物路径或日志章节）
 */
export function CollapsibleBlock({
  title,
  icon = '📋',
  badge,
  defaultExpanded = false,
  children,
}: {
  title: string;
  icon?: string;
  badge?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      style={{
        margin: '6px 0',
        borderRadius: 8,
        border: '1px solid #e2e8f0',
        background: '#f8fafc',
        overflow: 'hidden',
        fontSize: 12,
        transition: 'all 0.15s ease',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: expanded ? '#f1f5f9' : '#f8fafc',
          border: 'none',
          cursor: 'pointer',
          color: '#334155',
          fontSize: 12,
          fontWeight: 500,
          textAlign: 'left',
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              color: '#64748b',
              fontSize: 10,
              display: 'inline-block',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          >
            ▶
          </span>
          <span>
            {icon} {title}
          </span>
          {badge && (
            <span style={{ fontSize: 10.5, color: '#64748b', background: '#e2e8f0', padding: '1px 5px', borderRadius: 4 }}>
              {badge}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 500 }}>
          {expanded ? '收起 ▴' : '展开查看 ▾'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 长代码块 / 日志 / 参数配置折叠卡片
 */
export function CollapsibleCodeBlock({ children }: { children?: React.ReactNode }) {
  const rawText = String(
    Array.isArray(children)
      ? children.map((c) => (typeof c === 'object' && c && 'props' in c ? c.props.children : c)).join('')
      : children || ''
  ).trim();

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = rawText.split('\n');
  const isLong = lines.length > 3 || rawText.length > 140;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  // 短代码块直接显示
  if (!isLong) {
    return (
      <pre
        style={{
          background: '#0f172a',
          color: '#f8fafc',
          padding: '6px 10px',
          borderRadius: 6,
          overflowX: 'auto',
          fontSize: 11.5,
          margin: '4px 0',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        {children}
      </pre>
    );
  }

  return (
    <div
      style={{
        margin: '6px 0',
        borderRadius: 8,
        border: '1px solid #334155',
        background: '#0f172a',
        overflow: 'hidden',
        fontSize: 11.5,
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 10px',
          background: '#1e293b',
          borderBottom: expanded ? '1px solid #334155' : 'none',
          cursor: 'pointer',
          color: '#cbd5e1',
          fontSize: 11,
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 9,
              color: '#94a3b8',
              display: 'inline-block',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          >
            ▶
          </span>
          <span>📋 工具执行日志 / 详细参数</span>
          <span style={{ fontSize: 10, color: '#94a3b8', background: '#334155', padding: '1px 5px', borderRadius: 4 }}>
            {lines.length} 行
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              border: 'none',
              background: copied ? '#059669' : '#334155',
              color: '#ffffff',
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ 已复制' : '复制'}
          </button>
          <span style={{ color: '#38bdf8' }}>{expanded ? '收起 ▴' : '展开查看 ▾'}</span>
        </div>
      </div>

      {expanded ? (
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            color: '#f8fafc',
            overflowX: 'auto',
            fontSize: 11.5,
            lineHeight: 1.5,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {children}
        </pre>
      ) : (
        <div
          onClick={() => setExpanded(true)}
          style={{
            padding: '5px 10px',
            color: '#94a3b8',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'ui-monospace, monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            background: '#0f172a',
          }}
          title="点击展开完整日志与参数"
        >
          {lines[0] || '点击展开查看完整日志与参数…'}
        </div>
      )}
    </div>
  );
}

/**
 * 行内长路径/详细参数折叠胶囊
 */
export function CollapsibleInlinePath({ children, ...props }: any) {
  const text = String(children || '').trim();
  const isPath =
    (text.includes('/') || text.includes('\\')) &&
    (text.length > 30 || /\.(urdf|glb|json|stl|step|dae|yaml|yml|log|py|sh)/i.test(text));

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isPath) {
    return (
      <code
        style={{
          background: '#e2e8f0',
          padding: '1px 5px',
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const displayShort = text.length > 36 ? `${text.slice(0, 15)}…${text.slice(-16)}` : text;

  return (
    <span
      onClick={() => setExpanded(!expanded)}
      title={`文件产物路径 (点击${expanded ? '收起' : '展开'}，或复制)\n${text}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: '#e2e8f0',
        border: '1px solid #cbd5e1',
        padding: '1px 6px',
        borderRadius: 5,
        fontSize: 11.5,
        fontFamily: 'ui-monospace, monospace',
        color: '#1e293b',
        cursor: 'pointer',
        verticalAlign: 'middle',
        margin: '1px 2px',
        maxWidth: expanded ? '100%' : 260,
        wordBreak: expanded ? 'break-all' : 'normal',
      }}
    >
      <span style={{ fontSize: 11 }}>📁</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>
        {expanded ? text : displayShort}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        title="复制路径"
        style={{
          border: 'none',
          background: copied ? '#10b981' : '#94a3b8',
          color: '#ffffff',
          borderRadius: 3,
          fontSize: 9,
          padding: '0 4px',
          cursor: 'pointer',
          lineHeight: '14px',
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}

/**
 * 结构化工具调用折叠卡片
 */
export function ToolCallsCard({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <CollapsibleBlock
      title={`工具执行记录 (${toolCalls.length} 项)`}
      icon="🛠️"
      badge="系统调用"
      defaultExpanded={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {toolCalls.map((tc, idx) => (
          <div key={tc.id || idx} style={{ borderBottom: idx < toolCalls.length - 1 ? '1px dashed #e2e8f0' : 'none', paddingBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#334155' }}>
              <span style={{ color: '#0284c7' }}>⚙️ {tc.function.name}</span>
            </div>
            {tc.function.arguments && (
              <pre
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  margin: '4px 0 0 0',
                  color: '#475569',
                  overflowX: 'auto',
                }}
              >
                {tc.function.arguments}
              </pre>
            )}
          </div>
        ))}
      </div>
    </CollapsibleBlock>
  );
}

/**
 * 将 Agent 长回复切分为普通对话和密集技术抽屉
 */
export function AgentMessageView({ message }: AgentMessageViewProps) {
  const content = message.content || '';

  // 智能段落切分：
  // 如果内容中包含以 ### 或 #### 开头的 “产物路径”、“详细参数”、“执行日志”、“参数调整” 等章节
  const sections = useMemo(() => {
    if (!content) return [];
    const lines = content.split('\n');
    const result: Array<{ type: 'normal' | 'collapsible'; title?: string; text: string }> = [];
    let currentType: 'normal' | 'collapsible' = 'normal';
    let currentTitle = '';
    let currentLines: string[] = [];

    const isTechnicalHeader = (line: string) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^#{1,4}\s*(.*)$/);
      if (!match) return false;
      const title = match[1];
      return /(产物路径|详细参数|参数调整|构建日志|执行日志|调用日志|动力学参数|Artifacts|Parameters|Logs|Tool\s*Calls?)/i.test(title);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isTechnicalHeader(line)) {
        if (currentLines.length > 0) {
          result.push({
            type: currentType,
            title: currentTitle,
            text: currentLines.join('\n').trim(),
          });
          currentLines = [];
        }
        currentType = 'collapsible';
        const match = line.trim().match(/^#{1,4}\s*(.*)$/);
        currentTitle = match ? match[1] : '详细参数与产物日志';
      } else if (
        currentType === 'collapsible' &&
        line.trim().match(/^#{1,4}\s*(.*)$/) &&
        !isTechnicalHeader(line)
      ) {
        // 遇到了普通标题（如：下一步操作建议），切回 normal
        if (currentLines.length > 0) {
          result.push({
            type: currentType,
            title: currentTitle,
            text: currentLines.join('\n').trim(),
          });
          currentLines = [];
        }
        currentType = 'normal';
        currentTitle = '';
        currentLines.push(line);
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      result.push({
        type: currentType,
        title: currentTitle,
        text: currentLines.join('\n').trim(),
      });
    }

    return result;
  }, [content]);

  const markdownComponents = {
    p: ({ children }: any) => <p style={{ margin: '0 0 6px 0', lineHeight: 1.6 }}>{children}</p>,
    ul: ({ children }: any) => <ul style={{ paddingLeft: 18, margin: '4px 0 6px 0', listStyleType: 'disc' }}>{children}</ul>,
    ol: ({ children }: any) => <ol style={{ paddingLeft: 18, margin: '4px 0 6px 0', listStyleType: 'decimal' }}>{children}</ol>,
    li: ({ children }: any) => <li style={{ marginBottom: 3, lineHeight: 1.55 }}>{children}</li>,
    strong: ({ children }: any) => <strong style={{ fontWeight: 600, color: '#0f172a' }}>{children}</strong>,
    code: CollapsibleInlinePath,
    pre: ({ children }: any) => <CollapsibleCodeBlock>{children}</CollapsibleCodeBlock>,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* 结构化工具调用记录 (若有) */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallsCard toolCalls={message.toolCalls} />
      )}

      {/* 正文内容分层呈现 */}
      {sections.map((sec, idx) => {
        if (!sec.text) return null;
        if (sec.type === 'collapsible') {
          return (
            <CollapsibleBlock
              key={idx}
              title={sec.title || '详细参数与产物路径'}
              icon="📦"
              defaultExpanded={false}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {sec.text}
              </ReactMarkdown>
            </CollapsibleBlock>
          );
        }

        return (
          <div key={idx} style={{ margin: '2px 0' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {sec.text}
            </ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
}
