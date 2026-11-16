import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { client } from '../lib/api/client';
import { KitWorkspace, usageWindow, schemaFields, algorithmExamples, sessionStatus, priceText, formatTokens } from '../lib/embodikit/workspace';
import { LoadState, Pager, dialogKeyDown } from '../lib/embodikit/components';
import type { KitPublicAlgorithm, KitPublicAlgorithmList, KitAccessState } from '../lib/api/generated/types.gen';

const profile = { account_id: 'fixture-account', name: 'Fixture account', status: 'active', auth_method: 'bff_session', scopes: ['account:read', 'usage:read', 'api_keys:read', 'api_keys:write'] };
const active = { state: 'ACTIVE', account_id: profile.account_id, profile };
const balance = { available_tokens: 9000, processing_tokens: 250, consumed_tokens: 1000, unit: 'EmbodiKit_Tokens', updated_at: '2026-10-08T00:00:00Z' };
const key = { key_id: 'fixture-inference', name: 'fixture', key_prefix: 'fake_prefix', enabled: true, scopes: ['inference'], created_at: '2026-10-08T00:00:00Z', last_used_at: null };
const algorithm: KitPublicAlgorithm = { algorithm_ref: 'algorithm@2.0', name: 'Fixture algorithm', description: 'Only a local deterministic fixture', category: 'Fixture', supported_robot_types: ['robot-b'], availability: { status: 'available' }, pricing: { billing_type: 'fixed_request', display_name: 'Per request', tokens_per_request: 123, unit: 'EmbodiKit_Tokens' }, input_schema: { properties: { observation: { type: 'object', description: 'Fixture observation' } }, required: ['observation'] }, output_schema: { properties: { actions: { type: 'array' } } }, examples: { sdk: { protocol: 'sdk', source: 'fixture_sdk()\n' }, http: { protocol: 'http', source: 'fixture_http' }, websocket: { protocol: 'websocket', source: 'fixture_ws' } } };
const page = (name: string, rows: unknown[], page = 1, has_more = false) => ({ [name]: rows, page, page_size: 20, has_more });
const ok = (data: unknown, status = 200) => ({ data, response: new Response(null, { status }) });
const error = (code: string, status = 503) => ({ error: { error: { code, message: 'never print raw infrastructure secrets' } }, response: new Response(null, { status }) });
type Call = { url: string; query?: Record<string, unknown>; body?: { name?: string; api_key?: string }; headers?: Record<string, string>; path?: Record<string, string>; signal?: AbortSignal };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('Task018 frontend typed SDK wiring and isolation (local fake only)', () => {
  let get: typeof client.get; let post: typeof client.post; let del: typeof client.delete;
  let workspaces: KitWorkspace[];
  beforeEach(() => { get = client.get; post = client.post; del = client.delete; workspaces = []; });
  afterEach(() => { workspaces.forEach(item => item.dispose()); client.get = get; client.post = post; client.delete = del; });
  const workspace = () => { const result = new KitWorkspace('00000000-0000-4000-8000-000000000001', () => {}); workspaces.push(result); return result; };
  const fakeGet = (handler: (call: Call) => unknown | Promise<unknown>) => { client.get = (async (call: Call) => handler(call)) as unknown as typeof client.get; };

  test('catalog keyword/robot/page/project and exact algorithm ref use approved SDK', async () => {
    const calls: Call[] = [];
    fakeGet(call => { calls.push(call); return ok(call.path ? algorithm : page('algorithms', [algorithm], 3, true)); });
    const current = workspace(); await current.loadCatalog('real keyword', 'robot-b', 3); await current.loadDetail('algorithm@2.0');
    assert.equal(current.state.catalog?.has_more, true);
    assert.equal(current.state.detail?.algorithm_ref, 'algorithm@2.0');
    assert.deepEqual(calls[0].query, { projectId: current.projectId, keyword: 'real keyword', robot_type: 'robot-b', page: 3, page_size: 20 });
    assert.equal(calls[1].path?.algorithm_ref, 'algorithm@2.0');
    assert(calls.every(call => call.url.startsWith('/api/v1/embodikit/')));
  });

  test('superseded catalog and disposed identity cannot publish late data', async () => {
    let resolveOld!: (value: unknown) => void;
    fakeGet(call => call.query?.keyword === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : ok(page('algorithms', [], 1)));
    const current = workspace(); const old = current.loadCatalog('old', 'all', 1); await flush();
    current.invalidate('catalog'); assert.equal(current.state.catalog, null);
    resolveOld(ok(page('algorithms', [algorithm]))); await old;
    assert.equal(current.state.catalog, null); assert.equal(current.state.loading.catalog, true);
    const obsolete = current.loadCatalog('old', 'all', 1); await flush();
    await current.loadCatalog('new', 'all', 1); resolveOld(ok(page('algorithms', [algorithm]))); await obsolete;
    assert.deepEqual((current.state.catalog as KitPublicAlgorithmList | null)?.algorithms, []);
    const pending = current.loadCatalog('old', 'all', 1); await flush(); current.dispose(); resolveOld(ok(page('algorithms', [algorithm]))); await pending;
    assert.equal(current.state.catalog, null);
  });

  test('overview partial failure clears old values and never invents zero balances', async () => {
    fakeGet(call => ok(call.url.endsWith('/balance') ? balance : call.url.endsWith('/summary') ? { request_count: 3 } : call.url.endsWith('/sessions') ? page('sessions', []) : page('transactions', [])));
    const current = workspace(); await current.loadOverview(); assert.equal(current.state.balance?.available_tokens, 9000);
    fakeGet(call => call.url.endsWith('/transactions') ? error('EMBODIKIT_UNAVAILABLE') : ok(balance));
    await current.loadOverview(); assert.equal(current.state.balance, null); assert.equal(current.state.summary, null);
    assert.match(current.state.errors.overview ?? '', /暂时不可用/); assert.equal(formatTokens(null), '—');
    assert(!JSON.stringify(current.state).includes('infrastructure'));
  });

  test('session records use exact state and filters; trend uses Asia/Shanghai and paginated breakdowns', async () => {
    const calls: Call[] = [];
    fakeGet(call => { calls.push(call); return ok(call.url.endsWith('/sessions') ? page('sessions', []) : call.url.endsWith('/timeseries') ? { points: [] } : call.url.endsWith('/breakdown') ? { items: [] } : { request_count: 0 }); });
    const current = workspace(); await current.loadUsage('records', '7d', 'a@1', 'key-1', 'closed', 4);
    assert.equal(calls[0].url, '/api/v1/embodikit/sessions');
    assert.equal(calls[0].query?.status, 'closed'); assert.equal(calls[0].query?.page, 4);
    assert.equal(calls[0].query?.algorithm_ref, 'a@1'); assert.equal(calls[0].query?.api_key_id, 'key-1');
    assert.equal(Date.parse(String(calls[0].query?.created_to)) - Date.parse(String(calls[0].query?.created_from)), 7 * 86400000);
    calls.length = 0; await current.loadUsage('trend', '24h', 'all', 'all', 'failed', 1, 2);
    assert.equal(calls.length, 4); assert(calls.every(call => call.query?.status === undefined));
    assert.equal(calls.find(call => call.url.endsWith('/timeseries'))?.query?.timezone, 'Asia/Shanghai');
    assert.deepEqual(calls.filter(call => call.url.endsWith('/breakdown')).map(call => [call.query?.group_by, call.query?.page]), [['algorithm', 2], ['api_key', 2]]);
    assert.equal(sessionStatus('closed'), '已完成'); assert.equal(sessionStatus('failed'), '失败');
  });

  test('filter sources drain pagination and include disabled historical inference keys', async () => {
    fakeGet(call => ok(call.url.endsWith('/algorithms') ? page('algorithms', [algorithm], Number(call.query?.page), false) : page('api_keys', Number(call.query?.page) === 1 ? [key] : [{ ...key, key_id: 'disabled', enabled: false }, { ...key, key_id: 'bootstrap', scopes: ['account:read'] }], Number(call.query?.page), Number(call.query?.page) === 1)));
    const current = workspace(); await current.loadFilters();
    assert.equal(current.state.filterAlgorithms.length, 1);
    assert.deepEqual(current.state.filterKeys.map(item => item.key_id), ['fixture-inference', 'disabled']);
    fakeGet(call => ok(page(call.url.endsWith('/algorithms') ? 'algorithms' : 'api_keys', [], 1, true)));
    await current.loadFilters(); assert.deepEqual(current.state.filterAlgorithms, []); assert.deepEqual(current.state.filterKeys, []);
    assert.match(current.state.errors.filters ?? '', /返回数据无效/);
  });

  test('session detail separates requests from charged usage and keeps independent pages', async () => {
    const calls: Call[] = [];
    fakeGet(call => { calls.push(call); return ok(call.url.endsWith('/requests') ? page('requests', [], 3, true) : call.url.endsWith('/usage') ? page('usage_records', [], 4, false) : { session_id: 'session-1' }); });
    const current = workspace(); await current.loadSession('session-1', 3, 4);
    assert.equal(current.state.requests?.page, 3); assert.equal(current.state.usageRecords?.page, 4);
    assert.equal(calls.find(call => call.url.endsWith('/usage'))?.query?.session_id, 'session-1');
    assert.equal(calls.find(call => call.url.endsWith('/requests'))?.path?.session_id, 'session-1');
  });

  test('unknown create is not automatic; user retry keeps original key/body and null secret is truthful', async () => {
    const posts: Call[] = [];
    client.post = (async (call: Call) => { posts.push(call); return posts.length === 1 ? error('EMBODIKIT_WRITE_OUTCOME_UNKNOWN', 504) : ok({ key, secret: null }, 201); }) as unknown as typeof client.post;
    fakeGet(() => ok(page('api_keys', [key])));
    const current = workspace(); assert.equal(await current.createKey(' original '), false);
    assert.equal(posts.length, 1); assert.equal(current.state.pendingKeyName, 'original');
    assert.equal(await current.createKey('changed'), true); assert.equal(posts.length, 2);
    assert.equal(posts[0].headers?.['Idempotency-Key'], posts[1].headers?.['Idempotency-Key']);
    assert.deepEqual(posts[0].body, { name: 'original', scopes: ['inference'] }); assert.deepEqual(posts[0].body, posts[1].body);
    assert.equal(current.state.secret, null); assert.match(current.state.actionError ?? '', /无法再次查看/);
  });

  test('key double-submit blocks, secret clears on close and late success cannot reopen after leaving', async () => {
    let resolvePost!: (value: unknown) => void; let count = 0;
    client.post = (async () => { count++; return await new Promise(resolve => { resolvePost = resolve; }); }) as unknown as typeof client.post;
    fakeGet(() => ok(page('api_keys', [key])));
    const current = workspace(); const first = current.createKey('fixture'); await flush(); await current.createKey('duplicate'); assert.equal(count, 1);
    resolvePost(ok({ key, secret: 'FAKE_ONCE_ONLY_SECRET' }, 201)); await first; assert.equal(current.state.secret, 'FAKE_ONCE_ONLY_SECRET');
    current.clearSecret(); assert.equal(current.state.secret, null);
    const next = current.createKey('other'); await flush(); current.clearSecret(); resolvePost(ok({ key, secret: 'FAKE_LATE_SECRET' }, 201)); await next;
    assert.equal(current.state.secret, null); assert(!JSON.stringify(current.state).includes('FAKE_LATE_SECRET'));
  });

  test('actual create dialog Cancel/Escape suppress late secret and preserve uncertain explicit retry', async () => {
    const source = readFileSync(new URL('../app/algorithms/page.tsx', import.meta.url), 'utf8');
    assert.match(source, /aria-label="创建 API Key" onKeyDown=\{event => dialogKeyDown\(event, closeCreate\)\}/);
    assert.match(source, /onClick=\{closeCreate\}[\s\S]*?>\s*取消\s*<\/button>/);
    const closeBody = source.match(/const closeCreate = \(\) => \{([^}]+)\};/)?.[1];
    assert(closeBody, 'execute the close callback wired by the actual page');
    fakeGet(() => ok(page('api_keys', [key])));
    for (const entry of ['Cancel', 'Escape']) {
      const current = workspace(); let modalOpen = true; let prevented = false;
      const closeCreate = new Function('setIsCreateKeyModalOpen', 'workspace', closeBody)
        .bind(null, (open: boolean) => { modalOpen = open; }, current) as () => void;
      const close = () => entry === 'Cancel' ? closeCreate() : dialogKeyDown({ key: 'Escape', preventDefault: () => { prevented = true; } } as React.KeyboardEvent<HTMLDivElement>, closeCreate);
      let resolvePost!: (value: unknown) => void; const posts: Call[] = [];
      client.post = (async (call: Call) => { posts.push(call); return await new Promise(resolve => { resolvePost = resolve; }); }) as unknown as typeof client.post;
      const pending = current.createKey('original'); await flush(); close();
      assert.equal(modalOpen, false); assert.equal(prevented, entry === 'Escape');
      resolvePost(ok({ key, secret: `FAKE_DISMISSED_${entry}` }, 201)); await pending;
      assert.equal(current.state.secret, null); assert(!JSON.stringify(current.state).includes('FAKE_DISMISSED'));
      const uncertain = current.createKey('uncertain'); await flush(); close();
      resolvePost(error('EMBODIKIT_WRITE_OUTCOME_UNKNOWN', 504)); await uncertain;
      assert.equal(current.state.pendingKeyName, 'uncertain'); assert.equal(posts.length, 2);
      const retry = current.createKey('changed'); await flush();
      assert.equal(posts[1].headers?.['Idempotency-Key'], posts[2].headers?.['Idempotency-Key']);
      assert.deepEqual(posts[1].body, posts[2].body);
      resolvePost(ok({ key, secret: null }, 201)); await retry; assert.equal(current.state.secret, null);
    }
  });

  test('session-expired response invalidates all account data and suppresses sibling late requests', async () => {
    let resolveBalance!: (value: unknown) => void;
    fakeGet(call => call.url.endsWith('/access-session') ? ok(active) : call.url.endsWith('/balance') ? new Promise(resolve => { resolveBalance = resolve; }) : call.url.endsWith('/api-keys') ? error('EMBODIKIT_SESSION_EXPIRED', 401) : ok(page('sessions', [])));
    const current = workspace(); await current.loadAccess(); const pending = current.loadBilling(1); await flush();
    await current.loadKeys(1); resolveBalance(ok(balance)); await pending;
    assert.equal(current.state.access, null); assert.equal(current.state.balance, null); assert.equal(current.state.keys, null);
    assert.equal(current.state.secret, null);
  });

  test('binding exchanges once without retaining Bootstrap; logout only clears Kit and reports uncertain revocation', async () => {
    let posts = 0; const deletes: string[] = [];
    client.post = (async () => { posts++; return error('EMBODIKIT_WRITE_OUTCOME_UNKNOWN', 504); }) as unknown as typeof client.post;
    const current = workspace(); await current.connect('FAKE_BOOTSTRAP_INPUT'); assert.equal(posts, 1);
    assert(!JSON.stringify(current.state).includes('FAKE_BOOTSTRAP_INPUT'));
    client.post = (async () => ok(active, 201)) as unknown as typeof client.post;
    await current.connect('FAKE_BOOTSTRAP_INPUT');
    client.delete = (async (call: Call) => { deletes.push(call.url); return error('EMBODIKIT_WRITE_OUTCOME_UNKNOWN', 504); }) as unknown as typeof client.delete;
    await current.disconnect(); assert.deepEqual(deletes, ['/api/v1/embodikit/access-session']); assert.equal(current.state.access, null);
    assert.match(current.state.actionError ?? '', /远端撤销尚未确认/);
    client.delete = (async () => ok(undefined, 204)) as unknown as typeof client.delete;
    fakeGet(() => ok({ state: 'REAUTH_REQUIRED', account_id: profile.account_id, profile: null })); await current.disconnect();
    const reconnectedState = current.state.access as KitAccessState | null;
    assert.equal(reconnectedState?.state, 'REAUTH_REQUIRED'); assert.equal(reconnectedState?.account_id, profile.account_id);
  });

  test('input/schema/examples/price helpers preserve real protocol text and unknown display', () => {
    assert.deepEqual(schemaFields(algorithm.input_schema), [{ name: 'observation', type: 'object', description: 'Fixture observation', required: true }]);
    assert.equal(algorithmExamples(algorithm)[0].source, 'fixture_sdk()\n'); assert.deepEqual(algorithmExamples(algorithm).map(item => item.label), ['Python SDK', 'HTTP', 'WebSocket']);
    assert.equal(priceText(algorithm.pricing), '123 Token');
    assert.equal(priceText({ billing_type: 'token_usage', display_name: 'input 2 / output 4', unit: 'EmbodiKit_Tokens' }), 'input 2 / output 4');
    assert.equal(usageWindow('30d', 'all', 'all', 86400000 * 100).created_from, new Date(86400000 * 70).toISOString());
  });

  test('loading/error/pager are visible, and static fake operations cannot return to user UI', () => {
    const loading = renderToStaticMarkup(React.createElement(LoadState, { loading: true, retry: () => {} })); assert.match(loading, /正在加载/);
    const failed = renderToStaticMarkup(React.createElement(LoadState, { error: 'Fixture failure', retry: () => {} })); assert.match(failed, /role="alert"/); assert.match(failed, /重试/);
    const paging = renderToStaticMarkup(React.createElement(Pager, { page: 2, hasMore: true, onChange: () => {} })); assert(!paging.includes('disabled'));
    const source = readFileSync(new URL('../app/algorithms/page.tsx', import.meta.url), 'utf8');
    assert(!/990,000|83\.3%|124 ms|secret_token_123456|Math\.random|api\.embodikit\.com|已发起.*充值/.test(source));
    assert(source.includes('handleCopyCode(activeExample.source)')); assert(source.includes('<code>{activeExample.source}</code>'));
    assert(source.includes('Token 充值（暂不可用）')); assert(!source.includes('apiLogout')); assert(source.includes('dialogKeyDown'));
  });
});
