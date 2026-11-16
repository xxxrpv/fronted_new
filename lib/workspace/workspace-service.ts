import type {
  WorkspaceCapacity,
  WorkspaceEntries,
  WorkspaceEntry,
  WorkspaceDirectory,
  WorkspaceModelTraining,
} from './workspace-types';
import {
  getWorkspaceCapacity as sdkGetWorkspaceCapacity,
  getWorkspaceEntries as sdkGetWorkspaceEntries,
  getWorkspaceModelTraining as sdkGetWorkspaceModelTraining,
} from '../api/client';

export interface ParsedWorkspaceError {
  code: string;
  message: string;
  requestId?: string;
  status?: number;
  isInitializationPending: boolean;
}

/**
 * Safely parse any API or Network error into a normalized structure.
 * Never throws, sanitizes sensitive information.
 */
export function parseWorkspaceError(error: unknown, status?: number): ParsedWorkspaceError {
  const errObj = error as any;
  const responseStatus = status ?? errObj?.response?.status ?? errObj?.status;
  const payloadError = errObj?.error?.error || errObj?.error || errObj?.data?.error;

  const code: string =
    typeof payloadError?.code === 'string' && payloadError.code.length > 0
      ? payloadError.code
      : responseStatus === 401
      ? 'AUTHENTICATION_REQUIRED'
      : responseStatus === 404
      ? 'WORKSPACE_DIRECTORY_NOT_FOUND'
      : responseStatus === 502
      ? 'WORKSPACE_PROTOCOL_ERROR'
      : responseStatus === 503
      ? 'WORKSPACE_UNAVAILABLE'
      : 'UNKNOWN_ERROR';

  const message: string =
    typeof payloadError?.message === 'string' && payloadError.message.length > 0
      ? payloadError.message
      : typeof errObj?.message === 'string' && errObj.message.length > 0
      ? errObj.message
      : '平台服务异常，请稍后重试';

  const requestId: string | undefined =
    typeof payloadError?.requestId === 'string' ? payloadError.requestId : undefined;

  const isInitializationPending =
    responseStatus === 503 && code === 'WORKSPACE_INITIALIZATION_PENDING';

  return {
    code,
    message,
    requestId,
    status: responseStatus,
    isInitializationPending,
  };
}

/**
 * Fetch workspace capacity via platform API.
 */
export async function fetchWorkspaceCapacity(options?: {
  signal?: AbortSignal;
}): Promise<{ data?: WorkspaceCapacity; error?: ParsedWorkspaceError }> {
  try {
    const res = await sdkGetWorkspaceCapacity({
      headers: {
        'Cache-Control': 'no-store',
      },
      signal: options?.signal,
    });

    if (options?.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }

    if (res.data) {
      return { data: res.data };
    }

    if ((res.error as any)?.name === 'AbortError') {
      throw res.error;
    }

    const parsedErr = parseWorkspaceError(res.error, res.response?.status);
    return { error: parsedErr };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return { error: parseWorkspaceError(err) };
  }
}

/**
 * Fetch workspace model training details via platform API.
 */
export async function fetchWorkspaceModelTraining(
  entryId: string,
  options?: { signal?: AbortSignal },
): Promise<{ data?: WorkspaceModelTraining; error?: ParsedWorkspaceError }> {
  try {
    const res = await sdkGetWorkspaceModelTraining({
      path: { entryId },
      headers: {
        'Cache-Control': 'no-store',
      },
      signal: options?.signal,
    });

    if (options?.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }

    if (res.data) {
      return { data: res.data };
    }

    if ((res.error as any)?.name === 'AbortError') {
      throw res.error;
    }

    const parsedErr = parseWorkspaceError(res.error, res.response?.status);
    return { error: parsedErr };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return { error: parseWorkspaceError(err) };
  }
}

export interface FetchEntriesParams {
  parentId?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

/**
 * Fetch workspace entries via platform API.
 */
export async function fetchWorkspaceEntries(params: FetchEntriesParams): Promise<{
  data?: WorkspaceEntries;
  error?: ParsedWorkspaceError;
}> {
  try {
    const query: { parentId?: string; limit?: number; cursor?: string } = {};
    if (params.parentId) query.parentId = params.parentId;
    if (typeof params.limit === 'number') query.limit = params.limit;
    if (params.cursor) query.cursor = params.cursor;

    const res = await sdkGetWorkspaceEntries({
      query,
      headers: {
        'Cache-Control': 'no-store',
      },
      signal: params.signal,
    });

    if (params.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }

    if (res.data) {
      return { data: res.data };
    }

    if ((res.error as any)?.name === 'AbortError') {
      throw res.error;
    }

    const parsedErr = parseWorkspaceError(res.error, res.response?.status);
    return { error: parsedErr };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    return { error: parseWorkspaceError(err) };
  }
}

export interface MergeEntriesContext {
  expectedWorkspaceId: string | null;
  expectedDirectoryId: string | null;
  expectedDirectoryName?: string | null;
  expectedBreadcrumbs?: WorkspaceDirectory[] | null;
  currentEntries: WorkspaceEntry[];
  seenEntryIds: Set<string>;
  seenCursors: Set<string>;
}

export interface MergeEntriesResult {
  success: boolean;
  entries: WorkspaceEntry[];
  seenEntryIds: Set<string>;
  seenCursors: Set<string>;
  nextCursor: string | null;
  error?: string;
}

/**
 * Validate incoming page and merge with existing entries.
 * Strictly verifies workspaceId, directoryId, directoryName, breadcrumb consistency, entry ID uniqueness, and cursor loop prevention.
 */
export function validateAndMergeEntries(
  context: MergeEntriesContext,
  incoming: WorkspaceEntries,
  isNextPage: boolean,
): MergeEntriesResult {
  // 1. Workspace ID consistency
  if (context.expectedWorkspaceId && incoming.workspaceId !== context.expectedWorkspaceId) {
    return {
      success: false,
      entries: context.currentEntries,
      seenEntryIds: context.seenEntryIds,
      seenCursors: context.seenCursors,
      nextCursor: null,
      error: `工作区身份不一致：预期 ${context.expectedWorkspaceId}，收到 ${incoming.workspaceId}`,
    };
  }

  // 2. Directory ID and Name consistency
  if (context.expectedDirectoryId && incoming.directory.id !== context.expectedDirectoryId) {
    return {
      success: false,
      entries: context.currentEntries,
      seenEntryIds: context.seenEntryIds,
      seenCursors: context.seenCursors,
      nextCursor: null,
      error: `目录上下文不一致：预期 ${context.expectedDirectoryId}，收到 ${incoming.directory.id}`,
    };
  }

  if (context.expectedDirectoryName && incoming.directory.name !== context.expectedDirectoryName) {
    return {
      success: false,
      entries: context.currentEntries,
      seenEntryIds: context.seenEntryIds,
      seenCursors: context.seenCursors,
      nextCursor: null,
      error: `目录名称上下文不一致：预期 ${context.expectedDirectoryName}，收到 ${incoming.directory.name}`,
    };
  }

  // 3. Breadcrumb sequence and identity consistency (F3)
  if (context.expectedBreadcrumbs && context.expectedBreadcrumbs.length > 0) {
    if (incoming.breadcrumbs.length !== context.expectedBreadcrumbs.length) {
      return {
        success: false,
        entries: context.currentEntries,
        seenEntryIds: context.seenEntryIds,
        seenCursors: context.seenCursors,
        nextCursor: null,
        error: `面包屑层级不一致：预期 ${context.expectedBreadcrumbs.length} 层，收到 ${incoming.breadcrumbs.length} 层`,
      };
    }
    for (let i = 0; i < context.expectedBreadcrumbs.length; i++) {
      const exp = context.expectedBreadcrumbs[i];
      const act = incoming.breadcrumbs[i];
      if (!act || act.id !== exp.id || act.name !== exp.name) {
        return {
          success: false,
          entries: context.currentEntries,
          seenEntryIds: context.seenEntryIds,
          seenCursors: context.seenCursors,
          nextCursor: null,
          error: `面包屑溯源不一致：第 ${i + 1} 项预期 ${exp.id}(${exp.name})，收到 ${act?.id}(${act?.name})`,
        };
      }
    }
  }

  const updatedSeenIds = new Set(isNextPage ? context.seenEntryIds : []);
  const updatedSeenCursors = new Set(isNextPage ? context.seenCursors : []);

  // 3. Prevent duplicate entry IDs
  const newItems: WorkspaceEntry[] = [];
  for (const entry of incoming.entries) {
    if (updatedSeenIds.has(entry.id)) {
      return {
        success: false,
        entries: context.currentEntries,
        seenEntryIds: context.seenEntryIds,
        seenCursors: context.seenCursors,
        nextCursor: null,
        error: `检测到重复条目 ID (${entry.id})，为防止脏数据已中断加载`,
      };
    }
    updatedSeenIds.add(entry.id);
    newItems.push(entry);
  }

  // 4. Cursor cycle prevention
  let nextCursor: string | null = incoming.nextCursor;
  if (nextCursor) {
    if (updatedSeenCursors.has(nextCursor)) {
      return {
        success: false,
        entries: context.currentEntries,
        seenEntryIds: context.seenEntryIds,
        seenCursors: context.seenCursors,
        nextCursor: null,
        error: `检测到分页游标循环 (${nextCursor})，已终止分页以防止死循环`,
      };
    }
    updatedSeenCursors.add(nextCursor);
  }

  const mergedEntries = isNextPage ? [...context.currentEntries, ...newItems] : newItems;

  return {
    success: true,
    entries: mergedEntries,
    seenEntryIds: updatedSeenIds,
    seenCursors: updatedSeenCursors,
    nextCursor,
  };
}
