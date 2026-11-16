'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { listResources } from '../../lib/api';
import type {
  Resource,
  ResourceCatalogCounts,
  ResourceType,
} from '../../lib/api/generated/types.gen';
import { ResourceRequestCoordinator } from '../../lib/simcore/training-workflow';

export default function ResourcesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'ROBOT' | 'ALGORITHM'>('ALL');

  const [resources, setResources] = useState<Resource[]>([]);
  const [counts, setCounts] = useState<ResourceCatalogCounts>({
    all: 0,
    robot: 0,
    algorithm: 0,
    matched: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 跨请求与操作的请求控制协调器 (F-RE-01)
  const coordinatorRef = React.useRef(new ResourceRequestCoordinator());

  // 用户任何触发筛选变化的动作均同步立即递增 generation，使在途飞行中请求瞬间失去写入资格
  const invalidateRequests = useCallback(() => {
    coordinatorRef.current.invalidate();
  }, []);

  // 仅在类型筛选实际变化时才使在途请求失效并更新状态，防止点击当前激活 Tab 时误杀请求且不重发 (F-RE-05)
  const changeTypeFilter = useCallback(
    (next: 'ALL' | 'ROBOT' | 'ALGORITHM') => {
      if (next === typeFilter) {
        return;
      }
      invalidateRequests();
      setTypeFilter(next);
    },
    [typeFilter, invalidateRequests],
  );

  // 搜索框输入变更防误杀保护
  const handleSearchChange = useCallback(
    (next: string) => {
      if (next === searchQuery) {
        return;
      }
      invalidateRequests();
      setSearchQuery(next);
    },
    [searchQuery, invalidateRequests],
  );

  // 清除搜索防误杀保护
  const handleClearSearch = useCallback(() => {
    if (!searchQuery) {
      return;
    }
    invalidateRequests();
    setSearchQuery('');
  }, [searchQuery, invalidateRequests]);

  // 重置全部筛选
  const handleResetFilters = useCallback(() => {
    if (!searchQuery && typeFilter === 'ALL') {
      return;
    }
    invalidateRequests();
    setSearchQuery('');
    setTypeFilter('ALL');
  }, [searchQuery, typeFilter, invalidateRequests]);

  // 根据服务端全目录结果读取所有分页项目
  const fetchResources = useCallback(
    async (typeFilterVal: 'ALL' | 'ROBOT' | 'ALGORITHM', queryVal: string, requestSeq: number) => {
      // 若在排队或触发前已被新的操作作废，立即退出
      if (!coordinatorRef.current.isCurrent(requestSeq)) return;

      setIsLoading(true);
      setError(null);

      try {
        const trimmedQuery = queryVal.trim();
        const typeParam: ResourceType | undefined =
          typeFilterVal === 'ALL' ? undefined : typeFilterVal;
        const queryParam: string | undefined =
          trimmedQuery.length > 0 ? trimmedQuery : undefined;

        const allItems: Resource[] = [];
        let cursor: string | undefined = undefined;
        const seenCursors = new Set<string>();
        let pageCount = 0;
        const maxPages = 50;
        let serverCounts: ResourceCatalogCounts = {
          all: 0,
          robot: 0,
          algorithm: 0,
          matched: 0,
        };

        while (pageCount < maxPages) {
          pageCount++;
          const queryOptions: {
            limit: number;
            cursor?: string;
            type?: ResourceType;
            query?: string;
          } = {
            limit: 50,
          };
          if (typeParam) queryOptions.type = typeParam;
          if (queryParam) queryOptions.query = queryParam;
          if (cursor) queryOptions.cursor = cursor;

          const res = await listResources({ query: queryOptions });
          // 若在此期间有更新的筛选或请求发出，立即废弃本响应，禁止修改页面状态
          if (!coordinatorRef.current.isCurrent(requestSeq)) return;

          if (res.error || !res.data) {
            const errMsg =
              (res.error as any)?.error?.message || '获取资源目录失败';
            throw new Error(errMsg);
          }

          if (pageCount === 1 && res.data.counts) {
            serverCounts = res.data.counts;
          }

          const items = res.data.items || [];
          allItems.push(...items);

          const nextCur = res.data.pageInfo?.nextCursor;
          const hasMore = Boolean(res.data.pageInfo?.hasMore);

          if (hasMore && typeof nextCur === 'string' && nextCur.length > 0) {
            if (seenCursors.has(nextCur)) {
              throw new Error(`检测到资源分页游标循环 (${nextCur})，无法安全加载完整资源目录`);
            }
            seenCursors.add(nextCur);
            cursor = nextCur;
          } else {
            cursor = undefined;
            break;
          }
        }

        if (cursor !== undefined) {
          throw new Error(`资源分页超过防护深度 (${maxPages} 页)，为保障数据一致性已停止渲染`);
        }

        if (!coordinatorRef.current.isCurrent(requestSeq)) return;
        setResources(allItems);
        setCounts(serverCounts);
      } catch (err: any) {
        if (!coordinatorRef.current.isCurrent(requestSeq)) return;
        setResources([]);
        setError(err?.message || '加载资源列表异常');
      } finally {
        if (coordinatorRef.current.isCurrent(requestSeq)) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  // 筛选与搜索变化时：捕获当前由事件同步递增后的 generation，并在防抖 250ms 结束后发起请求 (F-RE-01)
  useEffect(() => {
    const requestSeq = coordinatorRef.current.getCurrentSeq();

    const timer = setTimeout(() => {
      // 防抖到期时核对序列号，确保防抖窗口内无新的用户筛选操作触发
      if (coordinatorRef.current.isCurrent(requestSeq)) {
        fetchResources(typeFilter, searchQuery, requestSeq);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [typeFilter, searchQuery, fetchResources]);

  return (
    <div className="resources-page-container">
      {/* 顶部工具栏 */}
      <div className="toolbar-row">
        <div className="search-container">
          <span className="search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索资源 (Robot / Algorithm 名称、标签、模块、参数...)"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="搜索资源"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              style={{
                position: 'absolute',
                right: 10,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
              aria-label="清除搜索输入"
            >
              ✕
            </button>
          )}
        </div>

        <div className="toolbar-actions">
          {/* 类型筛选器 Tab (使用服务端全目录总数) */}
          <div className="filter-tabs" role="group" aria-label="资源类型筛选">
            <button
              type="button"
              className={`filter-tab-btn ${typeFilter === 'ALL' ? 'filter-tab-active' : ''}`}
              onClick={() => changeTypeFilter('ALL')}
            >
              全部 ({counts.all})
            </button>
            <button
              type="button"
              className={`filter-tab-btn ${typeFilter === 'ROBOT' ? 'filter-tab-active' : ''}`}
              onClick={() => changeTypeFilter('ROBOT')}
            >
              Robot ({counts.robot})
            </button>
            <button
              type="button"
              className={`filter-tab-btn ${typeFilter === 'ALGORITHM' ? 'filter-tab-active' : ''}`}
              onClick={() => changeTypeFilter('ALGORITHM')}
            >
              Algorithm ({counts.algorithm})
            </button>
          </div>

          {/* 上传/导入资源按要求禁用并标记 */}
          <button
            type="button"
            className="btn btn-primary btn-disabled"
            disabled
            title="当前为静态展示环境，不支持上传操作"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>注册新资源</span>
          </button>
        </div>
      </div>

      {/* 双栏布局 */}
      <div className="dashboard-grid">
        {/* 左侧说明与分类卡片 */}
        <div className="dashboard-sidebar-column">
          {/* 仓库概念说明卡片 */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">资源仓库定位</span>
              <span className="badge badge-neutral">Library</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
            </p>
            <div className="stat-list">
              <div className="stat-item">
                <span className="stat-item-label">Robot 本体平台</span>
                <span className="stat-item-value">{counts.robot} 款</span>
              </div>
              <div className="stat-item">
                <span className="stat-item-label">Algorithm 算法模型</span>
                <span className="stat-item-value">{counts.algorithm} 种</span>
              </div>
              <div className="stat-item">
                <span className="stat-item-label">当前筛选命中</span>
                <span className="stat-item-value">{counts.matched} 项</span>
              </div>
            </div>
          </div>

          {/* 来源模块说明 */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">来源模块 (Modules)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 4 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>simcore</div>
                <div style={{ color: 'var(--text-muted)' }}>Simcore 仿真训练与评测环境模块</div>
              </div>
              <div style={{ fontSize: 12, padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 4 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>linkor</div>
                <div style={{ color: 'var(--text-muted)' }}>Linkor 异构硬件动力学与驱动适配器</div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧主栏: 资源列表 */}
        <div className="dashboard-main-column">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 className="page-title" style={{ fontSize: 18 }}>
                资源资产库 (Resource Library)
              </h1>
              <span className="badge badge-neutral">
                {counts.matched} 项
              </span>
            </div>
            {(searchQuery || typeFilter !== 'ALL') && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {typeFilter !== 'ALL' && `类型: ${typeFilter} `}
                {searchQuery && `| 关键词: “${searchQuery}”`}
              </span>
            )}
          </div>

          {/* 加载状态 */}
          {isLoading ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div
                style={{
                  display: 'inline-block',
                  width: 24,
                  height: 24,
                  border: '2px solid #e2e8f0',
                  borderTopColor: '#0070f3',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginBottom: 12,
                }}
              />
              <div>正在检索平台资源目录...</div>
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
              <h2 className="empty-state-title">获取资源目录失败</h2>
              <p className="empty-state-text">{error}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const retrySeq = coordinatorRef.current.invalidate();
                  fetchResources(typeFilter, searchQuery, retrySeq);
                }}
              >
                重试加载
              </button>
            </div>
          ) : resources.length === 0 ? (
            /* 空状态 */
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                  <path d="m9 9 4 4" />
                  <path d="m13 9-4 4" />
                </svg>
              </div>
              <h2 className="empty-state-title">未找到匹配的资源</h2>
              <p className="empty-state-text">
                {counts.all === 0
                  ? '平台资源资产库当前暂无可浏览的 Resource 记录。'
                  : `没有符合当前类型筛选或关键词 “${searchQuery}” 的资源资产。`}
              </p>
              {(searchQuery || typeFilter !== 'ALL') && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleResetFilters}
                >
                  重置全部筛选
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {resources.map((resource) => {
                const displayName =
                  resource.displayMetadata?.name || resource.externalId;
                const desc =
                  resource.displayMetadata?.description || '暂无描述信息';
                const tags = Array.isArray(resource.displayMetadata?.tags)
                  ? resource.displayMetadata.tags
                  : [];
                const specs =
                  resource.displayMetadata?.specifications &&
                  typeof resource.displayMetadata.specifications === 'object'
                    ? resource.displayMetadata.specifications
                    : {};
                const specCount = Object.keys(specs).length;

                const updatedDate = new Date(resource.updatedAt);
                const formattedUpdated = !isNaN(updatedDate.getTime())
                  ? updatedDate.toLocaleDateString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'recently';

                return (
                  <article key={resource.id} className="card card-interactive project-card">
                    <div className="project-card-header">
                      <div>
                        <h2 className="project-card-title">
                          <Link href={`/resources/${resource.id}`}>{displayName}</Link>
                        </h2>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                          <span
                            className={`badge ${
                              resource.type === 'ROBOT' ? 'badge-blue' : 'badge-green'
                            }`}
                          >
                            {resource.type}
                          </span>
                          <span className="badge badge-neutral">{resource.version}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            模块: {resource.sourceModule}
                          </span>
                        </div>
                      </div>
                      <div className="project-card-meta">
                        <span>更新于 {formattedUpdated}</span>
                      </div>
                    </div>

                    <p className="project-card-desc">{desc}</p>

                    {tags.length > 0 && (
                      <div className="detail-tags-row">
                        {tags.map((t) => (
                          <span key={t} className="badge badge-neutral">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="project-card-footer">
                      <span className="project-metrics-text">
                        已关联 {resource.myProjectCount} 个项目 | 包含 {specCount} 项技术规格
                      </span>
                      <Link href={`/resources/${resource.id}`} className="project-link-action">
                        查看资源详情 →
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
