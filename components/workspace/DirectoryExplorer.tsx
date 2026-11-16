import React from 'react';
import type { DirectoryState } from '../../lib/workspace/workspace-types';
import {
  formatBytes,
  formatDateTime,
  isModelTrainingEntry,
} from '../../lib/workspace/workspace-formatters';
import { BreadcrumbsNav } from './BreadcrumbsNav';
import { workspaceStyles as styles } from './workspace-styles';

interface DirectoryExplorerProps {
  state: DirectoryState;
  limit: number;
  onLimitChange: (newLimit: number) => void;
  onNavigate: (directoryId: string | undefined) => void;
  onRefresh: () => void;
  onLoadNextPage: () => void;
  onViewModelTraining?: (entry: { id: string; name: string }) => void;
}

export const DirectoryExplorer: React.FC<DirectoryExplorerProps> = ({
  state,
  limit,
  onLimitChange,
  onNavigate,
  onRefresh,
  onLoadNextPage,
  onViewModelTraining,
}) => {
  const {
    status,
    directory,
    breadcrumbs,
    entries,
    nextCursor,
    isLoadingNextPage,
    nextPageError,
    error,
  } = state;

  return (
    <section style={styles.card} aria-labelledby="directory-card-heading">
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="directory-card-heading" style={styles.cardTitle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
            目录条目管理
          </h2>
          <BreadcrumbsNav
            breadcrumbs={breadcrumbs}
            currentDirectory={directory}
            onNavigate={onNavigate}
            disabled={status === 'loading'}
          />
        </div>

        <div style={styles.cardActions}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label htmlFor="limit-select" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              每页数量:
            </label>
            <select
              id="limit-select"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              disabled={status === 'loading'}
              style={{
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: 13,
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <button
            type="button"
            style={styles.btn}
            onClick={onRefresh}
            disabled={status === 'loading'}
            aria-label="刷新目录列表"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            {status === 'loading' ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      {/* 骨架屏加载态 */}
      {status === 'loading' && (
        <div data-testid="directory-loading-skeleton" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...styles.tableWrapper, ...styles.skeleton, height: 180 }} />
        </div>
      )}

      {/* 初始化等待态 */}
      {status === 'initialization_pending' && (
        <div style={styles.stateBanner('pending')} role="status">
          <div style={{ fontWeight: 600 }}>工作区初始化中 (503 WORKSPACE_INITIALIZATION_PENDING)</div>
          <div style={{ fontSize: 13 }}>
            当前用户的专属空间正在异步建绑与挂载目录结构，请稍候重试。
          </div>
          {error?.requestId && (
            <div style={styles.monoId}>请求编号: {error.requestId}</div>
          )}
          <button
            type="button"
            style={{ ...styles.btnPrimary, marginTop: 4 }}
            onClick={onRefresh}
          >
            重试读取目录
          </button>
        </div>
      )}

      {/* 错误态 (严禁伪造为空列表) */}
      {status === 'error' && (
        <div style={styles.stateBanner('error')} role="alert">
          <div style={{ fontWeight: 600 }}>无法获取目录列表 ({error?.code || 'ERROR'})</div>
          <div style={{ fontSize: 13 }}>{error?.message || '读取目录失败，请稍后重试。'}</div>
          {error?.requestId && (
            <div style={styles.monoId}>排查编号: {error.requestId}</div>
          )}
          <button
            type="button"
            style={{ ...styles.btnPrimary, marginTop: 4 }}
            onClick={onRefresh}
          >
            重试读取
          </button>
        </div>
      )}

      {/* 真实空目录 */}
      {status === 'empty' && (
        <div style={styles.stateEmpty} role="status">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
          </svg>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>该目录下暂无任何条目</div>
          <div style={{ fontSize: 13 }}>当前路径没有任何子目录或文件。</div>
        </div>
      )}

      {/* 列表成功渲染 */}
      {status === 'success' && (
        <>
          <div style={styles.tableWrapper}>
            <table style={styles.table} aria-label="工作区条目列表">
              <thead>
                <tr>
                  <th scope="col" style={{ ...styles.th, width: '28%' }}>名称</th>
                  <th scope="col" style={{ ...styles.th, width: '10%' }}>类型</th>
                  <th scope="col" style={{ ...styles.th, width: '22%' }}>条目标识 (ID)</th>
                  <th scope="col" style={{ ...styles.th, width: '12%' }}>文件大小</th>
                  <th scope="col" style={{ ...styles.th, width: '14%' }}>生成时间</th>
                  <th scope="col" style={{ ...styles.th, width: '14%' }}>登记时间</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isDir = entry.kind === 'directory';

                  return (
                    <tr key={entry.id}>
                      <td style={styles.td}>
                        <div style={styles.entryNameCell}>
                          {isDir ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" aria-hidden="true">
                              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" aria-hidden="true">
                              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          )}

                          {isDir ? (
                            <button
                              type="button"
                              style={styles.entryLinkBtn}
                              onClick={() => onNavigate(entry.id)}
                              aria-label={`进入目录 ${entry.name}`}
                            >
                              {entry.name}
                            </button>
                          ) : isModelTrainingEntry(entry) ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <button
                                type="button"
                                style={styles.entryModelLinkBtn}
                                onClick={() => onViewModelTraining?.({ id: entry.id, name: entry.name })}
                                aria-label={`查看模型训练信息: ${entry.name}`}
                                data-testid={`model-training-link-${entry.id}`}
                              >
                                {entry.name}
                              </button>
                              <span style={styles.modelTag} aria-hidden="true">
                                训练模型
                              </span>
                            </div>
                          ) : (
                            <span>{entry.name}</span>
                          )}
                        </div>
                      </td>

                      <td style={styles.td}>
                        <span style={styles.kindBadge(isDir)}>
                          {isDir ? '目录' : '文件'}
                        </span>
                      </td>

                      <td style={styles.td}>
                        <span style={styles.monoId} title={entry.id}>
                          {entry.id}
                        </span>
                      </td>

                      <td style={styles.td}>
                        {isDir
                          ? '-'
                          : entry.sizeBytes !== null && entry.sizeBytes !== undefined
                          ? formatBytes(entry.sizeBytes)
                          : '未知'}
                      </td>

                      <td style={styles.td}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {isDir ? '-' : entry.generatedAt ? formatDateTime(entry.generatedAt) : '- (未提供)'}
                        </span>
                      </td>

                      <td style={styles.td}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {isDir ? '-' : entry.registeredAt ? formatDateTime(entry.registeredAt) : '- (未提供)'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 分页加载更多 */}
          {nextCursor && (
            <div style={styles.paginationRow}>
              {nextPageError && (
                <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 4 }} role="alert">
                  下一页加载失败: {nextPageError.message}
                </div>
              )}
              <button
                type="button"
                style={styles.btnPrimary}
                onClick={onLoadNextPage}
                disabled={isLoadingNextPage}
                aria-label="加载下一页条目"
              >
                {isLoadingNextPage ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <line x1="12" y1="2" x2="12" y2="6" />
                      <line x1="12" y1="18" x2="12" y2="22" />
                      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                      <line x1="2" y1="12" x2="6" y2="12" />
                      <line x1="18" y1="12" x2="22" y2="12" />
                      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                    </svg>
                    正在加载下一页...
                  </>
                ) : nextPageError ? (
                  '重试加载下一页'
                ) : (
                  '加载下一页'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
