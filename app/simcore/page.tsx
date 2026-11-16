'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { listProjects } from '../../lib/api/client';
import type { Project } from '../../lib/api/generated/types.gen';

export default function GlobalSimcorePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listProjects({ query: { limit: 20 } });
        if (!active) return;
        if (res.data?.items) {
          setProjects(res.data.items);
        } else if (res.error) {
          setError('获取项目列表失败');
        }
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '网络异常');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '60px auto',
        padding: '32px 24px',
        background: '#ffffff',
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#eff6ff',
            color: '#0284c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          请先选择 Project 进行 Simcore 仿真训练
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
          Simcore 仿真训练的 Robot、Algorithm 资源及训练任务均严格挂载在具体 Project 作用域下。
          平台规范禁用全局匿名或默认假项目执行训练。
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>
          正在检索可用项目...
        </div>
      ) : error ? (
        <div
          style={{
            padding: '12px 16px',
            background: '#fef2f2',
            color: '#991b1b',
            borderRadius: 6,
            fontSize: 13,
            textAlign: 'center',
            marginBottom: 20,
          }}
        >
          {error}
          <div style={{ marginTop: 12 }}>
            <Link href="/projects" className="btn btn-primary btn-sm">
              进入项目中心
            </Link>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div
          style={{
            padding: '28px 16px',
            background: '#f8fafc',
            border: '1px dashed #cbd5e1',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            当前账户下未找到可用项目。请先创建新项目。
          </p>
          <div style={{ marginTop: 16 }}>
            <Link href="/projects/new" className="btn btn-primary btn-sm">
              创建新项目
            </Link>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 12 }}>
            选择项目直接进入 Simcore 训练台：
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.map((proj) => (
              <Link
                key={proj.id}
                href={`/projects/${proj.id}/simcore`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{proj.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>ID: {proj.id}</div>
                </div>
                <span className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>
                  进入训练台 →
                </span>
              </Link>
            ))}
          </div>

          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <Link href="/projects" style={{ fontSize: 12, color: '#0284c7', textDecoration: 'none' }}>
              浏览全部项目与管理 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
