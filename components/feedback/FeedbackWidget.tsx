'use client';

import React, { useState, useEffect, useRef } from 'react';
import { submitFeedback, FeedbackTopic, FeedbackRating } from '../../lib/api/feedback';

export interface FeedbackWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  sourceUrl?: string;
}

const TOPIC_OPTIONS: FeedbackTopic[] = [
  '使用体验',
  '问题反馈/Bug',
  '功能建议',
  '其他',
];

const RATING_OPTIONS: Array<{ rating: FeedbackRating; emoji: string; label: string }> = [
  { rating: 1, emoji: '😭', label: '不满意' },
  { rating: 2, emoji: '☹️', label: '一般' },
  { rating: 3, emoji: '🙂', label: '满意' },
  { rating: 4, emoji: '🤩', label: '非常满意' },
];

export default function FeedbackWidget({
  isOpen,
  onClose,
  sourceUrl,
}: FeedbackWidgetProps) {
  const [topic, setTopic] = useState<FeedbackTopic>('使用体验');
  const [selectedRating, setSelectedRating] = useState<FeedbackRating | null>(null);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 打开时重置状态并聚焦
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setIsSuccess(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    } else {
      setTopic('使用体验');
      setSelectedRating(null);
      setMessage('');
      setErrorMsg(null);
      setIsSuccess(false);
    }
  }, [isOpen]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // 点击外部遮罩关闭
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (!isSubmitting) {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRating === null || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const result = await submitFeedback({
      topic,
      rating: selectedRating,
      message: message.trim() || undefined,
      sourceUrl,
    });

    setIsSubmitting(false);

    if (result.success) {
      setIsSuccess(true);
      // 发送成功后保持停留，由用户自主关闭
    } else {
      setErrorMsg(result.error?.message || '发送失败，请稍后重试');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="意见反馈窗口"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#ffffff',
          borderRadius: 12,
          border: '1px solid rgba(0, 0, 0, 0.08)',
          boxShadow: '0 20px 48px -8px rgba(0, 0, 0, 0.24), 0 8px 16px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          animation: 'feedbackCenterPop 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {isSuccess ? (
          <div
            style={{
              padding: '36px 24px 32px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'transparent',
                border: 'none',
                color: '#71717a',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f4f4f5';
                e.currentTarget.style.color = '#09090b';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#71717a';
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#ecfdf5',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
              反馈已发送，感谢你的意见！
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              反馈将帮助我们持续改进 EmboMiX
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                marginTop: 8,
                padding: '8px 28px',
                borderRadius: 6,
                border: 'none',
                background: '#09090b',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#27272a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#09090b';
              }}
            >
              完成
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ margin: 0, padding: 0 }}>
            {/* Top Row: 舒展大气的顶栏，左侧全宽下拉框（flex: 1），右侧等高无边框关闭按钮 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '16px 16px 12px',
              }}
            >
              {/* Topic Select: 舒展大方的类型选择框 */}
              <div style={{ flex: 1, position: 'relative' }}>
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value as FeedbackTopic)}
                  disabled={isSubmitting}
                  aria-label="选择反馈类型"
                  style={{
                    width: '100%',
                    height: 38,
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    boxSizing: 'border-box',
                    padding: '0 32px 0 12px',
                    fontSize: 13.5,
                    fontWeight: 500,
                    borderRadius: 8,
                    border: '1px solid #e4e4e7',
                    background: '#ffffff',
                    color: '#09090b',
                    outline: 'none',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#18181b';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#e4e4e7';
                  }}
                >
                  {TOPIC_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <div
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    color: '#71717a',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              {/* Close Button: 与下拉框等高 38px、等圆角 8px 的幽灵关闭按钮 */}
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭反馈窗口"
                disabled={isSubmitting}
                style={{
                  width: 38,
                  height: 38,
                  boxSizing: 'border-box',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  color: '#71717a',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  padding: 0,
                  transition: 'background 0.15s ease, color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f4f4f5';
                  e.currentTarget.style.color = '#09090b';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#71717a';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Input Box */}
            <div style={{ padding: '0 16px 10px' }}>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                placeholder="期待你的反馈..."
                rows={4}
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'none',
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #e4e4e7',
                  background: '#ffffff',
                  color: '#09090b',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#18181b';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e4e4e7';
                }}
              />
            </div>

            {errorMsg && (
              <div
                role="alert"
                style={{
                  padding: '0 16px 8px',
                  fontSize: 12,
                  color: '#ef4444',
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* Footer with Emojis & Send Button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 16px 14px',
              }}
            >
              {/* Emojis */}
              <div
                role="radiogroup"
                aria-label="选择满意度"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {RATING_OPTIONS.map((item) => {
                  const isSelected = selectedRating === item.rating;
                  return (
                    <button
                      key={item.rating}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      title={item.label}
                      aria-label={item.label}
                      disabled={isSubmitting}
                      onClick={() => setSelectedRating(item.rating)}
                      style={{
                        background: isSelected ? '#f4f4f5' : 'transparent',
                        border: isSelected ? '1px solid #d4d4d8' : '1px solid transparent',
                        borderRadius: 6,
                        width: 32,
                        height: 32,
                        padding: 0,
                        fontSize: 18,
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                        transition: 'transform 0.12s ease, background 0.12s ease',
                      }}
                    >
                      {item.emoji}
                    </button>
                  );
                })}
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={selectedRating === null || isSubmitting}
                style={{
                  background: selectedRating === null || isSubmitting ? '#e4e4e7' : '#000000',
                  color: selectedRating === null || isSubmitting ? '#a1a1aa' : '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: selectedRating === null || isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease, opacity 0.15s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isSubmitting ? '发送中...' : '发送'}
              </button>
            </div>

            {/* Privacy notice */}
            <div
              style={{
                background: '#fafafa',
                padding: '8px 16px',
                fontSize: 11,
                color: '#a1a1aa',
                borderTop: '1px solid #f4f4f5',
                textAlign: 'center',
              }}
            >
              反馈将帮助我们改进 EmboMiX
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
