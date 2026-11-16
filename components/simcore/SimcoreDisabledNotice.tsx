'use client';

import React from 'react';

interface SimcoreDisabledNoticeProps {
  title: string;
  description?: string;
}

export default function SimcoreDisabledNotice({
  title,
  description = '此功能属于平台内部能力，当前 v0.1 未开放公开 API，所有操作已禁用以防止误操作与未授权变更。',
}: SimcoreDisabledNoticeProps) {
  return (
    <div
      style={{
        background: '#fffbeb',
        border: '1px solid #fef3c7',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
      role="alert"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#d97706"
        strokeWidth="2"
        style={{ flexShrink: 0, marginTop: 1 }}
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
          {title}：Internal capability — Public API not exposed in v0.1
        </div>
        <div style={{ fontSize: 12, color: '#b45309', marginTop: 2, lineHeight: 1.4 }}>
          {description}
        </div>
      </div>
    </div>
  );
}
