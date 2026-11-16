/**
 * 验证新版真实视图的版本标识、发布确认、视频地址和空状态。
 * 直接渲染生产组件，避免只验证一份与实现脱节的静态界面副本。
 * 服务状态全部来自显式构造的测试数据，不伪装为真实 UE 或 Workspace 响应。
 * 发布建议只能显示确认入口，具体写操作仍通过用户触发的独立回调执行。
 * CSS 模块使用统一测试入口的代理；视觉布局另通过浏览器预览核对。
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HubWorkspaceView, playerUrl, versionName, type HubWorkspaceViewProps } from '../components/hub/HubWorkspaceView';
import { initialHubState } from '../lib/hub/types';

const vid = '55555555-5555-4555-8555-555555555555';
const version = { version_id: vid, number: 2, summary: '桌面抓取机器人', created_at: '2026-10-27T10:00:00Z' };

test('version dropdown uses readable name without interpreting engineering claims', () => {
  assert.equal(versionName({ ...version, summary: "{'name': 'unitree_a1_v1', 'parameter_changes_applied': True}" }), 'unitree_a1_v1');
  assert.equal(versionName({ ...version, summary: '{"name":"a1"}' }), 'a1');
});
function props(): HubWorkspaceViewProps {
  const noop = () => {};
  return { projectId: '22222222-2222-4222-8222-222222222222', projectName: '抓取项目', state: { ...initialHubState(), loading: false }, draft: '', confirmation: null,
    onDraft: noop, onSelect: noop, onPreview: noop, onSend: noop, onRefresh: noop, onResume: noop, onOlder: noop, onRetryMessage: noop,
    onPreparePublish: noop, onCancelPublish: noop, onConfirmPublish: noop, onRetryPublication: noop };
}
test('empty workspace offers conversation and does not expose a false preview', () => {
  const html = renderToStaticMarkup(<HubWorkspaceView {...props()} />);
  assert.match(html, /从右侧对话开始设计/); assert.match(html, /项目历史对话/); assert.ok(!html.includes('<iframe'));
  assert.match(html, /disabled=""[^>]*>发布所选版本/);
  assert.match(html, /<select[^>]*aria-label="选择模型版本"/);
  assert.match(html, />加载模型<\/button>/);
});

test('saved version has a manual confirmation entry without an Agent proposal', () => {
  const value = props(); value.state.versions = [version]; value.state.selected = vid;
  let uploads = 0; value.onConfirmPublish = () => uploads++;
  const html = renderToStaticMarkup(<HubWorkspaceView {...value} />);
  assert.match(html, /aria-label="版本发布确认"/);
  assert.match(html, /手动发布入口/);
  assert.match(html, /查看并确认/);
  assert.ok(!html.includes('aria-label="Agent 发布建议"'));
  assert.equal(uploads, 0);
});

test('conversation failure and queued status are visible outside the scrolling history', () => {
  const value = props();
  value.state.run = { run_id: vid, status: 'FAILED', error: { code: 'CONTEXT_LIMIT', message: '摘要服务不可用' } };
  const html = renderToStaticMarkup(<HubWorkspaceView {...value} />);
  assert.match(html, /本轮执行失败/);
  assert.match(html, /role="alert">摘要服务不可用/);
  assert.ok(html.indexOf('摘要服务不可用') < html.indexOf('aria-label="项目历史对话"'));
  value.state.run = { run_id: vid, status: 'QUEUED' }; value.state.busy = true;
  assert.match(renderToStaticMarkup(<HubWorkspaceView {...value} />), /本轮正在排队/);
});
test('selected version, actual preview and explicit publication dialog remain distinct', () => {
  const value = props(); value.state.versions = [version, { ...version, version_id: '66666666-6666-4666-8666-666666666666', number: 3 }];
  value.state.selected = vid; value.state.preview = { status: 'READY', version_id: value.state.versions[1].version_id, player_url: 'https://ue.example/player', error: null };
  value.confirmation = version;
  const html = renderToStaticMarkup(<HubWorkspaceView {...value} />);
  assert.match(html, /第 2 版/); assert.match(html, /第 3 版模型 UE 预览/); assert.match(html, /发布第 2 版？/);
  assert.match(html, /确认发布/); assert.match(html, /sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"/);
});
test('Agent proposal requires a user action and Markdown cannot inject remote content', () => {
  const value = props(); value.state.versions = [version]; value.state.proposal = { versionId: vid, number: 2, runId: vid };
  value.state.messages = [{ id: 'a', role: 'assistant', content: '<script>alert(1)</script>\n\n![图](https://attacker.invalid/x)\n\n[链接](javascript:alert(1))' }];
  let called = 0; value.onConfirmPublish = () => { called++; };
  const html = renderToStaticMarkup(<HubWorkspaceView {...value} />);
  assert.match(html, /是否发布第 2 版/); assert.match(html, /查看并确认/); assert.equal(called, 0);
  assert.ok(!html.includes('<script')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('javascript:'));
});
test('stale, unknown and unsafe player addresses never mount a video iframe', () => {
  const state = { ...initialHubState(), versions: [version], preview: { status: 'READY', version_id: vid, player_url: 'javascript:alert(1)', error: null } };
  assert.equal(playerUrl(state), null);
  state.preview.player_url = 'https://ue.example/player'; state.preview.version_id = 'other'; assert.equal(playerUrl(state), null);
  state.preview.version_id = vid; state.preview.status = 'UNKNOWN'; assert.equal(playerUrl(state), null);
  state.preview.status = 'READY'; assert.equal(playerUrl(state), 'https://ue.example/player');
});
