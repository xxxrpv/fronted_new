/**
 * 验证新版会话控制器的消息提交、AG-UI 归并与断线恢复行为。
 * 使用与正式接口相同的假 HTTP 响应，不访问真实模型、UE 或用户数据库。
 * 特别覆盖原运行续读、半截历史去重、结果不明时保留幂等键以及发布标识恢复。
 * 注销和销毁检查保证旧请求不会污染下一用户或项目的页面。
 * 本文件不验证浏览器真实视频画面，界面渲染和平台 HTTP 权限分别另行验证。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HubSession } from '../lib/hub/session';
import { HubApi } from '../lib/hub/api';
import { readEvents, reduceMessages } from '../lib/hub/events';
import { revokeUserConversations } from '../lib/embodex/conversation-storage';
import type { Message, HubState, Version } from '../lib/hub/types';

const pid = '22222222-2222-4222-8222-222222222222';
const vid = '55555555-5555-4555-8555-555555555555';
const frame = (n: number, value: unknown) => `id: ${n}\ndata: ${JSON.stringify(value)}\n\n`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (value: string) => new Response(value, { headers: { 'Content-Type': 'text/event-stream' } });

test('new generated version follows latest while ordinary refresh preserves manual selection', async () => {
  const first: Version = { version_id: vid, number: 1, summary: '基线', created_at: '' };
  const second: Version = { ...first, version_id: crypto.randomUUID(), number: 2 };
  let versions = [first];
  const session = new HubSession(crypto.randomUUID(), pid, () => {}, async url => {
    const path = String(url);
    if (path.endsWith('/versions')) return json({ versions });
    if (path.endsWith('/preview')) return json({ status: 'IDLE', version_id: null, player_url: null, error: null });
    if (path.includes('/messages?')) return json({ messages: [], next_before: null });
    return json({ status: 'ACTIVE', active_run_id: null });
  }, { pollMs: 0 });
  await session.initialize();
  assert.equal(session.state.selected, vid);
  versions = [second, first];
  await session.refresh();
  assert.equal(session.state.selected, second.version_id);
  session.select(vid);
  await session.refresh();
  assert.equal(session.state.selected, vid);
  session.dispose();
});
async function until(condition: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('test timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function fixture() {
  let rid: string | null = null, completed = false;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const user = crypto.randomUUID();
  const storage = new Map<string, string>();
  let failSend = false, failPublish = false, reconnect = false, streams = 0;
  const port = { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const history = () => ({ messages: rid ? [{ seq: 1, run_id: rid, created_at: '2026-10-27T10:00:00Z', message: { id: 'u1', role: 'user', content: '生成机器人' } },
    ...(!completed ? [] : [{ seq: 2, run_id: rid, created_at: '2026-10-27T10:00:01Z', message: { id: 'a1', role: 'assistant', content: '甲乙' } }])] : [], next_before: null });
  const transport: typeof fetch = async (url, init) => {
    const path = String(url); calls.push({ path, init });
    if (path.endsWith('/messages') && init?.method === 'POST') {
      if (failSend) { failSend = false; throw new TypeError('network failed'); }
      rid = new Headers(init.headers).get('Idempotency-Key'); completed = false;
      return json({ run_id: rid, status: 'QUEUED' }, 202);
    }
    if (path.includes('/messages?')) return json(history());
    if (path.endsWith('/versions')) return json({ versions: [{ version_id: vid, number: 1, created_at: '2026-10-27T10:00:00Z', summary: '桌面机器人' }] });
    if (path.endsWith('/preview')) return json({ status: 'IDLE', version_id: null, player_url: null, error: null });
    if (path.endsWith('/events')) {
      streams++;
      const initial = frame(1, { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }) + frame(2, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '甲' });
      if (reconnect && streams === 1) return sse(initial);
      completed = true;
      return sse(initial + frame(3, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '乙' })
        + frame(4, { type: 'CUSTOM', name: 'ARTIFACT_PUBLICATION_PROPOSED', value: { versionId: vid, number: 1 } })
        + frame(5, { type: 'RUN_FINISHED', runId: rid, threadId: pid }));
    }
    if (path.includes('/runs/')) return json({ run_id: rid, status: completed ? 'SUCCEEDED' : 'RUNNING', error: null });
    if (path.endsWith('/publications')) {
      if (failPublish) { failPublish = false; throw new TypeError('network failed'); }
      return json({ operation_id: new Headers(init?.headers).get('Idempotency-Key'), status: 'SUCCEEDED' }, 202);
    }
    if (path.includes('/operations/')) return json({ operation_id: path.split('/').at(-1), kind: 'PUBLISH', version_id: vid, status: 'SUCCEEDED', phase: 'COMPLETED', error: null, result: { asset_id: 'asset-1', artifact_id: 'artifact-1' } });
    return json({ status: 'ACTIVE', active_run_id: rid && !completed ? rid : null });
  };
  return { calls, transport, port, storage, user, history, setRun: (value: string) => { rid = value; },
    failSend: () => { failSend = true; }, failPublish: () => { failPublish = true; }, reconnect: () => { reconnect = true; } };
}

test('AG-UI split UTF-8/CRLF frames and repeated event IDs are consumed once', async () => {
  const raw = frame(1, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: '机器人' }).replaceAll('\n', '\r\n');
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let n = 0; n < bytes.length; n += 3) controller.enqueue(bytes.slice(n, n + 3)); controller.close(); } });
  const events: unknown[] = [];
  assert.equal(await readEvents(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), 0, event => { events.push(event); return false; }), 1);
  assert.equal((events[0] as { delta: string }).delta, '机器人');
  await readEvents(sse(raw), 1, event => { events.push(event); return false; });
  assert.equal(events.length, 1);
});

test('tool calls and snapshots preserve already loaded older messages', () => {
  let rows: Message[] = [{ id: 'old', role: 'user', content: '以前的需求' }];
  rows = reduceMessages(rows, { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'generate_robot_spec', parentMessageId: 'a' });
  rows = reduceMessages(rows, { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"requirement":"test"}' });
  rows = reduceMessages(rows, { type: 'TOOL_CALL_RESULT', toolCallId: 't1', messageId: 'result', content: '{"status":"success"}' });
  rows = reduceMessages(rows, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'a', role: 'assistant', content: '已完成' }] });
  assert.equal(rows.find(r => r.id === 'old')?.content, '以前的需求');
  assert.equal(rows.find(r => r.id === 'result')?.toolCallId, 't1');
});

test('browser submits only new content using the platform cookie and stable key', async () => {
  let captured: RequestInit | undefined;
  const api = new HubApi(pid, async (_url, init) => { captured = init; return json({ run_id: vid, status: 'QUEUED' }); });
  await api.send('新需求', vid);
  assert.deepEqual(JSON.parse(String(captured?.body)), { content: '新需求' });
  assert.equal(captured?.credentials, 'same-origin');
  assert.equal(new Headers(captured?.headers).get('Idempotency-Key'), vid);
  assert.equal(new Headers(captured?.headers).get('Authorization'), null);
});

test('SSE transport preserves the browser global receiver for native fetch', async () => {
  const api = new HubApi(pid, function (this: unknown) {
    assert.equal(this, globalThis);
    return Promise.resolve(sse(''));
  });
  await api.events(vid, 0, new AbortController().signal);
});

test('SSE reconnect resumes cursor without repeating generation or text', async () => {
  const f = fixture(); f.reconnect();
  const session = new HubSession(f.user, pid, () => {}, f.transport, { pollMs: 0 });
  try {
    await session.initialize(); assert.equal(await session.send('生成机器人'), true);
    await until(() => session.state.run?.status === 'SUCCEEDED');
    assert.equal(session.state.messages.find(row => row.id === 'a1')?.content, '甲乙');
    assert.equal(f.calls.filter(row => row.init?.method === 'POST').length, 1);
    assert.deepEqual(f.calls.filter(row => row.path.endsWith('/events')).map(row => new Headers(row.init?.headers).get('Last-Event-ID')), ['0', '2']);
    assert.equal(session.state.proposal?.versionId, vid);
  } finally { session.dispose(); }
});

test('page refresh recovers an active run without POST and without duplicating partial history', async () => {
  const f = fixture(); f.setRun(crypto.randomUUID());
  const original = f.transport;
  const transport: typeof fetch = async (url, init) => {
    if (String(url).includes('/messages?')) {
      const h = f.history();
      if (h.messages.length === 1) h.messages.push({ seq: 2, run_id: h.messages[0].run_id, created_at: '2026-10-27T10:00:01Z', message: { id: 'a1', role: 'assistant', content: '甲' } });
      return json(h);
    }
    return original(url, init);
  };
  const session = new HubSession(f.user, pid, () => {}, transport, { pollMs: 0 });
  try {
    await session.initialize(); await until(() => session.state.run?.status === 'SUCCEEDED');
    assert.equal(session.state.messages.find(row => row.id === 'a1')?.content, '甲乙');
    assert.ok(!f.calls.some(row => row.init?.method === 'POST'));
  } finally { session.dispose(); }
});

test('uncertain message retry preserves the same key and original content', async () => {
  const f = fixture(); f.failSend();
  const session = new HubSession(f.user, pid, () => {}, f.transport, { pollMs: 0 });
  try {
    await session.initialize(); assert.equal(await session.send('原消息'), false);
    assert.equal(session.state.pendingMessage, true);
    assert.equal(await session.send('修改后的内容'), true);
    await until(() => session.state.run?.status === 'SUCCEEDED');
    const posts = f.calls.filter(row => row.init?.method === 'POST');
    assert.equal(new Headers(posts[0].init?.headers).get('Idempotency-Key'), new Headers(posts[1].init?.headers).get('Idempotency-Key'));
    assert.equal(posts[0].init?.body, posts[1].init?.body);
  } finally { session.dispose(); }
});

test('publication retries preserve version/key and receipt survives refresh using only opaque IDs', async () => {
  const f = fixture(); f.failPublish();
  const session = new HubSession(f.user, pid, () => {}, f.transport, { pollMs: 0, storage: f.port });
  try {
    await session.initialize(); await session.publishVersion(vid);
    assert.equal(session.state.pendingPublication, vid);
    await session.publishVersion(vid);
    const posts = f.calls.filter(row => row.path.endsWith('/publications'));
    assert.deepEqual(JSON.parse(String(posts[0].init?.body)), { version_id: vid });
    assert.equal(new Headers(posts[0].init?.headers).get('Idempotency-Key'), new Headers(posts[1].init?.headers).get('Idempotency-Key'));
    assert.equal(session.state.publication?.result?.asset_id, 'asset-1');
    assert.deepEqual(Object.keys(JSON.parse([...f.storage.values()][0])).sort(), ['key', 'version']);
    const recovered = new HubSession(f.user, pid, () => {}, f.transport, { pollMs: 0, storage: f.port });
    try { await recovered.initialize(); assert.equal(recovered.state.publication?.status, 'SUCCEEDED'); } finally { recovered.dispose(); }
  } finally { session.dispose(); }
});

test('logout revokes writers and late responses cannot restore old conversation', async () => {
  const f = fixture(); const updates: HubState[] = [];
  const session = new HubSession(f.user, pid, state => updates.push(state), f.transport, { pollMs: 0 });
  await session.initialize(); revokeUserConversations(f.user);
  const before = updates.length;
  await session.send('不应发送');
  assert.equal(updates.length, before);
  assert.deepEqual(updates.at(-1)?.messages, []);
  session.dispose();
});

test('refresh restores an earlier valid proposal after an ordinary follow-up', async () => {
  const oldRun = crypto.randomUUID(), latestRun = crypto.randomUUID();
  const session = new HubSession(crypto.randomUUID(), pid, () => {}, async url => {
    const path = String(url);
    if (path.endsWith('/versions')) return json({ versions: [{ version_id: vid, number: 1, summary: '模型', created_at: '' }] });
    if (path.endsWith('/preview')) return json({ status: 'IDLE', version_id: null, player_url: null, error: null });
    if (path.includes('/messages?')) return json({ messages: [
      { seq: 1, run_id: oldRun, message: { id: 'old', role: 'user', content: '满意' } },
      { seq: 2, run_id: latestRun, message: { id: 'new', role: 'user', content: '入口在哪里' } },
    ], next_before: null });
    if (path.endsWith('/events')) return sse(path.includes(oldRun)
      ? frame(1, { type: 'CUSTOM', name: 'ARTIFACT_PUBLICATION_PROPOSED', value: { versionId: vid, number: 1 } })
        + frame(2, { type: 'RUN_FINISHED' }) : frame(1, { type: 'RUN_FINISHED' }));
    if (path.includes('/runs/')) return json({ run_id: latestRun, status: 'FAILED', error: { code: 'CONTEXT_LIMIT', message: '上下文超出预算' } });
    return json({ status: 'ACTIVE', active_run_id: null });
  }, { pollMs: 0 });
  try {
    await session.initialize();
    assert.equal(session.state.proposal?.versionId, vid);
    assert.equal(session.state.run?.status, 'FAILED');
    assert.equal(session.state.error, '上下文超出预算');
    assert.equal(session.state.busy, false);
  } finally { session.dispose(); }
});

test('HubApi.urdf reads raw XML without converting to JSON and validates MIME/UTF-8', async () => {
  const xmlSample = '<?xml version="1.0"?><robot name="test_robot"/>';
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const api = new HubApi(pid, async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(new TextEncoder().encode(xmlSample), {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
    });
  });
  const res = await api.urdf(vid);
  assert.equal(res, xmlSample);
  assert.equal(capturedUrl, `/api/v1/projects/${pid}/embodex-hub/versions/${vid}/urdf`);
  assert.equal(capturedInit?.credentials, 'same-origin');
  assert.equal(capturedInit?.cache, 'no-store');

  // 非法 UUID 校验
  await assert.rejects(async () => api.urdf('invalid-uuid'), (err: unknown) => {
    return typeof err === 'object' && err !== null && (err as { code?: string; status?: number }).code === 'INVALID_REQUEST' && (err as { status?: number }).status === 400;
  });

  // 错误 MIME 抛错
  const badMimeApi = new HubApi(pid, async () => {
    return new Response('<html>error</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  });
  await assert.rejects(async () => badMimeApi.urdf(vid), (err: unknown) => {
    return typeof err === 'object' && err !== null && (err as { code?: string; status?: number }).code === 'PROTOCOL_ERROR' && (err as { status?: number }).status === 502;
  });

  // 404 错误透传
  const errorApi = new HubApi(pid, async () => {
    return new Response(JSON.stringify({ error: { code: 'VERSION_NOT_FOUND', message: '版本不存在' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  });
  await assert.rejects(async () => errorApi.urdf(vid), (err: unknown) => {
    return typeof err === 'object' && err !== null && (err as { code?: string; status?: number }).code === 'VERSION_NOT_FOUND' && (err as { status?: number }).status === 404;
  });
});
