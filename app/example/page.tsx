'use client';

import React from 'react';
import Robot3DWorkbench from '../../components/workbench/Robot3DWorkbench';

/**
 * /example 机器人交互式 3D 设计工作台
 * 独立路由，已在 AppShell 与 auth-guard 中配置免套壳与公开免鉴权白名单
 */
export default function ExamplePage() {
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Robot3DWorkbench
        urdfUrl="/models/a1/robot.urdf"
        meshBaseUrl="/models/a1/"
      />
    </main>
  );
}
