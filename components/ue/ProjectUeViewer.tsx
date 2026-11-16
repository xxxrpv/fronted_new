'use client';

import React, { useEffect, useRef, useState } from 'react';
import { currentPlayerUrl, initialUeViewerState, UeViewerSession } from '../../lib/ue-runtime';

const statusText = { IDLE: '尚未加载', DEPLOYING: 'UE 正在加载', READY: '模型已核验就绪', FAILED: '模型加载失败', UNAVAILABLE: '模型预览暂不可用', UNKNOWN: '运行归属不确定' };

export default function ProjectUeViewer({ projectId }: { projectId: string }) {
  const [state, setState] = useState(() => initialUeViewerState(projectId));
  const session = useRef<UeViewerSession | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const [playerError, setPlayerError] = useState(false);

  useEffect(() => {
    const active = new UeViewerSession(projectId, setState);
    session.current = active;
    void active.loadResources();
    return () => { active.dispose(); session.current = null; };
  }, [projectId]);

  if (state.projectId !== projectId) return null;
  const url = currentPlayerUrl(state);
  const runtime = state.runtime;
  const blocked = state.deploying || state.checking || !state.resourcesComplete || !state.selectedRobotId || !state.expectedRevision
    || !runtime || ['UNKNOWN', 'DEPLOYING'].includes(runtime.status);

  return (
    <section className="embodex-ue-workspace" aria-labelledby="ue-viewer-title">
      <div className="studio-stage-header">
        <div><h3 id="ue-viewer-title" className="studio-stage-title">UE 交互工作区</h3><span className="badge-live-dot">{runtime ? statusText[runtime.status] : '待核验'}</span></div>
        <div className="studio-stage-controls">
          {['继续评测','注入动态障碍物','重置初始位姿'].map(label=><button key={label} type="button" className="btn-stage-pill" disabled title="当前预览接口尚未支持此控制">{label}</button>)}
        </div>
      </div>
      <p style={{ color: 'var(--text-secondary)' }}>选择当前项目关联的机器人，加载模型后进入 UE 交互。</p>
      <div className="studio-stage-controls embodex-ue-resource-controls">
        <label style={{ display: 'grid', gap: 6, flex: '1 1 240px' }}>
          <span>机器人资源</span>
          <select value={state.selectedRobotId} disabled={!state.resourcesComplete || state.loadingResources || state.deploying}
            onChange={event => { setPlayerError(false); session.current?.select(event.target.value); }}
            className="embodex-field-input">
            <option value="">请选择机器人</option>
            {state.robots.map(robot => <option key={robot.id} value={robot.id}>{robot.displayMetadata?.name || robot.externalId} · {robot.version}</option>)}
          </select>
        </label>
        <button type="button" className="btn-stage-pill active" disabled={blocked}
          onClick={() => { setPlayerError(false); void session.current?.deploy(); }}>{state.deploying ? '正在加载…' : runtime?.status === 'UNAVAILABLE' ? '重试加载' : '加载模型'}</button>
        <button type="button" className="btn-stage-pill" disabled={state.deploying || state.checking || state.loadingResources}
          onClick={() => { setPlayerError(false); void session.current?.refresh(); }}>刷新状态</button>
        <button type="button" className="btn-stage-pill" disabled={state.deploying || state.loadingResources}
          onClick={() => { setPlayerError(false); void session.current?.loadResources(); }}>刷新资源</button>
      </div>
      <p role="status" aria-live="polite" aria-busy={state.deploying || state.loadingResources || state.checking}>
        {state.loadingResources ? '正在完整读取项目资源…' : state.deploying ? '正在加载与核验模型，请等待；不会自动重复发送。' : state.checking ? '正在核验模型状态…' : runtime ? statusText[runtime.status] : '请选择机器人并刷新状态。'}
      </p>
      {state.resourcesComplete && state.robots.length === 0 ? <p>当前项目没有关联机器人，请先在资源库关联 ROBOT 资源。</p> : null}
      {state.error ? <p role="alert">模型或项目状态读取失败，请刷新状态核实权限；不会自动重复发送加载请求。</p> : null}
      {runtime && runtime.status !== 'READY' && runtime.error ? <p role="alert">{statusText[runtime.status]}，请刷新状态确认。</p> : null}
      {runtime?.status === 'UNKNOWN' ? <p>模型归属尚不能确认，画面已隐藏。请刷新状态核验；重新打开播放器不能解除此状态，请勿重复加载。</p> : null}
      {runtime?.status === 'UNAVAILABLE' ? <p>模型预览暂不可用，请刷新状态确认；恢复后可重试加载，页面不会自动重发请求。</p> : null}
      {!state.selectedRobotId && !state.loadingResources ? <p>尚未选择机器人，不会自动加载或显示旧模型。</p> : null}
      {runtime?.status === 'READY' && runtime.robotResourceId !== state.selectedRobotId && state.selectedRobotId ? <p>当前运行模型与所选机器人不同，旧画面已隐藏。请加载所选机器人。</p> : null}
      <div className="sim-render-canvas" style={{ minHeight: 380 }}>
        <div className="sim-metrics-bar" aria-label="运行指标尚未采集">
          {['仿真周期','末端位姿误差','碰撞风险概率','逆运动学迭代'].map(label=><div key={label} className="sim-metric-chip"><span className="metric-label">{label}:</span><span className="metric-value">—</span></div>)}
        </div>
        <div className="sim-world-grid">
      {url ? (
        <div className="embodex-ue-player">
          <p>模型已就绪；请在播放器中点击 Start Streaming。页面加载不代表视频已连接。</p>
          <iframe key={`${runtime?.revision}:${playerKey}`} src={url} title="当前项目机器人 Pixel Streaming 播放器"
            allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer"
            onError={() => setPlayerError(true)} style={{ width: '100%', aspectRatio: '16 / 9', border: 0, background: '#111827', display: 'block' }} />
          {playerError ? <p role="alert">播放器页面加载失败，请刷新状态确认后重新打开播放器。</p> : null}
          <p>若画面中断，请刷新状态确认当前模型，再重新打开播放器并点击 Start Streaming。</p>
          <button type="button" className="btn-stage-pill" onClick={() => { setPlayerError(false); setPlayerKey(key => key + 1); }}>重新打开播放器</button>
        </div>
      ) : <div className="embodex-ue-empty"><span>UE Pixel Streaming</span><p>选择项目机器人并加载后显示当前核验模型；此处没有模拟画面。</p><p>指标尚未采集 · FPS / RTT / Bitrate：—</p></div>}
        </div>
      </div>
    </section>
  );
}
