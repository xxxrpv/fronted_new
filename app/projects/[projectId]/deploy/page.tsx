'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import DeployWorkspace from '../../../../components/deploy/DeployWorkspace';

export default function ProjectDeployPage() {
  const params = useParams();
  const projectId = (params?.projectId as string) || '';

  return <DeployWorkspace projectId={projectId} />;
}
