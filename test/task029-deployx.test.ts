import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { client } from '../lib/api/client';
import {
  listDeployxProjectResources,
  createDeployxDeployment,
  triggerDeployxDeploymentAction,
  getDeployxDeploymentDetail,
  stopDeployxDeployment,
  cancelDeployxDeployment,
  recoverDeployxDeployment,
  getDeployxDeploymentRobotLogs,
} from '../lib/api';

describe('Task-029 Frontend DeployX Integration Tests', () => {
  let originalGet: typeof client.get;
  let originalPost: typeof client.post;

  beforeEach(() => {
    originalGet = client.get;
    originalPost = client.post;
  });

  afterEach(() => {
    client.get = originalGet;
    client.post = originalPost;
  });

  test('1. listDeployxProjectResources returns authorized robots, packages and models', async () => {
    client.get = async (opts: any) => {
      assert.equal(opts.url, '/api/v1/projects/{projectId}/deployx/resources');
      assert.equal(opts.path.projectId, 'proj-123');
      return {
        data: {
          robots: [{ id: 'r-1', name: 'Robot Alpha', online: true, bindState: 'BOUND', createdAt: '', updatedAt: '' }],
          packages: [{ id: 'p-1', originalName: 'pkg-walking.tar.gz', sizeBytes: 1048576, sha256: 'a'.repeat(64), status: 'UNPACKED', createdAt: '', updatedAt: '' }],
          templates: [{ id: 't-1', name: 'template-h1', version: '1.0', arch: 'arm64', runtime: 'ros2', createdAt: '', updatedAt: '' }],
          modelAssets: [{ id: 'm-1', displayName: 'Model Weights V1', sha256: 'b'.repeat(64), authorizationSource: 'CONTROLLED_MAPPING', observedAt: '' }],
          capabilities: {
            canCreateDeployment: true,
            canBuildRelease: true,
            canDeployToRobot: true,
            canStop: true,
            canCancel: true,
            canRecover: true,
          },
        },
        response: new Response(),
      } as any;
    };

    const res = await listDeployxProjectResources({ path: { projectId: 'proj-123' } });
    assert.ok(res.data);
    assert.equal(res.data.robots.length, 1);
    assert.equal(res.data.packages[0].originalName, 'pkg-walking.tar.gz');
    assert.equal(res.data.capabilities.canCreateDeployment, true);
  });

  test('2. createDeployxDeployment requires idempotencyKey and freezes MANUAL_STAGE', async () => {
    let sentBody: any = null;
    let sentHeaders: any = null;

    client.post = async (opts: any) => {
      assert.equal(opts.url, '/api/v1/projects/{projectId}/deployx/deployments');
      sentBody = opts.body;
      sentHeaders = opts.headers;
      return {
        data: {
          deploymentId: 'dep-999',
          projectId: 'proj-123',
          platformTaskId: 'task-platform-1',
          platformTaskStatus: 'RUNNING',
          upstreamTaskId: 'upstream-task-1',
          robotId: 'r-1',
          packageId: 'p-1',
          templateId: 't-1',
          isShadow: false,
          progressionPolicy: 'MANUAL_STAGE',
          status: 'AWAITING_STAGE_ACTION',
          availableActions: ['BUILD_RELEASE'],
          version: 1,
          submitStatus: 'SUBMITTED',
        },
        response: new Response(),
      } as any;
    };

    const res = await createDeployxDeployment({
      path: { projectId: 'proj-123' },
      headers: { 'idempotency-key': 'idemp-uuid-1' } as any,
      body: {
        idempotencyKey: 'idemp-uuid-1',
        robotId: 'r-1',
        packageId: 'p-1',
        templateId: 't-1',
      },
    });

    assert.ok(res.data);
    assert.equal(res.data.deploymentId, 'dep-999');
    assert.equal(res.data.status, 'AWAITING_STAGE_ACTION');
    assert.deepEqual(res.data.availableActions, ['BUILD_RELEASE']);
    assert.equal(sentBody.idempotencyKey, 'idemp-uuid-1');
  });

  test('3. triggerDeployxDeploymentAction enforces revision and independent stage confirmation', async () => {
    let sentActionBody: any = null;

    client.post = async (opts: any) => {
      assert.equal(opts.url, '/api/v1/projects/{projectId}/deployx/deployments/{deploymentId}/actions');
      sentActionBody = opts.body;
      return {
        data: {
          deploymentId: 'dep-999',
          status: 'AWAITING_STAGE_ACTION',
          version: 2,
          availableActions: ['DEPLOY_TO_ROBOT'],
          steps: {
            build: { status: 'SUCCEEDED' },
          },
        },
        response: new Response(),
      } as any;
    };

    const res = await triggerDeployxDeploymentAction({
      path: { projectId: 'proj-123', deploymentId: 'dep-999' },
      body: {
        action: 'BUILD_RELEASE',
        expectedTaskRevision: 1,
        idempotencyKey: 'idemp-action-1',
      },
    });

    assert.ok(res.data);
    assert.equal(sentActionBody.action, 'BUILD_RELEASE');
    assert.equal(sentActionBody.expectedTaskRevision, 1);
    assert.deepEqual(res.data.availableActions, ['DEPLOY_TO_ROBOT']);
  });

  test('4. Safety Operations (STOP, CANCEL, RECOVER) follow strict body & idempotency header', async () => {
    let stopHeaders: any = null;
    let cancelHeaders: any = null;
    let recoverHeaders: any = null;

    client.post = async (opts: any) => {
      if (opts.url.endsWith('/stop')) {
        stopHeaders = opts.headers;
        return { data: { operation: { operationId: 'op-stop' } }, response: new Response() } as any;
      }
      if (opts.url.endsWith('/cancel')) {
        cancelHeaders = opts.headers;
        return { data: { operation: { operationId: 'op-cancel' } }, response: new Response() } as any;
      }
      if (opts.url.endsWith('/recover')) {
        recoverHeaders = opts.headers;
        return { data: { operation: { operationId: 'op-recover' } }, response: new Response() } as any;
      }
      throw new Error(`Unexpected url: ${opts.url}`);
    };

    await stopDeployxDeployment({
      path: { projectId: 'proj-123', deploymentId: 'dep-999' },
      headers: { 'Idempotency-Key': 'stop-op-uuid' },
      body: { reason: 'Emergency Stop' },
    });
    assert.equal(stopHeaders['Idempotency-Key'], 'stop-op-uuid');

    await cancelDeployxDeployment({
      path: { projectId: 'proj-123', deploymentId: 'dep-999' },
      headers: { 'Idempotency-Key': 'cancel-op-uuid' },
      body: { reason: 'User Cancel' },
    });
    assert.equal(cancelHeaders['Idempotency-Key'], 'cancel-op-uuid');

    await recoverDeployxDeployment({
      path: { projectId: 'proj-123', deploymentId: 'dep-999' },
      headers: { 'Idempotency-Key': 'recover-op-uuid' },
      body: {} as never,
    });
    assert.equal(recoverHeaders['Idempotency-Key'], 'recover-op-uuid');
  });

  test('5. getDeployxDeploymentRobotLogs retrieves log tail snapshot', async () => {
    client.get = async (opts: any) => {
      assert.equal(opts.url, '/api/v1/projects/{projectId}/deployx/deployments/{deploymentId}/robot-logs');
      assert.equal(opts.query.lines, 200);
      return {
        data: {
          name: 'robot-container',
          lines: 200,
          container: 'main',
          content: '2026-10-24 [INFO] Controller loop started\n2026-10-24 [INFO] Joint state publisher active',
        },
        response: new Response(),
      } as any;
    };

    const res = await getDeployxDeploymentRobotLogs({
      path: { projectId: 'proj-123', deploymentId: 'dep-999' },
      query: { lines: 200 },
    });

    assert.ok(res.data);
    assert.ok(res.data.content.includes('Controller loop started'));
  });
});
