'use client';

import React from 'react';
import type {
  SanitizedArtifactItem,
  ArtifactCorrelation,
} from '../../lib/simcore/training-result';

interface SimcoreArtifactsListProps {
  artifacts?: SanitizedArtifactItem[];
  artifactCorrelation?: ArtifactCorrelation;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
    return '未知大小';
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SimcoreArtifactsList({
  artifacts,
  artifactCorrelation,
}: SimcoreArtifactsListProps) {
  const items = artifacts || [];

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px dashed #cbd5e1',
          color: '#64748b',
          fontSize: 13,
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.5"
          style={{ margin: '0 auto 8px', display: 'block' }}
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>暂无可归属的训练产物</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {artifactCorrelation && (
        <div
          style={{
            fontSize: 11,
            color: '#64748b',
            background: '#f1f5f9',
            padding: '4px 10px',
            borderRadius: 4,
            marginBottom: 4,
          }}
        >
          <span>关联策略: {artifactCorrelation.strategy}</span>
          <span style={{ marginLeft: 12 }}>置信度: {artifactCorrelation.confidence}</span>
        </div>
      )}

      {items.map((item, idx) => (
        <div
          key={`${item.name}-${idx}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#ffffff',
          }}
        >
          <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#0f172a',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={item.name}
            >
              {item.name}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              <span>类型: {item.kind || '未指定'}</span>
              <span style={{ margin: '0 6px' }}>·</span>
              <span>大小: {formatBytes(item.size)}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ fontSize: 11, padding: '3px 10px', opacity: 0.6, cursor: 'not-allowed' }}
            disabled
            title="平台 Public API v0.1 未开放产物文件下载契约"
          >
            下载 (未开放)
          </button>
        </div>
      ))}
    </div>
  );
}
