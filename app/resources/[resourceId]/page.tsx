'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getResource, listResourceProjects } from '../../../lib/api';
import type { Resource, Project } from '../../../lib/api/generated/types.gen';
import { getResourceDisplayName } from '../../../lib/simcore/training-workflow';

export default function ResourceDetailPage() {
  const params = useParams();
  const resourceId = (params?.resourceId as string) || '';

  const [resource, setResource] = useState<Resource | null>(null);
  const [relatedProjects, setRelatedProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const generationRef = React.useRef(0);

  // 加载关联的项目（读取全部游标分页），与主详情共享 generation (F-RE-02)
  const fetchRelatedProjects = useCallback(async (resId: string, currentGen: number) => {
    if (!resId || currentGen !== generationRef.current) return;
    setProjectsLoading(true);
    setProjectsError(null);

    try {
      const allProjects: Project[] = [];
      let cursor: string | undefined = undefined;
      const seenCursors = new Set<string>();
      let pageCount = 0;
      const maxPages = 50;

      while (pageCount < maxPages) {
        pageCount++;
        const queryOptions: { limit: number; cursor?: string } = {
          limit: 50,
        };
        if (cursor) queryOptions.cursor = cursor;

        const resProjects = await listResourceProjects({
          path: { resourceId: resId },
          query: queryOptions,
        });

        // 世代校验：若在等待期间发生了 route change 或新请求，立即丢弃
        if (currentGen !== generationRef.current) return;

        if (resProjects.error || !resProjects.data) {
          const msg =
            (resProjects.error as any)?.error?.message ||
            `获取关联项目列表失败 (HTTP ${resProjects.response?.status || 'Network'})`;
          throw new Error(msg);
        }

        const items = resProjects.data.items || [];
        allProjects.push(...items);

        const nextCur = resProjects.data.pageInfo?.nextCursor;
        const hasMore = Boolean(resProjects.data.pageInfo?.hasMore);

        if (hasMore && typeof nextCur === 'string' && nextCur.length > 0) {
          if (seenCursors.has(nextCur)) {
            throw new Error(`检测到关联项目分页游标循环 (${nextCur})，已终止以防数据不一致`);
          }
          seenCursors.add(nextCur);
          cursor = nextCur;
        } else {
          cursor = undefined;
          break;
        }
      }

      if (cursor !== undefined) {
        throw new Error(`关联项目超过最大防护页数 (${maxPages} 页)，停止渲染未完整数据`);
      }

      if (currentGen !== generationRef.current) return;
      setRelatedProjects(allProjects);
      setProjectsError(null);
    } catch (err: any) {
      if (currentGen !== generationRef.current) return;
      setRelatedProjects([]);
      setProjectsError(err?.message || '加载关联项目异常');
    } finally {
      if (currentGen === generationRef.current) {
        setProjectsLoading(false);
      }
    }
  }, []);

  // 加载资源主详情与关联项目
  const loadResourceData = useCallback(async (resId: string, currentGen: number) => {
    if (!resId || currentGen !== generationRef.current) return;

    try {
      const resDetail = await getResource({ path: { resourceId: resId } });
      if (currentGen !== generationRef.current) return;

      if (resDetail.error || !resDetail.data) {
        const errMsg =
          (resDetail.error as any)?.error?.message ||
          '未找到指定资源 (Resource Not Found)';
        throw new Error(errMsg);
      }

      setResource(resDetail.data);
      setError(null);
      setIsLoading(false);

      // 获取主详情成功后，在完全相同的 generation 下拉取关联项目
      fetchRelatedProjects(resId, currentGen);
    } catch (err: any) {
      if (currentGen !== generationRef.current) return;
      setResource(null);
      setError(err?.message || '加载资源详情失败');
      setIsLoading(false);
    }
  }, [fetchRelatedProjects]);

  useEffect(() => {
    // 关键修复 F-RE-02：URL resourceId 变化时立即递增 generation
    const currentGen = ++generationRef.current;

    // 立即清理旧资源与关联数据，呈现纯净态
    setResource(null);
    setRelatedProjects([]);
    setError(null);
    setProjectsError(null);
    setIsLoading(true);
    setProjectsLoading(false);

    loadResourceData(resourceId, currentGen);
  }, [resourceId, loadResourceData]);

  // 加载中状态
  if (isLoading) {
    return (
      <div className="resource-detail-container" style={{ padding: '60px 0', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            width: 28,
            height: 28,
            border: '2px solid #e2e8f0',
            borderTopColor: '#0070f3',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: 16,
          }}
        />
        <div style={{ color: 'var(--text-muted)' }}>正在加载资源资产详情 (ID: {resourceId})...</div>
      </div>
    );
  }

  // 未找到资源或网络错误时的展示状态
  if (error || !resource) {
    return (
      <div className="resource-not-found">
        <Link href="/resources" className="detail-back-link">
          ← 返回资源仓库
        </Link>
        <div className="empty-state" style={{ marginTop: 24 }}>
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <h1 className="empty-state-title">无法加载资源资产</h1>
          <p className="empty-state-text">
            {error || `系统未检索到 ID 为 “${resourceId}” 的资源资产记录。请检查 URL 路径或返回仓库列表。`}
          </p>
          <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const retryGen = ++generationRef.current;
                setIsLoading(true);
                setError(null);
                loadResourceData(resourceId, retryGen);
              }}
            >
              重试加载
            </button>
            <Link href="/resources" className="btn btn-primary btn-sm">
              返回资源仓库
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const displayName = getResourceDisplayName(resource);
  const meta = resource.displayMetadata || {};
  const desc = meta.description || '暂无详细描述信息。';
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const specifications = meta.specifications || {};
  const specEntries = Object.entries(specifications);

  return (
    <div className="resource-detail-container">
      {/* 顶部返回导航与操作 */}
      <div className="detail-header-row">
        <Link href="/resources" className="detail-back-link">
          ← 返回资源仓库
        </Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge badge-success">
            {resource.type === 'ROBOT' ? 'ROBOT 硬件本体' : 'ALGORITHM 算法策略'}
          </span>
          <span className="badge badge-neutral">v{resource.version}</span>
        </div>
      </div>

      {/* 核心基础卡片 */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="detail-title-row">
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              资源 ID: {resource.id}
            </div>
            <h1 className="detail-title">{displayName}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-neutral" style={{ padding: '6px 12px', fontSize: 12 }}>
              来源模块: {resource.sourceModule}
            </span>
            <span className="badge badge-neutral" style={{ padding: '6px 12px', fontSize: 12 }}>
              外部 ID: {resource.externalId}
            </span>
            <span className="badge badge-neutral" style={{ padding: '6px 12px', fontSize: 12 }}>
              已关联您的项目: {resource.myProjectCount} 个
            </span>
          </div>
        </div>

        <p className="detail-desc">{desc}</p>

        {tags.length > 0 && (
          <div className="detail-tags-row">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginRight: 4 }}>
              分类标签:
            </span>
            {tags.map((t) => (
              <span key={t} className="badge badge-neutral">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 技术规格参数规格表 */}
      <section className="card" aria-labelledby="specs-title" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2 id="specs-title" className="card-title">
            {resource.type === 'ROBOT'
              ? '机器人硬件本体参数 (Hardware Specs)'
              : '具身算法架构与执行参数 (Model Specs)'}
          </h2>
          <span className="badge badge-neutral">Specifications</span>
        </div>
        {specEntries.length === 0 ? (
          <div style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
            暂无具体规格参数定义。
          </div>
        ) : (
          <table className="spec-table" aria-label="技术元数据规格表">
            <tbody>
              {specEntries.map(([key, val]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{String(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 关联的项目列表 (读取当前用户可见且已关联的 Project 全部分页) */}
      <section aria-labelledby="related-projects-title">
        <div className="card-header">
          <h2 id="related-projects-title" className="card-title">
            已应用本资源的 Project {projectsLoading ? '(加载中...)' : `(${relatedProjects.length})`}
          </h2>
          <Link href="/projects" className="project-link-action" style={{ fontSize: 12 }}>
            查看所有项目 →
          </Link>
        </div>

        {projectsLoading ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div
              style={{
                display: 'inline-block',
                width: 20,
                height: 20,
                border: '2px solid #e2e8f0',
                borderTopColor: '#0070f3',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: 8,
              }}
            />
            <div style={{ fontSize: 13 }}>正在检索关联项目列表...</div>
          </div>
        ) : projectsError ? (
          <div className="empty-state" style={{ padding: '24px 16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8 }}>
            <div className="empty-state-icon" style={{ color: '#ef4444' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="empty-state-title" style={{ color: '#991b1b', fontSize: 15 }}>
              加载关联项目失败
            </h3>
            <p className="empty-state-text" style={{ color: '#b91c1c' }}>
              {projectsError}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const retryGen = ++generationRef.current;
                fetchRelatedProjects(resourceId, retryGen);
              }}
              style={{ marginTop: 8 }}
            >
              重试加载关联项目
            </button>
          </div>
        ) : relatedProjects.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <p className="empty-state-text">当前暂无属于您的 Project 关联此资源资产。</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {relatedProjects.map((proj) => {
              const projUpdated = new Date(proj.updatedAt);
              const formattedProjUpdated = !isNaN(projUpdated.getTime())
                ? projUpdated.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                  })
                : 'recently';

              return (
                <div key={proj.id} className="card card-interactive project-card">
                  <div className="project-card-header">
                    <div>
                      <h3 className="project-card-title">
                        <Link href={`/projects/${proj.id}`}>{proj.name}</Link>
                      </h3>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: proj.projectType === 'EMBODIED_AI' ? '#ecfdf5' : '#f0f9ff',
                            color: proj.projectType === 'EMBODIED_AI' ? '#059669' : '#0284c7',
                            border: `1px solid ${proj.projectType === 'EMBODIED_AI' ? '#a7f3d0' : '#bae6fd'}`,
                          }}
                        >
                          {proj.projectType === 'EMBODIED_AI' ? '具身智能' : '非标自动化'}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ID: {proj.id}</span>
                      </div>
                    </div>
                    <Link href={`/projects/${proj.id}`} className="btn btn-secondary btn-sm">
                      查看该项目详情 →
                    </Link>
                  </div>
                  <div className="project-card-footer" style={{ marginTop: 8 }}>
                    <span className="project-metrics-text">
                      所属容器: {proj.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      更新于 {formattedProjUpdated}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
