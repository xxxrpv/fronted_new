import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

import { client } from '../lib/api/client';
import {
  parseSimcoreTrainingResult,
  type SanitizedTrainingResultData,
} from '../lib/simcore/training-result';
import {
  fetchSimcoreResources,
  createTrainingValidation,
  createTrainingTask,
  pollTrainingTask,
  cancelTrainingTask,
  reconcileTrainingTask,
  fetchTrainingResults,
  isTerminalStatus,
  getPollingIntervalMs,
  getResourceDisplayName,
  getTrainingRobotUnavailableReason,
  getTrainingRobotPublicationDiagnostic,
  SimcoreSubmissionSession,
  SimcorePollingController,
  resumeSimcoreTask,
  SimcoreProjectResourceManager,
  SimcoreAsyncScopeController,
  ResourceRequestCoordinator,
  type TrainingValidationParams,
} from '../lib/simcore/training-workflow';
import type { Resource, Task, Validation, TaskStatus, Result, ResultList, ProducedResourceRef } from '../lib/api/generated/types.gen';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Task-006 Simcore Frontend Integration & Orchestration Tests', () => {
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

  describe('Task-021 Embodex 模型发布与输入绑定', () => {
    const artifactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const resource = (id: string, sourceModule = 'embodex', type: 'ROBOT' | 'ALGORITHM' = 'ROBOT',
      specifications: Record<string, string> = {}): Resource => ({
      id, sourceModule, type, scope: 'PROJECT', externalId: id, version: '1', myProjectCount: 1,
      displayMetadata: { name: id, description: '', tags: [], specifications },
      createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z',
    });
    const ready = () => resource('embodex-ready', 'embodex', 'ROBOT', {
      workspacePublicationStatus: 'LOCATION_REGISTERED', workspaceArtifactId: artifactId,
    });
    const algorithm = () => resource('algorithm', 'simcore', 'ALGORITHM');

    test('仅完整发布状态及 canonical UUID 可用，拒绝缺失、畸形和伪造投影', () => {
      assert.equal(getTrainingRobotUnavailableReason(ready()), null);
      for (const status of ['PENDING', 'NOT_REGISTERED', 'NEEDS_ATTENTION', '', 'SUCCEEDED']) {
        const reason = getTrainingRobotUnavailableReason(resource(status, 'embodex', 'ROBOT', {
          workspacePublicationStatus: status, workspaceArtifactId: artifactId,
        }));
        assert.ok(reason);
        if (status === 'PENDING') assert.match(reason, /登记中/);
        if (status === 'NEEDS_ATTENTION') assert.match(reason, /生成已完成，发布需处理/);
      }
      for (const id of ['', 'latest', artifactId.toUpperCase(), `${artifactId}\n`, '00000000-0000-0000-0000-000000000000']) {
        assert.match(getTrainingRobotUnavailableReason(resource('bad', 'embodex', 'ROBOT', {
          workspacePublicationStatus: 'LOCATION_REGISTERED', workspaceArtifactId: id,
        }))!, /回执无效/);
      }
      assert.ok(getTrainingRobotUnavailableReason(resource('wrong-source', 'linkor')));
      assert.ok(getTrainingRobotUnavailableReason(resource('wrong-type', 'embodex', 'ALGORITHM')));
      assert.equal(getTrainingRobotUnavailableReason(resource('legacy', 'simcore')), null);
    });

    test('v1.6只读诊断按状态与阶段白名单展示，pending UUID严格隔离', () => {
      const diagnostic = (status: string, stage: string, code: string, id = artifactId) =>
        getTrainingRobotPublicationDiagnostic(resource('model', 'embodex', 'ROBOT', {
          workspacePublicationStatus: status, workspacePublicationStage: stage, workspacePublicationCode: code,
          workspacePendingArtifactId: id, workspaceArtifactId: artifactId,
        }))!;
      for (const status of ['PENDING', 'NEEDS_ATTENTION']) {
        const code = status === 'PENDING' ? 'PUBLICATION_RESPONSE_UNCONFIRMED' : 'PUBLICATION_CONFLICT';
        for (const stage of ['LOCAL_PUBLICATION', 'WORKSPACE_REGISTRATION', 'LOCATION_REGISTRATION']) {
          const value = diagnostic(status, stage, code);
          assert.equal(value.pendingArtifactId, stage === 'LOCATION_REGISTRATION' ? artifactId : undefined);
          assert.equal(value.code, status === 'PENDING' && stage === 'LOCAL_PUBLICATION' ? undefined : code);
          assert.equal('workspaceArtifactId' in value, false);
        }
        for (const id of [artifactId.toUpperCase(), `${artifactId}\n`, '<script>bad</script>', '', '00000000-0000-0000-0000-000000000000']) {
          assert.equal(diagnostic(status, 'LOCATION_REGISTRATION', code, id).pendingArtifactId, undefined);
        }
        assert.equal(diagnostic(status, '<script>stage</script>', code).stage, undefined);
        assert.equal(diagnostic(status, 'WORKSPACE_REGISTRATION', '<script>code</script>').code, undefined);
        assert.equal(diagnostic(status, 'WORKSPACE_REGISTRATION', status === 'PENDING' ? 'PUBLICATION_CONFLICT' : 'PUBLICATION_PENDING').code, undefined);
      }
      for (const status of ['LOCATION_REGISTERED', 'NOT_REGISTERED', '<script>status</script>']) {
        const value = diagnostic(status, 'LOCATION_REGISTRATION', 'PUBLICATION_CONFLICT');
        assert.equal(value.pendingArtifactId, undefined);
        assert.equal(value.stage, undefined);
        assert.equal(value.code, undefined);
      }
      assert.equal(getTrainingRobotPublicationDiagnostic(resource('legacy', 'simcore')), null);
      assert.equal(getTrainingRobotPublicationDiagnostic(resource('algorithm', 'embodex', 'ALGORITHM')), null);
    });

    test('项目接口保留未发布模型供说明，兼容旧模型并严格过滤 algorithm 来源', async () => {
      client.get = (async (options: any) => {
        assert.equal(options.path.projectId, 'project-A');
        return { data: { items: [resource('pending'), ready(), resource('legacy', 'simcore'), algorithm(),
          resource('foreign', 'linkor'), resource('wrong-algorithm', 'embodex', 'ALGORITHM')],
          pageInfo: { hasMore: false, nextCursor: null } }, response: { status: 200 } };
      }) as any;
      const group = await fetchSimcoreResources('project-A');
      assert.deepEqual(group.robots.map((r) => r.id), ['pending', 'embodex-ready', 'legacy']);
      assert.deepEqual(group.algorithms.map((r) => r.id), ['algorithm']);
    });

    test('不可用模型不能自动或手动选中，过期发布状态与切项目均阻止提交', async () => {
      const manager = new SimcoreProjectResourceManager();
      const published = ready();
      await manager.load('project-A', async () => ({ robots: [resource('pending'), published], algorithms: [algorithm()] }));
      assert.equal(manager.getState().selectedRobotId, published.id);
      manager.setSelectedRobotId('pending');
      assert.equal(manager.getState().selectedRobotId, published.id);
      assert.equal(manager.validateSelection('project-A', 'pending', 'algorithm').valid, false);
      assert.equal(manager.validateSelection('project-A', published.id, 'algorithm').valid, true);
      assert.equal(manager.validateSelection('project-B', published.id, 'algorithm').valid, false);
      published.displayMetadata.specifications.workspacePublicationStatus = 'PENDING';
      assert.equal(manager.validateSelection().valid, false);
      manager.resetForProject('project-B');
      assert.equal(manager.validateSelection('project-B', published.id, 'algorithm').valid, false);
      await manager.load('project-B', async () => ({ robots: [resource('failed', 'embodex', 'ROBOT', {
        workspacePublicationStatus: 'NEEDS_ATTENTION',
      })], algorithms: [algorithm()] }));
      assert.equal(manager.getState().selectedRobotId, '');
      assert.equal(manager.validateSelection().valid, false);
    });

    test('提交只传选中的 Resource ID 与原训练参数，不传 artifact 或位置', async () => {
      client.post = (async (options: any) => {
        assert.deepEqual(options.body, { projectId: 'project-A', actionKey: 'SIMCORE_TRAINING',
          inputs: { robot: ready().id, algorithm: algorithm().id },
          configSnapshot: { totalSteps: 512, presentationMode: 'visible' } });
        return { data: { id: 'validation' }, response: { status: 201 } };
      }) as any;
      await createTrainingValidation({ projectId: 'project-A', robotResourceId: ready().id,
        algorithmResourceId: algorithm().id, totalSteps: 512, presentationMode: 'visible' });
    });

    test('实际组件展示不可选原因，伪造选中未发布模型或旧项目时直接阻止 API 提交', async () => {
      const pending = resource('pending', 'embodex', 'ROBOT', {
        workspacePublicationStatus: 'PENDING', workspacePublicationStage: 'LOCATION_REGISTRATION',
        workspacePublicationCode: 'PUBLICATION_RESPONSE_UNCONFIRMED', workspacePendingArtifactId: artifactId,
      });
      const attention = resource('attention', 'embodex', 'ROBOT', {
        workspacePublicationStatus: 'NEEDS_ATTENTION', workspacePublicationStage: 'WORKSPACE_REGISTRATION',
        workspacePublicationCode: 'PUBLICATION_CONFLICT', workspacePendingArtifactId: artifactId,
      });
      attention.displayMetadata.name = '<script>diagnostic</script>';
      const manager = new SimcoreProjectResourceManager();
      await manager.load('project-A', async () => ({ robots: [pending, attention, ready()], algorithms: [algorithm()] }));
      const filename = path.resolve(__dirname, '../components/simcore/SimcoreTrainingView.tsx');
      const tsRequire = createRequire(filename)('jiti').createJiti(filename, { jsx: true });
      let requests = 0;
      client.post = (async () => { requests++; throw new Error('must not submit'); }) as any;
      for (const projectId of ['project-A', 'project-B']) {
        let slot = 0;
        const errors: unknown[] = [];
        const module = { exports: {} as any };
        const requireComponent = (id: string) => id === 'react' ? {
          __esModule: true, default: React,
          useState: (initial: unknown) => {
            const i = slot++;
            return [i === 0 ? { ...manager.getState(), selectedRobotId: 'pending' } : initial,
              (value: unknown) => { if (i === 6) errors.push(value); }];
          },
          useRef: (current: unknown) => ({ current: current instanceof SimcoreProjectResourceManager ? manager : current }),
          useCallback: (fn: Function) => fn,
          useEffect: () => {},
        } : tsRequire(id);
        const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        });
        new Function('require', 'module', 'exports', compiled.outputText)(requireComponent, module, module.exports);
        const tree = module.exports.default({ projectId });
        const markup = renderToStaticMarkup(tree);
        assert.match(markup, /<option[^>]*value="pending"[^>]*disabled=""[^>]*>[^<]*发布登记中/);
        assert.match(markup, /<option value="embodex-ready">/);
        assert.match(markup, /<option[^>]*value="attention"[^>]*disabled=""/);
        const diagnostics = markup.match(/<section aria-label="Embodex 模型发布诊断"[\s\S]*?<\/section>/)?.[0];
        assert.ok(diagnostics, '不可选模型诊断必须在下拉外可见');
        assert.match(diagnostics, /阶段：文件位置登记/);
        assert.match(diagnostics, /PUBLICATION_RESPONSE_UNCONFIRMED/);
        assert.match(diagnostics, /PUBLICATION_CONFLICT/);
        assert.match(diagnostics, /仅诊断，不可用于训练/);
        assert.equal(diagnostics.split(artifactId).length - 1, 1, '非Location阶段与ready模型不得泄漏pending UUID');
        assert.match(diagnostics, /已停止自动恢复/);
        assert.doesNotMatch(diagnostics, /发布失败|重试|<script>/);
        assert.match(diagnostics, /&lt;script&gt;diagnostic&lt;\/script&gt;/);
        const findStart = (node: any): any => {
          if (!node || typeof node !== 'object') return undefined;
          if (node.type === 'button' && node.props.children === '启动训练') return node;
          return React.Children.toArray(node.props?.children).map(findStart).find(Boolean);
        };
        const button = findStart(tree);
        assert.equal(button.props.disabled, true);
        await button.props.onClick();
        assert.ok(errors.length > 0);
      }
      assert.equal(requests, 0);
    });
  });

  // =========================================================================
  // 1. Resource 检索、过滤、游标分页与超限保护 (F-06)
  // =========================================================================
  describe('1. Resource 过滤与游标分页测试 (fetchSimcoreResources)', () => {
    const createMockMeta = (name: string, extra: Record<string, any> = {}) => ({
      name,
      description: '',
      tags: [] as string[],
      specifications: {} as Record<string, string>,
      ...extra,
    });

    test('正确基于项目关联接口请求，且只接受 sourceModule=simcore 的 ROBOT 与 ALGORITHM', async () => {
      const mockProjectId = 'proj-test-01';

      client.get = (async (options: any) => {
        assert.equal(options.url, '/api/v1/projects/{projectId}/resources');
        assert.equal(options.path?.projectId || options.query?.projectId, mockProjectId);

        const items: Resource[] = [
          {
            id: 'res-robot-1',
            scope: 'PLATFORM',
            type: 'ROBOT',
            sourceModule: 'simcore',
            externalId: 'apartment_robot_soccer_goal_v1',
            version: '1.0.0',
            displayMetadata: createMockMeta('公寓踢球机器人', { title: '公寓踢球机器人' }),
            myProjectCount: 1,
            createdAt: '2026-09-20T00:00:00Z',
            updatedAt: '2026-09-20T00:00:00Z',
          },
          {
            id: 'res-algo-1',
            scope: 'PLATFORM',
            type: 'ALGORITHM',
            sourceModule: 'simcore',
            externalId: 'ppo',
            version: '1.0.0',
            displayMetadata: createMockMeta('PPO 强化学习算法'),
            myProjectCount: 1,
            createdAt: '2026-09-20T00:00:00Z',
            updatedAt: '2026-09-20T00:00:00Z',
          },
          {
            id: 'res-other-module',
            scope: 'PLATFORM',
            type: 'ROBOT',
            sourceModule: 'linkor', // 不属于 simcore，必须被过滤
            externalId: 'linkor-arm',
            version: '1.0.0',
            displayMetadata: createMockMeta('linkor-arm'),
            myProjectCount: 1,
            createdAt: '2026-09-20T00:00:00Z',
            updatedAt: '2026-09-20T00:00:00Z',
          },
          {
            id: 'res-other-algo',
            scope: 'PLATFORM',
            type: 'ALGORITHM',
            sourceModule: 'linkor', // 不属于 simcore，必须被过滤
            externalId: 'linkor-algo',
            version: '1.0.0',
            displayMetadata: createMockMeta('linkor-algo'),
            myProjectCount: 1,
            createdAt: '2026-09-20T00:00:00Z',
            updatedAt: '2026-09-20T00:00:00Z',
          },
        ];

        return {
          data: {
            items,
            pageInfo: { nextCursor: null, hasMore: false },
          },
          response: { status: 200 } as any,
        };
      }) as any;

      const { robots, algorithms } = await fetchSimcoreResources(mockProjectId);

      assert.equal(robots.length, 1);
      assert.equal(robots[0].id, 'res-robot-1');
      assert.equal(getResourceDisplayName(robots[0]), '公寓踢球机器人');

      assert.equal(algorithms.length, 1);
      assert.equal(algorithms[0].id, 'res-algo-1');
      assert.equal(getResourceDisplayName(algorithms[0]), 'PPO 强化学习算法');
    });

    test('游标分页正确遍历，不丢失候选资源', async () => {
      const mockProjectId = 'proj-pagination';
      const callQueries: any[] = [];

      client.get = (async (options: any) => {
        callQueries.push({ ...options.query });

        if (!options.query.cursor) {
          // Page 1
          return {
            data: {
              items: [
                {
                  id: 'robot-page-1',
                  projectId: mockProjectId,
                  type: 'ROBOT',
                  scope: 'PLATFORM',
                  sourceModule: 'simcore',
                  externalId: 'robot_1',
                  version: '1.0',
                  displayMetadata: createMockMeta('robot_1'),
                  myProjectCount: 1,
                  createdAt: '2026-09-20T00:00:00Z',
                  updatedAt: '2026-09-20T00:00:00Z',
                },
              ],
              pageInfo: { nextCursor: 'cursor_token_page2', hasMore: true },
            },
            response: { status: 200 } as any,
          };
        } else if (options.query.cursor === 'cursor_token_page2') {
          // Page 2
          return {
            data: {
              items: [
                {
                  id: 'algo-page-2',
                  projectId: mockProjectId,
                  type: 'ALGORITHM',
                  scope: 'PLATFORM',
                  sourceModule: 'simcore',
                  externalId: 'sac',
                  version: '1.0',
                  displayMetadata: createMockMeta('sac'),
                  myProjectCount: 1,
                  createdAt: '2026-09-20T00:00:00Z',
                  updatedAt: '2026-09-20T00:00:00Z',
                },
              ],
              pageInfo: { nextCursor: null, hasMore: false },
            },
            response: { status: 200 } as any,
          };
        }
        throw new Error('Unexpected cursor: ' + options.query.cursor);
      }) as any;

      const { robots, algorithms } = await fetchSimcoreResources(mockProjectId);

      assert.equal(callQueries.length, 2);
      assert.equal(callQueries[0].cursor, undefined);
      assert.equal(callQueries[1].cursor, 'cursor_token_page2');

      assert.equal(robots.length, 1);
      assert.equal(robots[0].id, 'robot-page-1');
      assert.equal(algorithms.length, 1);
      assert.equal(algorithms[0].id, 'algo-page-2');
    });

    test('F-06: 分页超过安全深度且仍有后续页时，显式抛出错误拒绝静默截断', async () => {
      client.get = (async (options: any) => {
        const cur = options.query.cursor ? parseInt(options.query.cursor, 10) : 0;
        return {
          data: {
            items: [],
            pageInfo: { nextCursor: String(cur + 1), hasMore: true },
          },
          response: { status: 200 } as any,
        };
      }) as any;

      await assert.rejects(
        async () => {
          await fetchSimcoreResources('proj-overflow');
        },
        { message: /Resource pagination exceeded safe maximum page depth/ },
      );
    });

    test('空资源响应时不回退到 Demo 数据', async () => {
      client.get = (async () => ({
        data: {
          items: [],
          pageInfo: { nextCursor: null, hasMore: false },
        },
        response: { status: 200 } as any,
      })) as any;

      const { robots, algorithms } = await fetchSimcoreResources('proj-empty');
      assert.equal(robots.length, 0);
      assert.equal(algorithms.length, 0);
    });

    // -----------------------------------------------------------------------
    // R3-01: Project 切换资源隔离、世代失效与 Selection 校验测试
    // -----------------------------------------------------------------------
    test('R3-01 A: Project A → B 切换后清空旧选项并自动选中 B 的 Resource', async () => {
      const manager = new SimcoreProjectResourceManager();

      const mockFetch = async (pid: string) => {
        if (pid === 'proj-A') {
          return {
            robots: [
              {
                id: 'rob-A1',
                projectId: 'proj-A',
                type: 'ROBOT' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-rob-a',
                version: '1.0',
                displayMetadata: createMockMeta('rob-A1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
            algorithms: [
              {
                id: 'algo-A1',
                projectId: 'proj-A',
                type: 'ALGORITHM' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-algo-a',
                version: '1.0',
                displayMetadata: createMockMeta('algo-A1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
          };
        }
        if (pid === 'proj-B') {
          return {
            robots: [
              {
                id: 'rob-B1',
                projectId: 'proj-B',
                type: 'ROBOT' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-rob-b',
                version: '1.0',
                displayMetadata: createMockMeta('rob-B1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
            algorithms: [
              {
                id: 'algo-B1',
                projectId: 'proj-B',
                type: 'ALGORITHM' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-algo-b',
                version: '1.0',
                displayMetadata: createMockMeta('algo-B1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
          };
        }
        return { robots: [], algorithms: [] };
      };

      // 1. 加载 Project A
      await manager.load('proj-A', mockFetch);
      assert.equal(manager.getState().projectId, 'proj-A');
      assert.equal(manager.getState().selectedRobotId, 'rob-A1');
      assert.equal(manager.getState().selectedAlgorithmId, 'algo-A1');
      assert.equal(manager.validateSelection().valid, true);

      // 2. 导航切换至 Project B
      await manager.load('proj-B', mockFetch);
      const stateB = manager.getState();

      // 核心断言：完全切换到 B 的 Resource 与 ID，不得残留 A 的 ID
      assert.equal(stateB.projectId, 'proj-B');
      assert.equal(stateB.robots.length, 1);
      assert.equal(stateB.robots[0].id, 'rob-B1');
      assert.equal(stateB.algorithms.length, 1);
      assert.equal(stateB.algorithms[0].id, 'algo-B1');
      assert.equal(stateB.selectedRobotId, 'rob-B1');
      assert.equal(stateB.selectedAlgorithmId, 'algo-B1');
      assert.equal(manager.validateSelection().valid, true);
    });

    test('R3-01 B: Project A 的迟到响应绝不能覆盖 Project B 的资源状态', async () => {
      const manager = new SimcoreProjectResourceManager();

      let resolveA: (val: any) => void;
      const inFlightPromiseA = new Promise((resolve) => {
        resolveA = resolve;
      });

      const mockFetch = async (pid: string) => {
        if (pid === 'proj-A') {
          return inFlightPromiseA as any;
        }
        if (pid === 'proj-B') {
          return {
            robots: [
              {
                id: 'rob-B1',
                projectId: 'proj-B',
                type: 'ROBOT' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-rob-b',
                version: '1.0',
                displayMetadata: createMockMeta('rob-B1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
            algorithms: [
              {
                id: 'algo-B1',
                projectId: 'proj-B',
                type: 'ALGORITHM' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-algo-b',
                version: '1.0',
                displayMetadata: createMockMeta('algo-B1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
          };
        }
        return { robots: [], algorithms: [] };
      };

      // 1. 触发 Project A 加载（处于挂起中）
      const loadAPromise = manager.load('proj-A', mockFetch);

      // 2. 立即切换到 Project B
      const loadBPromise = manager.load('proj-B', mockFetch);
      await loadBPromise;

      assert.equal(manager.getState().projectId, 'proj-B');
      assert.equal(manager.getState().selectedRobotId, 'rob-B1');

      // 3. 此时 Project A 的慢响应才延迟到达
      resolveA!({
        robots: [
          {
            id: 'rob-A-STALE',
            projectId: 'proj-A',
            type: 'ROBOT' as const,
            scope: 'PLATFORM' as const,
            sourceModule: 'simcore',
            externalId: 'ext-rob-a',
            version: '1.0',
            displayMetadata: createMockMeta('rob-A-STALE'),
            myProjectCount: 1,
            createdAt: '2026-09-22T00:00:00Z',
            updatedAt: '2026-09-22T00:00:00Z',
          },
        ],
        algorithms: [
          {
            id: 'algo-A-STALE',
            projectId: 'proj-A',
            type: 'ALGORITHM' as const,
            scope: 'PLATFORM' as const,
            sourceModule: 'simcore',
            externalId: 'ext-algo-a',
            version: '1.0',
            displayMetadata: createMockMeta('algo-A-STALE'),
            myProjectCount: 1,
            createdAt: '2026-09-22T00:00:00Z',
            updatedAt: '2026-09-22T00:00:00Z',
          },
        ],
      });
      const aResult = await loadAPromise;

      // 核心断言：A 的迟到响应被丢弃（返回 false），最终状态依然是 Project B
      assert.equal(aResult, false, 'Stale response for A must be discarded');
      const finalState = manager.getState();
      assert.equal(finalState.projectId, 'proj-B');
      assert.equal(finalState.selectedRobotId, 'rob-B1');
      assert.equal(finalState.robots[0].id, 'rob-B1');
    });

    test('R3-01 C: 切换到无资源的 Project B 时，清空选择，绝不继承 Project A 的 ID，且提交校验失败', async () => {
      const manager = new SimcoreProjectResourceManager();

      const mockFetch = async (pid: string) => {
        if (pid === 'proj-A') {
          return {
            robots: [
              {
                id: 'rob-A1',
                projectId: 'proj-A',
                type: 'ROBOT' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-rob-a',
                version: '1.0',
                displayMetadata: createMockMeta('rob-A1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
            algorithms: [
              {
                id: 'algo-A1',
                projectId: 'proj-A',
                type: 'ALGORITHM' as const,
                scope: 'PLATFORM' as const,
                sourceModule: 'simcore',
                externalId: 'ext-algo-a',
                version: '1.0',
                displayMetadata: createMockMeta('algo-A1'),
                myProjectCount: 1,
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
            ],
          };
        }
        // Project B 无任何资源
        return { robots: [], algorithms: [] };
      };

      // 1. Project A 正常加载并有选中 ID
      await manager.load('proj-A', mockFetch);
      assert.equal(manager.getState().selectedRobotId, 'rob-A1');

      // 2. 切换至无资源的 Project B
      await manager.load('proj-B', mockFetch);
      const stateB = manager.getState();

      // 核心断言：selectedRobotId 与 selectedAlgorithmId 必须被清空为 ''，不能继承 A 的 ID
      assert.equal(stateB.projectId, 'proj-B');
      assert.equal(stateB.selectedRobotId, '');
      assert.equal(stateB.selectedAlgorithmId, '');
      assert.equal(stateB.robots.length, 0);
      assert.equal(stateB.algorithms.length, 0);

      // 核心断言：校验失败，阻止训练启动
      const check = manager.validateSelection();
      assert.equal(check.valid, false);
      assert.ok(check.error?.includes('必须同时选择'));
    });

    test('R3-01 D: 尝试跨项目提交外来 Resource ID 时被 validateSelection 拦截，保障强作用域隔离', async () => {
      const manager = new SimcoreProjectResourceManager();

      const mockFetch = async () => ({
        robots: [
          {
            id: 'rob-B1',
            projectId: 'proj-B',
            type: 'ROBOT' as const,
            scope: 'PLATFORM' as const,
            sourceModule: 'simcore',
            externalId: 'ext-rob-b',
            version: '1.0',
            displayMetadata: createMockMeta('rob-B1'),
            myProjectCount: 1,
            createdAt: '2026-09-22T00:00:00Z',
            updatedAt: '2026-09-22T00:00:00Z',
          },
        ],
        algorithms: [
          {
            id: 'algo-B1',
            projectId: 'proj-B',
            type: 'ALGORITHM' as const,
            scope: 'PLATFORM' as const,
            sourceModule: 'simcore',
            externalId: 'ext-algo-b',
            version: '1.0',
            displayMetadata: createMockMeta('algo-B1'),
            myProjectCount: 1,
            createdAt: '2026-09-22T00:00:00Z',
            updatedAt: '2026-09-22T00:00:00Z',
          },
        ],
      });

      await manager.load('proj-B', mockFetch);

      // 尝试设置不属于当前项目的外来 ID
      manager.setSelectedRobotId('rob-A-FOREIGN'); // 非法 ID 被拒绝设置
      assert.equal(manager.getState().selectedRobotId, 'rob-B1');

      // 即使被篡改，validateSelection 仍提供 fail-closed 防御
      (manager as any).state.selectedRobotId = 'rob-FOREIGN';
      const check = manager.validateSelection();
      assert.equal(check.valid, false);
      assert.ok(check.error?.includes('不属于当前项目'));
    });
  });

  // =========================================================================
  // 2. Validation 契约与白名单提交
  // =========================================================================
  describe('2. Validation 契约与字段白名单测试 (createTrainingValidation)', () => {
    test('仅提交批准字段，且不包含 templateId/runName/script/command 等私有字段', async () => {
      let capturedBody: any = null;

      client.post = (async (options: any) => {
        assert.equal(options.url, '/api/v1/validations');
        capturedBody = options.body;

        return {
          data: {
            id: 'val-123',
            projectId: capturedBody.projectId,
            actionKey: capturedBody.actionKey,
            inputs: capturedBody.inputs,
            configSnapshot: capturedBody.configSnapshot,
            createdAt: '2026-09-21T00:00:00Z',
            updatedAt: '2026-09-21T00:00:00Z',
          } satisfies Validation,
          response: { status: 201 } as any,
        };
      }) as any;

      const res = await createTrainingValidation({
        projectId: 'proj-val',
        robotResourceId: 'rob-001',
        algorithmResourceId: 'algo-001',
        totalSteps: 32,
        presentationMode: 'headless',
      });

      assert.equal(res.id, 'val-123');
      assert.deepEqual(Object.keys(capturedBody).sort(), [
        'actionKey',
        'configSnapshot',
        'inputs',
        'projectId',
      ]);
      assert.equal(capturedBody.actionKey, 'SIMCORE_TRAINING');
      assert.deepEqual(capturedBody.inputs, {
        robot: 'rob-001',
        algorithm: 'algo-001',
      });
      assert.equal(res.actionKey, 'SIMCORE_TRAINING');
      assert.deepEqual(res.inputs, capturedBody.inputs);
      assert.equal(capturedBody.robotResourceId, undefined);
      assert.equal(capturedBody.algorithmResourceId, undefined);

      assert.deepEqual(Object.keys(capturedBody.configSnapshot).sort(), [
        'presentationMode',
        'totalSteps',
      ]);

      // 绝不包含以下字段
      assert.equal(capturedBody.templateId, undefined);
      assert.equal(capturedBody.runName, undefined);
      assert.equal(capturedBody.script, undefined);
      assert.equal(capturedBody.command, undefined);
      assert.equal(capturedBody.cwd, undefined);
    });

    test('拒绝非法 totalSteps (非正整数或浮点数)', async () => {
      await assert.rejects(
        async () => {
          await createTrainingValidation({
            projectId: 'proj-val',
            robotResourceId: 'rob-001',
            algorithmResourceId: 'algo-001',
            totalSteps: 0,
            presentationMode: 'headless',
          });
        },
        { message: /totalSteps must be a positive safe integer/ },
      );

      await assert.rejects(
        async () => {
          await createTrainingValidation({
            projectId: 'proj-val',
            robotResourceId: 'rob-001',
            algorithmResourceId: 'algo-001',
            totalSteps: 12.5,
            presentationMode: 'headless',
          });
        },
        { message: /totalSteps must be a positive safe integer/ },
      );
    });
  });

  // =========================================================================
  // 3. F-01 & F-02: 完整提交编排、重试防 409 与双击防护测试
  // =========================================================================
  describe('3. 提交会话编排、幂等性与重试测试 (SimcoreSubmissionSession)', () => {
    test('F-01: Validation 成功 + Task response lost + retry: 不重复创建 Validation，复用相同 validationId 与 Key', async () => {
      let validationCount = 0;
      let taskCallCount = 0;
      const taskCallBodies: any[] = [];
      const taskCallHeaders: any[] = [];

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          validationCount++;
          return {
            data: {
              id: `val-attempt-${validationCount}`,
              projectId: options.body.projectId,
              actionKey: options.body.actionKey,
              inputs: options.body.inputs,
              configSnapshot: options.body.configSnapshot,
              createdAt: '2026-09-22T00:00:00Z',
              updatedAt: '2026-09-22T00:00:00Z',
            } satisfies Validation,
            response: { status: 201 } as any,
          };
        }

        if (options.url === '/api/v1/tasks') {
          taskCallCount++;
          taskCallBodies.push({ ...options.body });
          taskCallHeaders.push({ ...options.headers });

          if (taskCallCount === 1) {
            // 模拟首次提交在网络层出现 504 Gateway Timeout 或连接断开
            return {
              error: { error: { message: 'Connection reset by peer' } },
              response: { status: 504 } as any,
            };
          }

          // 第二次重试成功返回
          return {
            data: {
              id: 'task-recovered-001',
              projectId: options.body.projectId,
              validationId: options.body.validationId,
              actionKey: 'SIMCORE_TRAINING',
              status: 'PENDING',
              idempotencyKey: options.headers['Idempotency-Key'],
              createdAt: '2026-09-22T00:00:00Z',
              updatedAt: '2026-09-22T00:00:00Z',
            },
            response: { status: 202 } as any,
          };
        }

        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      const session = new SimcoreSubmissionSession();
      const params = {
        projectId: 'proj-retry',
        robotResourceId: 'rob-1',
        algorithmResourceId: 'algo-1',
        totalSteps: 32,
        presentationMode: 'headless' as const,
      };

      // 首次提交尝试
      await assert.rejects(async () => {
        await session.submit(params, { isRetry: false });
      });

      assert.equal(validationCount, 1);
      assert.equal(taskCallCount, 1);
      const firstValidationId = session.getValidationId();
      const firstKey = session.getIdempotencyKey();
      assert.equal(firstValidationId, 'val-attempt-1');
      assert.ok(firstKey);
      assert.deepEqual(taskCallBodies[0], {
        projectId: params.projectId,
        validationId: firstValidationId,
        actionKey: 'SIMCORE_TRAINING',
      });

      // 用户点击“重试提交 (复用Key与Validation)”
      const recoveredTask = await session.submit(params, { isRetry: true });

      // 核心断言：绝不调用第二次 createValidation！
      assert.equal(validationCount, 1, 'Retry must NOT create a second Validation');
      assert.equal(taskCallCount, 2, 'Task endpoint called twice');

      // 核心断言：两次 createTask 的 validationId 和 Idempotency-Key 必须完全一致（防止 409 IDEMPOTENCY_CONFLICT）
      assert.equal(taskCallBodies[1].validationId, firstValidationId);
      assert.equal(taskCallHeaders[1]['Idempotency-Key'], firstKey);
      assert.deepEqual(taskCallBodies[1], taskCallBodies[0]);
      assert.equal(recoveredTask.id, 'task-recovered-001');
      assert.equal(recoveredTask.actionKey, 'SIMCORE_TRAINING');

      // 开启新任务 (resetNewRun)
      session.resetNewRun();
      assert.equal(session.getValidationId(), null);
      assert.equal(session.getIdempotencyKey(), null);

      await session.submit(params, { isRetry: false });
      assert.equal(validationCount, 2, 'New run creates a new validation');
      assert.notEqual(session.getIdempotencyKey(), firstKey, 'New run generates a fresh key');
      assert.deepEqual(taskCallBodies[2], {
        projectId: params.projectId,
        validationId: 'val-attempt-2',
        actionKey: 'SIMCORE_TRAINING',
      });
    });

    test('F-02: Double click 并发防护测试：正在提交时抛出错误，阻止并发请求', async () => {
      let resolvePromise: (value: any) => void;
      const hangingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      client.post = (async () => hangingPromise) as any;

      const session = new SimcoreSubmissionSession();
      const params = {
        projectId: 'p',
        robotResourceId: 'r',
        algorithmResourceId: 'a',
        totalSteps: 32,
        presentationMode: 'headless' as const,
      };

      // 触发第一次提交（未完成）
      const p1 = session.submit(params);

      // 立即触发第二次提交（模拟用户连续快速双击）
      await assert.rejects(
        async () => {
          await session.submit(params);
        },
        { message: /Submission already in flight \(double-click prevented\)/ },
      );

      // 释放第一次请求
      resolvePromise!({
        data: { id: 'val-done', configSnapshot: {} },
        response: { status: 201 },
      });
      // 捕获后续任务调用以完成
      client.post = (async (options: any) => ({
        data: {
          id: 'task-done',
          projectId: options.body.projectId,
          validationId: options.body.validationId,
          actionKey: 'SIMCORE_TRAINING',
          status: 'PENDING',
          idempotencyKey: options.headers['Idempotency-Key'],
          createdAt: '2026-09-22T00:00:00Z',
          updatedAt: '2026-09-22T00:00:00Z',
        },
        response: { status: 202 },
      })) as any;

      await p1;
    });

    test('R2-03: Validation phase 失败时，lastFailedPhase="validation"，canRetryTask=false，且后续重试为全新 Validation 尝试', async () => {
      let validationCallCount = 0;
      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          validationCallCount++;
          return {
            error: { error: { message: 'Robot resource not available', code: 'INVALID_RESOURCE' } },
            response: { status: 400 } as any,
          };
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      const session = new SimcoreSubmissionSession();
      const params = {
        projectId: 'proj-val-fail',
        robotResourceId: 'rob-1',
        algorithmResourceId: 'algo-1',
        totalSteps: 32,
        presentationMode: 'headless' as const,
      };

      await assert.rejects(
        async () => {
          await session.submit(params, { isRetry: false });
        },
        { message: /Robot resource not available/ },
      );

      // 核心断言：阶段与重试语义
      assert.equal(session.getLastFailedPhase(), 'validation');
      assert.equal(session.canRetryTask(), false, 'Cannot retry Task when Validation failed');
      assert.equal(session.getValidationId(), null, 'No validationId held on validation failure');

      // 再次重试 (用户点击 "重新创建 Validation")
      await assert.rejects(async () => {
        await session.submit(params, { isRetry: true });
      });

      // 核心断言：由于无 validationId，重试会重新调用 createValidation
      assert.equal(validationCallCount, 2, 'Validation re-attempted as a fresh validation attempt');
    });

    test('R2-03: Task phase 失败时，lastFailedPhase="task"，canRetryTask=true，明确复用已成功的 Validation', async () => {
      let validationCount = 0;
      let taskCallCount = 0;

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          validationCount++;
          return {
            data: { id: 'val-success-1', configSnapshot: {} },
            response: { status: 201 } as any,
          };
        }
        if (options.url === '/api/v1/tasks') {
          taskCallCount++;
          return {
            error: { error: { message: 'Simcore backend timeout', code: 'SIMCORE_TIMEOUT' } },
            response: { status: 504 } as any,
          };
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      const session = new SimcoreSubmissionSession();
      const params = {
        projectId: 'proj-task-fail',
        robotResourceId: 'rob-1',
        algorithmResourceId: 'algo-1',
        totalSteps: 32,
        presentationMode: 'headless' as const,
      };

      await assert.rejects(
        async () => {
          await session.submit(params);
        },
        { message: /Simcore backend timeout/ },
      );

      // 核心断言：阶段与重试语义
      assert.equal(session.getLastFailedPhase(), 'task');
      assert.equal(session.canRetryTask(), true, 'Can retry Task when Validation succeeded');
      assert.equal(session.getValidationId(), 'val-success-1');
      assert.ok(session.getIdempotencyKey());
    });
  });

  // =========================================================================
  // 4. Task 轮询序列与状态机流转 (F-02)
  // =========================================================================
  describe('4. Task 轮询序列与状态流转测试', () => {
    test('PENDING -> RUNNING -> SUCCEEDED 完整轮询序列且终态停止轮询', () => {
      assert.equal(isTerminalStatus('PENDING'), false);
      assert.equal(getPollingIntervalMs('PENDING'), 3000);

      assert.equal(isTerminalStatus('RUNNING'), false);
      assert.equal(getPollingIntervalMs('RUNNING'), 3000);

      assert.equal(isTerminalStatus('SUCCEEDED'), true);
      assert.equal(getPollingIntervalMs('SUCCEEDED'), null);
    });

    test('RUNNING -> TIMEOUT -> RUNNING -> SUCCEEDED 恢复序列：TIMEOUT 降低频率且绝不自动 createTask', () => {
      // 运行态: 3秒
      assert.equal(getPollingIntervalMs('RUNNING'), 3000);

      // TIMEOUT: 10秒 (非终态，保持轮询)
      assert.equal(isTerminalStatus('TIMEOUT'), false);
      assert.equal(getPollingIntervalMs('TIMEOUT'), 10000);

      // 恢复 RUNNING: 恢复 3秒
      assert.equal(getPollingIntervalMs('RUNNING'), 3000);

      // 达成 SUCCEEDED: 停止轮询
      assert.equal(isTerminalStatus('SUCCEEDED'), true);
      assert.equal(getPollingIntervalMs('SUCCEEDED'), null);
    });

    test('FAILED 与 CANCELED 终态正确判定', () => {
      assert.equal(isTerminalStatus('FAILED'), true);
      assert.equal(getPollingIntervalMs('FAILED'), null);

      assert.equal(isTerminalStatus('CANCELED'), true);
      assert.equal(getPollingIntervalMs('CANCELED'), null);
    });

    // -----------------------------------------------------------------------
    // R2-01: Polling Generation Invalidation & Cancellation Boundary
    // -----------------------------------------------------------------------
    test('R2-01: in-flight poll request 在 cancel() 后 resolve，不触发 onUpdate 且不 schedule next poll', async () => {
      const controller = new SimcorePollingController();
      let resolveTask: (task: Task) => void;
      const inFlightPromise = new Promise<Task>((resolve) => {
        resolveTask = resolve;
      });

      let updateCalls = 0;
      let errorCalls = 0;
      let terminalCalls = 0;

      controller.start(
        'task-inflight-01',
        'RUNNING',
        {
          onUpdate: () => {
            updateCalls++;
          },
          onError: () => {
            errorCalls++;
          },
          onTerminal: () => {
            terminalCalls++;
          },
        },
        {
          intervalProvider: () => 1, // 1ms 立即触发
          getTaskFn: async () => inFlightPromise,
        },
      );

      // 等待 1ms timer 触发使得 getTaskFn 挂起在 inFlightPromise
      await new Promise((r) => setTimeout(r, 10));

      // 模拟组件卸载或用户离开页面 (调用 cancel)
      controller.cancel();
      assert.equal(controller.getIsPolling(), false);

      // 现在旧的 HTTP 请求成功返回
      resolveTask!({
        id: 'task-inflight-01',
        projectId: 'proj-1',
        validationId: 'val-1',
        actionKey: 'SIMCORE_TRAINING',
        status: 'RUNNING',
        idempotencyKey: 'k-1',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      // 等待异步 microtasks 完成
      await new Promise((r) => setTimeout(r, 20));

      // 核心断言：回调绝不被触发，且不会启动新的 polling loop
      assert.equal(updateCalls, 0, 'onUpdate must NOT be called for cancelled poll');
      assert.equal(errorCalls, 0, 'onError must NOT be called');
      assert.equal(terminalCalls, 0, 'onTerminal must NOT be called');
      assert.equal(controller.getIsPolling(), false, 'Polling loop must remain stopped');
    });

    test('R2-01: task A 正在飞行中切换至 task B，task A 返回不得覆盖 task B 或复活旧轮询', async () => {
      const controller = new SimcorePollingController();
      let resolveTaskA: (task: Task) => void;
      const inFlightPromiseA = new Promise<Task>((resolve) => {
        resolveTaskA = resolve;
      });

      const updatedTasks: Task[] = [];

      // 启动 task A
      controller.start(
        'task-A',
        'RUNNING',
        {
          onUpdate: (t) => {
            updatedTasks.push(t);
          },
          onError: () => {},
        },
        {
          intervalProvider: () => 1,
          getTaskFn: async (id) =>
            id === 'task-A'
              ? inFlightPromiseA
              : {
                  id: 'task-B',
                  projectId: 'proj-1',
                  validationId: 'val-b',
                  actionKey: 'SIMCORE_TRAINING',
                  status: 'RUNNING',
                  idempotencyKey: 'k-b',
                  createdAt: '2026-09-22T00:00:00Z',
                  updatedAt: '2026-09-22T00:00:00Z',
                },
        },
      );

      // 等待 task A 发起请求
      await new Promise((r) => setTimeout(r, 10));

      // 用户切换到 task B (内部会 cancel 并启动新世代)
      controller.start(
        'task-B',
        'RUNNING',
        {
          onUpdate: (t) => {
            updatedTasks.push(t);
          },
          onError: () => {},
        },
        {
          intervalProvider: () => 1,
          getTaskFn: async () => ({
            id: 'task-B',
            projectId: 'proj-1',
            validationId: 'val-b',
            actionKey: 'SIMCORE_TRAINING',
            status: 'RUNNING',
            idempotencyKey: 'k-b',
            createdAt: '2026-09-22T00:00:00Z',
            updatedAt: '2026-09-22T00:00:00Z',
          }),
        },
      );

      // 等待 task B 轮询一次
      await new Promise((r) => setTimeout(r, 20));

      // 此时旧的 task A 响应延迟到达
      resolveTaskA!({
        id: 'task-A',
        projectId: 'proj-1',
        validationId: 'val-a',
        actionKey: 'SIMCORE_TRAINING',
        status: 'SUCCEEDED',
        idempotencyKey: 'k-a',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      // 停止轮询
      controller.cancel();
      await new Promise((r) => setTimeout(r, 20));

      // 核心断言：updatedTasks 中只有 task-B，task-A 的响应被彻底作废
      assert.ok(updatedTasks.length > 0);
      assert.ok(
        updatedTasks.every((t) => t.id === 'task-B'),
        'All updates must belong to task-B',
      );
    });

    test('R2-01: poll request 飞行中发生错误，若已 cancel()，不得触发 onError 或 TIMEOUT 重试', async () => {
      const controller = new SimcorePollingController();
      let rejectTask: (err: any) => void;
      const inFlightPromise = new Promise<Task>((_, reject) => {
        rejectTask = reject;
      });

      let errorCalls = 0;

      controller.start(
        'task-inflight-err',
        'RUNNING',
        {
          onUpdate: () => {},
          onError: () => {
            errorCalls++;
          },
        },
        {
          intervalProvider: () => 1,
          getTaskFn: async () => inFlightPromise,
        },
      );

      await new Promise((r) => setTimeout(r, 10));
      controller.cancel();

      // 飞行中网络请求失败
      rejectTask!(new Error('Network error'));
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(errorCalls, 0, 'onError must NOT be called for cancelled poll');
      assert.equal(controller.getIsPolling(), false);
    });

    // -----------------------------------------------------------------------
    // R2-02: Refresh / Resume Acceptance (No Duplicate Creation)
    // -----------------------------------------------------------------------
    test('R2-02: resume existing task: 验证 getTask 恢复状态，绝不调用 createValidation 和 createTask (0次创建)', async () => {
      let validationCalls = 0;
      let taskCreationCalls = 0;
      let getTaskCalls = 0;

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          validationCalls++;
          return { data: { id: 'val-fake' }, response: { status: 201 } };
        }
        if (options.url === '/api/v1/tasks') {
          taskCreationCalls++;
          return {
            data: {
              id: 'task-fake',
              projectId: options.body.projectId,
              validationId: options.body.validationId,
              actionKey: 'SIMCORE_TRAINING',
              status: 'PENDING',
              idempotencyKey: options.headers['Idempotency-Key'],
              createdAt: '2026-09-22T00:00:00Z',
              updatedAt: '2026-09-22T00:00:00Z',
            },
            response: { status: 202 },
          };
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      const mockExistingTask: Task = {
        id: 'task-resume-100',
        projectId: 'proj-current',
        validationId: 'val-resume',
        actionKey: 'SIMCORE_TRAINING',
        status: 'RUNNING',
        idempotencyKey: 'k-resume',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      };

      const resumeResult = await resumeSimcoreTask({
        projectId: 'proj-current',
        initialTaskId: 'task-resume-100',
        getTaskFn: async (id) => {
          getTaskCalls++;
          assert.equal(id, 'task-resume-100');
          return mockExistingTask;
        },
      });

      // 核心断言
      assert.equal(resumeResult.status, 'resumed');
      if (resumeResult.status === 'resumed') {
        assert.equal(resumeResult.task.id, 'task-resume-100');
      }
      assert.equal(getTaskCalls, 1, 'getTask must be called once');
      assert.equal(validationCalls, 0, 'createValidation must NOT be called on resume (0 calls)');
      assert.equal(taskCreationCalls, 0, 'createTask must NOT be called on resume (0 calls)');
    });

    test('R2-02: project mismatch: task 所属项目不一致时拒绝恢复，且绝不调用 createValidation/createTask', async () => {
      let validationCalls = 0;
      let taskCreationCalls = 0;

      const mockMismatchTask: Task = {
        id: 'task-other-project-200',
        projectId: 'proj-other', // 不属于当前 projectId
        validationId: 'val-mismatch',
        actionKey: 'SIMCORE_TRAINING',
        status: 'RUNNING',
        idempotencyKey: 'k-mismatch',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      };

      const resumeResult = await resumeSimcoreTask({
        projectId: 'proj-current',
        initialTaskId: 'task-other-project-200',
        getTaskFn: async () => mockMismatchTask,
      });

      assert.equal(resumeResult.status, 'mismatch');
      if (resumeResult.status === 'mismatch') {
        assert.ok(resumeResult.error.includes('belongs to project proj-other, not proj-current'));
      }
      assert.equal(validationCalls, 0, 'No validation created on mismatch');
      assert.equal(taskCreationCalls, 0, 'No task created on mismatch');
    });

    test('R2-02: initialTaskId 查询失败或 404 时安全返回 error，不触发重试创建', async () => {
      let validationCalls = 0;
      let taskCreationCalls = 0;

      const resumeResult = await resumeSimcoreTask({
        projectId: 'proj-current',
        initialTaskId: 'task-not-found',
        getTaskFn: async () => {
          throw new Error('Task not found (HTTP 404)');
        },
      });

      assert.equal(resumeResult.status, 'error');
      if (resumeResult.status === 'error') {
        assert.equal(resumeResult.error, 'Task not found (HTTP 404)');
      }
      assert.equal(validationCalls, 0);
      assert.equal(taskCreationCalls, 0);
    });
  });

  // =========================================================================
  // 5. Result 严格解析器 (F-03) 与 结果加载错误暴露 (F-04)
  // =========================================================================
  describe('5. Result 严格解析器与错误状态暴露测试 (parseSimcoreTrainingResult & fetchTrainingResults)', () => {
    test('Task-014: SDK Result 引用必填，Simcore 空引用结果仍按 data 解析', async () => {
      const requiredReferences: {} extends Pick<Result, 'producedResources'> ? false : true = true;
      const references: Result['producedResources'] = [] satisfies ProducedResourceRef[];
      const result: Result = {
        id: '00000000-0000-4000-8000-000000000001',
        taskId: '00000000-0000-4000-8000-000000000002',
        sourceModule: 'simcore',
        summary: 'Training finished',
        data: { finalStatus: 'finished', runName: 'run-task-014', externalJobId: 'job-014' },
        producedResources: references,
        createdAt: '2026-10-04T00:00:00Z',
        updatedAt: '2026-10-04T00:00:00Z',
      };
      const page: ResultList = { items: [result], pageInfo: { nextCursor: null, hasMore: false } };
      client.get = (async (options: any) => {
        assert.equal(options.url, '/api/v1/tasks/{taskId}/results');
        assert.equal(options.path.taskId, result.taskId);
        return { data: page, response: { status: 200 } };
      }) as any;

      assert.equal(requiredReferences, true);
      assert.deepEqual(result.producedResources, []);
      const parsed = await fetchTrainingResults(result.taskId);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].runName, 'run-task-014');
      assert.equal(parsed[0].externalJobId, 'job-014');
    });

    test('合法的 finished 结果解析成功', () => {
      const validFinished = {
        finalStatus: 'finished',
        runName: 'embodix-task-001',
        externalJobId: 'job_simcore_999',
        returnCode: 0,
        artifacts: [
          { name: 'checkpoint_epoch_10.pt', kind: 'weights', size: 25165824 },
          { name: 'eval_metrics.csv', kind: 'csv', size: 1024 },
        ],
        curves: {
          mean_reward: {
            title: 'Mean Reward',
            label: 'Episode Mean Reward',
            points: [{ step: 100, value: -1.5 }, { step: 200, value: 0.2 }],
          },
        },
        artifactCorrelation: { strategy: 'run-name-prefix', confidence: 'weak' },
        metrics: { fps: 58.4, total_loss: 0.042 },
      };

      const parsed = parseSimcoreTrainingResult(validFinished);
      assert.ok(parsed);
      assert.equal(parsed.finalStatus, 'finished');
      assert.equal(parsed.runName, 'embodix-task-001');
      assert.equal(parsed.externalJobId, 'job_simcore_999');
      assert.equal(parsed.returnCode, 0);
      assert.equal(parsed.artifacts?.length, 2);
      assert.equal(parsed.metrics?.fps, 58.4);
    });

    test('合法的 rejected 结果解析成功', () => {
      const validRejected = {
        finalStatus: 'rejected',
        runName: 'embodix-rejected',
        failure: { code: 'SIMULATOR_CRASHED', message: 'Process exited unexpectedly' },
      };

      const parsed = parseSimcoreTrainingResult(validRejected);
      assert.ok(parsed);
      assert.equal(parsed.finalStatus, 'rejected');
      assert.equal(parsed.failure?.code, 'SIMULATOR_CRASHED');
      assert.equal(parsed.failure?.message, 'Process exited unexpectedly');
    });

    test('F-03: 拒绝非枚举 finalStatus', () => {
      assert.equal(parseSimcoreTrainingResult({ finalStatus: 'unknown', runName: 'run-1' }), null);
      assert.equal(parseSimcoreTrainingResult({ finalStatus: 'completed', runName: 'run-1' }), null);
    });

    test('F-03: 拒绝空白 runName', () => {
      assert.equal(parseSimcoreTrainingResult({ finalStatus: 'finished', runName: '   ', externalJobId: 'j1' }), null);
    });

    test('F-03: finished 缺少 externalJobId 时拒绝', () => {
      assert.equal(parseSimcoreTrainingResult({ finalStatus: 'finished', runName: 'run-1' }), null);
    });

    test('F-03: rejected 缺少 failure 时拒绝', () => {
      assert.equal(parseSimcoreTrainingResult({ finalStatus: 'rejected', runName: 'run-1' }), null);
    });

    test('F-03: artifact 含有路径分隔符时被剔除 (暴露泄露，不静默修好)', () => {
      const data = {
        finalStatus: 'finished',
        runName: 'embodix-1',
        externalJobId: 'job-1',
        artifacts: [
          { name: '/var/simcore/runs/embodix-1/leaked_path.pt' }, // 包含路径，必须被拒绝！
          { name: 'C:\\Users\\admin\\leaked_win.pt' }, // Windows 路径，必须被拒绝！
          { name: 'valid_clean_file.pt' }, // 合法干净文件名，接受
        ],
      };

      const parsed = parseSimcoreTrainingResult(data);
      assert.ok(parsed);
      assert.equal(parsed.artifacts?.length, 1);
      assert.equal(parsed.artifacts?.[0].name, 'valid_clean_file.pt');
    });

    test('F-03: 拒绝非数字的 metrics', () => {
      const data = {
        finalStatus: 'finished',
        runName: 'embodix-1',
        externalJobId: 'job-1',
        metrics: {
          valid_num: 42.5,
          bad_string: 'not a number',
          bad_bool: true,
        },
      };

      const parsed = parseSimcoreTrainingResult(data);
      assert.ok(parsed);
      assert.equal(parsed.metrics?.valid_num, 42.5);
      assert.equal((parsed.metrics as any)?.bad_string, undefined);
      assert.equal((parsed.metrics as any)?.bad_bool, undefined);
    });

    test('F-03: 拒绝非标准的 correlation 策略或置信度', () => {
      const data = {
        finalStatus: 'finished',
        runName: 'embodix-1',
        externalJobId: 'job-1',
        artifactCorrelation: {
          strategy: 'exact-match', // 非法策略
          confidence: 'high',
        },
      };

      const parsed = parseSimcoreTrainingResult(data);
      assert.ok(parsed);
      assert.equal(parsed.artifactCorrelation, undefined);
    });

    test('F-04: fetchTrainingResults 遇 500 或网络失败时显式抛出错误以供暴露给 UI', async () => {
      client.get = (async () => ({
        error: { error: { message: 'Internal Server Error' } },
        response: { status: 500 } as any,
      })) as any;

      await assert.rejects(
        async () => {
          await fetchTrainingResults('task-err');
        },
        { message: /Internal Server Error/ },
      );
    });
  });

  // =========================================================================
  // 6. 静态安全与架构边界断言 (无直连 Simcore / 无私有 API 泄露)
  // =========================================================================
  describe('6. 静态安全与架构边界扫描测试', () => {
    // Render the actual TSX with only Next route/Link and demo data replaced.
    const renderComponent = (relativePath: string, props: object, pathname = '') => {
      const filename = path.resolve(__dirname, '..', relativePath);
      const module = { exports: {} as any };
      const nativeRequire = createRequire(filename);
      const componentRequire = (id: string) => {
        if (id === 'next/navigation') return {
          usePathname: () => pathname,
          useParams: () => pathname.startsWith('/projects/') ? { projectId: pathname.split('/')[2] } : {},
        };
        if (id === 'next/link') return { __esModule: true, default: (linkProps: any) => React.createElement('a', linkProps) };
        if (id === '../lib/demo-data') return { getProjectById: () => ({ name: 'Demo 项目名称' }) };
        if (id === '../lib/api' || id.endsWith('/lib/api')) return { getProject: () => Promise.resolve({ data: null }), listProjects: () => Promise.resolve({ data: { items: [] } }) };
        return nativeRequire(id);
      };
      const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      });
      new Function('require', 'module', 'exports', compiled.outputText)(componentRequire, module, module.exports);
      return renderToStaticMarkup(React.createElement(module.exports.default, props));
    };

    test('C-06: 真实 Simcore Header 不伪造项目名称、运行状态或 FPS，Demo 页面保持原行为', () => {
      for (const pathname of ['/simcore', '/projects/real-project/simcore']) {
        const html = renderComponent('components/ProjectWorkflowHeader.tsx', {}, pathname);
        assert.doesNotMatch(html, /RUNNING|60 FPS|StageRun|实时就绪|Demo 项目名称|proj-embodix-01/);
        assert.match(html, /ACTIVE/);
        assert.match(html, pathname === '/simcore' ? /选择 Project/ : /双臂协作装配机械臂控制系统/);
      }
      const named = renderComponent('components/ProjectWorkflowHeader.tsx', { projectName: '真实项目' }, '/projects/real-project/simcore');
      assert.match(named, /真实项目/);
      const demo = renderComponent('components/ProjectWorkflowHeader.tsx', {}, '/embodex');
      assert.match(demo, /Demo 项目名称/);
      assert.match(demo, /StageRun #3/);
      const shell = fs.readFileSync(path.resolve(__dirname, '../components/AppShell.tsx'), 'utf8');
      assert.match(shell, /if \(isWorkflowPage\)[\s\S]*?<ProjectWorkflowHeader\s*\/>/);
    });

    test('C-07: 训练表单明确标注下一次草稿，与恢复的当前任务面板分离', () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../components/simcore/SimcoreTrainingView.tsx'), 'utf8');
      assert.match(source, /下一次训练配置（草稿）/);
      assert.match(source, /不代表已提交或恢复任务的配置/);
      assert.match(source, /平台任务状态/);
      const resumeEffect = source.slice(source.indexOf('// R2-02:'), source.indexOf('// R2-01 & R3-01 & R4-01 & R5-01: 组件卸载'));
      assert.match(resumeEffect, /applyTask\(res.task\)/);
      assert.doesNotMatch(resumeEffect, /handleStartTraining|\.submit\(|createTraining/);
    });

    test('C-09: 真实产物组件缺 kind 时显示未指定，有 kind 时保留声明类型', () => {
      const html = renderComponent('components/simcore/SimcoreArtifactsList.tsx', {
        artifacts: [{ name: 'episodes.csv' }, { name: 'run-directory' }, { name: 'final_model.zip', kind: 'checkpoint' }],
      });
      assert.equal((html.match(/类型: 未指定/g) || []).length, 2);
      assert.equal((html.match(/类型: checkpoint/g) || []).length, 1);
    });

    test('前端所有实现源码中绝不包含 192.168.0.235 或硬编码 Simcore 主机', () => {
      const frontendDir = path.resolve(__dirname, '..');
      const filesToCheck = [
        'app/simcore/page.tsx',
        'app/projects/[projectId]/simcore/page.tsx',
        'lib/simcore/training-result.ts',
        'lib/simcore/training-workflow.ts',
        'components/simcore/SimcoreTrainingView.tsx',
        'components/simcore/SimcoreCurvesChart.tsx',
        'components/simcore/SimcoreArtifactsList.tsx',
        'components/simcore/SimcoreDisabledNotice.tsx',
      ];

      for (const relPath of filesToCheck) {
        const fullPath = path.join(frontendDir, relPath);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, 'utf8');

        // 断言不存在硬编码 upstream IP
        assert.equal(
          content.includes('192.168.0.235'),
          false,
          `File ${relPath} must NOT contain upstream IP 192.168.0.235`,
        );

        // 断言不存在浏览器端直接访问的内部 upstream API 路径调用
        assert.equal(
          content.includes("fetch('/api/simulator") || content.includes('fetch("/api/simulator'),
          false,
          `File ${relPath} must NOT directly fetch /api/simulator`,
        );
        assert.equal(
          content.includes("fetch('/api/train") || content.includes('fetch("/api/train'),
          false,
          `File ${relPath} must NOT directly fetch /api/train`,
        );
        assert.equal(
          content.includes("fetch('/api/eval") || content.includes('fetch("/api/eval'),
          false,
          `File ${relPath} must NOT directly fetch /api/eval`,
        );

        // 断言不存在旧 Demo 的 fake 行为标识
        assert.equal(
          content.includes('web_robottraining'),
          false,
          `File ${relPath} must NOT contain hard-coded runName web_robottraining`,
        );
        assert.equal(
          content.includes('train_rl.py'),
          false,
          `File ${relPath} must NOT generate python train_rl.py command`,
        );
      }
    });

    test('全局 /simcore 页面不包含 fake fallback proj-embodix-01', () => {
      const globalSimcoreFile = path.resolve(__dirname, '../app/simcore/page.tsx');
      const content = fs.readFileSync(globalSimcoreFile, 'utf8');
      assert.equal(
        content.includes('proj-embodix-01'),
        false,
        'Global /simcore page must NOT fallback to proj-embodix-01',
      );
    });

    test('F-05: 页面 metric strip 不再包含假连接状态 Connected', () => {
      const projectSimcoreFile = path.resolve(
        __dirname,
        '../app/projects/[projectId]/simcore/page.tsx',
      );
      const content = fs.readFileSync(projectSimcoreFile, 'utf8');
      assert.equal(
        content.includes('Connected (OpenAPI 0.2.0)'),
        false,
        'Project Simcore page must NOT contain fake Connected (OpenAPI 0.2.0)',
      );
    });
  });

  // =========================================================================
  // 7. 异步读取世代隔离与 UI 状态保护测试 (R4-01)
  // =========================================================================
  describe('7. 异步读取世代隔离与 UI 状态保护测试 (R4-01: SimcoreAsyncScopeController & UI Wiring)', () => {
    interface SimulatedTrainingViewState {
      projectId: string;
      activeTask: Task | null;
      pollingError: string | null;
      results: SanitizedTrainingResultData[];
      loadingResults: boolean;
      resultError: string | null;
    }

    function createSimulatedView(initialProjectId: string) {
      const state: SimulatedTrainingViewState = {
        projectId: initialProjectId,
        activeTask: null,
        pollingError: null,
        results: [],
        loadingResults: false,
        resultError: null,
      };

      const asyncScope = new SimcoreAsyncScopeController(initialProjectId, '');
      let pollingStopped = false;
      let resultLoadCalls = 0;

      const stopPolling = () => {
        pollingStopped = true;
      };

      const loadResults = async (
        taskId: string,
        fetchFn: (tid: string) => Promise<SanitizedTrainingResultData[]>,
      ) => {
        resultLoadCalls++;
        return asyncScope.runGuardedResultFetch(
          state.projectId,
          taskId,
          fetchFn,
          {
            onStart: () => {
              state.loadingResults = true;
              state.resultError = null;
            },
            onSuccess: (res) => {
              state.results = res;
              state.resultError = null;
            },
            onError: (msg) => {
              state.resultError = msg;
            },
            onFinally: () => {
              state.loadingResults = false;
            },
          },
        );
      };

      const handleManualRefresh = async (
        fetchFn: (tid: string) => Promise<Task>,
        resultFetchFn: (tid: string) => Promise<SanitizedTrainingResultData[]>,
      ) => {
        if (!state.activeTask) return false;
        const currentTaskId = state.activeTask.id;
        return asyncScope.runGuardedTaskRefresh(
          state.projectId,
          currentTaskId,
          fetchFn,
          {
            onSuccess: (updated) => {
              state.activeTask = updated;
              state.pollingError = null;
              if (isTerminalStatus(updated.status)) {
                stopPolling();
                loadResults(updated.id, resultFetchFn);
              }
            },
            onError: (msg) => {
              state.pollingError = msg;
            },
          },
        );
      };

      const switchProject = (newProjectId: string) => {
        stopPolling();
        state.projectId = newProjectId;
        state.activeTask = null;
        state.results = [];
        state.resultError = null;
        state.pollingError = null;
        state.loadingResults = false;
        asyncScope.resetScope(newProjectId, '');
      };

      return {
        getState: () => state,
        setActiveTask: (t: Task) => {
          state.activeTask = t;
          asyncScope.setTaskId(t.id);
        },
        asyncScope,
        loadResults,
        handleManualRefresh,
        switchProject,
        isPollingStopped: () => pollingStopped,
        getResultLoadCalls: () => resultLoadCalls,
      };
    }

    test('R4-01 A: Project A task refresh in-flight -> switch Project B -> A response returns -> activeTask remains B/null -> does not trigger A result load', async () => {
      const view = createSimulatedView('proj-A');
      view.setActiveTask({
        id: 'task-A',
        projectId: 'proj-A',
        validationId: 'val-A',
        actionKey: 'SIMCORE_TRAINING',
        status: 'RUNNING',
        idempotencyKey: 'key-A',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      let resolveTaskA: (t: Task) => void;
      const inFlightTaskPromise = new Promise<Task>((resolve) => {
        resolveTaskA = resolve;
      });

      let resultFetchCalled = false;
      const mockResultFetch = async () => {
        resultFetchCalled = true;
        return [];
      };

      // 1. 在 Project A 上触发手动刷新（正在飞行中）
      const refreshPromise = view.handleManualRefresh(() => inFlightTaskPromise, mockResultFetch);

      // 2. 用户导航切换至 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().projectId, 'proj-B');
      assert.equal(view.getState().activeTask, null);

      // 3. Project A 的迟到响应返回（且为终态 SUCCEEDED）
      resolveTaskA!({
        id: 'task-A',
        projectId: 'proj-A',
        validationId: 'val-A',
        actionKey: 'SIMCORE_TRAINING',
        status: 'SUCCEEDED',
        idempotencyKey: 'key-A',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      const applied = await refreshPromise;

      // 核心断言：
      // 1) 返回 false（表示请求被废弃）
      // 2) Project B 上的 activeTask 依然保持为 null，不被 Project A 覆盖
      // 3) 绝不能触发 loadResults(task-A)
      assert.equal(applied, false, 'Stale refresh for Project A must be discarded');
      assert.equal(view.getState().activeTask, null, 'activeTask must remain null on Project B');
      assert.equal(resultFetchCalled, false, 'Must NOT trigger loadResults for stale task A');
      assert.equal(view.getResultLoadCalls(), 0);
    });

    test('R4-01 B: Project A refresh in-flight -> switch B -> A request rejects -> pollingError for A must not appear on B', async () => {
      const view = createSimulatedView('proj-A');
      view.setActiveTask({
        id: 'task-A',
        projectId: 'proj-A',
        validationId: 'val-A',
        actionKey: 'SIMCORE_TRAINING',
        status: 'RUNNING',
        idempotencyKey: 'key-A',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      let rejectTaskA: (err: Error) => void;
      const inFlightPromise = new Promise<Task>((_, reject) => {
        rejectTaskA = reject;
      });

      const refreshPromise = view.handleManualRefresh(() => inFlightPromise, async () => []);

      // 切换至 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().pollingError, null);

      // Project A 请求失败
      rejectTaskA!(new Error('Network timeout on Project A'));

      const applied = await refreshPromise;

      // 核心断言：
      // 1) 迟到错误被丢弃
      // 2) pollingError 绝不能出现在 Project B
      assert.equal(applied, false);
      assert.equal(view.getState().pollingError, null, 'pollingError for A must not appear on B');
    });

    test('R4-01 C: A terminal result request in-flight -> switch B -> A result returns -> B results remain empty/current-B', async () => {
      const view = createSimulatedView('proj-A');
      view.setActiveTask({
        id: 'task-A',
        projectId: 'proj-A',
        validationId: 'val-A',
        actionKey: 'SIMCORE_TRAINING',
        status: 'SUCCEEDED',
        idempotencyKey: 'key-A',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      let resolveResultsA: (res: SanitizedTrainingResultData[]) => void;
      const inFlightResultPromise = new Promise<SanitizedTrainingResultData[]>((resolve) => {
        resolveResultsA = resolve;
      });

      // 1. 触发 Project A 结果拉取（正在飞行中）
      const resultPromise = view.loadResults('task-A', () => inFlightResultPromise);
      assert.equal(view.getState().loadingResults, true);

      // 2. 切换至 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().results.length, 0);
      assert.equal(view.getState().loadingResults, false);

      // 3. Project A 的结果迟到返回
      resolveResultsA!([
        {
          runName: 'embodix-proj-a-run',
          finalStatus: 'finished',
          externalJobId: 'job-ext-a',
          metrics: {
            successRate: 0.95,
            meanReward: 120.5,
          },
          artifacts: [],
        },
      ]);

      const applied = await resultPromise;

      // 核心断言：
      // 1) 迟到结果被丢弃
      // 2) Project B 的 results 保持为空，未被 Project A 的结果污染
      // 3) loadingResults 保持为 false
      assert.equal(applied, false, 'Stale result for Project A must be discarded');
      assert.equal(view.getState().results.length, 0, 'Project B results must remain empty');
      assert.equal(view.getState().loadingResults, false);
    });

    test('R4-01 D: A result request in-flight -> switch B -> A request fails -> B resultError must remain unaffected', async () => {
      const view = createSimulatedView('proj-A');
      view.setActiveTask({
        id: 'task-A',
        projectId: 'proj-A',
        validationId: 'val-A',
        actionKey: 'SIMCORE_TRAINING',
        status: 'SUCCEEDED',
        idempotencyKey: 'key-A',
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      });

      let rejectResultsA: (err: Error) => void;
      const inFlightResultPromise = new Promise<SanitizedTrainingResultData[]>((_, reject) => {
        rejectResultsA = reject;
      });

      // 1. 触发 Project A 结果拉取
      const resultPromise = view.loadResults('task-A', () => inFlightResultPromise);

      // 2. 切换至 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().resultError, null);

      // 3. Project A 结果请求失败
      rejectResultsA!(new Error('Failed to fetch results for task-A from Platform Backend'));

      const applied = await resultPromise;

      // 核心断言：
      // 1) 错误被丢弃
      // 2) Project B 上的 resultError 保持为 null，不显示 A 的错误
      // 3) loadingResults 保持为 false
      assert.equal(applied, false);
      assert.equal(view.getState().resultError, null, 'Project B resultError must remain unaffected');
      assert.equal(view.getState().loadingResults, false);
    });
  });

  // =========================================================================
  // 8. 训练提交项目世代隔离与会话独立性测试 (R5-01: Submission Session & Lifecycle Guard)
  // =========================================================================
  describe('8. 训练提交项目世代隔离与会话独立性测试 (R5-01: Submission Session & Lifecycle Guard)', () => {
    interface SimulatedSubmissionViewState {
      projectId: string;
      activeTask: Task | null;
      isSubmitting: boolean;
      submitError: string | null;
    }

    function createSubmissionView(initialProjectId: string) {
      const state: SimulatedSubmissionViewState = {
        projectId: initialProjectId,
        activeTask: null,
        isSubmitting: false,
        submitError: null,
      };

      let session = new SimcoreSubmissionSession();
      const asyncScope = new SimcoreAsyncScopeController(initialProjectId, '');

      const handleStartTraining = async (
        isRetry = false,
        customSubmitFn?: (activeSession: SimcoreSubmissionSession) => Promise<Task>,
      ) => {
        const activeSession = session;
        const currentProjectId = state.projectId;
        const params: TrainingValidationParams = {
          projectId: currentProjectId,
          robotResourceId: 'rob-01',
          algorithmResourceId: 'algo-01',
          totalSteps: 32,
          presentationMode: 'headless',
        };

        return asyncScope.runGuardedSubmission(
          currentProjectId,
          () =>
            customSubmitFn
              ? customSubmitFn(activeSession)
              : activeSession.submit(params, { isRetry }),
          {
            onStart: () => {
              state.isSubmitting = true;
              state.submitError = null;
            },
            onSuccess: (task) => {
              asyncScope.setTaskId(task.id);
              state.activeTask = task;
            },
            onError: (msg) => {
              state.submitError = msg;
            },
            onFinally: () => {
              state.isSubmitting = false;
            },
            isSessionCurrent: () => session === activeSession,
          },
        );
      };

      const switchProject = (newProjectId: string) => {
        state.projectId = newProjectId;
        state.activeTask = null;
        state.isSubmitting = false;
        state.submitError = null;
        // R5-01: 替换为全新 Session 实例，保证旧 session 不污染新项目状态
        session = new SimcoreSubmissionSession();
        asyncScope.resetScope(newProjectId, '');
      };

      return {
        getState: () => state,
        getSession: () => session,
        handleStartTraining,
        switchProject,
        asyncScope,
      };
    }

    test('R5-01 A: Project A createValidation in-flight -> switch Project B -> A validation resolves -> no B submitError, new B session contains no validation-A, no task-A UI write', async () => {
      const view = createSubmissionView('proj-A');
      const sessionA = view.getSession();

      let resolveValidationA: (val: any) => void;
      const inFlightValidationPromise = new Promise((resolve) => {
        resolveValidationA = resolve;
      });

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          await inFlightValidationPromise;
          return { data: { id: 'val-A' }, response: { status: 201 } };
        }
        if (options.url === '/api/v1/tasks') {
          return {
            data: {
              id: 'task-A',
              projectId: 'proj-A',
              validationId: 'val-A',
              actionKey: 'SIMCORE_TRAINING',
              status: 'RUNNING' as TaskStatus,
              idempotencyKey: options.headers['Idempotency-Key'],
              createdAt: '2026-09-22T00:00:00Z',
              updatedAt: '2026-09-22T00:00:00Z',
            },
            response: { status: 202 },
          };
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      // 1. 触发 Project A 提交 (正在飞行中)
      const subPromiseA = view.handleStartTraining();
      assert.equal(view.getState().isSubmitting, true);

      // 2. 立即切换到 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().projectId, 'proj-B');
      assert.equal(view.getState().isSubmitting, false);
      assert.notEqual(view.getSession(), sessionA, 'Project B must have a new isolated session instance');

      // 3. Project A 的校验成功完成并继续向旧 session 写入
      resolveValidationA!({ id: 'val-A' });
      const appliedA = await subPromiseA;

      // 核心断言：
      // 1) 旧提交被彻底丢弃
      // 2) Project B 上的 activeTask 保持为 null
      // 3) Project B 上的 submitError 保持为 null
      // 4) Project B 的新 session 绝对不包含 validation-A
      // 5) Project B 的 retry 状态绝对不声称可重试 task
      assert.equal(appliedA, false, 'Project A submission must be discarded');
      assert.equal(view.getState().activeTask, null, 'No task-A written to Project B');
      assert.equal(view.getState().submitError, null, 'No submitError on Project B');
      assert.equal(view.getSession().getValidationId(), null, 'New B session must not contain validation-A');
      assert.equal(view.getSession().canRetryTask(), false, 'B retry state must not reference validation-A');
    });

    test('R5-01 B: A validation succeeded, A createTask in-flight -> switch B -> A createTask rejects -> B submitError remains null, B retry state does not reference A', async () => {
      const view = createSubmissionView('proj-A');

      let rejectTaskA: (err: Error) => void;
      const inFlightTaskPromise = new Promise((_, reject) => {
        rejectTaskA = reject;
      });

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          return { data: { id: 'val-A-success' }, response: { status: 201 } };
        }
        if (options.url === '/api/v1/tasks') {
          await inFlightTaskPromise;
          throw new Error('Backend 500 while creating task A');
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      // 1. 触发 Project A 提交 (validation 立即成功，挂起在 task creation)
      const subPromiseA = view.handleStartTraining();

      // 等待 validation phase 完成进入 task phase
      await new Promise((r) => setTimeout(r, 10));

      // 2. 切换到 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().submitError, null);

      // 3. Project A 的 Task 请求在旧 session 中失败
      rejectTaskA!(new Error('Backend 500 while creating task A'));
      const appliedA = await subPromiseA;

      // 核心断言：
      // 1) 错误被丢弃，绝不污染 Project B 的 submitError
      // 2) Project B 的新 session 保持干净，不残留 validation-A
      // 3) canRetryTask 必须为 false
      assert.equal(appliedA, false, 'Stale failed submission must be discarded');
      assert.equal(view.getState().submitError, null, 'B submitError must remain null');
      assert.equal(view.getSession().getValidationId(), null, 'B session does not reference validation-A');
      assert.equal(view.getSession().canRetryTask(), false, 'B retry state does not reference validation-A');
    });

    test('R5-01 C: A-old submission starts -> switch B -> switch back A -> A-old response returns -> old task must be discarded (ABA protection)', async () => {
      const view = createSubmissionView('proj-A');
      const sessionA1 = view.getSession();

      let resolveTaskA1: () => void;
      const inFlightPromiseA1 = new Promise((resolve) => {
        resolveTaskA1 = resolve as any;
      });

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          return { data: { id: 'val-A1' }, response: { status: 201 } };
        }
        if (options.url === '/api/v1/tasks') {
          await inFlightPromiseA1;
          return {
            data: {
              id: 'task-A-OLD',
              projectId: 'proj-A',
              validationId: 'val-A1',
              actionKey: 'SIMCORE_TRAINING',
              status: 'RUNNING' as TaskStatus,
              idempotencyKey: options.headers['Idempotency-Key'],
              createdAt: '2026-09-22T00:00:00Z',
              updatedAt: '2026-09-22T00:00:00Z',
            },
            response: { status: 202 },
          };
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      // 1. 在第一个 Project A 作用域下启动提交
      const subPromise1 = view.handleStartTraining();
      await new Promise((r) => setTimeout(r, 10));

      // 2. 切换到 Project B
      view.switchProject('proj-B');

      // 3. 再次切回 Project A (全新 A 作用域与新 Session)
      view.switchProject('proj-A');
      const sessionA2 = view.getSession();
      assert.notEqual(sessionA1, sessionA2, 'Must have allocated fresh session for new A scope');

      // 4. 旧的第一个 A 提交延迟成功返回
      resolveTaskA1!();
      const applied1 = await subPromise1;

      // 核心断言：
      // 世代不匹配（generation !== capturedGeneration）必须丢弃 ABA 迟到结果
      assert.equal(applied1, false, 'Old submission from prior ABA cycle must be discarded');
      assert.equal(view.getState().activeTask, null, 'Old task-A must NOT be accepted in new Project A scope');
    });

    test('R5-01 D: A submission in-flight -> switch B -> start B submission -> old A finally returns -> B isSubmitting/state remains controlled by B operation', async () => {
      const view = createSubmissionView('proj-A');

      let rejectA: (err: Error) => void;
      const inFlightPromiseA = new Promise((_, reject) => {
        rejectA = reject;
      });

      let resolveB: () => void;
      const inFlightPromiseB = new Promise((resolve) => {
        resolveB = resolve as any;
      });

      client.post = (async (options: any) => {
        if (options.body?.projectId === 'proj-A') {
          await inFlightPromiseA;
          throw new Error('Project A timed out');
        }
        if (options.body?.projectId === 'proj-B') {
          if (options.url === '/api/v1/validations') {
            return { data: { id: 'val-B' }, response: { status: 201 } };
          }
          if (options.url === '/api/v1/tasks') {
            await inFlightPromiseB;
            return {
              data: {
                id: 'task-B-SUCCESS',
                projectId: 'proj-B',
                validationId: 'val-B',
                actionKey: 'SIMCORE_TRAINING',
                status: 'RUNNING' as TaskStatus,
                idempotencyKey: options.headers['Idempotency-Key'],
                createdAt: '2026-09-22T00:00:00Z',
                updatedAt: '2026-09-22T00:00:00Z',
              },
              response: { status: 202 },
            };
          }
        }
        throw new Error('Unexpected POST: ' + options.url);
      }) as any;

      // 1. Project A 提交在途
      const subPromiseA = view.handleStartTraining();
      assert.equal(view.getState().isSubmitting, true);

      // 2. 切换到 Project B
      view.switchProject('proj-B');
      assert.equal(view.getState().isSubmitting, false);

      // 3. 在 Project B 启动新的提交
      const subPromiseB = view.handleStartTraining();
      assert.equal(view.getState().isSubmitting, true, 'Project B submission is now in-flight');

      // 4. 旧的 Project A 抛错并进入 finally
      rejectA!(new Error('Project A timed out'));
      await subPromiseA;

      // 断言：A 的 finally 返回后，绝不能把 Project B 正在进行中的 isSubmitting 误置为 false
      assert.equal(view.getState().isSubmitting, true, 'B isSubmitting must remain TRUE while B is still in-flight');
      assert.equal(view.getState().submitError, null, 'No error from A on Project B');

      // 5. Project B 正常返回成功
      resolveB!();
      const appliedB = await subPromiseB;

      assert.equal(appliedB, true, 'Project B submission successfully applied');
      assert.equal(view.getState().isSubmitting, false, 'B isSubmitting finishes cleanly when B completes');
      assert.equal(view.getState().activeTask?.id, 'task-B-SUCCESS');
    });
  });

  // =========================================================================
  // 9. Task-007 资源目录防抖竞态与详情路由世代隔离测试 (F-RE-01 & F-RE-02)
  // =========================================================================
  describe('9. Task-007 资源目录防抖竞态与详情路由世代隔离测试 (F-RE-01 & F-RE-02)', () => {
    test('F-RE-01 A: ResourceRequestCoordinator 核心状态机行为 (invalidate / isCurrent / getCurrentSeq)', () => {
      const coordinator = new ResourceRequestCoordinator();
      assert.equal(coordinator.getCurrentSeq(), 0);
      assert.equal(coordinator.isCurrent(0), true);
      assert.equal(coordinator.isCurrent(1), false);

      const seq1 = coordinator.invalidate();
      assert.equal(seq1, 1);
      assert.equal(coordinator.getCurrentSeq(), 1);
      assert.equal(coordinator.isCurrent(0), false);
      assert.equal(coordinator.isCurrent(1), true);

      const seq2 = coordinator.invalidate();
      assert.equal(seq2, 2);
      assert.equal(coordinator.isCurrent(1), false);
      assert.equal(coordinator.isCurrent(2), true);
    });

    test('F-RE-01 B: 生产事件时序：用户 onChange 同步 invalidate -> 在途请求 A 迟到返回 -> A 立即丢弃 -> 防抖结束后请求 B 成功生效', async () => {
      const coordinator = new ResourceRequestCoordinator();
      let state = {
        resources: [] as any[],
        counts: { all: 0, matched: 0 },
        isLoading: false,
      };

      let resolveA: (data: any) => void;
      const pendingA = new Promise((resolve) => {
        resolveA = resolve;
      });

      // 模拟组件中的 fetchResources 逻辑，严格使用 coordinator.isCurrent 进行世代防护
      const fetchResources = async (query: string, requestSeq: number) => {
        if (!coordinator.isCurrent(requestSeq)) return;
        state.isLoading = true;

        let resData: any;
        if (query === 'filter-A') {
          resData = await pendingA;
        } else if (query === 'filter-B') {
          resData = {
            items: [{ id: 'res-B', name: 'Resource B' }],
            counts: { all: 10, matched: 1 },
          };
        }

        // 关键世代隔离核对：若当前世代已被新的用户操作作废，禁止写入任何页面状态
        if (!coordinator.isCurrent(requestSeq)) return;
        state.resources = resData.items;
        state.counts = resData.counts;
        state.isLoading = false;
      };

      // 1. 页面初始挂载，发起 Filter A 请求 (捕获当前 seq = 0)
      const seqA = coordinator.getCurrentSeq();
      const promiseA = fetchResources('filter-A', seqA);
      assert.equal(state.isLoading, true);

      // 2. A 仍然正在网络飞行中 (pending)
      // 用户在搜索输入框中触发 onChange 事件：
      // 【关键修复点】：事件处理函数中必须先同步执行 coordinator.invalidate()，使当前世代立即变为 1
      const handleSearchInputChange = (newVal: string) => {
        coordinator.invalidate(); // 同步立即失效前序在途请求
        // 随后 React 触发状态更新并计划重新渲染
      };
      handleSearchInputChange('filter-B');

      // 此时 React 的 debounce timer 刚启动 (等待 250ms)，新请求 B 尚未发出
      const seqB = coordinator.getCurrentSeq();
      assert.equal(seqB, 1, 'Current generation must be incremented synchronously in the event handler');

      // 3. 【时序窗口验证】：在防抖到期前/请求 B 发出前，慢请求 A 此时 resolve 到达客户端
      resolveA!({
        items: [{ id: 'res-A', name: 'Resource A' }],
        counts: { all: 10, matched: 5 },
      });
      await promiseA;

      // 4. 断言：由于 onChange 事件已同步递增世代，A 判定 !isCurrent(seqA) 成立，被立即丢弃！
      // 绝不允许写入 state.resources 与 state.counts
      assert.equal(state.resources.length, 0, 'A must NOT commit resources while B is in debounce');
      assert.equal(state.counts.matched, 0, 'A must NOT commit counts while B is in debounce');

      // 5. 250ms 防抖定时器到期，发出请求 B (带 seqB)
      assert.equal(coordinator.isCurrent(seqB), true);
      await fetchResources('filter-B', seqB);

      // 6. 最终状态验证：页面完整且仅显示 Filter B 的响应结果
      assert.equal(state.resources.length, 1);
      assert.equal(state.resources[0].id, 'res-B');
      assert.equal(state.counts.matched, 1);
      assert.equal(state.isLoading, false);
    });

    test('F-RE-01 C: 覆盖全部筛选交互事件同步失效 (Clear Button, Type Tabs, Reset Button, Retry Button)', async () => {
      const coordinator = new ResourceRequestCoordinator();
      let state = {
        resources: [] as any[],
        counts: { all: 0, matched: 0 },
      };

      const executeGuardedFetch = async (seq: number, dataPromise: Promise<any>) => {
        if (!coordinator.isCurrent(seq)) return;
        const data = await dataPromise;
        if (!coordinator.isCurrent(seq)) return;
        state.resources = data.items;
        state.counts = data.counts;
      };

      // 场景 1: 清除搜索按钮 onClick
      {
        let resolveReq: (d: any) => void;
        const pendingReq = new Promise((res) => { resolveReq = res; });
        const curSeq = coordinator.getCurrentSeq();
        const p = executeGuardedFetch(curSeq, pendingReq);

        // 用户点击清除按钮：同步 invalidate
        coordinator.invalidate();

        // 慢请求返回
        resolveReq!({ items: [{ id: 'old-search' }], counts: { all: 1, matched: 1 } });
        await p;
        assert.equal(state.resources.length, 0, 'Clear button must synchronously invalidate in-flight request');
      }

      // 场景 2: 类型 Tab (ROBOT / ALGORITHM / ALL) onClick
      {
        let resolveReq: (d: any) => void;
        const pendingReq = new Promise((res) => { resolveReq = res; });
        const curSeq = coordinator.getCurrentSeq();
        const p = executeGuardedFetch(curSeq, pendingReq);

        // 用户点击 ROBOT Tab：同步 invalidate
        coordinator.invalidate();

        // 慢请求返回
        resolveReq!({ items: [{ id: 'old-tab' }], counts: { all: 1, matched: 1 } });
        await p;
        assert.equal(state.resources.length, 0, 'Type tab click must synchronously invalidate in-flight request');
      }

      // 场景 3: 空状态 "重置全部筛选" 按钮 onClick
      {
        let resolveReq: (d: any) => void;
        const pendingReq = new Promise((res) => { resolveReq = res; });
        const curSeq = coordinator.getCurrentSeq();
        const p = executeGuardedFetch(curSeq, pendingReq);

        // 用户点击重置全部筛选按钮：同步 invalidate
        coordinator.invalidate();

        // 慢请求返回
        resolveReq!({ items: [{ id: 'old-empty-state' }], counts: { all: 1, matched: 1 } });
        await p;
        assert.equal(state.resources.length, 0, 'Reset button must synchronously invalidate in-flight request');
      }

      // 场景 4: 错误状态 "重试加载" 按钮 onClick
      {
        let resolveReq: (d: any) => void;
        const pendingReq = new Promise((res) => { resolveReq = res; });
        const curSeq = coordinator.getCurrentSeq();
        const p = executeGuardedFetch(curSeq, pendingReq);

        // 用户点击重试按钮：同步 invalidate 并获得新 seq
        const retrySeq = coordinator.invalidate();
        assert.notEqual(retrySeq, curSeq);

        // 慢请求返回
        resolveReq!({ items: [{ id: 'old-error-retry' }], counts: { all: 1, matched: 1 } });
        await p;
        assert.equal(state.resources.length, 0, 'Retry button must synchronously invalidate in-flight request');
      }
    });

    test('F-RE-05 A: 重复点击当前激活的类型 Tab (ALL -> ALL, ROBOT -> ROBOT) 不得触发 invalidate，保留当前请求提交资格并关闭 loading', async () => {
      const coordinator = new ResourceRequestCoordinator();
      let currentTypeFilter: 'ALL' | 'ROBOT' | 'ALGORITHM' = 'ALL';
      let state = {
        resources: [] as any[],
        counts: { all: 0, matched: 0 },
        isLoading: false,
      };

      // 模拟生产代码中的 changeTypeFilter 守卫逻辑
      const changeTypeFilter = (next: 'ALL' | 'ROBOT' | 'ALGORITHM') => {
        if (next === currentTypeFilter) {
          return; // 已激活 Tab 点击为 no-op，绝对不触发 invalidate
        }
        coordinator.invalidate();
        currentTypeFilter = next;
      };

      let resolveReqA: (d: any) => void;
      const pendingReqA = new Promise((res) => { resolveReqA = res; });

      const fetchResources = async (seq: number) => {
        if (!coordinator.isCurrent(seq)) return;
        state.isLoading = true;
        const data = await pendingReqA as any;
        if (!coordinator.isCurrent(seq)) return;
        state.resources = data.items;
        state.counts = data.counts;
        state.isLoading = false;
      };

      // 1. 页面初始挂载，typeFilter 默认为 'ALL'，请求 A 在途 (seq = 0)
      const seq0 = coordinator.getCurrentSeq();
      assert.equal(seq0, 0);
      const promiseA = fetchResources(seq0);
      assert.equal(state.isLoading, true);

      // 2. 用户再次点击已经处于激活状态的 'ALL' Tab
      changeTypeFilter('ALL');

      // 核心断言：因为目标值与当前值相同，generation 绝对不能被递增 (seq 保持为 0)
      assert.equal(coordinator.getCurrentSeq(), 0, 'Clicking active tab must NOT increment generation');
      assert.equal(coordinator.isCurrent(seq0), true, 'Request A must remain current and valid');

      // 3. 请求 A 正常返回
      resolveReqA!({
        items: [{ id: 'res-all-1', name: 'Robot Alpha' }],
        counts: { all: 10, matched: 10 },
      });
      await promiseA;

      // 核心断言：A 正常提交，页面成功呈现数据，且 isLoading 正常关闭为 false (不卡死在 loading)
      assert.equal(state.resources.length, 1);
      assert.equal(state.counts.all, 10);
      assert.equal(state.isLoading, false, 'Loading must finish cleanly when active tab is re-clicked');

      // 4. 同理验证 ROBOT -> ROBOT 重复点击
      currentTypeFilter = 'ROBOT';
      const seqRobot = coordinator.getCurrentSeq();
      changeTypeFilter('ROBOT');
      assert.equal(coordinator.getCurrentSeq(), seqRobot, 'Clicking active ROBOT tab must be a no-op');
    });

    test('F-RE-05 B: 类型 Tab 真实切换 (ALL -> ROBOT -> ALGORITHM -> ALL) 严格触发同步 invalidate 并推进世代', async () => {
      const coordinator = new ResourceRequestCoordinator();
      let currentTypeFilter: 'ALL' | 'ROBOT' | 'ALGORITHM' = 'ALL';

      const changeTypeFilter = (next: 'ALL' | 'ROBOT' | 'ALGORITHM') => {
        if (next === currentTypeFilter) {
          return;
        }
        coordinator.invalidate();
        currentTypeFilter = next;
      };

      assert.equal(coordinator.getCurrentSeq(), 0);

      // 1. ALL -> ROBOT (值改变)
      changeTypeFilter('ROBOT');
      assert.equal(currentTypeFilter, 'ROBOT');
      assert.equal(coordinator.getCurrentSeq(), 1, 'ALL -> ROBOT must increment generation');

      // 2. ROBOT -> ALGORITHM (值改变)
      changeTypeFilter('ALGORITHM');
      assert.equal(currentTypeFilter, 'ALGORITHM');
      assert.equal(coordinator.getCurrentSeq(), 2, 'ROBOT -> ALGORITHM must increment generation');

      // 3. ALGORITHM -> ALL (值改变)
      changeTypeFilter('ALL');
      assert.equal(currentTypeFilter, 'ALL');
      assert.equal(coordinator.getCurrentSeq(), 3, 'ALGORITHM -> ALL must increment generation');
    });

    test('F-RE-05 C: 搜索框输入与清除事件防误杀保护', () => {
      const coordinator = new ResourceRequestCoordinator();
      let searchQuery = 'test';

      const handleSearchChange = (next: string) => {
        if (next === searchQuery) return;
        coordinator.invalidate();
        searchQuery = next;
      };

      const handleClearSearch = () => {
        if (!searchQuery) return;
        coordinator.invalidate();
        searchQuery = '';
      };

      assert.equal(coordinator.getCurrentSeq(), 0);

      // 1. 相同内容输入 -> 不触发 invalidate
      handleSearchChange('test');
      assert.equal(coordinator.getCurrentSeq(), 0, 'Same search value must not invalidate');

      // 2. 不同内容输入 -> 触发 invalidate
      handleSearchChange('test2');
      assert.equal(coordinator.getCurrentSeq(), 1, 'Different search value must invalidate');
      assert.equal(searchQuery, 'test2');

      // 3. 清除搜索 -> 触发 invalidate
      handleClearSearch();
      assert.equal(coordinator.getCurrentSeq(), 2, 'Clear non-empty search must invalidate');
      assert.equal(searchQuery, '');

      // 4. 空搜索再次点击清除 -> 不触发 invalidate
      handleClearSearch();
      assert.equal(coordinator.getCurrentSeq(), 2, 'Clearing empty search must not invalidate');
    });

    test('F-RE-02 A: Resource A 请求挂起 -> 切换路由至 Resource B -> B 成功 -> A 迟到返回 -> 最终 Resource 必须为 B', async () => {
      let state = {
        resource: null as any,
        relatedProjects: [] as any[],
        isLoading: false,
      };

      let generation = 0;
      let resolveA: (data: any) => void;
      const pendingA = new Promise((resolve) => {
        resolveA = resolve;
      });

      const loadResource = async (resId: string, currentGen: number) => {
        if (currentGen !== generation) return;

        let detail: any;
        if (resId === 'res-A') {
          detail = await pendingA;
        } else if (resId === 'res-B') {
          detail = { id: 'res-B', name: 'Detail B' };
        }

        if (currentGen !== generation) return;
        state.resource = detail;
        state.isLoading = false;
      };

      // 1. 打开 Resource A
      const genA = ++generation;
      state.resource = null;
      state.isLoading = true;
      const promiseA = loadResource('res-A', genA);

      // 2. 快速导航到 Resource B
      const genB = ++generation;
      state.resource = null; // route change 立即清空
      state.isLoading = true;
      const promiseB = loadResource('res-B', genB);

      // 3. Resource B 成功先返回
      await promiseB;
      assert.equal(state.resource?.id, 'res-B');

      // 4. Resource A 的慢请求迟到返回
      resolveA!({ id: 'res-A', name: 'Detail A' });
      await promiseA;

      // 5. 核心断言：最终 Resource 仍然必须为 B，A 不得覆盖
      assert.equal(state.resource?.id, 'res-B', 'Resource A must be discarded by generationRef');
    });

    test('F-RE-02 B: A 的 related projects 挂起 -> 切换到 B -> B 关联项目返回 -> A 关联迟到返回 -> 仅显示 B 关联', async () => {
      let state = {
        resourceId: '',
        relatedProjects: [] as any[],
      };

      let generation = 0;
      let resolveRelatedA: (data: any[]) => void;
      const pendingRelatedA = new Promise((resolve) => {
        resolveRelatedA = resolve;
      });

      const fetchRelatedProjects = async (resId: string, currentGen: number) => {
        if (currentGen !== generation) return;

        let projects: any[] = [];
        if (resId === 'res-A') {
          projects = (await pendingRelatedA) as any[];
        } else if (resId === 'res-B') {
          projects = [{ id: 'proj-B1', name: 'Project Belonging to B' }];
        }

        if (currentGen !== generation) return;
        state.resourceId = resId;
        state.relatedProjects = projects;
      };

      // 1. Resource A 关联请求在途
      const genA = ++generation;
      const promiseA = fetchRelatedProjects('res-A', genA);

      // 2. 导航切换到 Resource B，generation 递增
      const genB = ++generation;
      state.relatedProjects = []; // 立即清空旧关联
      const promiseB = fetchRelatedProjects('res-B', genB);

      // 3. B 的关联请求先返回
      await promiseB;
      assert.equal(state.resourceId, 'res-B');
      assert.equal(state.relatedProjects.length, 1);
      assert.equal(state.relatedProjects[0].id, 'proj-B1');

      // 4. A 的慢关联请求延迟到达
      resolveRelatedA!([
        { id: 'proj-A1', name: 'Project Belonging to A' },
        { id: 'proj-A2', name: 'Project Belonging to A' },
      ]);
      await promiseA;

      // 5. 核心断言：页面必须只保留 B 的关联项目，A 的迟到关联必须被彻底抛弃
      assert.equal(state.resourceId, 'res-B');
      assert.equal(state.relatedProjects.length, 1);
      assert.equal(state.relatedProjects[0].id, 'proj-B1');
    });
  });
});

describe('Execution TIMEOUT recovery and cancellation', () => {
  const task = (status: TaskStatus, updatedAt = '2026-10-16T00:00:00Z'): Task => ({
    id: 'timeout-task', projectId: 'timeout-project', validationId: 'validation', actionKey: 'SIMCORE_TRAINING',
    status, updatedAt, createdAt: '2026-10-15T00:00:00Z', idempotencyKey: 'timeout-key',
  });
  test('cancel uses the existing authenticated platform endpoint and handles accepted intent/errors', async () => {
    const original = client.post;
    try {
      client.post = (async (options: any) => {
        assert.equal(options.url, '/api/v1/tasks/{taskId}/cancel'); assert.equal(options.path.taskId, 'timeout-task'); assert.deepEqual(options.body, {});
        return { data: task('CANCEL_REQUESTED'), response: { status: 202 } };
      }) as typeof client.post;
      assert.equal((await cancelTrainingTask('timeout-task')).status, 'CANCEL_REQUESTED');
      client.post = (async () => ({ error: { error: { message: 'Forbidden' } }, response: { status: 404 } })) as typeof client.post;
      await assert.rejects(cancelTrainingTask('timeout-task'), /Forbidden/);
    } finally { client.post = original; }
  });

  test('result parser distinguishes pending assembly from a closed incomplete result', () => {
    const data = { finalStatus: 'finished', runName: 'exec-job', externalJobId: 'job', assembly: { complete: false, diagnostics: ['ARTIFACT_ASSEMBLY_PENDING'] } };
    assert.equal(parseSimcoreTrainingResult(data)?.assemblyPending, true);
    data.assembly.diagnostics = ['ARTIFACT_ASSEMBLY_INCOMPLETE']; assert.equal(parseSimcoreTrainingResult(data)?.assemblyPending, false);
  });

  test('actual terminal Result refresh completes, is bounded, and is cleaned on unmount', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const filename = path.resolve(__dirname, '../components/simcore/SimcoreTrainingView.tsx');
    const tsRequire = createRequire(filename)('jiti').createJiti(filename, { jsx: true });
    const original = client.get; let calls = 0; let pending = true; const errors: unknown[] = [];
    client.get = (async () => {
      calls++;
      return { data: { items: [{ taskId: 'timeout-task', sourceModule: 'simcore', data: {
        finalStatus: 'finished', runName: 'exec-job', externalJobId: 'job', assembly: { complete: !pending, diagnostics: pending ? ['ARTIFACT_ASSEMBLY_PENDING'] : [] },
      } }] } };
    }) as typeof client.get;
    const mount = () => {
      const callbacks: Function[] = []; const effects: Function[] = []; let slot = 0; const module = { exports: {} as any };
      const requireComponent = (id: string) => id === 'react' ? {
        __esModule: true, default: React,
        useState: (initial: unknown) => { const i = slot++; return [i === 3 ? task('FAILED') : initial, (value: unknown) => { if (i === 11) errors.push(value); }]; },
        useRef: (current: unknown) => ({ current }),
        useCallback: (fn: Function) => { callbacks.push(fn); return fn; },
        useEffect: (fn: Function) => { effects.push(fn); },
      } : tsRequire(id);
      const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
      new Function('require', 'module', 'exports', compiled.outputText)(requireComponent, module, module.exports);
      module.exports.default({ projectId: 'timeout-project' });
      return { load: callbacks.find(fn => fn.constructor.name === 'AsyncFunction')!, dispose: effects.at(-1)!() };
    };
    const tick = async () => { t.mock.timers.tick(5000); for (let n = 0; n < 6; n++) await Promise.resolve(); };
    try {
      let view = mount(); await view.load('timeout-task'); assert.equal(calls, 1);
      pending = false; await tick(); assert.equal(calls, 2); await tick(); assert.equal(calls, 2); view.dispose();
      pending = true; view = mount(); await view.load('timeout-task'); const before = calls; view.dispose(); await tick(); assert.equal(calls, before);
      view = mount(); const start = calls; await view.load('timeout-task');
      for (let n = 0; n < 15; n++) await tick();
      assert.equal(calls - start, 13); assert.ok(errors.some(error => typeof error === 'string' && error.includes('产物仍在整理'))); view.dispose();
    } finally { client.get = original; }
  });

  test('TIMEOUT polling backs off, recovers automatically and stops after failure', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new SimcorePollingController(); const intervals: number[] = []; const seen: TaskStatus[] = [];
    const replies = ['TIMEOUT', 'TIMEOUT', 'RUNNING', 'FAILED'] as const; let calls = 0;
    controller.start('timeout-task', 'TIMEOUT', { onUpdate: updated => seen.push(updated.status), onError: assert.fail }, {
      intervalProvider: (status, retry) => { const ms = getPollingIntervalMs(status, retry); if (ms !== null) intervals.push(ms); return ms; },
      getTaskFn: async () => task(replies[calls++]),
    });
    for (const ms of [10000, 20000, 40000, 3000]) { t.mock.timers.tick(ms); await Promise.resolve(); await Promise.resolve(); }
    assert.deepEqual(intervals, [10000, 20000, 40000, 3000]); assert.deepEqual(seen, replies);
    assert.equal(controller.getIsPolling(), false); t.mock.timers.tick(120000); await Promise.resolve(); assert.equal(calls, 4);
    assert.equal(getPollingIntervalMs('TIMEOUT', 30), 60000);
    controller.cancel();
  });

  test('late polling/manual/cancel snapshots cannot overwrite terminal or newer state', () => {
    const failed = task('FAILED');
    for (const stale of ['TIMEOUT', 'RUNNING', 'CANCEL_REQUESTED', 'SUCCEEDED'] as const) assert.equal(reconcileTrainingTask(failed, task(stale, '2026-10-16T00:01:00Z')), failed);
    const current = task('CANCEL_REQUESTED'); assert.equal(reconcileTrainingTask(current, task('RUNNING', '2026-10-15T00:00:00Z')), current);
    assert.equal(reconcileTrainingTask(task('TIMEOUT'), task('RUNNING')).status, 'RUNNING');
    assert.equal(reconcileTrainingTask(task('TIMEOUT'), task('SUCCEEDED')).status, 'SUCCEEDED');
  });

  test('actual training markup offers TIMEOUT cancel, pending confirmation, and FAILED code/message without a cancel button', () => {
    const filename = path.resolve(__dirname, '../components/simcore/SimcoreTrainingView.tsx');
    const nativeRequire = createRequire(filename);
    const tsRequire = nativeRequire('jiti').createJiti(filename, { jsx: true });
    const render = (status: TaskStatus) => {
      let slot = 0; const module = { exports: {} as any };
      const requireComponent = (id: string) => id === 'react' ? {
        __esModule: true, default: React, ...React,
        useState: (initial: unknown) => {
          const i = slot++;
          return React.useState(i === 3 ? task(status) : i === 9 && status === 'FAILED' ? [{
            finalStatus: 'finished', curves: {}, artifacts: [], failure: { code: 'PROCESS_FAILED', message: 'Execution process exited with code 7' },
          }] : initial);
        },
      } : tsRequire(id);
      const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
      new Function('require', 'module', 'exports', compiled.outputText)(requireComponent, module, module.exports);
      return renderToStaticMarkup(React.createElement(module.exports.default, { projectId: 'timeout-project' }));
    };
    assert.match(render('TIMEOUT'), /取消任务/); assert.match(render('TIMEOUT'), /状态查询超时/);
    assert.match(render('CANCEL_REQUESTED'), /取消请求已提交，等待节点确认/);
    const failed = render('FAILED'); assert.match(failed, /PROCESS_FAILED/); assert.match(failed, /Execution process exited with code 7/); assert.doesNotMatch(failed, /取消任务|刷新任务状态|等待节点确认/);
  });
});
