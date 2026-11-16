'use client';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Resource } from '../../lib/api/generated/types.gen';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { EmbodexBuildSession, designArtifactsReady, initialDesignState, readDesignRecovery, writeDesignRecovery, type DesignState } from '../../lib/embodex/design-workflow';
const statusText={PENDING:'已提交，等待处理',QUEUED:'排队中',RUNNING:'正在构建',CANCEL_REQUESTED:'取消请求待确认',SUCCEEDED:'平台任务成功',FAILED:'构建未完成',CANCELED:'任务已取消',TIMEOUT:'执行结果不确定'};

export default function ExistingBuildArtifacts({projectId,initialTaskId,onRobotReady}:{projectId:string;initialTaskId?:string;onRobotReady?:(robot:Resource,taskId:string)=>void}) {
  const [storedState,setState]=useState(()=>initialDesignState(projectId));
  const auth=useAuth();
  const userId=auth.status==='authenticated'?auth.user?.id||'':'';
  const [buildOwner,setBuildOwner]=useState('');
  const state=buildOwner===userId && userId && storedState.projectId===projectId?storedState:initialDesignState(projectId);
  const readyCallback=useRef(onRobotReady);readyCallback.current=onRobotReady;
  const notified=useRef<string|null>(null);
  const session=useRef<EmbodexBuildSession|null>(null);
  const mounted=useRef(true);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;session.current?.dispose();session.current=null;};},[projectId,userId]);
  const ownerRef=useRef(`${userId}:${projectId}`);ownerRef.current=`${userId}:${projectId}`;
  const downloadIdentity=(value:DesignState)=>designArtifactsReady(value)&&value.task&&value.result&&value.robot?JSON.stringify([value.projectId,value.task.id,value.result.id,value.robot.id,value.robot.version,value.publicationStatus,value.result.data?.modelId,value.result.data?.manifestSha256]):null;
  const visibleDownload=useRef(downloadIdentity(state));visibleDownload.current=downloadIdentity(state);
  useEffect(()=>{
    setBuildOwner(userId);setState(initialDesignState(projectId));
    if(!userId)return;
    const recovery=readDesignRecovery(window.location.search);
    const current=new EmbodexBuildSession(projectId,setState,2000,{initial:recovery,persist:value=>{
      window.history.replaceState(window.history.state,'',writeDesignRecovery(window.location.href,value));
    }});
    session.current=current;
    setState(current.state);
    const taskId=initialTaskId || recovery?.taskId || new URLSearchParams(window.location.search).get('taskId');
    if (taskId) void current.resume(taskId).then(()=>current.loadRecent());
    else void current.loadRecent();
    return ()=>{current.dispose();session.current=null;};
  },[projectId,userId,initialTaskId]);
  useEffect(()=>{
    if (state.projectId!==projectId || !state.task) return;
    const url=new URL(window.location.href);
    url.searchParams.set('taskId',state.unresolvedTaskIds[0] || state.task.id);
    window.history.replaceState(window.history.state,'',url);
  },[projectId,state.projectId,state.task?.id,state.unresolvedTaskIds[0]]);
  useEffect(()=>{if(userId&&buildOwner===userId&&state.projectId===projectId&&designArtifactsReady(state)&&state.task&&state.robot&&notified.current!==`${state.task.id}:${state.robot.id}`){notified.current=`${state.task.id}:${state.robot.id}`;readyCallback.current?.(state.robot,state.task.id);}},[userId,buildOwner,projectId,state.robot,state.result,state.publicationStatus,state.task?.id,state.task?.status,state.projectId]);
  if (state.projectId!==projectId) return null;
  const unresolved=state.submissionUnknown || state.unresolvedTaskIds.length>0;
  const task=state.task;
  const importing=task?.actionKey==='EMBODEX_MODEL_IMPORT';
  const isPublishExisting=task?.actionKey==='EMBODEX_PUBLISH_EXISTING';
  const importStatus={PENDING:'模型登记等待处理',QUEUED:'模型登记排队中',RUNNING:'正在校验并登记模型',CANCEL_REQUESTED:'登记取消请求待确认',SUCCEEDED:'平台模型登记成功',FAILED:'模型登记未完成',CANCELED:'登记任务已取消',TIMEOUT:'模型登记结果不确定'};
  const publishExistingStatus={PENDING:'正式发布已受理，等待处理中',QUEUED:'正式发布排队中',RUNNING:'正在执行正式发布与位置登记',CANCEL_REQUESTED:'取消请求待确认',SUCCEEDED:'正式发布完成',FAILED:'正式发布未完成',CANCELED:'正式发布已取消',TIMEOUT:'平台尚不能确认正式发布执行结果'};
  const complete=designArtifactsReady(state);
  const pubStatusText = state.publicationStatus === 'LOCATION_REGISTERED'
    ? (isPublishExisting ? '正式发布登记完成，平台产物已就绪，可下载模型包。' : '发布登记完成，平台产物已就绪，可下载模型包。')
    : state.publicationStatus === 'PENDING'
      ? (isPublishExisting ? '正式发布处理中（正在等待 Workspace 及文件位置登记）' : '模型生成已完成，发布登记待定中（正在等待 Workspace 及文件位置登记）')
      : state.publicationStatus === 'NEEDS_ATTENTION'
        ? '正式发布需人工处理（已停止自动恢复，暂不可用）'
        : null;

  async function download() {
    const current=session.current,snapshot=downloadIdentity(state);
    const live=()=>mounted.current&&!!userId&&buildOwner===userId&&ownerRef.current===`${userId}:${projectId}`&&current===session.current&&!!snapshot&&snapshot===visibleDownload.current&&snapshot===downloadIdentity(current!.state);
    if(!current||!live())return;
    const blob=await current.download();
    if (!blob || !live()) return;
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='robot-runtime-model-package.zip';anchor.click();
    URL.revokeObjectURL(url);
  }
  return <section aria-label="已有平台构建与模型包">
    <div className="embodex-log-card">
    <strong>已有平台构建 · 独立产物</strong>
    <p role="status" aria-live="polite" aria-busy={state.submitting || state.checking || state.downloading}>
      {complete?(importing?'模型已登记并取得平台产物，可下载模型包。':(isPublishExisting?'正式发布已完成并取得平台机器人产物，可下载模型包。':(pubStatusText??'完整构建及机器人产物已取得，可下载模型包。'))):task?(importing?importStatus[task.status]:(isPublishExisting?((task.status==='FAILED'||task.status==='TIMEOUT')?publishExistingStatus[task.status]:(pubStatusText??publishExistingStatus[task.status])):(pubStatusText??statusText[task.status]))):state.submitting?'正在创建平台任务…':'尚未恢复平台构建；等待已登记任务及其真实产物。'}
    </p>
    {unresolved ? <div role="status">
      <p>仍有未确认的原构建。查看历史成功任务不会解除保护；请先核实原任务，勿重复构建。</p>
      {state.submissionUnknown ? <p>原提交尚无可确认的任务标识，需人工核实原提交结果；此页面不提供强制重试。刷新页面仍保留保护。</p>:null}
      {state.unresolvedTaskIds.map(id=><button key={id} type="button" className="embodex-btn-outline" disabled={state.submitting || state.downloading} onClick={()=>{void session.current?.resume(id);}}>核实原任务 {id}</button>)}
    </div>:null}
    {task ? <div>
      <p>任务：<code>{task.id}</code></p>
      {task.status==='TIMEOUT' ? <p>{importing?'平台尚不能确认模型登记结果；请核实原登记任务，不会重新调用 CAD。':isPublishExisting?'平台尚不能确认正式发布执行结果；请核实原任务，后台恢复仍将继续对账。':'平台尚不能确认执行结果；超时不证明 SolidWorks 已停止。请核实原任务，勿重复构建。'}</p>:null}
      {task.status==='FAILED' ? <p>{importing?'本任务未完成模型登记，未取得可确认的平台产物；请核实原登记任务。':isPublishExisting?(state.publicationStatus==='NEEDS_ATTENTION'?'本任务需人工干预（已停止自动处理）；未取得平台产物。':`本任务正式发布未成功（${state.result?.data?.code || state.result?.data?.failureCode || state.result?.data?.reason || '执行失败'}）；未交付平台模型包。`) : '本任务未交付完整模型包；可能保留中间构建文件，不会把 RobotSpec 当作完整成功。'}</p>:null}
      <button type="button" className="embodex-btn-outline" disabled={state.checking || state.downloading} onClick={()=>{void session.current?.refresh();}}>刷新任务状态</button>
    </div>:null}
    {state.robot ? <div style={{marginTop:16}}>
      <Link href={`/resources/${state.robot.id}`}>查看机器人资源：{state.robot.displayMetadata.name}</Link>{' '}
      <button type="button" className="embodex-agent-action-btn" disabled={!complete || state.downloading || state.checking} onClick={()=>{void download();}}>{state.downloading?'正在下载…':'下载 URDF 模型包 ZIP'}</button>
      <p>下载时重新校验项目权限、资源关联及文件完整性。</p>
    </div>:null}
    {state.error ? <p role="alert" style={{color:'var(--danger-color, #b91c1c)'}}>{state.error}</p>:null}
    </div>
    <details className="embodex-log-card">
      <summary>恢复已有设计任务</summary>
      <p>显示当前项目最近 20 条平台任务中的设计、模型导入及正式发布任务，并非完整历史。刷新页面会通过地址中的 taskId 恢复本次任务，不会再次构建。</p>
      <button type="button" className="embodex-btn-outline" disabled={state.loadingRecent} onClick={()=>{void session.current?.loadRecent();}}>{state.loadingRecent?'正在读取…':'刷新最近任务'}</button>
      {state.recentError ? <p role="alert">{state.recentError}</p>:null}
      {!state.loadingRecent && !state.recentError && !state.recent.length ? <p>此最近任务窗口中暂无设计或模型导入任务。</p>:null}
      <ul>{state.recent.map(item=><li key={item.id}><button type="button" className="embodex-btn-outline" disabled={state.submitting || state.downloading} onClick={()=>{void session.current?.resume(item.id);}}>{item.id} · {item.actionKey==='EMBODEX_MODEL_IMPORT'?importStatus[item.status]:item.actionKey==='EMBODEX_PUBLISH_EXISTING'?(publishExistingStatus[item.status]||item.status):statusText[item.status]}</button></li>)}</ul>
    </details>
  </section>;
}
