'use client';

import React from 'react';
import Link from 'next/link';
import DeployWorkspace from '../../components/deploy/DeployWorkspace';

export default function GlobalDeployPage() {
  return (
    <div>
      <div
        style={{
          background: '#eff6ff',
          borderBottom: '1px solid #bfdbfe',
          padding: '10px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          color: '#1e40af',
        }}
      >
        <span>
          当前处于全局部署预览模式。部署任务属于项目级资源，创建与下发需在项目内进行。
        </span>
        <Link
          href="/projects"
          style={{
            color: '#2563eb',
            fontWeight: 600,
            textDecoration: 'underline',
          }}
        >
          前往选择项目 →
        </Link>
      </div>
      <DeployWorkspace />
    </div>
  );
}
