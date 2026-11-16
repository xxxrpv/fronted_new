'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../../lib/api/generated/types.gen';

export interface ProjectActionMenuProps {
  project: Project;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onToast: (msg: string) => void;
  triggerAriaLabel?: string;
}

export function ProjectActionMenu({
  project,
  onEdit,
  onDelete,
  onToast,
  triggerAriaLabel = '更多项目操作',
}: ProjectActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 160;
    let left = rect.right - menuWidth;
    if (left < 10) left = 10;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    const top = rect.bottom + 140 > window.innerHeight ? Math.max(8, rect.top - 140) : rect.bottom + 4;
    setMenuCoords({ top, left });
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) {
      updateCoords();
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (isOpen && menuCoords) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [isOpen]);

  // 点击外部和 Esc 关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleScrollOrResize = () => {
      updateCoords();
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const handleCopyId = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
    triggerRef.current?.focus();

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(project.id);
        onToast('项目ID已复制');
      } else {
        onToast('当前环境不支持剪贴板复制，请手动复制');
      }
    } catch {
      onToast('复制失败，请检查浏览器权限');
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
    triggerRef.current?.focus();
    onEdit(project);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
    triggerRef.current?.focus();
    onDelete(project);
  };

  const menuDropdown = isOpen && menuCoords && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${project.name} 操作菜单`}
          onKeyDown={event => {
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            } else if (event.key === 'Tab') { setIsOpen(false); triggerRef.current?.focus(); }
          }}
          style={{
            position: 'fixed',
            top: menuCoords.top,
            left: menuCoords.left,
            width: 160,
            backgroundColor: '#ffffff',
            borderRadius: 8,
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
            border: '1px solid #e2e8f0',
            padding: '4px',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {/* 1. 编辑项目信息 */}
          <button
            type="button"
            role="menuitem"
            onClick={handleEditClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              fontSize: 13,
              color: '#334155',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f1f5f9';
              e.currentTarget.style.color = '#0f172a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#334155';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
            <span>编辑项目信息</span>
          </button>

          {/* 2. 复制项目ID */}
          <button
            type="button"
            role="menuitem"
            onClick={handleCopyId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              fontSize: 13,
              color: '#334155',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f1f5f9';
              e.currentTarget.style.color = '#0f172a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#334155';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span>复制项目ID</span>
          </button>

          {/* 3. 分割线 */}
          <div
            style={{
              height: 1,
              backgroundColor: '#f1f5f9',
              margin: '3px 0',
            }}
          />

          {/* 4. 删除项目 (危险色) */}
          <button
            type="button"
            role="menuitem"
            onClick={handleDeleteClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              fontSize: 13,
              color: '#dc2626',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#fee2e2';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            <span>删除项目</span>
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); updateCoords(); setIsOpen(true); }
        }}
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          border: 'none',
          background: isOpen ? '#f1f5f9' : 'transparent',
          color: isOpen ? '#0f172a' : '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          transition: 'background 0.15s ease, color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f1f5f9';
          e.currentTarget.style.color = '#0f172a';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#94a3b8';
          }
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      </button>
      {menuDropdown}
    </>
  );
}
