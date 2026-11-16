'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { listProjects } from '../../lib/api';
import type { Project } from '../../lib/api/generated/types.gen';
import { ProjectActionMenu, EditProjectModal, DeleteProjectModal } from '../../components/projects';

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleProjectUpdated = (updated: Project) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
    );
    showToast('项目信息已更新');
  };

  const handleProjectDeleted = (deletedId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== deletedId));
    showToast('项目已删除');
  };

  // 获取当前用户的全部分页项目
  const fetchAllProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const allItems: Project[] = [];
      let cursor: string | undefined = undefined;
      const seenCursors = new Set<string>();
      let pageCount = 0;
      const maxPages = 50;

      while (pageCount < maxPages) {
        pageCount++;
        const response = (await listProjects({
          query: cursor ? { limit: 50, cursor } : { limit: 50 },
        })) as {
          data?: {
            items?: Project[];
            pageInfo?: { nextCursor?: string | null; hasMore?: boolean };
          };
          error?: unknown;
        };

        if (response.error || !response.data) {
          const errMsg = (response.error as any)?.error?.message || '获取项目列表失败';
          throw new Error(errMsg);
        }

        const items = response.data.items || [];
        allItems.push(...items);

        const nextCursorStr: string | null | undefined = response.data.pageInfo?.nextCursor;
        const hasMore = Boolean(response.data.pageInfo?.hasMore);

        if (hasMore && typeof nextCursorStr === 'string' && nextCursorStr.length > 0) {
          if (seenCursors.has(nextCursorStr)) {
            throw new Error(`检测到项目分页游标循环 (${nextCursorStr})，无法安全加载完整项目列表`);
          }
          seenCursors.add(nextCursorStr);
          cursor = nextCursorStr;
        } else {
          cursor = undefined;
          break;
        }
      }

      if (cursor !== undefined) {
        throw new Error(`项目分页超过防护深度 (${maxPages} 页)，为保障数据完整性已停止渲染`);
      }

      setProjects(allItems);
    } catch (err: any) {
      setProjects([]);
      setError(err?.message || '加载项目列表异常');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllProjects();
  }, [fetchAllProjects]);

  // 映射项目卡片元数据
  const projectDisplayList = useMemo(() => {
    return projects.map((p) => {
      const initials = p.name ? p.name.trim().slice(0, 2).toUpperCase() : 'EX';
      const createdDate = new Date(p.createdAt);
      const timeAgo = !isNaN(createdDate.getTime())
        ? createdDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
        : '近期';

      // 格式化最近更新时间：如 10月28日 14:30
      const updateDate = new Date(p.updatedAt || p.createdAt);
      let updatedTimeText = '刚刚';
      if (!isNaN(updateDate.getTime())) {
        const month = updateDate.getMonth() + 1;
        const day = updateDate.getDate();
        const hours = String(updateDate.getHours()).padStart(2, '0');
        const minutes = String(updateDate.getMinutes()).padStart(2, '0');
        updatedTimeText = `${month}月${day}日 ${hours}:${minutes}`;
      }

      return {
        ...p,
        timeAgo,
        updatedTimeText,
        initials,
      };
    });
  }, [projects]);

  // 本地实时关键词过滤
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projectDisplayList;
    return projectDisplayList.filter((p) => {
      const matchName = p.name.toLowerCase().includes(q);
      const matchId = p.id.toLowerCase().includes(q);
      const typeText = p.projectType === 'EMBODIED_AI' ? '具身智能 embodied' : '非标自动化 automation';
      const matchType = typeText.toLowerCase().includes(q);
      return matchName || matchId || matchType;
    });
  }, [projectDisplayList, searchQuery]);

  return (
    <div className="projects-page-container">
      {/* 顶部工具栏 (严格对齐 屏幕截图 2026-09-11 011906.png) */}
      <div className="toolbar-row">
        <div className="search-container">
          <span className="search-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索项目名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="搜索项目名称"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 10,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
              aria-label="Clear search input"
            >
              ✕
            </button>
          ) : (
            <kbd
              className="search-shortcut"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 18,
                height: 18,
                padding: '0 4px',
                fontSize: 11,
                fontFamily: 'inherit',
                fontWeight: 600,
                color: '#64748b',
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
              }}
            >
              /
            </kbd>
          )}
        </div>

        <div className="toolbar-actions">
          {/* 筛选按钮 */}
          <button type="button" className="btn-icon-box" title="Filter" aria-label="Filter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" x2="4" y1="21" y2="14" />
              <line x1="4" x2="4" y1="10" y2="3" />
              <line x1="12" x2="12" y1="21" y2="12" />
              <line x1="12" x2="12" y1="8" y2="3" />
              <line x1="20" x2="20" y1="21" y2="16" />
              <line x1="20" x2="20" y1="12" y2="3" />
              <line x1="1" x2="7" y1="14" y2="14" />
              <line x1="9" x2="15" y1="8" y2="8" />
              <line x1="17" x2="23" y1="16" y2="16" />
            </svg>
          </button>

          {/* 视图切换 (网格 / 列表) */}
          <div className="filter-tabs" role="group" aria-label="View toggle">
            <button
              type="button"
              className={`filter-tab-btn ${viewMode === 'grid' ? 'filter-tab-active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              title="Grid view"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="7" height="7" x="3" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="3" rx="1" />
                <rect width="7" height="7" x="14" y="14" rx="1" />
                <rect width="7" height="7" x="3" y="14" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              className={`filter-tab-btn ${viewMode === 'list' ? 'filter-tab-active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-label="List view"
              title="List view"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" x2="21" y1="6" y2="6" />
                <line x1="8" x2="21" y1="12" y2="12" />
                <line x1="8" x2="21" y1="18" y2="18" />
                <line x1="3" x2="3.01" y1="6" y2="6" />
                <line x1="3" x2="3.01" y1="12" y2="12" />
                <line x1="3" x2="3.01" y1="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Add New 下拉主按钮 */}
          <Link href="/projects/new" className="btn-add-new" style={{ textDecoration: 'none' }}>
            <span>新建项目</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Link>
        </div>
      </div>

      {/* 双栏布局 (严格对齐 屏幕截图 2026-09-11 011906.png) */}
      <div className="dashboard-grid">
        {/* 左侧栏: Usage, Alerts, Recent Previews */}
        <div className="dashboard-sidebar-column">
          {/* Usage 卡片 */}
          <div className="card-vercel">
            <div className="card-vercel-header">
              <span className="card-vercel-title">资源用量</span>
            </div>
            <div className="usage-box">
              <div className="usage-top-row">
                <span className="usage-period">近 30 天</span>
                <button type="button" className="btn-upgrade-pill">升级</button>
              </div>

              <div className="usage-metrics-list">
                <div className="usage-metric-item">
                  <div className="metric-left">
                    <span className="metric-ring-icon" />
                    <span className="metric-name">部署存储</span>
                    <span className="metric-info-icon" title="Storage info">i</span>
                  </div>
                  <span className="metric-value">5.61 MB / 10 GB</span>
                </div>

                <div className="usage-metric-item">
                  <div className="metric-left">
                    <span className="metric-ring-icon" />
                    <span className="metric-name">模型存储</span>
                    <span className="metric-info-icon" title="Functions info">i</span>
                  </div>
                  <span className="metric-value">588.99 kB / 10 GB</span>
                </div>

                <div className="usage-metric-item">
                  <div className="metric-left">
                    <span className="metric-ring-icon" />
                    <span className="metric-name">边缘请求量</span>
                    <span className="metric-info-icon" title="Requests info">i</span>
                  </div>
                  <span className="metric-value">5 / 1M</span>
                </div>

                <div className="usage-metric-item">
                  <div className="metric-left">
                    <span className="metric-ring-icon" />
                    <span className="metric-name">ISR 读取次数</span>
                    <span className="metric-info-icon" title="Reads info">i</span>
                  </div>
                  <span className="metric-value">2 / 1M</span>
                </div>
              </div>

              <div className="usage-expand-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>
          </div>

          {/* 平台动态 卡片 (严格对齐用户设计) */}
          <div
            className="card-vercel"
            style={{
              background: '#ffffff',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: 12,
              minHeight: 185,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            {/* 上半部分内容 */}
            <div style={{ padding: '16px 18px 12px' }}>
              {/* 顶栏: 公告图标 + 区域标题 + 版本标签 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569', fontSize: 13, fontWeight: 500 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#64748b' }}>
                    <path d="m3 11 18-5v12L3 14v-3z" />
                    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                  </svg>
                  <span>平台动态</span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#059669',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    padding: '1px 6px',
                    borderRadius: 9999,
                    letterSpacing: 0.5,
                  }}
                >
                  NEW
                </span>
              </div>

              {/* 主标题 */}
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: '#0f172a',
                  margin: '0 0 8px',
                  letterSpacing: '-0.01em',
                }}
              >
                EmboMiX 正式上线
              </h3>

              {/* 描述 */}
              <p
                style={{
                  fontSize: 13,
                  color: '#64748b',
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                面向具身智能研发，支持机器人构建、仿真训练与模型评估等核心场景。
              </p>
            </div>

            {/* 底部栏 */}
            <div
              style={{
                padding: '11px 18px',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
              }}
            >
              <span style={{ color: '#94a3b8' }}>EmboMiX v1.0</span>
              <a
                href="https://embomind.com.cn/#home"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  color: '#0f172a',
                  fontWeight: 500,
                  textDecoration: 'none',
                  cursor: 'pointer',
                  transition: 'color 0.15s ease',
                }}
              >
                <span>了解新功能</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            </div>
          </div>
        </div>



        {/* 右侧主栏: Projects 部分 */}
        <div className="dashboard-main-column">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 className="card-vercel-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              我的项目
            </h2>
          </div>

          {/* 加载状态 */}
          {isLoading ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ display: 'inline-block', width: 24, height: 24, border: '2px solid #e2e8f0', borderTopColor: '#0070f3', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: 12 }} />
              <div>正在获取当前用户的项目列表...</div>
            </div>
          ) : error ? (
            /* 错误状态 */
            <div className="empty-state">
              <div className="empty-state-icon" style={{ color: '#ef4444' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h3 className="empty-state-title">获取项目列表失败</h3>
              <p className="empty-state-text">{error}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={fetchAllProjects}
              >
                重试加载
              </button>
            </div>
          ) : filteredProjects.length === 0 ? (
            /* 筛选结果为空状态 */
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                  <path d="m9 9 4 4" />
                  <path d="m13 9-4 4" />
                </svg>
              </div>
              <h3 className="empty-state-title">
                {projects.length === 0 ? '暂无项目' : '未找到匹配的项目'}
              </h3>
              <p className="empty-state-text">
                {projects.length === 0
                  ? '您当前尚未创建任何 Project。点击上方 “新建” 开始构建新项目。'
                  : `没有找到与 “${searchQuery}” 匹配的 Project。请尝试更换关键词。`}
              </p>
              {projects.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSearchQuery('')}
                >
                  清除筛选
                </button>
              ) : (
                <Link href="/projects/new" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
                  创建新项目
                </Link>
              )}
            </div>
          ) : (
            <div
              style={
                viewMode === 'grid'
                  ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }
                  : { display: 'flex', flexDirection: 'column', gap: 12 }
              }
            >
              {filteredProjects.map((project) => {
                const projectHref =
                  project.projectType === 'AUTOMATION'
                    ? `/projects/${project.id}/equipment`
                    : `/projects/${project.id}`;

                return (
                  <div
                    key={project.id}
                    className="project-vercel-card"
                    style={{
                      position: 'relative',
                      borderRadius: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      height: 136,
                      minHeight: 132,
                      overflow: 'hidden',
                    }}
                  >
                    {/* 独立更多操作按钮: 同级兄弟元素，zIndex: 2，避免非法嵌套在 <a> 中 */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 13,
                        right: 14,
                        zIndex: 2,
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <ProjectActionMenu
                        project={project}
                        onEdit={(p) => setEditingProject(p)}
                        onDelete={(p) => setDeletingProject(p)}
                        onToast={(msg) => showToast(msg)}
                      />
                    </div>

                    {/* 卡片主跳转区域: 纯净 Link，内部无任何交互 button */}
                    <Link
                      href={projectHref}
                      style={{
                        textDecoration: 'none',
                        color: 'inherit',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        height: '100%',
                      }}
                    >
                      {/* 上半部分: Logo + 标题/类别 + 最近更新时间 (右侧 padding 44px 避免遮挡独立操作按钮) */}
                      <div style={{ padding: '13px 44px 8px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 }}>
                        {/* 第一层: 项目 Logo */}
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            background: '#000000',
                            color: '#ffffff',
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12.5,
                            fontWeight: 600,
                            flexShrink: 0,
                            letterSpacing: 0.5,
                            userSelect: 'none',
                          }}
                        >
                          <span>{project.initials}</span>
                        </div>

                        {/* 标题 + 标签 + 更新时间 */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: '#0f172a',
                              lineHeight: 1.4,
                              wordBreak: 'break-word',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            <span>{project.name}</span>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                verticalAlign: 'middle',
                                fontSize: 10,
                                fontWeight: 500,
                                padding: '1px 6px',
                                borderRadius: 9999,
                                background: project.projectType === 'EMBODIED_AI' ? '#ecfdf5' : '#f0f9ff',
                                color: project.projectType === 'EMBODIED_AI' ? '#059669' : '#0284c7',
                                border: `1px solid ${project.projectType === 'EMBODIED_AI' ? '#a7f3d0' : '#bae6fd'}`,
                                marginLeft: 6,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {project.projectType === 'EMBODIED_AI' ? '具身智能' : '非标自动化'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75, flexShrink: 0 }}>
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 16 14" />
                            </svg>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              最近更新于 {project.updatedTimeText}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 底部栏: 创建时间与查看项目 */}
                      <div
                        style={{
                          height: 34,
                          padding: '0 16px',
                          borderTop: '1px solid #f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ color: '#94a3b8' }}>创建于 {project.timeAgo}</span>
                        <div className="project-card-action-text" style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#475569', fontWeight: 500, transition: 'color 0.15s ease' }}>
                          <span>查看项目</span>
                          <svg className="project-card-action-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}

              {/* 末位补位: 虚线「+ 新建项目」卡片 (对齐网格并提供快捷入口) */}
              {viewMode === 'grid' && (
                <Link
                  href="/projects/new"
                  style={{
                    background: 'rgba(248, 250, 252, 0.65)',
                    border: '1.5px dashed #cbd5e1',
                    borderRadius: 10,
                    height: 136,
                    minHeight: 132,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    textDecoration: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#94a3b8';
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#cbd5e1';
                    e.currentTarget.style.background = 'rgba(248, 250, 252, 0.65)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#0f172a',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>新建项目</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>支持具身智能及非标自动化</div>
                  </div>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 浮动 Toast 消息提示 */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: '#0f172a',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 99999,
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* 编辑项目弹窗 */}
      <EditProjectModal
        project={editingProject}
        isOpen={Boolean(editingProject)}
        onClose={() => setEditingProject(null)}
        onSuccess={handleProjectUpdated}
      />

      {/* 删除项目确认弹窗 */}
      <DeleteProjectModal
        project={deletingProject}
        isOpen={Boolean(deletingProject)}
        onClose={() => setDeletingProject(null)}
        onSuccess={handleProjectDeleted}
      />
    </div>
  );
}
