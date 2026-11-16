/**
 * 项目方案设计路由，沿用原项目归属、加载和项目类型校验。
 * 只有项目确认可访问后才挂载设计入口，避免提前创建聊天或执行请求。
 * 入口组件根据后端 env 选择旧版或 Hub 新版，页面不复制两套工作流逻辑。
 * 新版额外获得已验证的项目名称，用于明确展示用户确认发布的项目。
 * 原旧版组件、旧接口和错误状态保持原有实现。
 */
'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getProject } from '../../../../lib/api';
import type { Project } from '../../../../lib/api/generated/types.gen';
import EmbodexSchemeDesignPage from '../../../../components/embodex/EmbodexEntry';

export default function Page() {
  const params = useParams();
  const projectId = (params?.projectId as string) || '';

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    getProject({ path: { projectId } })
      .then((res) => {
        if (!active) return;
        if (res.data) {
          setProject(res.data);
          setError(null);
        } else {
          setError('未找到该项目或数据不存在');
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '获取项目详情失败，请检查网络');
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  if (!projectId) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>无效的项目标识</h2>
        <p style={{ color: '#64748b', marginTop: 8 }}>未检测到 URL 中的 projectId 参数。</p>
        <Link href="/projects" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-block' }}>
          返回项目列表
        </Link>
      </div>
    );
  }

  // 1. 加载中状态 (Fail-Closed: 绝对不提前挂载工作流)
  if (loading || (project && project.id !== projectId && !error)) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '36px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
          正在验证项目工作流权限...
        </h3>
        <p style={{ fontSize: 13, color: '#64748b' }}>请稍候，正在获取项目分类与配置</p>
      </div>
    );
  }

  // 2. 错误状态 (404 或网络失败)
  if (error || !project) {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '36px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
          无法访问 Embodex 方案设计
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>
          {error || '未找到该项目或项目不存在。'}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
          <Link href="/projects" className="btn btn-primary btn-sm">
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  // 3. 非标自动化项目拦截 (AUTOMATION)
  if (project.projectType === 'AUTOMATION') {
    return (
      <div style={{ maxWidth: 640, margin: '80px auto', padding: '36px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
          非标自动化项目不进入 Embodex 方案设计
        </h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>
          当前项目《{project.name}》分类为【非标自动化】(AUTOMATION)。平台规则限定：仅【具身智能】(EMBODIED_AI) 项目可进入 Embodex / Simcore 既有工作流，非标自动化的专属工作流另行设计。
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <Link href={`/projects/${projectId}`} className="btn btn-primary btn-sm">
            返回项目概览
          </Link>
          <Link href="/projects" className="btn btn-secondary btn-sm">
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  // 4. 仅在成功确认 EMBODIED_AI 时，方可渲染工作流 (Fail-Closed)
  if (project.id === projectId && project.projectType === 'EMBODIED_AI') {
    return <EmbodexSchemeDesignPage key={projectId} projectId={projectId} projectName={project.name} />;
  }

  // 未知或不匹配类型的兜底保护
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: '#64748b' }}>项目类型不匹配，无法进入 Embodex 方案设计。</p>
      <Link href={`/projects/${projectId}`} className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
        返回项目概览
      </Link>
    </div>
  );
}
