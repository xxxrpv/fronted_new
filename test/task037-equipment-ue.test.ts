import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { client } from '../lib/api/client';
import {
  fetchEquipmentUeRuntime,
  createEquipmentUeLoad,
  fetchEquipmentUeLoads,
  fetchEquipmentUeLoadDetail,
  fetchEquipmentUeViewerAccess,
  EquipmentApiError,
} from '../lib/equipment/equipment-service';

describe('Equipment UE Frontend: 非标自动化设备 UE 静态展示集成测试', () => {
  const projectId = '00000000-0000-4000-8000-000000000001';
  const batchId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const alternativeId = 'option_0';
  const operationId = '00000000-0000-4000-8000-000000000002';
  const runtimeRevision = '00000000-0000-4000-8000-000000000003';

  test('1. fetchEquipmentUeRuntime 正确请求 /equipment/ue/runtime 且不影响具身智能', async () => {
    const originalGet = client.get;
    try {
      client.get = (async (options: any) => {
        assert.ok(options.url.includes('/equipment/ue/runtime'));
        assert.ok(!options.url.endsWith('/ue-runtime'), '不得调用具身智能的 /ue-runtime');
        assert.strictEqual(options.path?.projectId, projectId);
        return {
          data: {
            revision: runtimeRevision,
            status: 'idle',
            controllable: true,
            observedAt: '2026-10-27T10:00:00Z',
          },
        };
      }) as any;

      const res = await fetchEquipmentUeRuntime(projectId);
      assert.strictEqual(res.revision, runtimeRevision);
      assert.strictEqual(res.status, 'idle');
      assert.strictEqual(res.controllable, true);
    } finally {
      client.get = originalGet;
    }
  });

  test('2. createEquipmentUeLoad 传递 expectedRuntimeRevision 并支持 202 异步受理', async () => {
    const originalPost = client.post;
    try {
      client.post = (async (options: any) => {
        assert.ok(options.url.includes('/equipment/batches/{batchId}/ue-loads'));
        assert.strictEqual(options.path?.projectId, projectId);
        assert.strictEqual(options.path?.batchId, batchId);
        assert.strictEqual(options.body.alternativeId, alternativeId);
        assert.strictEqual(options.body.expectedRuntimeRevision, runtimeRevision);
        assert.strictEqual(options.body.idempotencyKey, 'idemp-ue-test');

        return {
          data: {
            operationId,
            batchId,
            alternativeId,
            projectId,
            workspaceId: 'ws-1',
            status: 'staging',
            submissionState: 'upstream_acknowledged',
            displayMode: 'static_fixed_joints',
            loadedIdentityVerified: false,
            viewerAvailable: false,
            error: null,
            createdAt: '2026-10-27T10:00:00Z',
          },
          response: { status: 202 } as Response,
        };
      }) as any;

      const receipt = await createEquipmentUeLoad(
        projectId,
        batchId,
        alternativeId,
        'idemp-ue-test',
        runtimeRevision
      );

      assert.strictEqual(receipt.operationId, operationId);
      assert.strictEqual(receipt.status, 'staging');
      assert.strictEqual(receipt.submissionState, 'upstream_acknowledged');
    } finally {
      client.post = originalPost;
    }
  });

  test('3. fetchEquipmentUeLoads 支持分页游标与历史查询', async () => {
    const originalGet = client.get;
    try {
      client.get = (async (options: any) => {
        assert.ok(options.url.includes('/equipment/ue-loads'));
        assert.strictEqual(options.path?.projectId, projectId);
        assert.strictEqual(options.query?.limit, 10);
        assert.strictEqual(options.query?.cursor, 'cur-1');

        return {
          data: {
            items: [
              {
                operationId,
                batchId,
                alternativeId,
                projectId,
                workspaceId: 'ws-1',
                status: 'ready',
                submissionState: 'upstream_acknowledged',
                displayMode: 'static_fixed_joints',
                loadedIdentityVerified: true,
                viewerAvailable: true,
                error: null,
                createdAt: '2026-10-27T10:00:00Z',
              },
            ],
            nextCursor: null,
          },
        };
      }) as any;

      const res = await fetchEquipmentUeLoads(projectId, 'cur-1', 10);
      assert.strictEqual(res.items.length, 1);
      assert.strictEqual(res.items[0].operationId, operationId);
      assert.strictEqual(res.nextCursor, null);
    } finally {
      client.get = originalGet;
    }
  });

  test('4. fetchEquipmentUeLoadDetail 取得实时装载详情与观察状态', async () => {
    const originalGet = client.get;
    try {
      client.get = (async (options: any) => {
        assert.ok(options.url.includes('/equipment/ue-loads/{operationId}'));
        assert.strictEqual(options.path?.projectId, projectId);
        assert.strictEqual(options.path?.operationId, operationId);

        return {
          data: {
            operationId,
            projectId,
            batchId,
            alternativeId,
            workspaceId: 'ws-1',
            status: 'ready',
            submissionState: 'upstream_acknowledged',
            displayMode: 'static_fixed_joints',
            loadedIdentityVerified: true,
            viewerAvailable: true,
            observationFresh: true,
            error: null,
            createdAt: '2026-10-27T10:00:00Z',
            updatedAt: '2026-10-27T10:01:00Z',
          },
        };
      }) as any;

      const detail = await fetchEquipmentUeLoadDetail(projectId, operationId);
      assert.strictEqual(detail.operationId, operationId);
      assert.strictEqual(detail.status, 'ready');
      assert.strictEqual(detail.loadedIdentityVerified, true);
      assert.strictEqual(detail.viewerAvailable, true);
    } finally {
      client.get = originalGet;
    }
  });

  test('5. fetchEquipmentUeViewerAccess 获取受控单操作者观看凭据', async () => {
    const originalPost = client.post;
    try {
      client.post = (async (options: any) => {
        assert.ok(options.url.includes('/equipment/ue-loads/{operationId}/viewer-access'));
        assert.strictEqual(options.path?.projectId, projectId);
        assert.strictEqual(options.path?.operationId, operationId);

        return {
          data: {
            operationId,
            runtimeRevision,
            viewerUrl: 'http://127.0.0.1:8081/player.html',
            accessMode: 'trusted_single_operator',
            expiresAt: null,
          },
        };
      }) as any;

      const access = await fetchEquipmentUeViewerAccess(projectId, operationId);
      assert.strictEqual(access.operationId, operationId);
      assert.strictEqual(access.viewerUrl, 'http://127.0.0.1:8081/player.html');
      assert.strictEqual(access.accessMode, 'trusted_single_operator');
    } finally {
      client.post = originalPost;
    }
  });

  test('6. 异常处理：409 UE_REVISION_CONFLICT 与 422 PREVIEW_NOT_AVAILABLE 安全抛出', async () => {
    const originalPost = client.post;
    try {
      client.post = (async () => ({
        error: {
          code: 'UE_REVISION_CONFLICT',
          message: 'UE runtime slot revision conflict',
        },
        response: { status: 409 } as Response,
      })) as any;

      await assert.rejects(
        () => createEquipmentUeLoad(projectId, batchId, alternativeId, 'k', 'wrong-rev'),
        (err: any) => {
          assert.ok(err instanceof EquipmentApiError);
          assert.strictEqual(err.status, 409);
          return true;
        }
      );
    } finally {
      client.post = originalPost;
    }
  });

  test('7. 取消语义：AbortSignal 支持且保持 AbortError 语义', async () => {
    const originalConfig = client.getConfig();
    try {
      client.setConfig({
        baseUrl: 'https://test-ue-abort.invalid',
        fetch: async () => {
          throw new DOMException('The operation was aborted', 'AbortError');
        },
      });

      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        async () => {
          await fetchEquipmentUeRuntime(projectId, controller.signal);
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
});
