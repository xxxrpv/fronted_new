/**
 * 全局工作流页头统一挂载入口。
 * 统一挂载标准 ProjectWorkflowHeader，确保 6 阶段全局工作流导航一致性。
 */
'use client';
import React from 'react';
import ProjectWorkflowHeader from '../ProjectWorkflowHeader';

export default function WorkflowHeaderEntry() {
  return <ProjectWorkflowHeader />;
}
