import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { client } from '../lib/api/client';
import {
  parseSanitizedEvaluationResult,
  type SanitizedEvaluationResultData,
} from '../lib/simcore/evaluation-result';
import {
  fetchEvaluationModelCandidates,
  createEvaluationValidation,
  createEvaluationTask,
  pollEvaluationTask,
  cancelEvaluationTask,
  reconcileEvaluationTask,
  fetchEvaluationResults,
  listProjectEvaluationTasks,
  isTerminalEvaluationStatus,
  getEvaluationPollingIntervalMs,
  SimcoreEvaluationSubmissionSession,
  SimcoreEvaluationPollingController,
  resumeSimcoreEvaluationTask,
  getSafeEvaluationCsvDownloadUrl,
} from '../lib/simcore/evaluation-workflow';
import type {
  SimcoreEvaluationModelCandidate,
  Task,
  TaskStatus,
  ActionKey,
  EvaluationArtifactItem,
} from '../lib/api/generated/types.gen';
import SimcoreEvaluationView from '../components/simcore/SimcoreEvaluationView';

describe('Task-022 Simcore Evaluation Frontend Integration Tests', () => {
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

  const mockCandidate = (
    taskId = '11111111-1111-4111-8111-111111111111',
    artId = '22222222222222222222222222222222',
  ): SimcoreEvaluationModelCandidate => ({
    sourceTrainingTaskId: taskId,
    sourceArtifactId: artId,
    artifactName: 'final_model.zip',
    templateId: 'franka_panda_reach',
    algorithm: 'ppo',
    trainedAt: '2026-10-18T10:00:00.000Z',
    sizeBytes: 15420000,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ready: true,
  });

  const mockTask = (
    id = 'task-eval-001',
    status: TaskStatus = 'SUCCEEDED',
    actionKey: ActionKey = 'SIMCORE_EVALUATION',
    projectId = 'proj-test-1',
    updatedAt = '2026-10-18T10:05:00.000Z',
  ): Task => ({
    id,
    projectId,
    validationId: 'val-mock-001',
    idempotencyKey: 'idemp-mock-001',
    actionKey,
    status,
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt,
  });

  describe('1. 候选模型查询与分页安全', () => {
    test('正确拉取本 Project 候选模型列表', async () => {
      client.get = (async (options: any) => {
        assert.equal(options.url, '/api/v1/projects/{projectId}/simcore/evaluation-models');
        assert.equal(options.path.projectId, 'proj-alpha');
        return {
          data: {
            items: [mockCandidate('task-1'), mockCandidate('task-2')],
            pageInfo: { hasMore: false, nextCursor: null },
          },
          response: { status: 200 },
        };
      }) as any;

      const items = await fetchEvaluationModelCandidates('proj-alpha');
      assert.equal(items.length, 2);
      assert.equal(items[0].sourceTrainingTaskId, 'task-1');
      assert.equal(items[1].sourceTrainingTaskId, 'task-2');
    });

    test('分页循环引用检测防死循环', async () => {
      let callCount = 0;
      client.get = (async (options: any) => {
        callCount++;
        return {
          data: {
            items: [mockCandidate(`task-${callCount}`)],
            pageInfo: { hasMore: true, nextCursor: 'cycle-cur' },
          },
          response: { status: 200 },
        };
      }) as any;

      await assert.rejects(
        async () => {
          await fetchEvaluationModelCandidates('proj-alpha');
        },
        /Pagination cycle detected/,
      );
    });

    test('空 projectId 抛出明确错误', async () => {
      await assert.rejects(
        async () => {
          await fetchEvaluationModelCandidates('');
        },
        /projectId is required/,
      );
    });
  });

  describe('2. Validation 与 Task 创建及幂等性保护', () => {
    test('严格限制 episodes 范围 1-100 并构建 SIMCORE_EVALUATION 校验体', async () => {
      client.post = (async (options: any) => {
        assert.equal(options.url, '/api/v1/validations');
        assert.equal(options.body.actionKey, 'SIMCORE_EVALUATION');
        assert.deepEqual(options.body.inputs, {});
        assert.equal(options.body.configSnapshot.episodes, 10);
        return {
          data: { id: 'val-123', valid: true },
          response: { status: 201 },
        };
      }) as any;

      const val = await createEvaluationValidation({
        projectId: 'proj-1',
        sourceTrainingTaskId: '11111111-1111-4111-8111-111111111111',
        sourceArtifactId: '22222222222222222222222222222222',
        episodes: 10,
      });
      assert.equal(val.id, 'val-123');

      // Invalid episodes
      await assert.rejects(
        async () => {
          await createEvaluationValidation({
            projectId: 'proj-1',
            sourceTrainingTaskId: '11111111-1111-4111-8111-111111111111',
            sourceArtifactId: '22222222222222222222222222222222',
            episodes: 0,
          });
        },
        /episodes must be an integer between 1 and 100/,
      );

      await assert.rejects(
        async () => {
          await createEvaluationValidation({
            projectId: 'proj-1',
            sourceTrainingTaskId: '11111111-1111-4111-8111-111111111111',
            sourceArtifactId: '22222222222222222222222222222222',
            episodes: 101,
          });
        },
        /episodes must be an integer between 1 and 100/,
      );
    });

    test('SimcoreEvaluationSubmissionSession 幂等会话管理：防连击与失败重试复用 Key', async () => {
      const session = new SimcoreEvaluationSubmissionSession();
      let validationCalls = 0;
      let taskCalls = 0;

      client.post = (async (options: any) => {
        if (options.url === '/api/v1/validations') {
          validationCalls++;
          return { data: { id: 'val-session-1' }, response: { status: 201 } };
        }
        if (options.url === '/api/v1/tasks') {
          taskCalls++;
          if (taskCalls === 1) {
            // First task attempt fails (simulating network blip)
            return { error: { error: { message: 'Network transient timeout' } }, response: { status: 504 } };
          }
          return { data: mockTask('task-session-1'), response: { status: 201 } };
        }
        throw new Error(`Unexpected url ${options.url}`);
      }) as any;

      // First run fails at task phase
      await assert.rejects(
        async () => {
          await session.submit({
            projectId: 'proj-1',
            sourceTrainingTaskId: '11111111-1111-4111-8111-111111111111',
            sourceArtifactId: '22222222222222222222222222222222',
            episodes: 5,
          });
        },
        /Network transient timeout/,
      );

      assert.equal(validationCalls, 1);
      assert.equal(taskCalls, 1);
      assert.equal(session.canRetryTask(), true);
      const heldKey = session.getIdempotencyKey();
      const heldVal = session.getActiveValidationId();
      assert.ok(heldKey);
      assert.equal(heldVal, 'val-session-1');

      // Retry task reusing validation and key!
      const task = await session.submit(
        {
          projectId: 'proj-1',
          sourceTrainingTaskId: '11111111-1111-4111-8111-111111111111',
          sourceArtifactId: '22222222222222222222222222222222',
          episodes: 5,
        },
        { isRetry: true },
      );

      assert.equal(task.id, 'task-session-1');
      assert.equal(validationCalls, 1); // Not called again!
      assert.equal(taskCalls, 2);
      assert.equal(session.getIdempotencyKey(), heldKey);
    });
  });

  describe('3. 任务恢复与 Action/Project 强隔离', () => {
    test('恢复匹配 Project 与 SIMCORE_EVALUATION 的评估任务', async () => {
      client.get = (async () => {
        return { data: mockTask('task-eval-valid', 'RUNNING', 'SIMCORE_EVALUATION', 'proj-target'), response: { status: 200 } };
      }) as any;

      const res = await resumeSimcoreEvaluationTask({
        projectId: 'proj-target',
        initialTaskId: 'task-eval-valid',
      });

      assert.equal(res.status, 'resumed');
      if (res.status === 'resumed') {
        assert.equal(res.task.id, 'task-eval-valid');
      }
    });

    test('拒绝跨 Project 任务恢复', async () => {
      client.get = (async () => {
        return { data: mockTask('task-other-proj', 'RUNNING', 'SIMCORE_EVALUATION', 'proj-foreign'), response: { status: 200 } };
      }) as any;

      const res = await resumeSimcoreEvaluationTask({
        projectId: 'proj-current',
        initialTaskId: 'task-other-proj',
      });

      assert.equal(res.status, 'mismatch');
      if (res.status === 'mismatch') {
        assert.match(res.error, /belongs to project proj-foreign, not proj-current/);
      }
    });

    test('两类 Task 隔离：拒绝将 SIMCORE_TRAINING 任务恢复到评估视图', async () => {
      client.get = (async () => {
        return { data: mockTask('task-training', 'SUCCEEDED', 'SIMCORE_TRAINING', 'proj-target'), response: { status: 200 } };
      }) as any;

      const res = await resumeSimcoreEvaluationTask({
        projectId: 'proj-target',
        initialTaskId: 'task-training',
      });

      assert.equal(res.status, 'mismatch');
      if (res.status === 'mismatch') {
        assert.match(res.error, /expected 'SIMCORE_EVALUATION'/);
      }
    });
  });

  describe('4. 脱敏指标解析与真实 0.0 保留', () => {
    test('真实 0.0% 成功率与 0.0 回报被准确解析，不与 null 混淆', () => {
      const raw = {
        finalStatus: 'finished',
        runName: 'eval_run_01',
        returnCode: 0,
        successRate: 0.0,
        episodes: 5,
        averageCumulativeReward: 0.0,
        episodeRewards: [
          { episode: 0, steps: 100, cumulativeReward: 0.0, success: false },
          { episode: 1, steps: 100, cumulativeReward: 0.0, success: false },
        ],
        assembly: {
          complete: true,
          retryExhausted: false,
          attempts: 1,
          diagnostics: [],
          verifiedArtifactIds: ['art-csv-1'],
        },
        executionProof: {
          nodeId: 'node-c52',
          platformTaskId: 'task-001',
          requestId: 'req-001',
          state: 'SUCCESS',
          exitConfirmed: true,
        },
        artifacts: [
          {
            artifactId: 'art-csv-1',
            name: 'evaluation_steps.csv',
            kind: 'file',
            sizeBytes: 1024,
            sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            downloadAvailable: true,
          },
        ],
      };

      const parsed = parseSanitizedEvaluationResult(raw);
      assert.ok(parsed);
      assert.equal(parsed.successRate, 0.0);
      assert.equal(parsed.averageCumulativeReward, 0.0);
      assert.equal(parsed.episodes, 5);
      assert.equal(parsed.episodeRewards.length, 2);
      assert.equal(parsed.episodeRewards[0].cumulativeReward, 0.0);
      assert.equal(parsed.episodeRewards[0].success, false);
      assert.equal(parsed.assembly.complete, true);
    });

    test('缺失指标时保留 null，不填充假数据', () => {
      const raw = {
        finalStatus: 'stopped',
        returnCode: 1,
        successRate: null,
        episodes: null,
        averageCumulativeReward: null,
        episodeRewards: [],
        assembly: {
          complete: false,
          retryExhausted: true,
          attempts: 3,
          diagnostics: ['CSV_PARSING_FAILED'],
          verifiedArtifactIds: [],
        },
        executionProof: {
          nodeId: 'node-c52',
          platformTaskId: 'task-001',
          requestId: 'req-001',
          state: 'SUCCESS',
          exitConfirmed: true,
        },
        artifacts: [],
      };

      const parsed = parseSanitizedEvaluationResult(raw);
      assert.ok(parsed);
      assert.equal(parsed.successRate, null);
      assert.equal(parsed.averageCumulativeReward, null);
      assert.equal(parsed.assembly.complete, false);
      assert.equal(parsed.assembly.retryExhausted, true);
    });

    test('拒绝含有内部路径/调试敏感字段的结果对象 (Fail-Closed)', () => {
      const leaky = {
        finalStatus: 'finished',
        successRate: 0.8,
        stdout: 'internal log leakage',
        trainingRoot: '/data/simcore/run',
      };
      assert.equal(parseSanitizedEvaluationResult(leaky), null);
    });
  });

  describe('5. 安全 CSV 下载 URL 边界', () => {
    const validCsvArtifact: EvaluationArtifactItem = {
      artifactId: 'art-csv-1',
      name: 'evaluation_steps.csv',
      kind: 'file',
      sizeBytes: 2048,
      sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      downloadAvailable: true,
    };

    const summaryArtifact: EvaluationArtifactItem = {
      artifactId: 'art-sum-1',
      name: 'summary.json',
      kind: 'metrics',
      sizeBytes: 512,
      sha256: 'b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      downloadAvailable: false,
    };

    test('仅对 evaluation_steps.csv 且 downloadAvailable=true 构建安全下载路径', () => {
      const url = getSafeEvaluationCsvDownloadUrl('task-100', 'req-200', validCsvArtifact);
      assert.equal(
        url,
        '/api/v1/tasks/task-100/simcore/attempts/req-200/artifacts/art-csv-1/download',
      );
    });

    test('严禁为 summary.json 或 config_snapshot.json 构建直接下载 URL', () => {
      assert.equal(getSafeEvaluationCsvDownloadUrl('task-100', 'req-200', summaryArtifact), null);
      assert.equal(
        getSafeEvaluationCsvDownloadUrl('task-100', 'req-200', {
          ...validCsvArtifact,
          name: 'config_snapshot.json' as any,
        }),
        null,
      );
    });

    test('downloadAvailable=false 时严禁生成下载 URL', () => {
      assert.equal(
        getSafeEvaluationCsvDownloadUrl('task-100', 'req-200', {
          ...validCsvArtifact,
          downloadAvailable: false,
        }),
        null,
      );
    });
  });

  describe('6. 任务对账与状态退避', () => {
    test('终态任务不可被迟到的中间状态覆盖', () => {
      const terminal = mockTask('task-1', 'SUCCEEDED', 'SIMCORE_EVALUATION', 'proj-1', '2026-10-18T10:10:00Z');
      const staleRunning = mockTask('task-1', 'RUNNING', 'SIMCORE_EVALUATION', 'proj-1', '2026-10-18T10:11:00Z');

      const reconciled = reconcileEvaluationTask(terminal, staleRunning);
      assert.equal(reconciled.status, 'SUCCEEDED');
    });

    test('轮询间隔计算：终端状态返回 null，超时按指数退避', () => {
      assert.equal(getEvaluationPollingIntervalMs('SUCCEEDED'), null);
      assert.equal(getEvaluationPollingIntervalMs('FAILED'), null);
      assert.equal(getEvaluationPollingIntervalMs('CANCELED'), null);
      assert.equal(getEvaluationPollingIntervalMs('RUNNING'), 3000);
      assert.equal(getEvaluationPollingIntervalMs('TIMEOUT', 0), 10000);
      assert.equal(getEvaluationPollingIntervalMs('TIMEOUT', 1), 20000);
      assert.equal(getEvaluationPollingIntervalMs('TIMEOUT', 2), 40000);
      assert.equal(getEvaluationPollingIntervalMs('TIMEOUT', 3), 60000);
    });
  });

  describe('7. 组件静态渲染与结构验证', () => {
    test('渲染 SimcoreEvaluationView 初始结构包含评估表单与回合数输入', () => {
      const html = renderToStaticMarkup(
        React.createElement(SimcoreEvaluationView, {
          projectId: 'proj-render-test',
        }),
      );

      assert.match(html, /评估目标模型选择/);
      assert.match(html, /评估回合数 \(Episodes\)/);
      assert.match(html, /Headless \(后台静默高并发评估\)/);
      assert.match(html, /启动评估 \(Start Evaluation\)/);
      assert.match(html, /本工程评估任务历史/);
    });
  });
});


describe('Task-022 R2 submission identity and history paging', () => {
  test('ordinary submit after lost response retains key/validation and new run is blocked', async () => {
    const original = client.post;
    const session = new SimcoreEvaluationSubmissionSession();
    let validationCalls = 0;
    const posts: { key: string; validationId: string }[] = [];
    client.post = (async (options: any) => {
      if (options.url === '/api/v1/validations') {
        validationCalls++;
        return { data: { id: 'retained-validation' }, response: { status: 201 } };
      }
      posts.push({ key: options.headers['Idempotency-Key'], validationId: options.body.validationId });
      if (posts.length === 1) throw new Error('response lost');
      return { data: { id: 'existing-task' }, response: { status: 201 } };
    }) as typeof client.post;
    try {
      const params = { projectId: 'project-A', sourceTrainingTaskId: 'source-task', sourceArtifactId: 'artifact', episodes: 5 };
      await assert.rejects(session.submit(params), /response lost/);
      assert.throws(() => session.resetNewRun(), /未确认/);
      await session.submit(params, { isRetry: false, customIdempotencyKey: 'must-not-replace' });
      assert.equal(validationCalls, 1);
      assert.deepEqual(posts[1], posts[0]);
    } finally { client.post = original; }
  });

  test('history scans a training-only page and rejects foreign project or wrong Action', async () => {
    const original = client.get;
    const calls: string[] = [];
    client.get = (async (options: any) => {
      calls.push(options.query.cursor || 'first');
      const base = { projectId: 'project-A', status: 'SUCCEEDED', createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:00:00Z' };
      return { data: options.query.cursor ? {
        items: [{ ...base, id: 'eval', actionKey: 'SIMCORE_EVALUATION' }, { ...base, id: 'foreign', projectId: 'project-B', actionKey: 'SIMCORE_EVALUATION' }],
        pageInfo: { hasMore: false, nextCursor: null },
      } : { items: [{ ...base, id: 'training', actionKey: 'SIMCORE_TRAINING' }], pageInfo: { hasMore: true, nextCursor: 'opaque-cursor' } }, response: { status: 200 } };
    }) as typeof client.get;
    try {
      const tasks = await listProjectEvaluationTasks('project-A', 15);
      assert.deepEqual(tasks.map((task) => task.id), ['eval']);
      assert.deepEqual(calls, ['first', 'opaque-cursor']);
    } finally { client.get = original; }
  });

  test('history errors and invalid cursor do not masquerade as empty results', async () => {
    const original = client.get;
    try {
      client.get = (async () => ({ error: { error: { message: 'history unavailable' } }, response: { status: 503 } })) as typeof client.get;
      await assert.rejects(listProjectEvaluationTasks('project-A'), /history unavailable/);
      client.get = (async () => ({ data: { items: [], pageInfo: { hasMore: true, nextCursor: null } }, response: { status: 200 } })) as typeof client.get;
      await assert.rejects(listProjectEvaluationTasks('project-A'), /分页异常/);
    } finally { client.get = original; }
  });
});
