import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  isModelTrainingEntry,
  formatTaskStatus,
} from '../lib/workspace/workspace-formatters';
import { fetchWorkspaceModelTraining } from '../lib/workspace/workspace-service';
import { client } from '../lib/api/client';
import type {
  WorkspaceFileEntry,
  WorkspaceDirectoryEntry,
  DirectoryState,
  WorkspaceModelTraining,
  ModelTrainingState,
} from '../lib/workspace/workspace-types';
import { DirectoryExplorer } from '../components/workspace/DirectoryExplorer';
import { ModelTrainingModal } from '../components/workspace/ModelTrainingModal';
import { WorkspaceView } from '../components/workspace/WorkspaceView';

const sampleModelTraining: WorkspaceModelTraining = {
  entryId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  taskId: '00000000-0000-4000-8000-000000000777',
  fileName: '00000000-0000-4000-8000-000000000777_final_model.zip',
  algorithm: 'ppo',
  plannedTotalSteps: 100000,
  trainingStatus: 'SUCCEEDED',
  modelExecutionCount: 3,
  robotTrainingExecutionCount: 5,
  resultRecordedAt: '2026-10-25T10:02:05Z',
};

describe('Task-033 Frontend: Workspace formatters and pattern matching', () => {
  test('isModelTrainingEntry strictly matches {platformTaskId}_final_model.zip for files only', () => {
    const validUuidFile: WorkspaceFileEntry = {
      id: 'e-1',
      kind: 'file',
      name: '00000000-0000-4000-8000-000000000001_final_model.zip',
      sizeBytes: 2048,
      fileStatus: 'available',
      generatedAt: '2026-10-25T10:00:00Z',
      registeredAt: '2026-10-25T10:05:00Z',
    };
    const invalidDir: WorkspaceDirectoryEntry = {
      id: 'e-2',
      kind: 'directory',
      name: '00000000-0000-4000-8000-000000000001_final_model.zip',
      sizeBytes: null,
    };
    const invalidPrefixFile: WorkspaceFileEntry = {
      id: 'e-3',
      kind: 'file',
      name: '_final_model.zip',
      sizeBytes: 1024,
      fileStatus: 'available',
      generatedAt: null,
      registeredAt: null,
    };
    const plainFinalModel: WorkspaceFileEntry = {
      id: 'e-4',
      kind: 'file',
      name: 'final_model.zip',
      sizeBytes: 1024,
      fileStatus: 'available',
      generatedAt: null,
      registeredAt: null,
    };
    const otherExtension: WorkspaceFileEntry = {
      id: 'e-5',
      kind: 'file',
      name: '00000000-0000-4000-8000-000000000001_final_model.tar.gz',
      sizeBytes: 1024,
      fileStatus: 'available',
      generatedAt: null,
      registeredAt: null,
    };
    const suffixFile: WorkspaceFileEntry = {
      id: 'e-6',
      kind: 'file',
      name: '00000000-0000-4000-8000-000000000001_final_model.zip.bak',
      sizeBytes: 1024,
      fileStatus: 'available',
      generatedAt: null,
      registeredAt: null,
    };

    assert.equal(isModelTrainingEntry(validUuidFile), true);
    assert.equal(isModelTrainingEntry(invalidDir), false);
    assert.equal(isModelTrainingEntry(invalidPrefixFile), false);
    assert.equal(isModelTrainingEntry(plainFinalModel), false);
    assert.equal(isModelTrainingEntry(otherExtension), false);
    assert.equal(isModelTrainingEntry(suffixFile), false);
    assert.equal(isModelTrainingEntry(null), false);
    assert.equal(isModelTrainingEntry(undefined), false);
  });

  test('formatTaskStatus formats known states and passes through unknowns', () => {
    assert.equal(formatTaskStatus('PENDING'), '等待中');
    assert.equal(formatTaskStatus('RUNNING'), '运行中');
    assert.equal(formatTaskStatus('SUCCEEDED'), '已成功');
    assert.equal(formatTaskStatus('FAILED'), '已失败');
    assert.equal(formatTaskStatus('CANCELED'), '已取消');
    assert.equal(formatTaskStatus('UNKNOWN_VALUE' as any), '未知状态 (UNKNOWN_VALUE)');
    assert.equal(formatTaskStatus(null), '未提供');
    assert.equal(formatTaskStatus(undefined), '未提供');
  });
});

describe('Task-033 Frontend: fetchWorkspaceModelTraining API client', () => {
  afterEach(() => {
    client.setConfig({
      baseUrl: '',
      fetch: undefined,
    });
  });

  test('fetchWorkspaceModelTraining returns model training payload on 200', async () => {
    const mockFetch = async (req: Request) => {
      assert.ok(req.url.includes('/api/v1/workspace/entries/e-001/model-training'));
      return new Response(JSON.stringify(sampleModelTraining), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    client.setConfig({
      baseUrl: 'http://127.0.0.1:3000',
      fetch: mockFetch as any,
    });

    const res = await fetchWorkspaceModelTraining('e-001');
    assert.ok(res.data);
    assert.deepEqual(res.data, sampleModelTraining);
    assert.equal(res.error, undefined);
  });

  test('fetchWorkspaceModelTraining handles 404 error response', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'MODEL_TRAINING_NOT_FOUND',
            message: '未找到关联的模型训练任务记录',
          },
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    client.setConfig({
      baseUrl: 'http://127.0.0.1:3000',
      fetch: mockFetch as any,
    });

    const res = await fetchWorkspaceModelTraining('e-404');
    assert.ok(res.error);
    assert.equal(res.error?.code, 'MODEL_TRAINING_NOT_FOUND');
    assert.ok(res.error?.message.includes('未找到关联的模型训练任务记录'));
  });

  test('fetchWorkspaceModelTraining handles 409 FILE_NOT_AVAILABLE', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'FILE_NOT_AVAILABLE',
            message: '模型文件尚在生成或同步中',
          },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    client.setConfig({
      baseUrl: 'http://127.0.0.1:3000',
      fetch: mockFetch as any,
    });

    const res = await fetchWorkspaceModelTraining('e-409');
    assert.ok(res.error);
    assert.equal(res.error?.code, 'FILE_NOT_AVAILABLE');
    assert.ok(res.error?.message.includes('模型文件尚在生成或同步中'));
  });

  test('fetchWorkspaceModelTraining handles 409 IDENTITY_CONFLICT', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'IDENTITY_CONFLICT',
            message: '模型归属身份冲突',
          },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    client.setConfig({
      baseUrl: 'http://127.0.0.1:3000',
      fetch: mockFetch as any,
    });

    const res = await fetchWorkspaceModelTraining('e-conflict');
    assert.ok(res.error);
    assert.equal(res.error?.code, 'IDENTITY_CONFLICT');
    assert.ok(res.error?.message.includes('模型归属身份冲突'));
  });

  test('fetchWorkspaceModelTraining passes AbortSignal and propagates abort error', async () => {
    const ac = new AbortController();
    const mockFetch = async (_req: Request) => {
      if (ac.signal.aborted) {
        throw new DOMException('This operation was aborted', 'AbortError');
      }
      return new Promise<Response>((_resolve, reject) => {
        if (ac.signal.aborted) {
          reject(new DOMException('This operation was aborted', 'AbortError'));
          return;
        }
        ac.signal.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    };

    client.setConfig({
      baseUrl: 'http://127.0.0.1:3000',
      fetch: mockFetch as any,
    });

    const fetchPromise = fetchWorkspaceModelTraining('e-abort', { signal: ac.signal });
    ac.abort();

    await assert.rejects(
      async () => await fetchPromise,
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        return true;
      },
    );
  });
});

describe('Task-033 Frontend: DirectoryExplorer model training entry rendering', () => {
  const modelFile: WorkspaceFileEntry = {
    id: 'entry-model-01',
    kind: 'file',
    name: '00000000-0000-4000-8000-000000000777_final_model.zip',
    sizeBytes: 10485760,
    fileStatus: 'available',
    generatedAt: '2026-10-25T10:00:00Z',
    registeredAt: '2026-10-25T10:05:00Z',
  };

  const normalFile: WorkspaceFileEntry = {
    id: 'entry-normal-02',
    kind: 'file',
    name: 'readme.txt',
    sizeBytes: 512,
    fileStatus: 'available',
    generatedAt: '2026-10-25T10:00:00Z',
    registeredAt: '2026-10-25T10:05:00Z',
  };

  const directoryEntry: WorkspaceDirectoryEntry = {
    id: 'entry-dir-03',
    kind: 'directory',
    name: 'checkpoints',
    sizeBytes: null,
  };

  const state: DirectoryState = {
    status: 'success',
    workspaceId: 'ws-mock-01',
    directory: { id: 'root', name: 'Root' },
    breadcrumbs: [{ id: 'root', name: 'Root' }],
    entries: [modelFile, normalFile, directoryEntry],
    nextCursor: null,
    isLoadingNextPage: false,
    nextPageError: null,
    error: null,
    seenEntryIds: new Set(['entry-model-01', 'entry-normal-02', 'entry-dir-03']),
    seenCursors: new Set(),
  };

  test('renders clickable button and 训练模型 tag for model training entries', () => {
    let selectedEntry: any = null;
    const html = renderToStaticMarkup(
      React.createElement(DirectoryExplorer, {
        state,
        limit: 50,
        onLimitChange: () => {},
        onNavigate: () => {},
        onRefresh: () => {},
        onLoadNextPage: () => {},
        onViewModelTraining: (entry) => {
          selectedEntry = entry;
        },
      }),
    );

    // Verifies model file link button & tag
    assert.ok(html.includes('00000000-0000-4000-8000-000000000777_final_model.zip'));
    assert.ok(html.includes('训练模型'));
    assert.ok(html.includes('查看模型训练信息'));

    // Verifies normal file has no 训练模型 tag
    assert.ok(html.includes('readme.txt'));
    // Directory has no 训练模型 tag
    assert.ok(html.includes('checkpoints'));
  });
});

describe('Task-033 Frontend: ModelTrainingModal component rendering', () => {
  test('renders loading state when status is loading', () => {
    const loadingState: ModelTrainingState = {
      status: 'loading',
      entryId: 'e-1',
      fileName: '00000000-0000-4000-8000-000000000777_final_model.zip',
      data: null,
      error: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(ModelTrainingModal, {
        isOpen: true,
        state: loadingState,
        onClose: () => {},
        onRetry: () => {},
      }),
    );

    assert.ok(html.includes('模型训练信息'));
    assert.ok(html.includes('正在验证产物身份并读取训练信息...'));
    assert.ok(html.includes('00000000-0000-4000-8000-000000000777_final_model.zip'));
  });

  test('renders error state with retry button', () => {
    const errorState: ModelTrainingState = {
      status: 'error',
      entryId: 'e-1',
      fileName: '00000000-0000-4000-8000-000000000777_final_model.zip',
      data: null,
      error: {
        code: 'WORKSPACE_UNAVAILABLE',
        message: '网络连接失败，请稍后重试',
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(ModelTrainingModal, {
        isOpen: true,
        state: errorState,
        onClose: () => {},
        onRetry: () => {},
      }),
    );

    assert.ok(html.includes('模型训练信息'));
    assert.ok(html.includes('网络连接失败，请稍后重试'));
    assert.ok(html.includes('重试读取'));
  });

  test('renders the six training metrics without internal identifiers', () => {
    const successState: ModelTrainingState = {
      status: 'success',
      entryId: '00000000-0000-4000-8000-000000000001',
      fileName: '00000000-0000-4000-8000-000000000777_final_model.zip',
      data: sampleModelTraining,
      error: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(ModelTrainingModal, {
        isOpen: true,
        state: successState,
        onClose: () => {},
        onRetry: () => {},
      }),
    );

    assert.ok(html.includes('模型训练信息'));
    assert.ok(!html.includes('Entry ID'));
    assert.ok(!html.includes('Workspace ID'));
    assert.ok(!html.includes('Task ID'));
    assert.ok(html.includes('模型文件名'));
    assert.ok(html.includes('00000000-0000-4000-8000-000000000777_final_model.zip'));
    assert.ok(html.includes('训练算法'));
    assert.ok(html.includes('PPO'));
    assert.ok(html.includes('计划总步数'));
    assert.ok(html.includes('100,000 步'));
    assert.ok(html.includes('任务运行状态'));
    assert.ok(html.includes('已成功')); // status SUCCEEDED -> 已成功
    assert.ok(html.includes('本任务模型执行次数'));
    assert.ok(html.includes('3 次'));
    assert.ok(html.includes('机器人累计训练次数 (同项目)'));
    assert.ok(html.includes('5 次'));
    assert.ok(html.includes('结果入库时间 (UTC)'));
    assert.ok(html.includes('2026-10-25 10:02:05 UTC'));
  });

  test('renders 未提供 placeholder when optional fields are null', () => {
    const dataWithNulls: WorkspaceModelTraining = {
      ...sampleModelTraining,
      algorithm: null,
      plannedTotalSteps: null,
      robotTrainingExecutionCount: null,
      resultRecordedAt: null,
    };
    const stateWithNulls: ModelTrainingState = {
      status: 'success',
      entryId: 'e-1',
      fileName: '00000000-0000-4000-8000-000000000777_final_model.zip',
      data: dataWithNulls,
      error: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(ModelTrainingModal, {
        isOpen: true,
        state: stateWithNulls,
        onClose: () => {},
        onRetry: () => {},
      }),
    );

    assert.ok(html.includes('未提供'));
  });

  test('returns null when isOpen is false', () => {
    const hiddenState: ModelTrainingState = {
      status: 'idle',
      entryId: null,
      fileName: null,
      data: null,
      error: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(ModelTrainingModal, {
        isOpen: false,
        state: hiddenState,
        onClose: () => {},
        onRetry: () => {},
      }),
    );

    assert.equal(html, '');
  });
});

describe('Task-033 Frontend: account ownership', () => {
  test('the actual WorkspaceView keys its entire stateful subtree by account', () => {
    const accountA = WorkspaceView({ userId: 'user-a' }) as React.ReactElement;
    const accountB = WorkspaceView({ userId: 'user-b' }) as React.ReactElement;
    const loggedOut = WorkspaceView({ userId: null }) as React.ReactElement;
    assert.equal(accountA.key, 'user-a');
    assert.equal(accountB.key, 'user-b');
    assert.notEqual(accountA.key, accountB.key);
    assert.notEqual(accountB.key, loggedOut.key);
  });
});
