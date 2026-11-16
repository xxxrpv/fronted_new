'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ProjectDialog } from './ProjectDialog';
import type { Project } from '../../lib/api/generated/types.gen';
import { deleteProject } from '../../lib/api/generated/sdk.gen';

export interface DeleteProjectModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (deletedProjectId: string) => void;
}

export function DeleteProjectModal({
  project,
  isOpen,
  onClose,
  onSuccess,
}: DeleteProjectModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submitSeq = useRef(0);
  useEffect(() => { ++submitSeq.current; }, [isOpen,project]);
  const requestIdentity = useRef<string | null>(null);
  requestIdentity.current = isOpen ? project?.id ?? null : null;
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsDeleting(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleDelete = async () => {
    if (!project || isDeleting) return;

    const submittedId = project.id;
    const submittedSeq = submitSeq.current;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const res = await deleteProject({
        path: { projectId: project.id },
      });

      if ((requestIdentity.current !== submittedId || submitSeq.current !== submittedSeq)) return;
      if (res.error) {
        const errObj = res.error as any;
        const status = res.response?.status;
        const code = errObj?.code || errObj?.error?.code;
        const msg = errObj?.message || errObj?.error?.message;

        if (status === 409 || code === 'PROJECT_HAS_ACTIVE_OPERATIONS') {
          setErrorMessage(
            '该项目存在进行中或尚未确认结束的操作（如任务执行中、仿真评测中等），无法安全删除。请等待操作结束或手动终止后再试。',
          );
        } else if (status === 404) {
          // 项目在远端已不存在，视为已删除
          onSuccess(project.id);
          onClose();
        } else if (status === 401) {
          setErrorMessage('登录态已失效，请重新登录');
        } else {
          setErrorMessage(msg || '删除项目失败，请稍后重试');
        }
        return;
      }

      // 204 No Content 成功
      onSuccess(project.id);
      onClose();
    } catch (err: any) {
      if ((requestIdentity.current !== submittedId || submitSeq.current !== submittedSeq)) return;
      setErrorMessage(err?.message || '网络请求异常，请检查网络');
    } finally {
      if ((requestIdentity.current === submittedId && submitSeq.current === submittedSeq)) setIsDeleting(false);
    }
  };

  if (!isOpen || !project) return null;

  return (
    <ProjectDialog key={project.id} titleId="delete-project-title" busy={isDeleting} onClose={onClose}>
      <div
        ref={modalRef}
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '24px 20px 16px' }}>
          {/* Danger Icon */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: '#fee2e2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>

          <h2 id="delete-project-title" style={{ fontSize: 17, fontWeight: 600, color: '#0f172a', margin: '0 0 8px' }}>
            确定要删除项目吗？
          </h2>

          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, margin: '0 0 16px' }}>
            您即将删除项目 <strong style={{ color: '#0f172a' }}>“{project.name}”</strong>（ID: <code style={{ fontSize: 12, backgroundColor: '#f1f5f9', padding: '1px 4px', borderRadius: 4 }}>{project.id}</code>）。
            删除后该项目将不可访问，此操作不可撤销。
          </p>

          {errorMessage && (
            <div role="alert"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                lineHeight: 1.4,
                marginBottom: 16,
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={isDeleting}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              color: '#475569',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              cursor: isDeleting ? 'not-allowed' : 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              backgroundColor: isDeleting ? '#f87171' : '#dc2626',
              border: 'none',
              borderRadius: 6,
              cursor: isDeleting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {isDeleting ? (
              <>
                <span
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    border: '2px solid #ffffff',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <span>删除中...</span>
              </>
            ) : (
              '确认删除'
            )}
          </button>
        </div>
      </div>
    </ProjectDialog>
  );
}
