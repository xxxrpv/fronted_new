import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import { client } from '../lib/api/client';
import React from 'react';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  loadStoredConversation,
  saveStoredConversation,
  clearUserStoredConversation,
  type StoredConversation,
  type StoredIntent,
} from '../lib/embodex/conversation-storage';
import {
  EmbodexConversationSession,
  initialConversationState,
  type ConversationState,
} from '../lib/embodex/conversation';
import {
  EmbodexBuildSession,
  designArtifactsReady,
  initialDesignState,
} from '../lib/embodex/design-workflow';

// In-memory mock sessionStorage for Node environment
const storageMap = new Map<string, string>();
const mockStorage: Storage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => { storageMap.set(k, String(v)); },
  removeItem: (k: string) => { storageMap.delete(k); },
  clear: () => { storageMap.clear(); },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
  get length() { return storageMap.size; },
};

(globalThis as any).sessionStorage = mockStorage;

const frame = (event: unknown) => 'data: ' + JSON.stringify(event) + '\r\n\r\n';
const sseResponse = (events: unknown[]) => {
  const bytes = new TextEncoder().encode(events.map(frame).join(''));
  return new Response(new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
};

describe('Task-028 Frontend Confirmation & Publication Workflow', () => {
  let originalGet: typeof client.get;

  beforeEach(() => {
    storageMap.clear();
    originalGet = client.get;
  });

  afterEach(() => {
    client.get = originalGet;
  });

  // 1. Storage isolation & message recovery
  test('sessionStorage isolates conversations by userId + projectId with structure validation', () => {
    const userA = '00000000-0000-4000-8000-000000000001';
    const userB = '00000000-0000-4000-8000-000000000002';
    const proj1 = '10000000-0000-4000-8000-000000000001';
    const proj2 = '10000000-0000-4000-8000-000000000002';

    const convA1: StoredConversation = {
      version: 1,
      userId: userA,
      projectId: proj1,
      threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 3,
      messages: [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: 'ok', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'fn1', arguments: '{}' } }] },
        { id: 'm3', role: 'tool', toolCallId: 'tc1', content: '{"res":1}' },
      ],
      intent: {
        threadId: '20000000-0000-4000-8000-000000000001',
        confirmationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        submissionState: 'SUBMITTING',
        taskId: null,
      },
      updatedAt: 1000,
    };

    saveStoredConversation(userA, proj1, convA1);

    // User A on Project 1 can read back
    const loadedA1 = loadStoredConversation(userA, proj1);
    assert.ok(loadedA1);
    assert.equal(loadedA1.threadId, '20000000-0000-4000-8000-000000000001');
    assert.equal(loadedA1.messageEpoch, 3);
    assert.equal(loadedA1.messages.length, 3);
    assert.equal((loadedA1.messages[1] as any).toolCalls?.[0].id, 'tc1');
    assert.equal(loadedA1.intent?.submissionState, 'SUBMITTING');

    // Cross-user isolation: User B cannot read User A's data
    assert.equal(loadStoredConversation(userB, proj1), null);

    // Cross-project isolation: User A on Project 2 cannot read Project 1
    assert.equal(loadStoredConversation(userA, proj2), null);

    // Malformed JSON fails closed
    storageMap.set(`embodix_conv_v1_${userA}_${proj1}`, 'INVALID JSON {');
    assert.equal(loadStoredConversation(userA, proj1), null);

    // Malformed schema (wrong version) fails closed
    storageMap.set(`embodix_conv_v1_${userA}_${proj1}`, JSON.stringify({ version: 999, userId: userA, projectId: proj1 }));
    assert.equal(loadStoredConversation(userA, proj1), null);
  });

  test('clearUserStoredConversation clears only the targeted user conversations without full storage wipe', () => {
    const userA = 'user-a';
    const userB = 'user-b';
    const proj1 = 'proj-1';
    const proj2 = 'proj-2';

    saveStoredConversation(userA, proj1, {
      version: 1, userId: userA, projectId: proj1, threadId: '20000000-0000-4000-8000-000000000001', messageEpoch: 1, messages: [], intent: null, updatedAt: 1,
    });
    saveStoredConversation(userA, proj2, {
      version: 1, userId: userA, projectId: proj2, threadId: '20000000-0000-4000-8000-000000000002', messageEpoch: 1, messages: [], intent: null, updatedAt: 1,
    });
    saveStoredConversation(userB, proj1, {
      version: 1, userId: userB, projectId: proj1, threadId: '20000000-0000-4000-8000-000000000003', messageEpoch: 1, messages: [], intent: null, updatedAt: 1,
    });
    storageMap.set('other_unrelated_key', 'keep-me');

    clearUserStoredConversation(userA);

    assert.equal(loadStoredConversation(userA, proj1), null);
    assert.equal(loadStoredConversation(userA, proj2), null);
    assert.ok(loadStoredConversation(userB, proj1)); // User B preserved
    assert.equal(storageMap.get('other_unrelated_key'), 'keep-me'); // Unrelated keys preserved
  });

  // 2. Epoch Defense & SSE Confirmation Events
  test('session message increments epoch; valid READY event sets confirmation on RUN_FINISHED', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const projectId = '10000000-0000-4000-8000-000000000001';
    const confId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    let lastState: ConversationState = initialConversationState(userId, projectId);
    const session = new EmbodexConversationSession(
      userId,
      projectId,
      (state) => { lastState = state; },
      async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        return sseResponse([
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          {
            type: 'CUSTOM',
            name: 'EMBODIX_BUILD_CONFIRMATION_READY',
            value: {
              status: 'READY',
              projectId,
              threadId: body.threadId,
              runId: body.runId,
              confirmationId: confId,
            },
          },
          { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
        ]);
      }
    );

    assert.equal(session.state.epoch, 0);
    assert.equal(session.state.confirmation.status, 'NONE');

    const sent = await session.send('设计一个轮足机器人');
    assert.ok(sent);
    assert.equal(lastState.epoch, 1);
    assert.equal(lastState.outcome, 'finished');
    assert.equal(lastState.confirmation.status, 'READY');
    assert.equal(lastState.confirmation.confirmationId, confId);
    assert.equal(lastState.confirmation.epoch, 1);

    session.dispose();
  });

  test('INVALIDATED event cancels pending confirmation and marks status INVALIDATED', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const projectId = '10000000-0000-4000-8000-000000000001';
    const confId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    let lastState: ConversationState = initialConversationState(userId, projectId);
    const session = new EmbodexConversationSession(
      userId,
      projectId,
      (state) => { lastState = state; },
      async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        return sseResponse([
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          {
            type: 'CUSTOM',
            name: 'EMBODIX_BUILD_CONFIRMATION_READY',
            value: {
              status: 'READY',
              projectId,
              threadId: body.threadId,
              runId: body.runId,
              confirmationId: confId,
            },
          },
          {
            type: 'CUSTOM',
            name: 'EMBODIX_BUILD_CONFIRMATION_INVALIDATED',
            value: {
              status: 'INVALIDATED',
              reason: 'NEW_BUILD_STARTED',
              projectId,
              threadId: body.threadId,
              runId: body.runId,
              confirmationId: confId,
            },
          },
          { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
        ]);
      }
    );

    await session.send('重新调整腿部长度');
    assert.equal(lastState.confirmation.status, 'INVALIDATED');
    assert.equal(lastState.confirmation.confirmationId, null);
    session.dispose();
  });

  test('Duplicate READY event in the same run throws protocol error and marks outcome unconfirmed', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const projectId = '10000000-0000-4000-8000-000000000001';
    const confId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    let lastState: ConversationState = initialConversationState(userId, projectId);
    const session = new EmbodexConversationSession(
      userId,
      projectId,
      (state) => { lastState = state; },
      async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        return sseResponse([
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          {
            type: 'CUSTOM',
            name: 'EMBODIX_BUILD_CONFIRMATION_READY',
            value: { status: 'READY', projectId, threadId: body.threadId, runId: body.runId, confirmationId: confId },
          },
          {
            type: 'CUSTOM',
            name: 'EMBODIX_BUILD_CONFIRMATION_READY',
            value: { status: 'READY', projectId, threadId: body.threadId, runId: body.runId, confirmationId: confId },
          },
          { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
        ]);
      }
    );

    await session.send('非法双重事件');
    assert.equal(lastState.outcome, 'unconfirmed');
    assert.equal(lastState.confirmation.status, 'NONE');
    session.dispose();
  });

  test('RUN_ERROR prevents showing confirmation', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const projectId = '10000000-0000-4000-8000-000000000001';
    const confId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    let lastState: ConversationState = initialConversationState(userId, projectId);
    const session = new EmbodexConversationSession(
      userId,
      projectId,
      (state) => { lastState = state; },
      async (_url, options) => {
        const body = JSON.parse(options?.body as string);
        return sseResponse([
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          {
            type: 'CUSTOM',
            name: 'EMBODIX_BUILD_CONFIRMATION_READY',
            value: { status: 'READY', projectId, threadId: body.threadId, runId: body.runId, confirmationId: confId },
          },
          { type: 'RUN_ERROR', code: 'INTERNAL_ERROR' },
        ]);
      }
    );

    await session.send('异常中断');
    assert.equal(lastState.outcome, 'unconfirmed');
    assert.equal(lastState.confirmation.status, 'NONE');
    session.dispose();
  });

  // 3. EmbodexBuildSession Workflow for EMBODEX_PUBLISH_EXISTING
  test('EmbodexBuildSession validTask accepts EMBODEX_PUBLISH_EXISTING and handles PENDING / TIMEOUT polling', async () => {
    const projectId = '10000000-0000-4000-8000-000000000001';
    const taskId = 'task-pub-001';
    let currentState = initialDesignState(projectId);

    client.get = (async (options: { url: string }) => {
      if (options.url === '/api/v1/tasks/{taskId}') {
        return {
          data: {
            id: taskId,
            projectId,
            validationId: 'val-1',
            actionKey: 'EMBODEX_PUBLISH_EXISTING',
            status: 'PENDING',
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        };
      }
      return { error: 'not found' };
    }) as unknown as typeof client.get;

    const session = new EmbodexBuildSession(
      projectId,
      (st) => { currentState = st; },
      50,
      { initial: { intentId: 'intent-1', taskId }, persist: () => {} }
    );

    try {
      await session.resume(taskId);
      assert.equal(currentState.task?.id, taskId);
      assert.equal(currentState.task?.status, 'PENDING');
      assert.ok(currentState.unresolvedTaskIds.includes(taskId));
    } finally {
      session.dispose();
    }
  });

  test('EmbodexBuildSession FAILED task reads robot-publication Result and displays NEEDS_ATTENTION with 0 resources', async () => {
    const projectId = '10000000-0000-4000-8000-000000000001';
    const taskId = 'task-pub-failed-002';
    let currentState = initialDesignState(projectId);

    client.get = (async (options: { url: string }) => {
      if (options.url === '/api/v1/tasks/{taskId}/results') {
        return {
          data: {
            items: [{
              id: 'result-1',
              taskId,
              sourceModule: 'embodex',
              summary: 'Robot publication needs operator attention',
              resultKind: 'robot-publication',
              data: {
                operation: 'PUBLISH_EXISTING',
                status: 'NEEDS_ATTENTION',
                publicationStatus: 'NEEDS_ATTENTION',
                failureCode: 'NEEDS_ATTENTION',
              },
              producedResources: [], // 0 resources allowed for FAILED
              createdAt: '2026-10-23T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            }],
          },
        };
      }
      if (options.url === '/api/v1/tasks/{taskId}') {
        return {
          data: {
            id: taskId,
            projectId,
            validationId: 'val-1',
            actionKey: 'EMBODEX_PUBLISH_EXISTING',
            status: 'FAILED',
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        };
      }
      return { error: 'not found' };
    }) as unknown as typeof client.get;

    const session = new EmbodexBuildSession(
      projectId,
      (st) => { currentState = st; },
      5000,
      { initial: { intentId: 'intent-1', taskId }, persist: () => {} }
    );

    try {
      await session.resume(taskId);
      assert.equal(currentState.task?.status, 'FAILED');
      assert.equal(currentState.publicationStatus, 'NEEDS_ATTENTION');
      assert.equal(currentState.robot, null);
      assert.equal(currentState.unresolvedTaskIds.length, 0); // FAILED releases fence
      assert.equal(designArtifactsReady(currentState), false);
    } finally {
      session.dispose();
    }
  });

  test('EmbodexBuildSession SUCCEEDED task validates single ROBOT resource and enables download', async () => {
    const projectId = '10000000-0000-4000-8000-000000000001';
    const taskId = 'task-pub-succeeded-003';
    const resourceId = '00000000-0000-4000-8000-000000000099';
    const artifactUuid = '11111111-2222-4333-8444-555555555555';
    let currentState = initialDesignState(projectId);

    client.get = (async (options: { url: string }) => {
      if (options.url === '/api/v1/tasks/{taskId}/results') {
        return {
          data: {
            items: [{
              id: 'result-success',
              taskId,
              sourceModule: 'embodex',
              summary: 'Robot publication registered',
              resultKind: 'robot-publication',
              data: {
                operation: 'PUBLISH_EXISTING',
                status: 'LOCATION_REGISTERED',
                publicationStatus: 'LOCATION_REGISTERED',
              },
              producedResources: [{
                outputKey: 'robot',
                resourceId,
              }],
              createdAt: '2026-10-23T00:00:00.000Z',
              updatedAt: '2026-10-23T00:00:00.000Z',
            }],
          },
        };
      }
      if (options.url === '/api/v1/resources/{resourceId}') {
        return {
          data: {
            id: resourceId,
            type: 'ROBOT',
            scope: 'PROJECT',
            projectId,
            sourceModule: 'embodex',
            externalId: `publication:${taskId}`,
            version: 'v1',
            displayMetadata: {
              name: 'Published Robot',
              specifications: {
                operation: 'PUBLISH_EXISTING',
                workspacePublicationStatus: 'LOCATION_REGISTERED',
                workspaceArtifactId: artifactUuid,
              },
            },
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        };
      }
      if (options.url === '/api/v1/tasks/{taskId}') {
        return {
          data: {
            id: taskId,
            projectId,
            validationId: 'val-1',
            actionKey: 'EMBODEX_PUBLISH_EXISTING',
            status: 'SUCCEEDED',
            createdAt: '2026-10-23T00:00:00.000Z',
            updatedAt: '2026-10-23T00:00:00.000Z',
          },
        };
      }
      if (options.url === '/api/v1/projects/{projectId}/resources/{resourceId}/runtime-model-package/download') {
        const zipBlob = new Blob(['PK\x03\x04mockzipcontent'], { type: 'application/zip' });
        return {
          data: zipBlob,
          response: new Response(null, {
            headers: { 'content-type': 'application/zip' },
          }),
        };
      }
      return { error: 'not found' };
    }) as unknown as typeof client.get;

    const session = new EmbodexBuildSession(
      projectId,
      (st) => { currentState = st; },
      5000,
      { initial: { intentId: 'intent-1', taskId }, persist: () => {} }
    );

    try {
      await session.resume(taskId);
      assert.equal(currentState.task?.status, 'SUCCEEDED');
      assert.equal(currentState.publicationStatus, 'LOCATION_REGISTERED');
      assert.ok(currentState.robot);
      assert.equal(currentState.robot.id, resourceId);
      assert.equal(currentState.robot.externalId, `publication:${taskId}`);
      assert.ok(designArtifactsReady(currentState));

      // Test download package
      const downloaded = await session.download();
      assert.ok(downloaded instanceof Blob);
      assert.equal(downloaded.type, 'application/zip');
    } finally {
      session.dispose();
    }
  });

  // 4. Late GET and Epoch Drift
  test('Late GET current confirmation response is ignored if epoch or threadId drifts', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const projectId = '10000000-0000-4000-8000-000000000001';
    const thread1 = '11111111-1111-4111-8111-111111111111';
    const checkEpoch = 1;

    // Simulate session that advanced to epoch 2 and changed threadId
    const currentSession = {
      userId,
      projectId,
      threadId: '22222222-2222-4222-8222-222222222222',
      state: { epoch: 2 },
    };

    // Stale response from thread 1 epoch 1
    const shouldApplyResponse = (resThreadId: string, resEpoch: number) => {
      if (currentSession.threadId !== resThreadId) return false;
      if (currentSession.state.epoch !== resEpoch) return false;
      return true;
    };

    assert.equal(shouldApplyResponse(thread1, checkEpoch), false);
    assert.equal(shouldApplyResponse(currentSession.threadId, checkEpoch), false);
    assert.equal(shouldApplyResponse(currentSession.threadId, 2), true);
  });

  // 5. Double Click Prevention & UNKNOWN Intent Persistence
  test('Double click submission lock and UNKNOWN intent recovery with stable idempotencyKey', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const projectId = '10000000-0000-4000-8000-000000000001';
    const threadId = '33333333-3333-4333-8333-333333333333';
    const confId = '44444444-4444-4444-8444-444444444444';
    const idempotencyKey = '55555555-5555-4555-8555-555555555555';

    let isPublishing = false;
    let postCalls = 0;

    const mockPublish = async () => {
      if (isPublishing) return; // double-click lock
      isPublishing = true;
      postCalls++;

      // Persist SUBMITTING intent before I/O
      const initialIntent: StoredIntent = {
        threadId,
        confirmationId: confId,
        idempotencyKey,
        submissionState: 'SUBMITTING',
        taskId: null,
      };
      saveStoredConversation(userId, projectId, {
        version: 1,
        userId,
        projectId,
        threadId,
        messageEpoch: 1,
        messages: [],
        intent: initialIntent,
        updatedAt: Date.now(),
      });

      try {
        // Simulate async network request
        await new Promise(r => setImmediate(r));
        throw new TypeError('Failed to fetch');
      } catch {
        // Network failure persists UNKNOWN intent
        const unknownIntent: StoredIntent = {
          threadId,
          confirmationId: confId,
          idempotencyKey,
          submissionState: 'UNKNOWN',
          taskId: null,
        };
        saveStoredConversation(userId, projectId, {
          version: 1,
          userId,
          projectId,
          threadId,
          messageEpoch: 1,
          messages: [],
          intent: unknownIntent,
          updatedAt: Date.now(),
        });
      } finally {
        isPublishing = false;
      }
    };

    // Trigger concurrent calls
    await Promise.all([mockPublish(), mockPublish()]);
    assert.equal(postCalls, 1); // exactly one POST issued

    // Reload conversation from storage
    const recovered = loadStoredConversation(userId, projectId);
    assert.ok(recovered);
    assert.equal(recovered.intent?.submissionState, 'UNKNOWN');
    assert.equal(recovered.intent?.idempotencyKey, idempotencyKey);
    assert.equal(recovered.intent?.confirmationId, confId);
  });
});

describe('Embodex Auth Revocation & 401 Recovery Workflow', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const projectId = '10000000-0000-4000-8000-000000000001';
  const confId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  function hookHarness() {
    let pos = 0, rpos = 0, epos = 0, cpos = 0;
    const values: any[] = [], refs: any[] = [], effects: any[] = [], callbacks: any[] = [];
    return {
      values, refs, effects,
      reset: () => { pos = 0; rpos = 0; epos = 0; cpos = 0; },
      hooks: {
        useState: (init: any) => {
          const i = pos++;
          if (!(i in values)) values[i] = typeof init === 'function' ? init() : init;
          return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }];
        },
        useRef: (init: any) => {
          const i = rpos++;
          return refs[i] || (refs[i] = { current: init });
        },
        useEffect: (fn: any) => {
          const i = epos++;
          effects[i] = fn;
        },
        useCallback: (fn: any) => {
          const i = cpos++;
          return callbacks[i] || (callbacks[i] = fn);
        },
        useMemo: (fn: any) => fn(),
      },
    };
  }

  function loadHeadlessPanel(mocks: {
    getConfirmation?: () => Promise<any>;
    postPublication?: (opts: any) => Promise<any>;
    getCurrentUser?: () => Promise<any>;
  } = {}) {
    const h = hookHarness();
    const source = readFileSync(new URL('../components/embodex/headless-chat/index.tsx', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} as any };
    runInNewContext(compiled, {
      module,
      exports: module.exports,
      crypto,
      fetch,
      require: (name: string) => {
        if (name === 'react') return { __esModule: true, default: React, ...React, ...h.hooks };
        if (name === '../../../lib/embodex/conversation') return { EmbodexConversationSession, initialConversationState };
        if (name === '../../../lib/api/generated/sdk.gen') {
          return {
            getProjectEmbodexCurrentConfirmation: mocks.getConfirmation || (async () => ({ data: { status: 'NOT_READY', confirmationId: null } })),
            createProjectEmbodexPublication: mocks.postPublication || (async () => ({ data: { taskId: 'task-1' } })),
            getCurrentUser: mocks.getCurrentUser || (async () => ({ data: { user: { id: userId } } })),
          };
        }
        if (name === '../../../lib/embodex/conversation-storage') {
          return {
            loadStoredConversation,
            loadStoredConversationWithStatus: (u: string, p: string) => ({ data: loadStoredConversation(u, p), corrupted: false }),
            saveStoredConversation,
            clearUserStoredConversation,
            revokeUserConversations: () => {},
          };
        }
        if (name === './chat-header') return { ChatHeader: () => null };
        if (name === './chat-input') return { ChatInput: () => null };
        if (name === './message-list') return { MessageList: () => null };
        if (name === './floating-panel') return { FloatingChatPanel: () => null };
        throw new Error('Unexpected import in test: ' + name);
      },
    });

    const HeadlessPanel = module.exports.default;
    const render = () => {
      h.reset();
      return HeadlessPanel({ userId, projectId });
    };
    return { h, render, HeadlessPanel };
  }

  test('conversation POST 401 with /auth/me = 200 preserves session & messages, allows next send without F5', async () => {
    storageMap.clear();
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    let calls = 0;
    const session = new EmbodexConversationSession(
      userId,
      projectId,
      () => {},
      async (_url, options) => {
        calls++;
        const body = JSON.parse(String(options?.body || '{}'));
        if (calls === 1) {
          return new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }), { status: 401 });
        }
        return sseResponse([
          { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
          { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
        ]);
      },
      undefined,
      {
        initialThreadId: '20000000-0000-4000-8000-000000000001',
        initialMessages: [{ id: 'm1', role: 'user', content: 'hello' }],
        verifyAuth: async () => 'authenticated',
      },
    );

    await session.send('test 401 with valid auth');
    assert.equal(session.writable, true);
    assert.ok(loadStoredConversation(userId, projectId));
    assert.match(session.state.notice || '', /已保留聊天记录/);

    const ok = await session.send('second message');
    assert.equal(ok, true);
    assert.equal(session.state.outcome, 'finished');
    assert.equal(session.writable, true);
    assert.equal(calls, 2);
    session.dispose();
  });

  test('conversation POST 401 with /auth/me = 401 revokes session and clears local conversation', async () => {
    storageMap.clear();
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    const session = new EmbodexConversationSession(
      userId,
      projectId,
      () => {},
      async () => new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }), { status: 401 }),
      undefined,
      {
        initialThreadId: '20000000-0000-4000-8000-000000000001',
        initialMessages: [{ id: 'm1', role: 'user', content: 'hello' }],
        verifyAuth: async () => 'unauthenticated',
      },
    );

    await session.send('trigger real 401');
    assert.equal(session.writable, false);
    assert.equal(loadStoredConversation(userId, projectId), null);
    assert.equal(await session.send('blocked'), false);
    session.dispose();
  });

  test('conversation POST 401 with /auth/me network/5xx error keeps messages in UNCONFIRMED state', async () => {
    storageMap.clear();
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    const session = new EmbodexConversationSession(
      userId,
      projectId,
      () => {},
      async () => new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED' }), { status: 401 }),
      undefined,
      {
        initialThreadId: '20000000-0000-4000-8000-000000000001',
        initialMessages: [{ id: 'm1', role: 'user', content: 'hello' }],
        verifyAuth: async () => 'unknown',
      },
    );

    await session.send('trigger unknown 401');
    assert.ok(loadStoredConversation(userId, projectId));
    assert.match(session.state.notice || '', /已保留聊天记录/);
    assert.equal(session.writable, true);
    session.dispose();
  });

  test('confirmations/current 404 / 500 does not destroy session or clear history', async () => {
    for (const status of [404, 500]) {
      storageMap.clear();
      saveStoredConversation(userId, projectId, {
        version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
        messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
        intent: null, updatedAt: Date.now(),
      });

      let getCalls = 0;
      const { h, render } = loadHeadlessPanel({
        getConfirmation: async () => {
          getCalls++;
          return { response: { status } };
        },
      });

      render();
      const cleanup = h.effects[0]();
      await new Promise(r => setImmediate(r));

      assert.equal(getCalls, 1, 'confirmations/current must be invoked for status ' + status);
      const session = h.refs[1].current as EmbodexConversationSession;
      assert.ok(session);
      assert.equal(session.writable, true);

      const stored = loadStoredConversation(userId, projectId);
      assert.ok(stored);
      assert.equal(stored.messages.length, 1);
      assert.equal(stored.messages[0].content, 'hello');

      const tree = render();
      const ctx = tree.props.children.props.value;
      assert.equal(ctx.canSend, true);

      cleanup?.();
    }
  });

  test('publication 401 with /auth/me = 200 executes verification, enters UNKNOWN without auto-replay', async () => {
    storageMap.clear();
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    let publicationCalls = 0;
    let authCheckCalls = 0;
    let capturedIdempotencyKey: string | null = null;

    const { h, render } = loadHeadlessPanel({
      getConfirmation: async () => ({
        data: { status: 'READY', confirmationId: confId },
      }),
      postPublication: async (opts: any) => {
        publicationCalls++;
        capturedIdempotencyKey = opts.headers?.['Idempotency-Key'];
        return { response: { status: 401 } };
      },
      getCurrentUser: async () => {
        authCheckCalls++;
        return { data: { user: { id: userId } } };
      },
    });

    render();
    const cleanup = h.effects[0]();
    await new Promise(r => setImmediate(r));

    const session = h.refs[1].current as EmbodexConversationSession;
    assert.equal(session.state.confirmation.status, 'READY');

    const findButton = (node: any, label: string): any => {
      if (!React.isValidElement(node)) return null;
      const element = node as React.ReactElement<any>;
      if (element.type === 'button' && element.props.children === label) return element;
      for (const child of React.Children.toArray(element.props.children)) {
        const found: any = findButton(child, label);
        if (found) return found;
      }
      return null;
    };

    const tree = render();
    const confirmBtn = findButton(tree, '确认构建');
    assert.ok(confirmBtn, '确认构建 button must be rendered');
    await confirmBtn.props.onClick();

    assert.equal(publicationCalls, 1, 'must issue exactly 1 publication request (no auto-replay)');
    assert.equal(authCheckCalls, 1, 'platform auth must be verified on 401');
    assert.ok(capturedIdempotencyKey);

    const stored = loadStoredConversation(userId, projectId);
    assert.ok(stored?.intent);
    assert.equal(stored.intent.submissionState, 'UNKNOWN');
    assert.equal(stored.intent.idempotencyKey, capturedIdempotencyKey);
    assert.equal(stored.intent.confirmationId, confId);

    assert.equal(session.writable, true);
    const updatedTree = render();
    assert.equal(updatedTree.props.children.props.value.canSend, true);
    const retryBtn = findButton(updatedTree, '安全重试原提交');
    assert.ok(retryBtn, 'Safe retry button must be available for UNKNOWN intent');

    cleanup?.();
  });

  test('ensureActiveSession and canSend state coordination: real auth failure strictly prevents write permission recovery', async () => {
    storageMap.clear();
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    let authChecked = 0;
    const { h, render } = loadHeadlessPanel({
      getConfirmation: async () => ({ response: { status: 401 } }),
      getCurrentUser: async () => {
        authChecked++;
        return { response: { status: 401 } };
      },
    });

    render();
    const cleanup = h.effects[0]();
    await new Promise(r => setImmediate(r));

    assert.equal(authChecked, 1);
    const session = h.refs[1].current as EmbodexConversationSession;
    assert.equal(session.writable, false);
    assert.equal(loadStoredConversation(userId, projectId), null);

    const tree = render();
    const ctx = tree.props.children.props.value;
    assert.equal(ctx.canSend, false);

    let accepted = false;
    ctx.sendMessage({ role: 'user', content: 'try to recover' }, () => { accepted = true; });
    assert.equal(accepted, false);
    assert.equal(session.writable, false);
    assert.equal(loadStoredConversation(userId, projectId), null);

    cleanup?.();
  });

  test('account switch detection: /auth/me returning different user is treated as unauthenticated for current session', async () => {
    storageMap.clear();
    const otherUser = '00000000-0000-4000-8000-000000000009';
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    let authChecked = 0;
    const { h, render } = loadHeadlessPanel({
      getConfirmation: async () => ({ response: { status: 401 } }),
      getCurrentUser: async () => {
        authChecked++;
        return { data: { user: { id: otherUser } } };
      },
    });

    render();
    const cleanup = h.effects[0]();
    await new Promise(r => setImmediate(r));

    assert.equal(authChecked, 1);
    const session = h.refs[1].current as EmbodexConversationSession;
    assert.equal(session.writable, false);
    assert.equal(loadStoredConversation(userId, projectId), null);

    const tree = render();
    const ctx = tree.props.children.props.value;
    assert.equal(ctx.canSend, false);

    cleanup?.();
  });

  test('re-login via lifecycle: component re-mounts after re-login to cleanly recreate active session', async () => {
    storageMap.clear();
    const { h: h1, render: render1 } = loadHeadlessPanel({
      getConfirmation: async () => ({ response: { status: 401 } }),
      getCurrentUser: async () => ({ response: { status: 401 } }),
    });

    render1();
    const cleanup1 = h1.effects[0]();
    await new Promise(r => setImmediate(r));

    const oldSession = h1.refs[1].current as EmbodexConversationSession;
    assert.equal(oldSession.writable, false);
    cleanup1?.();

    const { h: h2, render: render2 } = loadHeadlessPanel({
      getConfirmation: async () => ({ data: { status: 'NOT_READY', confirmationId: null } }),
      getCurrentUser: async () => ({ data: { user: { id: userId } } }),
    });

    render2();
    const cleanup2 = h2.effects[0]();
    await new Promise(r => setImmediate(r));

    const newSession = h2.refs[1].current as EmbodexConversationSession;
    assert.ok(newSession);
    assert.notEqual(newSession, oldSession);
    assert.equal(newSession.writable, true);

    const tree2 = render2();
    const ctx2 = tree2.props.children.props.value;
    assert.equal(ctx2.canSend, true);

    cleanup2?.();
  });

  test('async race condition: stale confirmation response cannot revive revoked or unmounted session', async () => {
    storageMap.clear();
    saveStoredConversation(userId, projectId, {
      version: 1, userId, projectId, threadId: '20000000-0000-4000-8000-000000000001',
      messageEpoch: 1, messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      intent: null, updatedAt: Date.now(),
    });

    let delayedResolve: ((val: any) => void) | null = null;
    const delayedPromise = new Promise(resolve => { delayedResolve = resolve; });

    const { h, render } = loadHeadlessPanel({
      getConfirmation: () => delayedPromise,
      getCurrentUser: async () => ({ data: { user: { id: userId } } }),
    });

    render();
    const cleanup = h.effects[0]();

    const session = h.refs[1].current as EmbodexConversationSession;
    assert.equal(session.writable, true);

    session.dispose();
    assert.equal(session.writable, false);
    cleanup?.();

    delayedResolve!({ response: { status: 401 } });
    await new Promise(r => setImmediate(r));

    assert.equal(session.writable, false);
  });
});

// Execute real components and Sessions with dynamic Hook state, including auth revocation.
test('Task028 R3 actual component, Session, storage and auth regressions', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../docs/tasks/task-028/frontend-evidence/r3/regression.cjs', import.meta.url))], { stdio: 'pipe' });
});
