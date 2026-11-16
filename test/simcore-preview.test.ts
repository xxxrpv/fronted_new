import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SimcorePreviewView from '../components/simcore/SimcorePreviewView';
import { PreviewWorkflow, parsePreviewStatus, previewPresentation, type PreviewViewState } from '../lib/simcore/preview-workflow';
import type { SimcorePreviewStatus } from '../lib/api/generated/types.gen';

const project = '00000000-0000-4000-8000-000000000001';
const s1 = '00000000-0000-4000-8000-000000000011';
const s2 = '00000000-0000-4000-8000-000000000012';
const idle: SimcorePreviewStatus = { ok: true, running: false, executionState: 'idle', session: null };
const running = (sessionId = s1): SimcorePreviewStatus => ({ ok: true, running: true, executionState: 'running', session: {
  sessionId, projectId: project, templateId: 'synthetic-template', startedAt: '2026-10-14T08:00:00Z',
  expiresAt: '2026-10-14T08:10:00Z', remainingSeconds: 600, streamUrl: 'https://player.example.test/authorized',
  isCurrentProject: true, isOwner: true,
} });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const stopped = () => response({ ok: true, running: false, stopped: true });
const deferred = () => {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const workflow = (id = project) => {
  const writes: PreviewViewState[] = [];
  const current = new PreviewWorkflow(id, view => writes.push(view));
  return { current, writes };
};

describe('Task019 Preview: deterministic fake Backend responses (no browser/UE/video proof)', () => {
  test('strict DTO rejects missing identity, foreign owner/project, invalid states and missing player', () => {
    assert.deepEqual(parsePreviewStatus(idle, project), idle);
    assert.deepEqual(parsePreviewStatus(running(), project), running());
    for (const bad of [
      {}, { ...idle, running: true }, { ...idle, executionState: 'QUEUED' }, { ...idle, session: undefined },
      { ...running(), session: null }, { ...running(), executionState: 'busy' },
      ...[{ sessionId: '' }, { isOwner: false }, { isCurrentProject: false }, { projectId: 'foreign' },
        { streamUrl: '' }, { streamUrl: 'javascript:alert(1)' }, { streamUrl: 'https://user:password@example.test' },
        { remainingSeconds: -1 }, { remainingSeconds: 601 }, { remainingSeconds: 1.5 }, { startedAt: 'invalid' }]
        .map(patch => ({ ...running(), session: { ...running().session, ...patch } })),
    ]) assert.throws(() => parsePreviewStatus(bad, project));
  });

  test('only confirmed idle permits start; busy/unknown/starting/cancelling never look ready', () => {
    for (const executionState of ['busy', 'unknown', 'starting', 'cancelling'] as const) {
      const state = { ...idle, executionState };
      const view = { status: state, pending: null, unavailable: false, error: null };
      assert.equal(previewPresentation(view).canStart, false);
      assert.equal(previewPresentation(view).streamUrl, null);
      assert(!previewPresentation(view).label.includes('就绪'));
    }
    assert.equal(previewPresentation(workflow().current.view).canStart, false);
    assert.equal(previewPresentation({ status: idle, pending: null, unavailable: false, error: null }).canStart, true);
  });

  test('RUNNING allows only Backend player URL and still labels video unverified', () => {
    const view: PreviewViewState = { status: running(), pending: null, unavailable: false, error: null };
    assert.equal(previewPresentation(view).streamUrl, running().session?.streamUrl);
    assert.match(previewPresentation(view).label, /视频待验证/);
    assert.equal(previewPresentation({ ...view, unavailable: true }).streamUrl, null);
    assert.equal(previewPresentation({ ...view, status: { ...running(), running: false, executionState: 'cancelling' } }).streamUrl, null);
  });

  test('monitoring session permits video stream, disables stop, and parses valid monitoring status', () => {
    const monitoringStatus: SimcorePreviewStatus = {
      ...running(),
      session: { ...running().session!, isMonitoring: true, remainingSeconds: 0 },
    };
    assert.deepEqual(parsePreviewStatus(monitoringStatus, project), monitoringStatus);
    const view: PreviewViewState = { status: monitoringStatus, pending: null, unavailable: false, error: null };
    const pres = previewPresentation(view);
    assert.equal(pres.canStart, false);
    assert.equal(pres.canStop, false);
    assert.equal(pres.streamUrl, monitoringStatus.session?.streamUrl);
    assert.match(pres.label, /训练监控中/);
  });

  test('two same-project tabs stop their displayed identity, never the other tab new session', async () => {
    const a = workflow().current; const b = workflow().current;
    await a.refresh(async () => response(running(s1)));
    await b.refresh(async () => response(running(s2)));
    const requested: string[] = [];
    const displayedId = a.view.status!.session!.sessionId;
    await a.stop(displayedId, async () => { requested.push(displayedId); return response({ error: { code: 'PREVIEW_STALE_SESSION' } }, 409); });
    assert.deepEqual(requested, [s1]);
    assert.equal(a.view.status?.session?.sessionId, s1);
    assert.equal(b.view.status?.session?.sessionId, s2);
    assert.match(a.view.error!, /未停止其他会话/);
  });

  test('missing/stale stop identity does not send a request or fall back to latest', async () => {
    const current = workflow().current; let calls = 0;
    const send = async () => { calls++; return stopped(); };
    await current.stop('', send);
    await current.refresh(async () => response(running(s2)));
    await current.stop(s1, send);
    assert.equal(calls, 0);
    assert.equal(current.view.status?.session?.sessionId, s2);
  });

  test('newer GET wins when older response arrives late', async () => {
    const current = workflow().current; const old = deferred(); const newer = deferred();
    const first = current.refresh(() => old.promise); const second = current.refresh(() => newer.promise);
    newer.resolve(response(running(s2))); await second;
    old.resolve(response(running(s1))); await first;
    assert.equal(current.view.status?.session?.sessionId, s2);
  });

  test('overlapping slow reads make progress, without waiting for the last-issued read', async () => {
    const current = workflow().current; const old = deferred(); const newer = deferred();
    const first = current.refresh(() => old.promise); const second = current.refresh(() => newer.promise);
    old.resolve(response(running(s1))); await first;
    assert.equal(current.view.status?.session?.sessionId, s1);
    newer.resolve(response(running(s2))); await second;
    assert.equal(current.view.status?.session?.sessionId, s2);
  });

  test('GET issued before start cannot restore idle after confirmed start', async () => {
    const current = workflow().current; await current.refresh(async () => response(idle));
    const old = deferred(); const read = current.refresh(() => old.promise);
    await current.start(async () => response(running()));
    old.resolve(response(idle)); await read;
    assert.equal(current.view.status?.session?.sessionId, s1);
  });

  test('GET issued during start cannot undo the later successful mutation', async () => {
    const current = workflow().current; await current.refresh(async () => response(idle));
    const start = deferred(); const old = deferred();
    const submitted = current.start(() => start.promise); const read = current.refresh(() => old.promise);
    start.resolve(response(running())); await submitted;
    old.resolve(response(idle)); await read;
    assert.equal(current.view.status?.session?.sessionId, s1);
  });

  test('late start success/error does not overwrite a newer discovered session', async () => {
    for (const fail of [false, true]) {
      const current = workflow().current; await current.refresh(async () => response(idle));
      const old = deferred(); const submitted = current.start(() => old.promise);
      await current.refresh(async () => response(running(s2)));
      if (fail) old.reject(new Error('raw transport error')); else old.resolve(response(running(s1)));
      await submitted;
      assert.equal(current.view.status?.session?.sessionId, s2);
      assert.equal(current.view.unavailable, false);
      assert.equal(current.view.pending, null);
    }
  });

  test('late stop success/error cannot clear or mark unknown a new displayed session', async () => {
    for (const fail of [false, true]) {
      const current = workflow().current; await current.refresh(async () => response(running(s1)));
      const old = deferred(); const cancelled = current.stop(s1, () => old.promise);
      await current.refresh(async () => response(running(s2)));
      if (fail) old.reject(new Error('raw failure')); else old.resolve(stopped());
      await cancelled;
      assert.equal(current.view.status?.session?.sessionId, s2);
      assert.equal(current.view.unavailable, false);
      assert.equal(current.view.pending, null);
    }
  });

  test('GET issued during stop cannot restore old s1 after confirmed exit', async () => {
    const current = workflow().current; await current.refresh(async () => response(running()));
    const cancel = deferred(); const old = deferred();
    const cancelled = current.stop(s1, () => cancel.promise); const read = current.refresh(() => old.promise);
    cancel.resolve(stopped()); await cancelled;
    old.resolve(response(running())); await read;
    assert.deepEqual(current.view.status, idle);
  });

  test('scope disposal prevents GET/start/stop and finally callbacks writing into a new Project', async () => {
    for (const action of ['get', 'start', 'stop'] as const) {
      const { current, writes } = workflow(); const old = deferred();
      await current.refresh(async () => response(action === 'stop' ? running() : idle));
      const request = action === 'get' ? current.refresh(() => old.promise) : action === 'start' ? current.start(() => old.promise) : current.stop(s1, () => old.promise);
      current.dispose(); const count = writes.length;
      const next = workflow('00000000-0000-4000-8000-000000000002').current;
      await next.refresh(async () => response(idle));
      old.resolve(action === 'stop' ? stopped() : response(running())); await request;
      assert.equal(writes.length, count);
      assert.deepEqual(next.view.status, idle);
    }
  });

  test('StrictMode effect dispose/reactivate invalidates earlier reads', async () => {
    const current = workflow().current; const old = deferred(); const read = current.refresh(() => old.promise);
    current.dispose(); current.activate(); await current.refresh(async () => response(running(s2)));
    old.resolve(response(running(s1))); await read;
    assert.equal(current.view.status?.session?.sessionId, s2);
  });

  test('HTTP 202, unconfirmed 200 and pending/unknown cancellation never clear identity', async () => {
    for (const result of [
      () => response({ ok: true, running: false, stopped: true }, 202),
      () => response({ ok: true, running: false }),
      () => response({ error: { code: 'PREVIEW_STOP_PENDING' } }, 409),
      () => response({ error: { code: 'PREVIEW_UNKNOWN' } }, 409),
    ]) {
      const current = workflow().current; await current.refresh(async () => response(running()));
      await current.stop(s1, async () => result());
      assert.equal(current.view.status?.session?.sessionId, s1);
      assert.equal(previewPresentation(current.view).canStart, false);
      assert.equal(previewPresentation(current.view).streamUrl, null);
      assert.match(previewPresentation(current.view).label, /未确认退出/);
    }
  });

  test('network/JSON/query errors preserve identity, hide player, and do not expose raw errors', async () => {
    const current = workflow().current; await current.refresh(async () => response(running()));
    await current.refresh(async () => { throw new Error('raw-private-infrastructure-error'); });
    assert.equal(current.view.status?.session?.sessionId, s1);
    assert.equal(current.view.error?.includes('raw-private'), false);
    assert.equal(previewPresentation(current.view).streamUrl, null);
    await current.stop(s1, async () => new Response('invalid-json'));
    assert.equal(current.view.status?.session?.sessionId, s1);
    await current.refresh(async () => response(running()));
    assert.equal(current.view.unavailable, false);
    assert.equal(current.view.error, null);
  });

  test('double start suppressed; pending start and missing player are never success', async () => {
    const current = workflow().current; await current.refresh(async () => response(idle));
    const old = deferred(); const submitted = current.start(() => old.promise);
    let duplicate = 0; await current.start(async () => { duplicate++; return response(running()); });
    assert.equal(duplicate, 0);
    old.resolve(response({ error: { code: 'PREVIEW_START_PENDING' } }, 504)); await submitted;
    assert.equal(previewPresentation(current.view).canStart, false);
    assert.match(current.view.error!, /请勿重复启动/);
    await current.refresh(async () => response(idle));
    await current.start(async () => response({ error: { code: 'PREVIEW_NOT_CONFIGURED' } }, 503));
    assert.match(current.view.error!, /播放器尚未配置/);
    assert.equal(previewPresentation(current.view).streamUrl, null);
    await current.refresh(async () => response(idle));
    await current.start(async () => response(idle));
    assert.equal(current.view.unavailable, true);
  });

  test('confirmed exact-session stop permits start again and clears identity', async () => {
    const current = workflow().current; await current.refresh(async () => response(running()));
    await current.stop(s1, async () => stopped());
    assert.deepEqual(current.view.status, idle);
    assert.equal(previewPresentation(current.view).canStart, true);
  });

  test('component keeps original styles/classes/control count and actual SSR layout', () => {
    const source = readFileSync(new URL('../components/simcore/SimcorePreviewView.tsx', import.meta.url), 'utf8');
    const styles = [...source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)].map(match => match[1].replace(/\s+/g, ''));
    assert.equal(styles.length, 32);
    assert.equal(createHash('sha256').update(styles.join('\n')).digest('hex'), '528190ad3e1d552db494f3a0a742202fbc3bb53e42de0325bad2efad2d72e7a9');
    assert.equal((source.match(/<button/g) ?? []).length, 5);
    assert.deepEqual([...source.matchAll(/className="([^"]+)"/g)].map(match => match[1]), [
      'simcore2-panel', 'simcore2-panel-header', 'simcore2-panel-title', 'simcore2-label', 'simcore2-select',
      'btn btn-primary', 'spinner', 'btn btn-secondary', 'spinner', 'btn btn-secondary', 'btn btn-secondary',
    ]);
    const markup = renderToStaticMarkup(React.createElement(SimcorePreviewView, { projectId: project }));
    assert.equal((markup.match(/<article/g) ?? []).length, 1);
    assert.equal((markup.match(/<select/g) ?? []).length, 1);
    assert.equal((markup.match(/<button/g) ?? []).length, 1);
    assert.equal((markup.match(/<iframe/g) ?? []).length, 0);
    assert.match(markup, /正在查询预览状态/);
    assert.match(markup, /disabled=""/);
    assert(!source.includes('127.0.0.1:8080'));
    assert.match(source, /JSON\.stringify\(\{ sessionId \}\)/);
    assert.match(source, /<ProjectPreview key=\{projectId\}/);
    assert(!source.includes('onLoad=') || !source.includes('视频已验证'));
  });
});
