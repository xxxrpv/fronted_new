'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  CapacityState,
  DirectoryState,
  ModelTrainingState,
  WorkspaceEntry,
} from '../../lib/workspace/workspace-types';
import {
  fetchWorkspaceCapacity,
  fetchWorkspaceEntries,
  fetchWorkspaceModelTraining,
  validateAndMergeEntries,
} from '../../lib/workspace/workspace-service';
import { CapacityCard } from './CapacityCard';
import { DirectoryExplorer } from './DirectoryExplorer';
import { ModelTrainingModal } from './ModelTrainingModal';
import { workspaceStyles as styles } from './workspace-styles';

interface WorkspaceViewProps {
  userId?: string | null;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({ userId }) => {
  return <WorkspaceAccountView key={userId ?? 'anonymous'} userId={userId} />;
};

const WorkspaceAccountView: React.FC<WorkspaceViewProps> = ({ userId }) => {
  // 1. Capacity State
  const [capacityState, setCapacityState] = useState<CapacityState>({
    status: 'loading',
    data: null,
    error: null,
  });

  // 2. Directory State & Query Controls
  const [limit, setLimit] = useState<number>(50);
  const [currentParentId, setCurrentParentId] = useState<string | undefined>(undefined);

  const [directoryState, setDirectoryState] = useState<DirectoryState>({
    status: 'loading',
    workspaceId: null,
    directory: null,
    breadcrumbs: [],
    entries: [],
    nextCursor: null,
    isLoadingNextPage: false,
    nextPageError: null,
    error: null,
    seenEntryIds: new Set<string>(),
    seenCursors: new Set<string>(),
  });

  // 3. Model Training Details State & Race-condition tracking
  const [modelTrainingState, setModelTrainingState] = useState<ModelTrainingState>({
    status: 'idle',
    entryId: null,
    fileName: null,
    data: null,
    error: null,
  });

  const modelEpochRef = useRef<number>(0);
  const modelAbortRef = useRef<AbortController | null>(null);

  const closeModelTraining = useCallback(() => {
    modelEpochRef.current += 1;
    if (modelAbortRef.current) {
      modelAbortRef.current.abort();
      modelAbortRef.current = null;
    }
    setModelTrainingState({
      status: 'idle',
      entryId: null,
      fileName: null,
      data: null,
      error: null,
    });
  }, []);

  const openModelTraining = useCallback(async (entry: { id: string; name: string }) => {
    modelEpochRef.current += 1;
    const epoch = modelEpochRef.current;

    if (modelAbortRef.current) {
      modelAbortRef.current.abort();
    }
    const controller = new AbortController();
    modelAbortRef.current = controller;

    // Immediately clear previous details and enter loading
    setModelTrainingState({
      status: 'loading',
      entryId: entry.id,
      fileName: entry.name,
      data: null,
      error: null,
    });

    try {
      const res = await fetchWorkspaceModelTraining(entry.id, { signal: controller.signal });
      if (epoch !== modelEpochRef.current) return;

      if (res.data) {
        setModelTrainingState({
          status: 'success',
          entryId: entry.id,
          fileName: entry.name,
          data: res.data,
          error: null,
        });
      } else if (res.error) {
        setModelTrainingState({
          status: 'error',
          entryId: entry.id,
          fileName: entry.name,
          data: null,
          error: res.error,
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (epoch !== modelEpochRef.current) return;
      setModelTrainingState({
        status: 'error',
        entryId: entry.id,
        fileName: entry.name,
        data: null,
        error: { code: 'CLIENT_ERROR', message: err?.message || '读取模型训练信息失败' },
      });
    }
  }, []);

  const retryModelTraining = useCallback(() => {
    if (modelTrainingState.entryId && modelTrainingState.fileName) {
      openModelTraining({ id: modelTrainingState.entryId, name: modelTrainingState.fileName });
    }
  }, [modelTrainingState.entryId, modelTrainingState.fileName, openModelTraining]);

  // 4. F4: Track confirmed workspace ID for account partition & continuity checks
  const confirmedWorkspaceIdRef = useRef<string | null>(null);

  // 4. Stable refs for current navigation context (avoids effect dependency cycles)
  const parentIdRef = useRef<string | undefined>(undefined);
  const limitRef = useRef<number>(50);

  // 5. Race condition defense & request generation tracking
  const capEpochRef = useRef<number>(0);
  const capAbortRef = useRef<AbortController | null>(null);

  const dirEpochRef = useRef<number>(0);
  const dirAbortRef = useRef<AbortController | null>(null);

  // 6. Load Capacity
  const loadCapacity = useCallback(async () => {
    capEpochRef.current += 1;
    const epoch = capEpochRef.current;

    if (capAbortRef.current) {
      capAbortRef.current.abort();
    }
    const controller = new AbortController();
    capAbortRef.current = controller;

    setCapacityState((prev) => ({
      ...prev,
      status: 'loading',
      error: null,
    }));

    try {
      const res = await fetchWorkspaceCapacity({ signal: controller.signal });
      if (epoch !== capEpochRef.current) return;

      if (res.data) {
        const wsId = res.data.workspaceId;
        if (confirmedWorkspaceIdRef.current && confirmedWorkspaceIdRef.current !== wsId) {
          setCapacityState({
            status: 'error',
            data: null,
            error: {
              code: 'WORKSPACE_PROTOCOL_ERROR',
              message: `工作区身份不一致：预期 ${confirmedWorkspaceIdRef.current}，收到 ${wsId}`,
            },
          });
          return;
        }
        if (!confirmedWorkspaceIdRef.current) {
          confirmedWorkspaceIdRef.current = wsId;
        }

        setCapacityState({
          status: 'success',
          data: res.data,
          error: null,
        });
      } else if (res.error) {
        setCapacityState({
          status: res.error.isInitializationPending ? 'initialization_pending' : 'error',
          data: null,
          error: res.error,
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (epoch !== capEpochRef.current) return;
      setCapacityState({
        status: 'error',
        data: null,
        error: { code: 'CLIENT_ERROR', message: err?.message || '读取容量网络异常' },
      });
    }
  }, []);

  // 7. Load Directory (Initial, drill-down, refresh, or limit change)
  const loadDirectory = useCallback(
    async (targetParentId?: string, targetLimit?: number) => {
      dirEpochRef.current += 1;
      const epoch = dirEpochRef.current;

      if (dirAbortRef.current) {
        dirAbortRef.current.abort();
      }
      const controller = new AbortController();
      dirAbortRef.current = controller;

      const pageLimit = targetLimit ?? limitRef.current;

      // 清空旧条目并进入 loading，保留当前层级面包屑若同目录
      closeModelTraining();
      setDirectoryState((prev) => ({
        status: 'loading',
        workspaceId: confirmedWorkspaceIdRef.current,
        directory: null,
        breadcrumbs: targetParentId === parentIdRef.current ? prev.breadcrumbs : [],
        entries: [],
        nextCursor: null,
        isLoadingNextPage: false,
        nextPageError: null,
        error: null,
        seenEntryIds: new Set<string>(),
        seenCursors: new Set<string>(),
      }));

      try {
        const res = await fetchWorkspaceEntries({
          parentId: targetParentId,
          limit: pageLimit,
          signal: controller.signal,
        });

        if (epoch !== dirEpochRef.current) return;

        if (res.data) {
          const incoming = res.data;

          // F4: Check workspace identity continuity
          if (confirmedWorkspaceIdRef.current && incoming.workspaceId !== confirmedWorkspaceIdRef.current) {
            setDirectoryState({
              status: 'error',
              workspaceId: incoming.workspaceId,
              directory: incoming.directory,
              breadcrumbs: incoming.breadcrumbs,
              entries: [],
              nextCursor: null,
              isLoadingNextPage: false,
              nextPageError: null,
              error: {
                code: 'WORKSPACE_PROTOCOL_ERROR',
                message: `工作区身份不一致：预期 ${confirmedWorkspaceIdRef.current}，收到 ${incoming.workspaceId}`,
              },
              seenEntryIds: new Set<string>(),
              seenCursors: new Set<string>(),
            });
            return;
          }
          if (!confirmedWorkspaceIdRef.current) {
            confirmedWorkspaceIdRef.current = incoming.workspaceId;
          }

          const mergeResult = validateAndMergeEntries(
            {
              expectedWorkspaceId: confirmedWorkspaceIdRef.current,
              expectedDirectoryId: targetParentId || null,
              currentEntries: [],
              seenEntryIds: new Set<string>(),
              seenCursors: new Set<string>(),
            },
            incoming,
            false,
          );

          if (!mergeResult.success) {
            setDirectoryState({
              status: 'error',
              workspaceId: incoming.workspaceId,
              directory: incoming.directory,
              breadcrumbs: incoming.breadcrumbs,
              entries: [],
              nextCursor: null,
              isLoadingNextPage: false,
              nextPageError: null,
              error: {
                code: 'WORKSPACE_PROTOCOL_ERROR',
                message: mergeResult.error || '目录数据协议校验失败',
              },
              seenEntryIds: new Set<string>(),
              seenCursors: new Set<string>(),
            });
            return;
          }

          const hasEntries = mergeResult.entries.length > 0;
          setDirectoryState({
            status: hasEntries ? 'success' : 'empty',
            workspaceId: incoming.workspaceId,
            directory: incoming.directory,
            breadcrumbs: incoming.breadcrumbs,
            entries: mergeResult.entries,
            nextCursor: mergeResult.nextCursor,
            isLoadingNextPage: false,
            nextPageError: null,
            error: null,
            seenEntryIds: mergeResult.seenEntryIds,
            seenCursors: mergeResult.seenCursors,
          });
        } else if (res.error) {
          setDirectoryState((prev) => ({
            ...prev,
            status: res.error!.isInitializationPending ? 'initialization_pending' : 'error',
            entries: [],
            nextCursor: null,
            isLoadingNextPage: false,
            nextPageError: null,
            error: res.error!,
          }));
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (epoch !== dirEpochRef.current) return;
        setDirectoryState((prev) => ({
          ...prev,
          status: 'error',
          entries: [],
          nextCursor: null,
          isLoadingNextPage: false,
          nextPageError: null,
          error: { code: 'CLIENT_ERROR', message: err?.message || '读取目录网络异常' },
        }));
      }
    },
    [],
  );

  // 8. Load Next Page (F3: verifies directory name and breadcrumbs consistency)
  const loadNextPage = useCallback(async () => {
    if (!directoryState.nextCursor || directoryState.isLoadingNextPage) return;

    closeModelTraining();
    const epoch = dirEpochRef.current;
    const currentCursor = directoryState.nextCursor;

    setDirectoryState((prev) => ({
      ...prev,
      isLoadingNextPage: true,
      nextPageError: null,
    }));

    try {
      const res = await fetchWorkspaceEntries({
        parentId: parentIdRef.current,
        limit: limitRef.current,
        cursor: currentCursor,
      });

      if (epoch !== dirEpochRef.current) return;

      if (res.data) {
        const incoming = res.data;
        const mergeResult = validateAndMergeEntries(
          {
            expectedWorkspaceId: directoryState.workspaceId || confirmedWorkspaceIdRef.current,
            expectedDirectoryId: directoryState.directory?.id || null,
            expectedDirectoryName: directoryState.directory?.name || null,
            expectedBreadcrumbs: directoryState.breadcrumbs,
            currentEntries: directoryState.entries,
            seenEntryIds: directoryState.seenEntryIds,
            seenCursors: directoryState.seenCursors,
          },
          incoming,
          true,
        );

        if (!mergeResult.success) {
          setDirectoryState((prev) => ({
            ...prev,
            isLoadingNextPage: false,
            nextPageError: {
              code: 'WORKSPACE_PROTOCOL_ERROR',
              message: mergeResult.error || '下一页协议数据校验失败',
            },
          }));
          return;
        }

        setDirectoryState((prev) => ({
          ...prev,
          isLoadingNextPage: false,
          nextPageError: null,
          entries: mergeResult.entries,
          nextCursor: mergeResult.nextCursor,
          seenEntryIds: mergeResult.seenEntryIds,
          seenCursors: mergeResult.seenCursors,
        }));
      } else if (res.error) {
        setDirectoryState((prev) => ({
          ...prev,
          isLoadingNextPage: false,
          nextPageError: res.error!,
        }));
      }
    } catch (err: any) {
      if (epoch !== dirEpochRef.current) return;
      setDirectoryState((prev) => ({
        ...prev,
        isLoadingNextPage: false,
        nextPageError: {
          code: 'CLIENT_ERROR',
          message: err?.message || '加载下一页异常',
        },
      }));
    }
  }, [
    directoryState.nextCursor,
    directoryState.isLoadingNextPage,
    directoryState.workspaceId,
    directoryState.directory,
    directoryState.breadcrumbs,
    directoryState.entries,
    directoryState.seenEntryIds,
    directoryState.seenCursors,
  ]);

  // 9. Navigation handler
  const handleNavigate = useCallback(
    (directoryId: string | undefined) => {
      closeModelTraining();
      setCurrentParentId(directoryId);
      parentIdRef.current = directoryId;
      loadDirectory(directoryId, limitRef.current);
    },
    [loadDirectory, closeModelTraining],
  );

  // 10. Limit change handler (F1: does NOT trigger account effect or capacity reload)
  const handleLimitChange = useCallback(
    (newLimit: number) => {
      closeModelTraining();
      setLimit(newLimit);
      limitRef.current = newLimit;
      loadDirectory(parentIdRef.current, newLimit);
    },
    [loadDirectory, closeModelTraining],
  );

  // 11. Account or initial mount trigger (F2: cleanly resets parent, confirmed workspace, and state)
  useEffect(() => {
    // Abort any in-flight requests from previous account
    if (capAbortRef.current) capAbortRef.current.abort();
    if (dirAbortRef.current) dirAbortRef.current.abort();

    closeModelTraining();

    // Invalidate in-flight epochs
    capEpochRef.current += 1;
    dirEpochRef.current += 1;

    // Reset account context
    confirmedWorkspaceIdRef.current = null;
    parentIdRef.current = undefined;
    setCurrentParentId(undefined);

    // Reset UI states immediately so previous account's data does not linger
    setCapacityState({
      status: 'loading',
      data: null,
      error: null,
    });

    setDirectoryState({
      status: 'loading',
      workspaceId: null,
      directory: null,
      breadcrumbs: [],
      entries: [],
      nextCursor: null,
      isLoadingNextPage: false,
      nextPageError: null,
      error: null,
      seenEntryIds: new Set<string>(),
      seenCursors: new Set<string>(),
    });

    // Start fresh loads for the current account
    loadCapacity();
    loadDirectory(undefined, limitRef.current);

    return () => {
      if (capAbortRef.current) capAbortRef.current.abort();
      if (dirAbortRef.current) dirAbortRef.current.abort();
      closeModelTraining();
    };
  }, [userId, loadCapacity, loadDirectory, closeModelTraining]);

  return (
    <div style={styles.container}>
      <header style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>用户存储工作区 (Workspace)</h1>
        <p style={styles.pageSubtitle}>
          查看专属挂载存储容量配额，浏览并管理登记产物与项目模块目录。
        </p>
      </header>

      <CapacityCard
        state={capacityState}
        onRefresh={loadCapacity}
      />

      <DirectoryExplorer
        state={directoryState}
        limit={limit}
        onLimitChange={handleLimitChange}
        onNavigate={handleNavigate}
        onRefresh={() => loadDirectory(parentIdRef.current, limitRef.current)}
        onLoadNextPage={loadNextPage}
        onViewModelTraining={openModelTraining}
      />

      <ModelTrainingModal
        isOpen={modelTrainingState.status !== 'idle'}
        state={modelTrainingState}
        onClose={closeModelTraining}
        onRetry={retryModelTraining}
      />
    </div>
  );
};
