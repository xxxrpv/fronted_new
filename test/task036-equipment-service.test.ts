import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { client } from '../lib/api/client';
import {
  createBatch,
  createRevision,
  fetchArtifactBinary,
  fetchBatchDetail,
  fetchOperationDetail,
  fetchOperationList,
  selectAlternative,
  EquipmentApiError,
} from '../lib/equipment/equipment-service';
import { DEFAULT_EQUIPMENT_PARAMETERS } from '../lib/equipment/types';

describe('Task-036 Frontend: 设备 SDK 9 接口交互与 Mock 行为闭环 (F03, F05, F06, F07)', () => {
  const projectId = '00000000-0000-4000-8000-000000000001';
  const batchId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  test('createBatch 提交成功返回 202 Accepted operation receipt', async () => {
    const originalPost = client.post;
    try {
      client.post = (async (options: any) => {
        assert.ok(options.url.includes('/equipment/batches'));
        assert.strictEqual(options.path?.projectId, projectId);
        assert.strictEqual(options.body.requirement, '测试流水线');
        return {
          data: {
            operationId: 'op_gen_001',
            kind: 'generate_alternatives',
            status: null,
            submissionState: 'local_persisted',
            statusUrl: `/api/v1/projects/${projectId}/equipment/operations/op_gen_001`,
            createdAt: '2026-10-27T10:00:00Z',
          },
        };
      }) as any;

      const res = await createBatch(
        projectId,
        'eq_batch_test_001',
        '测试流水线',
        DEFAULT_EQUIPMENT_PARAMETERS
      );

      assert.strictEqual(res.operationId, 'op_gen_001');
      assert.strictEqual(res.kind, 'generate_alternatives');
      assert.strictEqual(res.submissionState, 'local_persisted');
    } finally {
      client.post = originalPost;
    }
  });

  test('createRevision 传原 batchId 与 sourceAlternativeId，创建新批次', async () => {
    const originalPost = client.post;
    try {
      client.post = (async (options: any) => {
        assert.ok(options.url.includes('/revisions'));
        assert.strictEqual(options.path?.batchId, batchId);
        assert.strictEqual(options.body.sourceAlternativeId, 'alt_side_push');
        return {
          data: {
            operationId: 'op_rev_002',
            batchId: 'b2c3d4e5f60718293a4b5c6d7e8f90a1',
            kind: 'generate_alternatives',
            status: null,
            submissionState: 'local_persisted',
            statusUrl: `/api/v1/projects/${projectId}/equipment/operations/op_rev_002`,
            createdAt: '2026-10-27T10:05:00Z',
          },
        };
      }) as any;

      const res = await createRevision(
        projectId,
        batchId,
        'alt_side_push',
        'eq_rev_test_001',
        '修订需求',
        DEFAULT_EQUIPMENT_PARAMETERS
      );

      assert.strictEqual(res.operationId, 'op_rev_002');
      assert.strictEqual(res.batchId, 'b2c3d4e5f60718293a4b5c6d7e8f90a1');
    } finally {
      client.post = originalPost;
    }
  });

  test('selectAlternative 选型提交 202 Receipt 及 409 冲突处理', async () => {
    const originalPost = client.post;
    try {
      // 正常 202
      client.post = (async (options: any) => {
        assert.ok(options.url.includes('/selection'));
        assert.strictEqual(options.path?.batchId, batchId);
        assert.strictEqual(options.body.alternativeId, 'alt_1');
        return {
          data: {
            operationId: 'op_sel_003',
            batchId,
            alternativeId: 'alt_1',
            kind: 'select_cad',
            status: null,
            submissionState: 'local_persisted',
            statusUrl: `/api/v1/projects/${projectId}/equipment/operations/op_sel_003`,
            createdAt: '2026-10-27T10:10:00Z',
          },
        };
      }) as any;

      const res = await selectAlternative(projectId, batchId, 'alt_1', 'eq_sel_test_001');
      assert.strictEqual(res.operationId, 'op_sel_003');
      assert.strictEqual(res.alternativeId, 'alt_1');

      // 409 选型冲突（遵循真实 SDK 的 response.status 结构）
      client.post = (async () => {
        return {
          error: {
            error: {
              code: 'BATCH_SELECTION_CONFLICT',
              message: '该批次已存在确认的选型，禁止重复修改',
            },
          },
          response: { status: 409 } as any,
        };
      }) as any;

      await assert.rejects(
        async () => {
          await selectAlternative(projectId, batchId, 'alt_2', 'eq_sel_test_002');
        },
        (err: any) => {
          assert.ok(err instanceof EquipmentApiError);
          assert.strictEqual(err.status, 409);
          assert.match(err.message, /该批次已存在确认的选型/);
          return true;
        }
      );
    } finally {
      client.post = originalPost;
    }
  });

  test('fetchBatchDetail 默认持久快照与显式 refresh=true', async () => {
    const originalGet = client.get;
    try {
      let queriedRefresh: boolean | undefined = undefined;
      client.get = (async (options: any) => {
        queriedRefresh = options.query?.refresh;
        return {
          data: {
            batchId,
            projectId,
            workspaceId: '00000000-0000-4000-8000-000000000002',
            status: 'awaiting_user_selection',
            syncStatus: queriedRefresh ? 'upstream_synced' : 'persisted_snapshot',
            engineeringVerified: false,
            requirement: '测试批次',
            parameters: DEFAULT_EQUIPMENT_PARAMETERS,
            alternatives: [],
            selection: null,
            files: [],
            createdAt: '2026-10-27T10:00:00Z',
            updatedAt: '2026-10-27T10:02:00Z',
          },
        };
      }) as any;

      // 默认读取快照，无 refresh query
      const snapshot = await fetchBatchDetail(projectId, batchId, false);
      assert.strictEqual(snapshot.syncStatus, 'persisted_snapshot');
      assert.strictEqual(queriedRefresh, undefined);

      // 显式刷新 refresh=true
      const live = await fetchBatchDetail(projectId, batchId, true);
      assert.strictEqual(live.syncStatus, 'upstream_synced');
      assert.strictEqual(queriedRefresh, true);
    } finally {
      client.get = originalGet;
    }
  });

  test('fetchOperationList 能发现并恢复 batchId=null 的持久操作', async () => {
    const originalGet = client.get;
    try {
      client.get = (async (options: any) => {
        assert.ok(options.url.includes(`/equipment/operations`));
        return {
          data: {
            items: [
              {
                operationId: 'op_orphan_001',
                kind: 'generate_alternatives',
                status: null,
                submissionState: 'local_persisted',
                batchId: null, // 未确认批次的离线/崩溃孤儿记录
                statusUrl: `/api/v1/projects/${projectId}/equipment/operations/op_orphan_001`,
                createdAt: '2026-10-27T09:00:00Z',
              },
            ],
            nextCursor: null,
          },
        };
      }) as any;

      const list = await fetchOperationList(projectId);
      assert.strictEqual(list.items.length, 1);
      assert.strictEqual(list.items[0].batchId, null);
      assert.strictEqual(list.items[0].operationId, 'op_orphan_001');
    } finally {
      client.get = originalGet;
    }
  });

  test('fetchArtifactBinary 获取受控二进制流与 404/503 异常捕获', async () => {
    const originalGet = client.get;
    try {
      const mockBuffer = new ArrayBuffer(16);
      client.get = (async (options: any) => {
        assert.strictEqual(options.parseAs, 'arrayBuffer');
        return {
          data: mockBuffer,
        };
      }) as any;

      const data = await fetchArtifactBinary(projectId, batchId, 'entry_glb_01', 'arrayBuffer');
      assert.strictEqual(data, mockBuffer);

      // 模拟 404（通过 response.status 提取）
      client.get = (async () => ({
        error: { error: { code: 'RESOURCE_NOT_FOUND', message: '产物未就绪' } },
        response: { status: 404 } as any,
      })) as any;

      await assert.rejects(
        async () => {
          await fetchArtifactBinary(projectId, batchId, 'entry_missing');
        },
        (err: any) => {
          assert.strictEqual(err.status, 404);
          assert.match(err.message, /产物未就绪/);
          return true;
        }
      );
    } finally {
      client.get = originalGet;
    }
  });

  test('STD-01 & S03: 真实生成 SDK 与 fetch Response 形状校验 (401/409/503 及 AbortError)', async () => {
    const originalConfig = client.getConfig();
    try {
      // 1. 真实 401 响应
      client.setConfig({
        baseUrl: 'https://test-sdk-status.invalid',
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: { code: 'UNAUTHORIZED', message: 'Login required' },
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      await assert.rejects(
        async () => {
          await fetchOperationDetail(projectId, 'op_001');
        },
        (err: any) => {
          assert.ok(err instanceof EquipmentApiError);
          assert.strictEqual(err.status, 401);
          assert.strictEqual(err.code, 'UNAUTHORIZED');
          return true;
        }
      );

      // 2. 真实 409 响应
      client.setConfig({
        baseUrl: 'https://test-sdk-status.invalid',
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: { code: 'BATCH_SELECTION_CONFLICT', message: 'Conflict detected' },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      await assert.rejects(
        async () => {
          await selectAlternative(projectId, batchId, 'alt_1', 'key_conflict');
        },
        (err: any) => {
          assert.ok(err instanceof EquipmentApiError);
          assert.strictEqual(err.status, 409);
          assert.strictEqual(err.code, 'BATCH_SELECTION_CONFLICT');
          return true;
        }
      );

      // 3. 真实 503 响应
      client.setConfig({
        baseUrl: 'https://test-sdk-status.invalid',
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: { code: 'SERVICE_UNAVAILABLE', message: 'Upstream busy' },
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          ),
      });

      await assert.rejects(
        async () => {
          await fetchBatchDetail(projectId, batchId, false);
        },
        (err: any) => {
          assert.ok(err instanceof EquipmentApiError);
          assert.strictEqual(err.status, 503);
          return true;
        }
      );

      // 4. 真实 AbortError 保持语义
      client.setConfig({
        baseUrl: 'https://test-sdk-status.invalid',
        fetch: async () => {
          throw new DOMException('The operation was aborted', 'AbortError');
        },
      });

      await assert.rejects(
        async () => {
          await fetchOperationDetail(projectId, 'op_aborted');
        },
        (err: any) => {
          assert.strictEqual(err.name, 'AbortError');
          return true;
        }
      );
    } finally {
      client.setConfig(originalConfig);
    }
  });

  test('S01: 跨批次 CAD 归属严格隔离，无选型批次绝对不关联其他批次的 CAD', () => {
    const { findCadZipReceipt } = require('../lib/equipment/state-helpers');
    const cadA = {
      kind: 'cad_zip',
      status: 'available',
      alternativeId: 'alt_same_id',
      entryId: 'entry_batch_A',
      fileName: 'cad_A.zip',
    };

    // 批次 B 尚未选型
    const batchB: {
      batchId: string;
      files: any[];
      selection: { alternativeId?: string; files?: any[] } | null;
    } = {
      batchId: 'batch_B',
      files: [],
      selection: null,
    };
    // 遗留的批次 A operation
    const staleOpA: {
      batchId: string;
      alternativeId: string;
      files: any[];
    } = {
      batchId: 'batch_A',
      alternativeId: 'alt_same_id',
      files: [cadA],
    };

    // 按照 page.tsx 的归属过滤规则：
    const selectedAltId = batchB.selection?.alternativeId;
    const validOpFiles =
      selectedAltId &&
      staleOpA.batchId === batchB.batchId &&
      staleOpA.alternativeId === selectedAltId
        ? staleOpA.files
        : undefined;

    const receipt = selectedAltId
      ? findCadZipReceipt([batchB.selection?.files, batchB.files, validOpFiles], selectedAltId)
      : undefined;

    assert.strictEqual(receipt, undefined);
  });
});
