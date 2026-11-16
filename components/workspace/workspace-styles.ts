import type { CSSProperties } from 'react';

export const workspaceStyles = {
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px 20px 48px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  } as CSSProperties,

  pageHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as CSSProperties,

  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--text-primary, #0f172a)',
    letterSpacing: '-0.02em',
    margin: 0,
  } as CSSProperties,

  pageSubtitle: {
    fontSize: 14,
    color: 'var(--text-muted, #64748b)',
    margin: 0,
  } as CSSProperties,

  card: {
    background: 'var(--bg-surface, #ffffff)',
    border: '1px solid var(--border-color, #eaeaea)',
    borderRadius: 'var(--radius-md, 8px)',
    padding: '20px 24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  } as CSSProperties,

  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border-color, #eaeaea)',
    paddingBottom: 14,
    flexWrap: 'wrap',
    gap: 12,
  } as CSSProperties,

  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary, #0f172a)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: 0,
  } as CSSProperties,

  cardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  } as CSSProperties,

  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 'var(--radius-sm, 6px)',
    cursor: 'pointer',
    border: '1px solid var(--border-color, #eaeaea)',
    background: 'var(--bg-surface, #ffffff)',
    color: 'var(--text-primary, #0f172a)',
  } as CSSProperties,

  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 'var(--radius-sm, 6px)',
    cursor: 'pointer',
    background: 'var(--accent-primary, #000000)',
    color: '#ffffff',
    border: '1px solid var(--accent-primary, #000000)',
  } as CSSProperties,

  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
  } as CSSProperties,

  metricItem: {
    background: 'var(--bg-subtle, #f8fafc)',
    padding: '14px 16px',
    borderRadius: 'var(--radius-sm, 6px)',
    border: '1px solid var(--border-color, #eaeaea)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  } as CSSProperties,

  metricLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-muted, #64748b)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  } as CSSProperties,

  metricValue: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary, #0f172a)',
  } as CSSProperties,

  metricWarning: {
    color: '#dc2626',
  } as CSSProperties,

  progressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as CSSProperties,

  progressBarBg: {
    width: '100%',
    height: 8,
    background: 'var(--bg-subtle, #f1f5f9)',
    borderRadius: 9999,
    overflow: 'hidden',
  } as CSSProperties,

  progressBarFill: (percentage: number, isOverquota: boolean): CSSProperties => ({
    width: `${Math.min(100, Math.max(0, percentage))}%`,
    height: '100%',
    background: isOverquota ? '#dc2626' : '#0284c7',
    borderRadius: 9999,
    transition: 'width 0.3s ease',
  }),

  progressLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: 'var(--text-muted, #64748b)',
  } as CSSProperties,

  breadcrumbsContainer: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-muted, #64748b)',
  } as CSSProperties,

  breadcrumbItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  } as CSSProperties,

  breadcrumbBtn: {
    background: 'none',
    border: 'none',
    padding: '2px 6px',
    fontSize: 13,
    color: '#0284c7',
    cursor: 'pointer',
    borderRadius: 4,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  } as CSSProperties,

  breadcrumbCurrent: {
    fontWeight: 600,
    color: 'var(--text-primary, #0f172a)',
    padding: '2px 6px',
  } as CSSProperties,

  breadcrumbSep: {
    color: 'var(--text-muted, #94a3b8)',
  } as CSSProperties,

  tableWrapper: {
    width: '100%',
    overflowX: 'auto',
    border: '1px solid var(--border-color, #eaeaea)',
    borderRadius: 'var(--radius-sm, 6px)',
  } as CSSProperties,

  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
    fontSize: 13,
  } as CSSProperties,

  th: {
    background: 'var(--bg-subtle, #f8fafc)',
    padding: '10px 14px',
    fontWeight: 600,
    color: 'var(--text-secondary, #475569)',
    borderBottom: '1px solid var(--border-color, #eaeaea)',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  td: {
    padding: '12px 14px',
    borderBottom: '1px solid var(--border-color, #eaeaea)',
    verticalAlign: 'middle',
  } as CSSProperties,

  entryNameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as CSSProperties,

  entryLinkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 13,
    fontWeight: 500,
    color: '#0284c7',
    cursor: 'pointer',
    textAlign: 'left',
  } as CSSProperties,

  kindBadge: (isDir: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 9999,
    fontSize: 11,
    fontWeight: 500,
    background: isDir ? '#e0f2fe' : '#f1f5f9',
    color: isDir ? '#0369a1' : '#475569',
  }),

  monoId: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    color: 'var(--text-muted, #64748b)',
  } as CSSProperties,

  stateBanner: (type: 'pending' | 'error'): CSSProperties => ({
    padding: '18px 20px',
    borderRadius: 'var(--radius-sm, 6px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    alignItems: 'flex-start',
    background: type === 'pending' ? '#fffbeb' : '#fef2f2',
    border: `1px solid ${type === 'pending' ? '#fef3c7' : '#fecaca'}`,
    color: type === 'pending' ? '#92400e' : '#991b1b',
  }),

  stateEmpty: {
    padding: '36px 20px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: 'var(--text-muted, #64748b)',
  } as CSSProperties,

  skeleton: {
    background: '#f1f5f9',
    borderRadius: 4,
  } as CSSProperties,

  paginationRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
  } as CSSProperties,

  entryModelLinkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 13,
    fontWeight: 600,
    color: '#0284c7',
    cursor: 'pointer',
    textAlign: 'left',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  } as CSSProperties,

  modelTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    background: '#f0fdf4',
    color: '#15803d',
    border: '1px solid #bbf7d0',
  } as CSSProperties,

  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  } as CSSProperties,

  modalDialog: {
    backgroundColor: 'var(--bg-surface, #ffffff)',
    borderRadius: 'var(--radius-md, 8px)',
    border: '1px solid var(--border-color, #eaeaea)',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    width: '100%',
    maxWidth: 580,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  } as CSSProperties,

  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-color, #eaeaea)',
    background: 'var(--bg-subtle, #f8fafc)',
  } as CSSProperties,

  modalTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary, #0f172a)',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as CSSProperties,

  modalCloseBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 'var(--radius-sm, 6px)',
    color: 'var(--text-muted, #64748b)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as CSSProperties,

  modalBody: {
    minWidth: 0,
    padding: 20,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  } as CSSProperties,

  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: '12px 16px',
  } as CSSProperties,

  detailItem: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--bg-subtle, #f8fafc)',
    border: '1px solid var(--border-color, #eaeaea)',
  } as CSSProperties,

  detailLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary, #475569)',
  } as CSSProperties,

  detailValue: {
    overflowWrap: 'anywhere',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary, #0f172a)',
    wordBreak: 'break-all',
  } as CSSProperties,

  taskStatusBadge: (status: string | null | undefined): CSSProperties => {
    let bg = '#f1f5f9';
    let color = '#475569';
    let border = '#cbd5e1';

    if (status === 'SUCCEEDED') {
      bg = '#dcfce7';
      color = '#15803d';
      border = '#86efac';
    } else if (status === 'FAILED' || status === 'TIMEOUT') {
      bg = '#fee2e2';
      color = '#b91c1c';
      border = '#fca5a5';
    } else if (status === 'RUNNING' || status === 'CANCEL_REQUESTED') {
      bg = '#fef3c7';
      color = '#b45309';
      border = '#fde68a';
    } else if (status === 'PENDING' || status === 'QUEUED') {
      bg = '#e0f2fe';
      color = '#0369a1';
      border = '#bae6fd';
    }

    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      background: bg,
      color,
      border: `1px solid ${border}`,
      width: 'fit-content',
    };
  },
};
