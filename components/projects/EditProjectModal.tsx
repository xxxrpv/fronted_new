'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ProjectDialog } from './ProjectDialog';
import type { Project } from '../../lib/api/generated/types.gen';
import { updateProject } from '../../lib/api/generated/sdk.gen';
import { checkProjectName } from '../../lib/api/client';

export interface EditProjectModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: Project) => void;
}

export function EditProjectModal({
  project,
  isOpen,
  onClose,
  onSuccess,
}: EditProjectModalProps) {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [descError, setDescError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkSeqRef = useRef(0);
  const submitSeq = useRef(0);
  useEffect(() => { ++submitSeq.current; }, [isOpen,project]);
  const requestIdentity = useRef<string | null>(null);
  requestIdentity.current = isOpen ? project?.id ?? null : null;
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // 初始化表单数据
  useEffect(() => {
    if (project && isOpen) {
      setName(project.name || '');
      setDescription(project.description || '');
      setNameError(null);
      setDescError(null);
      setServerError(null);
      setIsCheckingName(false);
      setIsSubmitting(false);

      firstInputRef.current?.focus();
    }
  }, [project, isOpen]);

  const getCodePointLength = (str: string) => [...str].length;
  useEffect(() => {
    const seq = ++checkSeqRef.current;
    let cancelled = false;
    setIsCheckingName(false);
    if (!isOpen || !project || !name.trim() || [...name].length > 200 || name.trim() === project.name) return;
    const timer = setTimeout(async () => {
      setIsCheckingName(true);
      try {
        const res = await checkProjectName({name,excludeProjectId:project.id});
        if (!cancelled && checkSeqRef.current === seq && res.data) setNameError(res.data.available ? null : '该项目名称已被占用，请换一个名称');
      } catch { /* PATCH remains authoritative when advisory checking is unavailable. */ }
      finally { if (!cancelled && checkSeqRef.current === seq) setIsCheckingName(false); }
    },300);
    return () => { cancelled = true; ++checkSeqRef.current; clearTimeout(timer); };
  },[name,isOpen,project]);

  const handleNameChange = (val: string) => {
    ++checkSeqRef.current;
    setName(val);
    setServerError(null);
    const codePoints = getCodePointLength(val.trim());
    if (codePoints === 0) {
      setNameError('项目名称不能为空');
    } else if (getCodePointLength(val) > 200 || codePoints > 200) {
      setNameError('项目名称不能超过 200 个字符');
    } else {
      setNameError(null);
    }
  };

  const handleDescChange = (val: string) => {
    setDescription(val);
    setServerError(null);
    if (getCodePointLength(val) > 500) {
      setDescError('项目简介不能超过 500 个字符');
    } else {
      setDescError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || isSubmitting) return;

    const trimmedName = name.trim();
    const nameCodePoints = getCodePointLength(trimmedName);

    if (nameCodePoints === 0) {
      setNameError('项目名称不能为空');
      return;
    }
    if ([...name].length > 200 || nameCodePoints > 200) {
      setNameError('项目名称不能超过 200 个字符');
      return;
    }

    const trimmedDesc = description.trim();
    if (getCodePointLength(description) > 500) {
      setDescError('项目简介不能超过 500 个字符');
      return;
    }

    const submittedId = project.id;
    const submittedSeq = submitSeq.current;
    setIsSubmitting(true);
    setServerError(null);

    try {
      const res = await updateProject({
        path: { projectId: project.id },
        body: {
          name: trimmedName,
          description: trimmedDesc.length > 0 ? trimmedDesc : null,
        },
      });

      if ((requestIdentity.current !== submittedId || submitSeq.current !== submittedSeq)) return;
      if (res.error) {
        const errObj = res.error as any;
        const status = res.response?.status;
        const code = errObj?.code || errObj?.error?.code;
        const msg = errObj?.message || errObj?.error?.message;

        if (status === 409 || code === 'PROJECT_NAME_EXISTS') {
          setServerError('该项目名称已被占用，请换一个名称');
          setNameError('该项目名称已被占用，请换一个名称');
        } else if (status === 404) {
          setServerError('项目不存在或已删除');
        } else if (status === 401) {
          setServerError('登录态已失效，请重新登录');
        } else {
          setServerError(msg || '更新项目失败，请稍后重试');
        }
        return;
      }

      if (res.data) {
        onSuccess(res.data as Project);
        onClose();
      }
    } catch (err: any) {
      if ((requestIdentity.current !== submittedId || submitSeq.current !== submittedSeq)) return;
      setServerError(err?.message || '网络请求异常，请检查网络');
    } finally {
      if ((requestIdentity.current === submittedId && submitSeq.current === submittedSeq)) setIsSubmitting(false);
    }
  };

  if (!isOpen || !project) return null;

  const currentNameCodePoints = getCodePointLength(name);
  const currentDescCodePoints = getCodePointLength(description);

  return (
    <ProjectDialog key={project.id} titleId="edit-project-title" busy={isSubmitting} onClose={onClose}>
      <div
        ref={modalRef}
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0f172a',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </div>
            <div>
              <h2 id="edit-project-title" style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>
                编辑项目信息
              </h2>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                更新项目的基本名称与描述
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="关闭弹窗"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              borderRadius: 6,
              cursor: 'pointer',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {serverError && (
            <div role="alert"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{serverError}</span>
            </div>
          )}

          {/* Project ID (只读) */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#64748b', marginBottom: 4 }}>
              项目 ID (只读)
            </label>
            <input
              type="text"
              readOnly
              value={project.id}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: 'monospace',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                color: '#64748b',
                cursor: 'default',
              }}
            />
          </div>

          {/* Project Name (可编辑) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                项目名称 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <span style={{ fontSize: 11, color: currentNameCodePoints > 200 ? '#ef4444' : '#94a3b8' }}>
                {isCheckingName ? '查重中... ' : ''}{currentNameCodePoints} / 200
              </span>
            </div>
            <input
              ref={firstInputRef}
              autoFocus
              type="text"
              value={name}
              readOnly={isSubmitting}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="请输入项目名称"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                border: `1px solid ${nameError ? '#ef4444' : '#cbd5e1'}`,
                borderRadius: 6,
                color: '#0f172a',
              }}
            />
            {nameError && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                {nameError}
              </div>
            )}
          </div>

          {/* Description (可编辑) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                项目简介 (可选)
              </label>
              <span style={{ fontSize: 11, color: currentDescCodePoints > 500 ? '#ef4444' : '#94a3b8' }}>
                {currentDescCodePoints} / 500
              </span>
            </div>
            <textarea
              rows={3}
              value={description}
              readOnly={isSubmitting}
              onChange={(e) => handleDescChange(e.target.value)}
              placeholder="简要描述项目的目标或任务背景..."
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                border: `1px solid ${descError ? '#ef4444' : '#cbd5e1'}`,
                borderRadius: 6,
                color: '#0f172a',
                resize: 'vertical',
              }}
            />
            {descError && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                {descError}
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 8,
              borderTop: '1px solid #f1f5f9',
              paddingTop: 16,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                color: '#475569',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || Boolean(nameError) || Boolean(descError)}
              style={{
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 600,
                color: '#ffffff',
                backgroundColor: isSubmitting || Boolean(nameError) || Boolean(descError) ? '#94a3b8' : '#0f172a',
                border: 'none',
                borderRadius: 6,
                cursor: isSubmitting || Boolean(nameError) || Boolean(descError) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isSubmitting ? (
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
                  <span>保存中...</span>
                </>
              ) : (
                '保存变更'
              )}
            </button>
          </div>
        </form>
      </div>
    </ProjectDialog>
  );
}
