/**
 * 在原方案设计外壳内呈现 Hub 对话和模型版本，不重新设计平台布局。
 * 机器人使用原生下拉框选择；选择只修改目标，点击加载才提交预览请求。
 * 模板入口复用平台原有 UE 组件，生成版本入口调用 Hub 的预览适配器。
 * 发布必须经过绑定具体版本的原生模态确认框，Agent 的建议不会自动上传。
 * Markdown 禁止原始 HTML、远程图片和自动跳转，工具结果保留在可展开的详情中。
 * 所有操作通过回调交给会话层，视图不直接访问服务或维护第二套服务端状态。
 * 响应式布局、键盘焦点、原生对话框及空状态在本文件和独立样式中统一处理。
 */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HubState, Version } from '../../lib/hub/types';
import styles from './HubWorkspace.module.css';

export interface HubWorkspaceViewProps {
  templatePanel?: React.ReactNode;
  renderShell?: (viewer: React.ReactNode, chat: React.ReactNode, publish: () => void) => React.ReactNode;
  projectId: string; projectName: string; state: HubState; draft: string; confirmation: Version | null;
  onDraft: (text: string) => void; onSelect: (id: string) => void; onPreview: () => void; onSend: () => void;
  onRefresh: () => void; onResume: () => void; onOlder: () => void; onRetryMessage: () => void;
  onPreparePublish: (version: Version) => void; onCancelPublish: () => void; onConfirmPublish: () => void; onRetryPublication: () => void;
}
const previewLabels: Record<string, string> = { IDLE: '等待生成模型', LOADING: '正在准备预览并加载模型', READY: '模型已就绪', UNKNOWN: '预览归属待核实', UNAVAILABLE: '预览暂不可用' };
// 历史版本摘要可能是 Python 字典文本，仅提取名称，不执行或推断工程数值。
export function versionName(version: Version): string {
  try { const value = JSON.parse(version.summary); if (typeof value?.name === 'string') return value.name; } catch { /* 兼容旧摘要。 */ }
  return version.summary.match(/['"]name['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] || version.summary.slice(0, 80) || '机器人模型';
}
const operationLabels: Record<string, string> = { QUEUED: '等待发布', RUNNING: '正在发布', SUCCEEDED: '发布成功', FAILED: '发布失败', UNKNOWN: '发布结果待核实', CANCELED: '发布已取消' };
const phaseLabels: Record<string, string> = { PACKAGING: '正在打包模型文件', REGISTERING: '正在登记产物', UPLOADING: '正在上传文件', VERIFYING: '正在确认文件完整性', COMPLETED: '产物已保存到文件空间' };
export function playerUrl(state: HubState): string | null {
  if (state.preview.status !== 'READY' || !state.versions.some(v => v.version_id === state.preview.version_id) || !state.preview.player_url) return null;
  try { const url = new URL(state.preview.player_url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function Markdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt || ''}</span> }}>{content}</ReactMarkdown>;
}
function PublicationDialog({ version, name, enabled, submitting, cancel, confirm }: { version: Version; name: string; enabled: boolean; submitting: boolean; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { if (node?.open) node.close(); }; }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="hub-publish-title" onCancel={event => { event.preventDefault(); if (!submitting) cancel(); }}>
    <span className={styles.eyebrow}>确认模型版本</span>
    <h2 id="hub-publish-title">发布第 {version.number} 版？</h2>
    <p>项目：{name}</p><p className={styles.dialogSummary}>{version.summary}</p>
    <p>确认后将上传这一版的完整模型文件。上传成功后，其他旧模型版本会按保留规则清理。</p>
    {!enabled && <p role="alert">这一版已被淘汰，请关闭后重新选择。</p>}
    <div className={styles.actions}><button type="button" className="btn btn-secondary" onClick={cancel} disabled={submitting} autoFocus>继续查看</button>
      <button type="button" className="btn btn-primary" onClick={confirm} disabled={!enabled || submitting}>{submitting ? '正在提交…' : '确认发布'}</button></div>
  </dialog>;
}

export function HubWorkspaceView(props: HubWorkspaceViewProps) {
  const { state, projectId, projectName, draft, confirmation } = props;
  const selected = state.versions.find(v => v.version_id === state.selected);
  const preview = state.versions.find(v => v.version_id === state.preview.version_id);
  const proposal = state.versions.find(v => v.version_id === state.proposal?.versionId);
  const publication = state.publication;
  const publishBlocked = state.publishing || !!state.pendingPublication || ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(publication?.status || '');
  const confirmationTarget = proposal || selected;
  const alreadyPublished = publication?.status === 'SUCCEEDED' && publication.version_id === confirmationTarget?.version_id;
  const conversationStatus = state.loading ? '正在读取会话…' : state.sending ? '正在提交消息…'
    : state.run?.status === 'UNKNOWN' ? '本轮结果待核实，不能重复执行'
    : state.busy ? state.run?.status === 'QUEUED' ? '本轮正在排队…' : 'Agent 正在处理本轮需求…'
    : state.run?.status === 'FAILED' ? '本轮执行失败'
    : state.run?.status === 'SUCCEEDED' ? '本轮对话已结束，可继续发送消息' : '可以发送新消息';
  const url = playerUrl(state);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // 模板和生成版本使用不同的服务归属校验；切换时卸载旧播放器，避免显示错误模型。
  const [source, setSource] = useState(props.templatePanel ? 'templates' : 'versions');
  const latestVersion = state.versions.reduce<Version | undefined>((a, b) => !a || b.number > a.number ? b : a, undefined)?.version_id;
  useEffect(() => { if (latestVersion) setSource('versions'); }, [latestVersion]);
  useEffect(() => { const node = log.current; if (node && pinned.current) node.scrollTop = node.scrollHeight; }, [state.messages]);
  const viewer = <>
    {state.error && <p role="alert">{state.error}</p>}
    {props.templatePanel && <label className="studio-stage-controls" style={{marginBottom: 16}}><span>模型来源</span><select className="embodex-field-input" value={source} onChange={event => setSource(event.target.value)} aria-label="模型来源"><option value="templates">项目机器人模板</option><option value="versions">Agent 生成版本</option></select></label>}
    {source === 'templates' ? props.templatePanel : <section className="embodex-ue-workspace" aria-label="模型版本和预览">
      <div className="studio-stage-header"><div><h3 className="studio-stage-title">UE 交互工作区</h3><span className="badge-live-dot">{previewLabels[state.preview.status] || '待核验'}</span></div></div>
      <div className="studio-stage-controls embodex-ue-resource-controls">
        <label style={{display:'grid',gap:6,flex:'1 1 240px'}}><span>机器人资源</span><select className="embodex-field-input" aria-label="选择模型版本" value={state.selected || ''} onChange={event => props.onSelect(event.target.value)} disabled={state.loading}>
          <option value="">请选择机器人版本</option>{state.versions.map(version => <option key={version.version_id} value={version.version_id}>第 {version.number} 版 · {versionName(version)}</option>)}
        </select></label>
        <button type="button" className="btn-stage-pill active" disabled={!selected || state.preview.status === 'LOADING'} onClick={props.onPreview}>加载模型</button>
        <button type="button" className="btn-stage-pill" onClick={props.onRefresh}>刷新状态</button>
        <button type="button" className="btn-stage-pill" disabled={!selected || publishBlocked} onClick={() => { if (selected) props.onPreparePublish(selected); }}>发布所选版本</button>
      </div>
      {!state.versions.length && <p>从右侧对话开始设计，生成的模型会保存在这里。</p>}
      <p role="status">{preview ? `当前预览：第 ${preview.number} 版` : '尚未加载生成版本。'}{state.preview.error?.message}</p>
      <div className="sim-render-canvas" style={{minHeight:380}}><div className="sim-world-grid">
        {url ? <iframe key={`${state.preview.version_id}:${url}`} title={`第 ${preview?.number} 版模型 UE 预览`} src={url} allow="fullscreen; autoplay; gamepad" allowFullScreen sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" referrerPolicy="no-referrer" style={{width:'100%',minHeight:380,border:0}} /> : <div className="embodex-ue-empty"><span>UE Pixel Streaming</span><p>选择机器人并点击加载模型，就绪后显示 UE 画面。</p></div>}
      </div></div>
        {publication && <section className={styles.receipt} aria-label="发布结果" role="status"><div className={styles.sectionHeading}><h2>{operationLabels[publication.status] || '发布状态'}</h2><a href="/workspace" className={styles.workspaceLink}>打开文件空间 →</a></div>
          <p>{publication.error?.message || phaseLabels[publication.phase || ''] || '正在准备模型文件，请稍候。'}</p>
          {publication.result && <details><summary>发布回执</summary><dl>{publication.result.file_name && <><dt>文件名</dt><dd>{publication.result.file_name}</dd></>}{publication.result.asset_id && <><dt>资产 ID</dt><dd>{publication.result.asset_id}</dd></>}{publication.result.artifact_id && <><dt>产物 ID</dt><dd>{publication.result.artifact_id}</dd></>}</dl></details>}
      </section>}
        {state.pendingPublication && <div className={styles.notice}><p>上次发布请求尚未确认，请核实原版本的发布结果。</p><button type="button" className="btn btn-secondary btn-sm" onClick={props.onRetryPublication} disabled={state.publishing}>核实并确认原版本</button></div>}
    </section>}
  </>;
  const chat = <section className={styles.chat} aria-label="设计对话"><div className={styles.chatHeading}><span className={styles.chatDot} aria-hidden="true" /><h2>Simplaix Agent</h2></div>
        <div className={styles.conversationStatus} role="status" aria-live="polite">{conversationStatus}</div>
        {(state.error || state.run?.error?.message) && <div className={styles.chatError} role="alert">{state.error || state.run?.error?.message}</div>}
        <div className={styles.messages} role="log" aria-label="项目历史对话" aria-live="polite" ref={log} onScroll={() => { const node = log.current; if (node) pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 180; }}>
          {state.before !== null && <button type="button" className={styles.older} onClick={props.onOlder}>加载更早的对话</button>}
          {!state.messages.length && <div className={styles.welcome}>{state.loading ? '正在读取项目对话…' : "Hi, I'm Simplaix Agent. I'm here to help you with your project."}</div>}
          {state.messages.map(message => <article key={message.id} className={`${styles.message} ${message.role === 'user' ? styles.userMessage : ''}`}>
            {message.role !== 'tool' && <span className={styles.messageRole}>{message.role === 'user' ? '你' : 'Embodex'}</span>}
            {message.role === 'tool' ? <details className={styles.tool}><summary>工具执行结果</summary><pre>{message.content}</pre></details> : <>
              {message.content && <div className={styles.markdown}><Markdown content={message.content} /></div>}
              {message.toolCalls?.map(call => <details key={call.id} className={styles.tool}><summary>{call.function.name}</summary><pre>{call.function.arguments}</pre></details>)}
            </>}
          </article>)}
          {state.busy && <p className={styles.running} role="status">{state.run?.status === 'UNKNOWN' ? '本轮执行结果尚未确认，请核实状态。' : 'Agent 正在处理本轮需求…'}</p>}
        </div>
        {confirmationTarget && !alreadyPublished && <aside className={styles.proposal} aria-label={proposal ? 'Agent 发布建议' : '版本发布确认'}><span className={styles.eyebrow}>{proposal ? 'Agent 发布建议' : '所选模型版本'}</span><h3>是否发布第 {confirmationTarget.number} 版？</h3><p>{proposal ? '你可以继续预览或修改。确认后才会上传这一版。' : '可先预览或继续修改；这是手动发布入口，确认后才上传所选版本。'}</p><button type="button" className="btn btn-primary btn-sm" disabled={publishBlocked} onClick={() => props.onPreparePublish(confirmationTarget)}>查看并确认</button></aside>}
        {state.paused && <button type="button" className={styles.reconnect} onClick={props.onResume}>{state.run?.status === 'UNKNOWN' ? '核实运行状态' : '重新连接本轮对话'}</button>}
        {state.pendingMessage && <div className={styles.pending} role="status"><p>上次发送结果未确认，将使用原消息核实。</p><button type="button" className="btn btn-secondary btn-sm" onClick={props.onRetryMessage} disabled={state.sending}>核实本次发送</button></div>}
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); props.onSend(); }}><label htmlFor="hub-message" className="sr-only">设计需求</label>
          <textarea id="hub-message" value={draft} onChange={event => props.onDraft(event.target.value)} maxLength={16000} disabled={state.loading || state.busy || state.sending || state.pendingMessage} placeholder="Type a message..." rows={1} />
          <button type="submit" aria-label="发送" className="btn btn-primary" disabled={!draft.trim() || state.loading || state.busy || state.sending || state.pendingMessage}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" /></svg></button>
        </form>
      </section>;
  const content = props.renderShell ? props.renderShell(viewer, chat, () => { if(selected && !publishBlocked) props.onPreparePublish(selected); }) : <div>{viewer}{chat}</div>;
  return <>{content}
    {confirmation && <PublicationDialog version={confirmation} name={projectName} enabled={state.versions.some(v => v.version_id === confirmation.version_id)} submitting={state.publishing} cancel={props.onCancelPublish} confirm={props.onConfirmPublish} />}
  </>;
}
