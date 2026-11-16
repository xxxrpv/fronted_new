import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatBytes,
  formatDateTime,
  formatMeasurement,
} from '../lib/workspace/workspace-formatters';
import {
  parseWorkspaceError,
  validateAndMergeEntries,
} from '../lib/workspace/workspace-service';
import type {
  CapacityState,
  DirectoryState,
  WorkspaceCapacity,
  WorkspaceEntries,
  WorkspaceDirectory,
  WorkspaceDirectoryEntry,
  WorkspaceFileEntry,
} from '../lib/workspace/workspace-types';
import { CapacityCard } from '../components/workspace/CapacityCard';
import { BreadcrumbsNav } from '../components/workspace/BreadcrumbsNav';
import { DirectoryExplorer } from '../components/workspace/DirectoryExplorer';

// Mock IDs for deterministic unit tests (Clearly identified as Mock)
const mockWorkspaceId = 'ws-mock-00000000-0000-4000-8000-000000000001';
const mockRootId = '00000000-0000-4000-8000-000000000000';
const mockProjectId = '00000000-0000-4000-8000-000000000010';
const mockModuleId = '00000000-0000-4000-8000-000000000020';

describe('Task-020 Frontend: Workspace formatters and utilities', () => {
  test('formatBytes correctly formats null, 0, positive and signed negative values', () => {
    assert.equal(formatBytes(null), '-');
    assert.equal(formatBytes(undefined), '-');
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B (512 字节)');
    assert.equal(formatBytes(1048576), '1.00 MB (1,048,576 字节)');
    assert.equal(formatBytes(10737418240), '10.00 GB (10,737,418,240 字节)');

    // Overquota negative values must be preserved with sign
    const overquota = -52428800; // -50 MB
    const formattedOverquota = formatBytes(overquota);
    assert.ok(formattedOverquota.startsWith('-50.00 MB'));
    assert.ok(formattedOverquota.includes('-52,428,800 字节'));
  });

  test('formatDateTime handles null, invalid and valid RFC3339 timestamps in East-8', () => {
    assert.equal(formatDateTime(null), '-');
    assert.equal(formatDateTime(''), '-');
    assert.equal(formatDateTime('invalid-date'), 'invalid-date');
    const formatted = formatDateTime('2026-10-16T10:30:00Z');
    assert.equal(formatted, '2026-10-16 18:30:00');
  });

  test('formatMeasurement returns localized label for registered_artifacts and cloud_verified_assets', () => {
    assert.equal(formatMeasurement('registered_artifacts'), '已登记产物 (registered_artifacts)');
    assert.equal(formatMeasurement('cloud_verified_assets'), '云端已校验资产 (cloud_verified_assets)');
    assert.equal(formatMeasurement(undefined), '-');
  });
});

describe('Task-020 Frontend: Workspace error parsing & normalization', () => {
  test('parseWorkspaceError distinguishes 503 WORKSPACE_INITIALIZATION_PENDING vs 503 WORKSPACE_UNAVAILABLE', () => {
    const pendingErr = parseWorkspaceError(
      { error: { code: 'WORKSPACE_INITIALIZATION_PENDING', message: 'Binding in progress' } },
      503,
    );
    assert.equal(pendingErr.code, 'WORKSPACE_INITIALIZATION_PENDING');
    assert.equal(pendingErr.isInitializationPending, true);

    const unavailErr = parseWorkspaceError(
      { error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Upstream gateway down' } },
      503,
    );
    assert.equal(unavailErr.code, 'WORKSPACE_UNAVAILABLE');
    assert.equal(unavailErr.isInitializationPending, false);
  });

  test('parseWorkspaceError correctly captures requestId and preserves sanitized code', () => {
    const err = parseWorkspaceError({
      response: { status: 404 },
      error: {
        error: {
          code: 'WORKSPACE_DIRECTORY_NOT_FOUND',
          message: 'Directory does not exist',
          requestId: 'req-test-999',
        },
      },
    });

    assert.equal(err.code, 'WORKSPACE_DIRECTORY_NOT_FOUND');
    assert.equal(err.message, 'Directory does not exist');
    assert.equal(err.requestId, 'req-test-999');
    assert.equal(err.isInitializationPending, false);
  });
});

describe('Task-020 Frontend: Pagination merging, loop defense, and duplicate ID detection', () => {
  const rootDir: WorkspaceDirectory = { id: mockRootId, name: 'Root' };
  const mockEntriesPage1: WorkspaceEntries = {
    workspaceId: mockWorkspaceId,
    directory: rootDir,
    breadcrumbs: [rootDir],
    entries: [
      { id: 'entry-1', kind: 'directory', name: 'project-a', sizeBytes: null },
      { id: 'entry-2', kind: 'directory', name: 'project-b', sizeBytes: null },
    ],
    nextCursor: 'cursor-page-2',
  };

  test('initial page load succeeds and records seen IDs and cursors', () => {
    const result = validateAndMergeEntries(
      {
        expectedWorkspaceId: null,
        expectedDirectoryId: null,
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      mockEntriesPage1,
      false,
    );

    assert.equal(result.success, true);
    assert.equal(result.entries.length, 2);
    assert.equal(result.nextCursor, 'cursor-page-2');
    assert.ok(result.seenEntryIds.has('entry-1'));
    assert.ok(result.seenEntryIds.has('entry-2'));
    assert.ok(result.seenCursors.has('cursor-page-2'));
  });

  test('consecutive page append succeeds with new non-duplicate entries', () => {
    const mockEntriesPage2: WorkspaceEntries = {
      workspaceId: mockWorkspaceId,
      directory: rootDir,
      breadcrumbs: [rootDir],
      entries: [
        { id: 'entry-3', kind: 'directory', name: 'project-c', sizeBytes: null },
      ],
      nextCursor: null,
    };

    const initial = validateAndMergeEntries(
      {
        expectedWorkspaceId: null,
        expectedDirectoryId: null,
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      mockEntriesPage1,
      false,
    );

    const merged = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        currentEntries: initial.entries,
        seenEntryIds: initial.seenEntryIds,
        seenCursors: initial.seenCursors,
      },
      mockEntriesPage2,
      true,
    );

    assert.equal(merged.success, true);
    assert.equal(merged.entries.length, 3);
    assert.equal(merged.nextCursor, null);
    assert.equal(merged.entries[2].id, 'entry-3');
  });

  test('rejects page with mismatched workspace ID', () => {
    const badPage: WorkspaceEntries = {
      ...mockEntriesPage1,
      workspaceId: 'ws-foreign-workspace-id',
    };

    const result = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      badPage,
      true,
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('工作区身份不一致'));
  });

  test('rejects page with mismatched directory ID', () => {
    const badPage: WorkspaceEntries = {
      ...mockEntriesPage1,
      directory: { id: mockProjectId, name: 'Project A' },
    };

    const result = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      badPage,
      true,
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('目录上下文不一致'));
  });

  test('rejects page with mismatched directory name (F3)', () => {
    const badNamePage: WorkspaceEntries = {
      ...mockEntriesPage1,
      directory: { id: mockRootId, name: 'Different Root Name' },
    };

    const result = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        expectedDirectoryName: 'Root',
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      badNamePage,
      true,
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('目录名称上下文不一致'));
  });

  test('rejects page with mismatched breadcrumb length or hierarchy (F3)', () => {
    const badBreadcrumbsPage: WorkspaceEntries = {
      ...mockEntriesPage1,
      breadcrumbs: [rootDir, { id: mockProjectId, name: 'Project Alpha' }],
    };

    const result = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        expectedDirectoryName: 'Root',
        expectedBreadcrumbs: [rootDir],
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      badBreadcrumbsPage,
      true,
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('面包屑层级不一致'));
  });

  test('rejects page when breadcrumb name drifts (F3)', () => {
    const badCrumbNamePage: WorkspaceEntries = {
      ...mockEntriesPage1,
      breadcrumbs: [{ id: mockRootId, name: 'Renamed Root' }],
    };

    const result = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        expectedDirectoryName: 'Root',
        expectedBreadcrumbs: [rootDir],
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      badCrumbNamePage,
      true,
    );

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('面包屑溯源不一致'));
  });

  test('detects and rejects duplicate entry ID across pagination', () => {
    const duplicatePage: WorkspaceEntries = {
      workspaceId: mockWorkspaceId,
      directory: rootDir,
      breadcrumbs: [rootDir],
      entries: [
        { id: 'entry-1', kind: 'directory', name: 'project-a-replayed', sizeBytes: null },
      ],
      nextCursor: 'cursor-page-3',
    };

    const initial = validateAndMergeEntries(
      {
        expectedWorkspaceId: null,
        expectedDirectoryId: null,
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      mockEntriesPage1,
      false,
    );

    const merged = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        currentEntries: initial.entries,
        seenEntryIds: initial.seenEntryIds,
        seenCursors: initial.seenCursors,
      },
      duplicatePage,
      true,
    );

    assert.equal(merged.success, false);
    assert.ok(resultErrorHas(merged.error, '重复条目 ID'));
  });

  test('detects and rejects pagination cursor cycle', () => {
    const cyclicPage: WorkspaceEntries = {
      workspaceId: mockWorkspaceId,
      directory: rootDir,
      breadcrumbs: [rootDir],
      entries: [
        { id: 'entry-99', kind: 'directory', name: 'project-z', sizeBytes: null },
      ],
      nextCursor: 'cursor-page-2', // Already seen in Page 1!
    };

    const initial = validateAndMergeEntries(
      {
        expectedWorkspaceId: null,
        expectedDirectoryId: null,
        currentEntries: [],
        seenEntryIds: new Set(),
        seenCursors: new Set(),
      },
      mockEntriesPage1,
      false,
    );

    const merged = validateAndMergeEntries(
      {
        expectedWorkspaceId: mockWorkspaceId,
        expectedDirectoryId: mockRootId,
        currentEntries: initial.entries,
        seenEntryIds: initial.seenEntryIds,
        seenCursors: initial.seenCursors,
      },
      cyclicPage,
      true,
    );

    assert.equal(merged.success, false);
    assert.ok(resultErrorHas(merged.error, '分页游标循环'));
  });
});

describe('Task-020 Frontend: Component rendering with mock fixtures', () => {
  test('CapacityCard renders loading skeleton when status is loading', () => {
    const state: CapacityState = { status: 'loading', data: null, error: null };
    const html = renderToStaticMarkup(React.createElement(CapacityCard, { state, onRefresh: () => {} }));
    assert.ok(html.includes('data-testid="capacity-loading-skeleton"'));
    assert.ok(html.includes('正在查询...'));
  });

  test('CapacityCard renders initialization pending state with retry button', () => {
    const state: CapacityState = {
      status: 'initialization_pending',
      data: null,
      error: { code: 'WORKSPACE_INITIALIZATION_PENDING', message: 'Init pending', requestId: 'req-init-1' },
    };
    const html = renderToStaticMarkup(React.createElement(CapacityCard, { state, onRefresh: () => {} }));
    assert.ok(html.includes('工作区初始化中 (503 WORKSPACE_INITIALIZATION_PENDING)'));
    assert.ok(html.includes('req-init-1'));
    assert.ok(html.includes('重新尝试检查'));
  });

  test('CapacityCard renders error state truthfully without faking 0 bytes', () => {
    const state: CapacityState = {
      status: 'error',
      data: null,
      error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Storage backend down', requestId: 'req-err-1' },
    };
    const html = renderToStaticMarkup(React.createElement(CapacityCard, { state, onRefresh: () => {} }));
    assert.ok(html.includes('无法读取存储容量 (WORKSPACE_UNAVAILABLE)'));
    assert.ok(html.includes('Storage backend down'));
    assert.ok(!html.includes('0 B')); // Does NOT fake 0 bytes
  });

  test('CapacityCard renders configured quota, reservedBytes separation and overquota warning in 0.2', () => {
    const data: WorkspaceCapacity = {
      workspaceId: mockWorkspaceId,
      quotaBytes: 104857600, // 100 MB
      usedBytes: 83886080, // 80 MB
      reservedBytes: 31457280, // 30 MB (80+30 = 110 MB > 100 MB, overquota!)
      remainingBytes: 0, // Clamped to 0 in 0.2
      measurement: 'cloud_verified_assets',
    };
    const state: CapacityState = { status: 'success', data, error: null };
    const html = renderToStaticMarkup(React.createElement(CapacityCard, { state, onRefresh: () => {} }));

    assert.ok(html.includes(mockWorkspaceId));
    assert.ok(html.includes('已超出配额限额'));
    assert.ok(html.includes('已用存储空间'));
    assert.ok(html.includes('80.00 MB'));
    assert.ok(html.includes('预占保留空间'));
    assert.ok(html.includes('30.00 MB'));
    assert.ok(html.includes('已超出限额 (可用 0 B)'));
    assert.ok(html.includes('云端已校验资产 (cloud_verified_assets)'));
  });

  test('BreadcrumbsNav renders clickable ancestor links and static current crumb', () => {
    const breadcrumbs: WorkspaceDirectory[] = [
      { id: mockRootId, name: 'Root' },
      { id: mockProjectId, name: 'Project X' },
      { id: mockModuleId, name: 'Module Y' },
    ];
    const html = renderToStaticMarkup(
      React.createElement(BreadcrumbsNav, {
        breadcrumbs,
        currentDirectory: breadcrumbs[2],
        onNavigate: () => {},
      }),
    );

    // Ancestor buttons
    assert.ok(html.includes('返回至 Root'));
    assert.ok(html.includes('返回至 Project X'));
    // Current directory is not a button
    assert.ok(html.includes('aria-current="location"'));
    assert.ok(html.includes('Module Y'));
  });

  test('DirectoryExplorer renders real empty directory state', () => {
    const state: DirectoryState = {
      status: 'empty',
      workspaceId: mockWorkspaceId,
      directory: { id: mockRootId, name: 'Root' },
      breadcrumbs: [{ id: mockRootId, name: 'Root' }],
      entries: [],
      nextCursor: null,
      isLoadingNextPage: false,
      nextPageError: null,
      error: null,
      seenEntryIds: new Set(),
      seenCursors: new Set(),
    };

    const html = renderToStaticMarkup(
      React.createElement(DirectoryExplorer, {
        state,
        limit: 50,
        onLimitChange: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
        onLoadNextPage: () => {},
      }),
    );

    assert.ok(html.includes('该目录下暂无任何条目'));
  });

  test('DirectoryExplorer renders entries table, distinguishes directories and files, and renders next page button', () => {
    const dirEntry: WorkspaceDirectoryEntry = {
      id: mockProjectId,
      kind: 'directory',
      name: 'robot-arm-project',
      sizeBytes: null,
    };
    const fileEntry: WorkspaceFileEntry = {
      id: '00000000-0000-4000-8000-000000000099',
      kind: 'file',
      name: 'model.urdf',
      sizeBytes: 204800,
      generatedAt: '2026-10-16T08:00:00Z',
      registeredAt: '2026-10-16T09:00:00Z',
    };

    const state: DirectoryState = {
      status: 'success',
      workspaceId: mockWorkspaceId,
      directory: { id: mockRootId, name: 'Root' },
      breadcrumbs: [{ id: mockRootId, name: 'Root' }],
      entries: [dirEntry, fileEntry],
      nextCursor: 'cursor-has-more-123',
      isLoadingNextPage: false,
      nextPageError: null,
      error: null,
      seenEntryIds: new Set([dirEntry.id, fileEntry.id]),
      seenCursors: new Set(['cursor-has-more-123']),
    };

    const html = renderToStaticMarkup(
      React.createElement(DirectoryExplorer, {
        state,
        limit: 50,
        onLimitChange: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
        onLoadNextPage: () => {},
      }),
    );

    // Directory row
    assert.ok(html.includes('进入目录 robot-arm-project'));
    assert.ok(html.includes('目录'));
    assert.ok(html.includes(mockProjectId));

    // File row
    assert.ok(html.includes('model.urdf'));
    assert.ok(html.includes('文件'));
    assert.ok(html.includes('200.00 KB'));

    // Next page button
    assert.ok(html.includes('加载下一页'));
  });

  test('DirectoryExplorer keeps existing entries and shows retry button when next-page fails', () => {
    const fileEntry: WorkspaceFileEntry = {
      id: '00000000-0000-4000-8000-000000000099',
      kind: 'file',
      name: 'model.urdf',
      sizeBytes: 204800,
      generatedAt: null,
      registeredAt: '2026-10-16T09:00:00Z',
    };

    const state: DirectoryState = {
      status: 'success',
      workspaceId: mockWorkspaceId,
      directory: { id: mockRootId, name: 'Root' },
      breadcrumbs: [{ id: mockRootId, name: 'Root' }],
      entries: [fileEntry],
      nextCursor: 'cursor-retry-123',
      isLoadingNextPage: false,
      nextPageError: {
        code: 'WORKSPACE_UNAVAILABLE',
        message: 'Network timed out while fetching next page',
      },
      error: null,
      seenEntryIds: new Set([fileEntry.id]),
      seenCursors: new Set(['cursor-retry-123']),
    };

    const html = renderToStaticMarkup(
      React.createElement(DirectoryExplorer, {
        state,
        limit: 50,
        onLimitChange: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
        onLoadNextPage: () => {},
      }),
    );

    // Existing entry is still rendered!
    assert.ok(html.includes('model.urdf'));
    // Error message and retry button
    assert.ok(html.includes('下一页加载失败: Network timed out while fetching next page'));
    assert.ok(html.includes('重试加载下一页'));
  });

  test('DirectoryExplorer renders both 生成时间 and 登记时间 columns, displaying - (未提供) when generatedAt is null (F5)', () => {
    const fileWithGen: WorkspaceFileEntry = {
      id: '00000000-0000-4000-8000-000000000088',
      kind: 'file',
      name: 'weights.bin',
      sizeBytes: 1048576,
      generatedAt: '2026-10-16T10:00:00Z',
      registeredAt: '2026-10-16T10:05:00Z',
    };
    const fileWithoutGen: WorkspaceFileEntry = {
      id: '00000000-0000-4000-8000-000000000089',
      kind: 'file',
      name: 'config.json',
      sizeBytes: 2048,
      generatedAt: null,
      registeredAt: '2026-10-16T10:06:00Z',
    };

    const state: DirectoryState = {
      status: 'success',
      workspaceId: mockWorkspaceId,
      directory: { id: mockRootId, name: 'Root' },
      breadcrumbs: [{ id: mockRootId, name: 'Root' }],
      entries: [fileWithGen, fileWithoutGen],
      nextCursor: null,
      isLoadingNextPage: false,
      nextPageError: null,
      error: null,
      seenEntryIds: new Set([fileWithGen.id, fileWithoutGen.id]),
      seenCursors: new Set(),
    };

    const html = renderToStaticMarkup(
      React.createElement(DirectoryExplorer, {
        state,
        limit: 50,
        onLimitChange: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
        onLoadNextPage: () => {},
      }),
    );

    // Verify both headers exist
    assert.ok(html.includes('生成时间'));
    assert.ok(html.includes('登记时间'));

    // Verify generatedAt rendered format (East-8 without suffix)
    assert.ok(html.includes('2026-10-16 18:00:00'));
    // Verify null generatedAt displays - (未提供)
    assert.ok(html.includes('- (未提供)'));
    // Verify registeredAt rendered (East-8 without suffix)
    assert.ok(html.includes('2026-10-16 18:05:00'));
    assert.ok(html.includes('2026-10-16 18:06:00'));
  });

  test('DirectoryExplorer renders 未知 for file with null sizeBytes in 0.2 without faking 0 B', () => {
    const fileWithNullSize: WorkspaceFileEntry = {
      id: '00000000-0000-4000-8000-000000000077',
      kind: 'file',
      name: 'unverified.bin',
      sizeBytes: null,
      fileStatus: 'pending_upload',
      generatedAt: null,
      registeredAt: null,
    };

    const state: DirectoryState = {
      status: 'success',
      workspaceId: mockWorkspaceId,
      directory: { id: mockRootId, name: 'Root' },
      breadcrumbs: [{ id: mockRootId, name: 'Root' }],
      entries: [fileWithNullSize],
      nextCursor: null,
      isLoadingNextPage: false,
      nextPageError: null,
      error: null,
      seenEntryIds: new Set([fileWithNullSize.id]),
      seenCursors: new Set(),
    };

    const html = renderToStaticMarkup(
      React.createElement(DirectoryExplorer, {
        state,
        limit: 50,
        onLimitChange: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
        onLoadNextPage: () => {},
      }),
    );

    assert.ok(html.includes('unverified.bin'));
    assert.ok(html.includes('未知'));
    assert.ok(!html.includes('0 B'));
  });
});

function resultErrorHas(err: string | undefined, sub: string): boolean {
  return typeof err === 'string' && err.includes(sub);
}
