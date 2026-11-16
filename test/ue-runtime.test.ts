import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client } from '../lib/api/client';
import { currentPlayerUrl, fetchProjectRobots, trustedPlayerUrl, UeViewerSession } from '../lib/ue-runtime';
import type { Resource, UeRuntimeState, UeRuntimeReady, UeRuntimeNotReady } from '../lib/api/generated/types.gen';

const projectId = '00000000-0000-4000-8000-000000000001';
const robotId = '00000000-0000-4000-8000-000000000002';
const otherRobotId = '00000000-0000-4000-8000-000000000003';
const revision = '00000000-0000-4000-8000-000000000004';
const loadedRevision = '00000000-0000-4000-8000-000000000005';
const url = 'http://127.0.0.1:8081/player.html';
const resource = (id = robotId, sourceModule = 'embodex', type: Resource['type'] = 'ROBOT'): Resource => ({ id, scope: 'PROJECT', type, sourceModule, externalId: `robot:${id}`, version: '1', displayMetadata: { name: 'Robot', description: '', tags: [], specifications: {} }, myProjectCount: 1, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' });
const idle = (): UeRuntimeNotReady => ({ projectId, robotResourceId: null, revision, status: 'IDLE', playerUrl: null, error: null });
const ready = (id = robotId): UeRuntimeReady => ({ projectId, robotResourceId: id, revision: loadedRevision, status: 'READY', playerUrl: url, error: null });
const page = (items: Resource[], nextCursor: string | null = null, hasMore = false) => ({ data: { items, pageInfo: { nextCursor, hasMore } } });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('Task-016 scoped UE viewer lifecycle', () => {
  let originalGet: typeof client.get;
  let originalPost: typeof client.post;
  let sessions: UeViewerSession[];
  beforeEach(() => { originalGet = client.get; originalPost = client.post; sessions = []; });
  afterEach(() => { sessions.forEach(session => session.dispose()); client.get = originalGet; client.post = originalPost; });
  const createSession = () => { const session = new UeViewerSession(projectId, () => {}); sessions.push(session); return session; };
  const useRuntime = (state: () => UeRuntimeState = idle) => {
    client.get = (async (options: { url: string }) => options.url.endsWith('/resources') ? page([resource(), resource(otherRobotId, 'simcore')]) : { data: state() }) as unknown as typeof client.get;
  };

  test('complete project pagination preserves all ROBOT providers and excludes algorithms', async () => {
    let calls = 0;
    client.get = (async (options: { query: { cursor?: string }; path: { projectId: string } }) => {
      assert.equal(options.path.projectId, projectId);
      calls++;
      assert.equal(options.query.cursor, calls === 1 ? undefined : 'next');
      return calls === 1 ? page([resource(), resource(otherRobotId, 'simcore', 'ALGORITHM')], 'next', true) : page([resource(otherRobotId, 'simcore')]);
    }) as unknown as typeof client.get;
    assert.deepEqual((await fetchProjectRobots(projectId, new AbortController().signal)).map(robot => robot.id), [robotId, otherRobotId]);
    assert.equal(calls, 2);
  });

  test('malformed, looping and excess pagination returns no deployable partial choices', async () => {
    for (const mode of ['missing', 'loop', 'limit']) {
      let count = 0;
      client.get = (async (options: { url: string }) => options.url.endsWith('/resources') ? page([resource()], mode === 'missing' ? null : mode === 'loop' ? 'same' : `cursor-${++count}`, true) : { data: idle() }) as unknown as typeof client.get;
      const session = createSession();
      await session.loadResources();
      assert.equal(session.state.resourcesComplete, false);
      assert.deepEqual(session.state.robots, []);
      assert.match(session.state.error || '', /不完整/);
    }
  });

  test('selection immediately removes picture and ignores an older GET reply even when transport ignores abort', async () => {
    useRuntime(() => ready());
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    assert.equal(currentPlayerUrl(session.state), url);
    let resolveOld!: (value: unknown) => void;
    client.get = (() => new Promise<unknown>(resolve => { resolveOld = resolve; })) as unknown as typeof client.get;
    const oldRead = session.refresh();
    assert.equal(currentPlayerUrl(session.state), null);
    session.select('');
    resolveOld({ data: ready() });
    await oldRead;
    assert.equal(session.state.selectedRobotId, '');
    assert.equal(session.state.runtime, null);
    assert.equal(currentPlayerUrl(session.state), null);
  });

  test('POST uses captured revision once, blocks duplicate click, and only accepts the new matching READY', async () => {
    useRuntime();
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    let count = 0;
    let resolvePost!: (value: unknown) => void;
    client.post = ((options: { body: unknown }) => {
      count++;
      assert.deepEqual(options.body, { robotResourceId: robotId, expectedRevision: revision });
      return new Promise<unknown>(resolve => { resolvePost = resolve; });
    }) as unknown as typeof client.post;
    const pending = session.deploy();
    await session.deploy();
    assert.equal(count, 1);
    assert.equal(session.state.deploying, true);
    resolvePost({ data: ready() });
    await pending;
    assert.equal(currentPlayerUrl(session.state), url);
  });

  test('unmount and later selection reject an old successful POST', async () => {
    for (const dispose of [false, true]) {
      useRuntime();
      const session = createSession();
      await session.loadResources();
      session.select(robotId);
      await flush();
      let resolvePost!: (value: unknown) => void;
      client.post = (() => new Promise<unknown>(resolve => { resolvePost = resolve; })) as unknown as typeof client.post;
      const pending = session.deploy();
      if (dispose) session.dispose(); else session.select('');
      resolvePost({ data: ready() });
      await pending;
      assert.equal(currentPlayerUrl(session.state), null);
    }
  });

  test('wrong Robot or unchanged revision cannot revive a previous model', async () => {
    for (const invalid of [ready(otherRobotId), { ...ready(), revision }]) {
      useRuntime();
      const session = createSession();
      await session.loadResources();
      session.select(robotId);
      await flush();
      client.post = (async () => ({ data: invalid })) as unknown as typeof client.post;
      await session.deploy();
      assert.equal(currentPlayerUrl(session.state), null);
      assert.match(session.state.error || '', /无法确认/);
    }
  });

  test('timeout/network failure observes GET without retrying POST and never displays rollback READY', async () => {
    useRuntime();
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    let posts = 0;
    let signal!: AbortSignal;
    client.post = (async (options: { signal: AbortSignal }) => { posts++; signal = options.signal; throw new DOMException('timeout', 'TimeoutError'); }) as unknown as typeof client.post;
    useRuntime(() => ({ ...ready(), revision }));
    await session.deploy();
    assert.equal(posts, 1);
    assert(signal instanceof AbortSignal);
    assert.equal(currentPlayerUrl(session.state), null);
    assert.match(session.state.error || '', /不要重复提交/);
    assert.equal(session.state.runtime?.revision, revision);
  });

  test('runtime UNKNOWN remains non-deployable and carries the server safe error', async () => {
    useRuntime(() => ({ ...idle(), status: 'UNKNOWN', error: { code: 'RUNTIME_UNKNOWN', message: '受控恢复后才能部署。' } }));
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    let posts = 0;
    client.post = (async () => { posts++; return { data: ready() }; }) as unknown as typeof client.post;
    await session.deploy();
    assert.equal(posts, 0);
    assert.equal(currentPlayerUrl(session.state), null);
    assert.equal(session.state.runtime?.error?.message, '受控恢复后才能部署。');
  });

  test('UNAVAILABLE requires an explicit retry and can recover without automatic POST replay', async () => {
    let observed = idle();
    useRuntime(() => observed);
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    let posts = 0;
    client.post = (async (options: { body: { expectedRevision: string } }) => {
      posts++;
      if (posts === 1) {
        observed = { ...idle(), robotResourceId: robotId, revision: loadedRevision, status: 'UNAVAILABLE', error: { code: 'RUNTIME_UNAVAILABLE', message: '本机服务暂不可用。' } };
        return { error: { error: { message: '本机服务暂不可用。' } } };
      }
      assert.equal(options.body.expectedRevision, loadedRevision);
      return { data: { ...ready(), revision: '00000000-0000-4000-8000-000000000006' } };
    }) as unknown as typeof client.post;
    await session.deploy();
    assert.equal(posts, 1);
    assert.equal(currentPlayerUrl(session.state), null);
    assert.equal(session.state.runtime?.status, 'UNAVAILABLE');
    await session.deploy();
    assert.equal(posts, 2);
    assert.equal(currentPlayerUrl(session.state), url);
  });

  test('poll identity change removes player; cancelled polling cannot issue another read', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    let current = ready();
    let gets = 0;
    client.get = (async (options: { url: string }) => { gets++; return options.url.endsWith('/resources') ? page([resource()]) : { data: current }; }) as unknown as typeof client.get;
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    current = { ...ready(), revision };
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(currentPlayerUrl(session.state), null);
    assert.match(session.state.error || '', /代次已改变/);
    const before = gets;
    session.dispose();
    t.mock.timers.tick(600000);
    await flush();
    assert.equal(gets, before);
  });

  test('polling absolute ceiling removes READY and requires manual confirmation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    useRuntime(() => ready());
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    assert.equal(currentPlayerUrl(session.state), url);
    t.mock.timers.tick(600000);
    await flush();
    assert.equal(currentPlayerUrl(session.state), null);
    assert.equal(session.state.pollingPaused, true);
  });

  test('a different current Robot stays hidden but its revision remains usable for explicit deployment', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    useRuntime(() => ready(otherRobotId));
    const session = createSession();
    await session.loadResources();
    session.select(robotId);
    await flush();
    assert.equal(currentPlayerUrl(session.state), null);
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(session.state.expectedRevision, loadedRevision);
    assert.equal(session.state.error, null);
  });

  test('trusted player URL is exact loopback and invalid ports/ref/credentials are refused', () => {
    assert.equal(trustedPlayerUrl(url), true);
    for (const value of ['http://example.com/player.html', 'http://127.0.0.1:99999/player.html', `${url}?ref=x`, `${url}#x`, 'http://user@127.0.0.1:8081/player.html']) assert.equal(trustedPlayerUrl(value), false);
    assert.equal(trustedPlayerUrl('http://10.60.0.12:8081/player.html'), false);
    assert.equal(trustedPlayerUrl('http://10.60.0.12:8081/player.html', 'http://10.60.0.12:8081/player.html'), true);
    assert.equal(trustedPlayerUrl('https://ue.example.com/player.html', 'https://ue.example.com/player.html'), true);

    const prev = process.env.NEXT_PUBLIC_UE_PLAYER_ALLOWED_URLS;
    try {
      process.env.NEXT_PUBLIC_UE_PLAYER_ALLOWED_URLS = 'http://10.60.0.12:8081/player.html';
      assert.equal(trustedPlayerUrl('http://10.60.0.12:8081/player.html'), true);
      assert.equal(trustedPlayerUrl('http://10.60.0.12:8081/player.html?ref=x'), false);
      assert.equal(trustedPlayerUrl('http://10.60.0.12:8081/player.html#x'), false);
      assert.equal(trustedPlayerUrl('http://user@10.60.0.12:8081/player.html'), false);
      assert.equal(trustedPlayerUrl('http://10.60.0.12:99999/player.html'), false);
      assert.equal(trustedPlayerUrl('http://other.host:8081/player.html'), false);
    } finally {
      process.env.NEXT_PUBLIC_UE_PLAYER_ALLOWED_URLS = prev;
    }
  });

  test('real Viewer lives only in the authorized Project Embodex UE Tab; parts and three-column layout remain separate', () => {
    const shared = readFileSync(fileURLToPath(new URL('../components/embodex/EmbodexSchemeDesignPage.tsx', import.meta.url)), 'utf8');
    const wrapper = readFileSync(fileURLToPath(new URL('../app/projects/[projectId]/embodex/page.tsx', import.meta.url)), 'utf8');
    const overview = readFileSync(fileURLToPath(new URL('../app/projects/[projectId]/page.tsx', import.meta.url)), 'utf8');
    assert.match(shared, /activeView === 'parts' &&/);
    assert.match(shared, /activeView === 'ue' &&[\s\S]*?projectId \? \([\s\S]*?<ProjectUeViewer key=\{projectId\} projectId=\{projectId\}/);
    for (const layout of ['embodex-sidebar', 'embodex-center-pane', 'embodex-agent-dock']) assert(shared.includes(layout));
    assert.match(shared, /请从已授权的具身智能项目进入 Embodex/);
    assert.match(wrapper, /project\.id === projectId && project\.projectType === 'EMBODIED_AI'/);
    assert.match(wrapper, /<EmbodexSchemeDesignPage key=\{projectId\} projectId=\{projectId\}/);
    assert(!overview.includes('ProjectUeViewer'));
    for (const fake of ['60 FPS', 'UE 5.4', '实时就绪', 'simRunning', 'handleInjectObstacle', 'deployment.json']) assert(!shared.includes(fake), `Old UE demo survived: ${fake}`);
    const viewer = readFileSync(fileURLToPath(new URL('../components/ue/ProjectUeViewer.tsx', import.meta.url)), 'utf8');
    assert(!viewer.includes('onLoad='), 'iframe load must not claim WebRTC connection');
    assert.match(viewer, /重新打开播放器/);
  });
});
