import type {
  WorkspaceCapacity,
  WorkspaceDirectory,
  WorkspaceDirectoryEntry,
  WorkspaceFileEntry,
  WorkspaceEntries,
  WorkspaceModelTraining,
  TaskStatus,
} from '../api/generated/types.gen';

export type {
  WorkspaceCapacity,
  WorkspaceDirectory,
  WorkspaceDirectoryEntry,
  WorkspaceFileEntry,
  WorkspaceEntries,
  WorkspaceModelTraining,
  TaskStatus,
};

export type WorkspaceEntry = WorkspaceDirectoryEntry | WorkspaceFileEntry;

export type CapacityFetchStatus = 'idle' | 'loading' | 'success' | 'initialization_pending' | 'error';

export interface CapacityState {
  status: CapacityFetchStatus;
  data: WorkspaceCapacity | null;
  error: {
    code: string;
    message: string;
    requestId?: string;
  } | null;
}

export type DirectoryFetchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'initialization_pending' | 'error';

export interface DirectoryState {
  status: DirectoryFetchStatus;
  workspaceId: string | null;
  directory: WorkspaceDirectory | null;
  breadcrumbs: WorkspaceDirectory[];
  entries: WorkspaceEntry[];
  nextCursor: string | null;
  isLoadingNextPage: boolean;
  nextPageError: {
    code: string;
    message: string;
    requestId?: string;
  } | null;
  error: {
    code: string;
    message: string;
    requestId?: string;
  } | null;
  seenEntryIds: Set<string>;
  seenCursors: Set<string>;
}

export type ModelTrainingFetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ModelTrainingState {
  status: ModelTrainingFetchStatus;
  entryId: string | null;
  fileName: string | null;
  data: WorkspaceModelTraining | null;
  error: {
    code: string;
    message: string;
    requestId?: string;
    status?: number;
  } | null;
}
