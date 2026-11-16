'use client';

import React from 'react';
import { useAuth } from '../../lib/auth-context';
import { WorkspaceView } from '../../components/workspace/WorkspaceView';

export default function WorkspacePage() {
  const { user } = useAuth();

  return <WorkspaceView userId={user?.id} />;
}
