'use client';

import React from 'react';
import { useAuth } from '../../lib/auth-context';
import type { ModelImportEvent } from '../../lib/embodex/conversation';
import HeadlessChatPanel from './headless-chat';

export default function EmbodexBaselineBuildPanel({
  projectId = '',
  navigate,
  onModelImport,
  onPublishCreated,
}: {
  projectId?: string;
  navigate?: (view: 'parts' | 'ue') => void;
  onModelImport?: (event: ModelImportEvent) => void;
  onPublishCreated?: (taskId: string) => void;
}) {
  const auth = useAuth();
  const userId = auth.status === 'authenticated' ? auth.user?.id || '' : '';
  return (
    <div className="embodex-build-panel">
      <HeadlessChatPanel
        key={`${userId}:${projectId}`}
        userId={userId}
        projectId={projectId}
        navigate={navigate}
        onModelImport={onModelImport}
        onPublishCreated={onPublishCreated}
      />
    </div>
  );
}
