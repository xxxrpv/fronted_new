import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { client } from '../lib/api/client';
import { EmbodexBuildSession, designArtifactsReady, initialDesignState, normalizeBaselineRequirement, normalizeTemplateId, readDesignRecovery, writeDesignRecovery } from '../lib/embodex/design-workflow';
import EmbodexPublicationForm from '../components/embodex/EmbodexPublicationForm';
import EmbodexPage from '../components/embodex/EmbodexSchemeDesignPage';
import { AuthProvider } from '../lib/auth-context';
import ProjectUeViewer from '../components/ue/ProjectUeViewer';
import { currentPlayerUrl, initialUeViewerState } from '../lib/ue-runtime';
import type { Task, Result, Resource } from '../lib/api/generated/types.gen';

const projectId='00000000-0000-4000-8000-000000000001';
const taskId='00000000-0000-4000-8000-000000000002';
const validationId='00000000-0000-4000-8000-000000000003';
const resourceId='00000000-0000-4000-8000-000000000004';
const time='2026-10-07T00:00:00Z';
const task=(status:Task['status']='SUCCEEDED'):Task=>({id:taskId,projectId,validationId,actionKey:'EMBODEX_DESIGN',status,idempotencyKey:'fixture',createdAt:time,updatedAt:time});
const evidence={templateId:'so101_v1',buildMode:'baseline',parameterChangesApplied:false,physicsComplete:false,solidworksBuilt:true,urdfVerified:true,linkCount:8,jointCount:7,meshCount:12,modelId:resourceId,manifestSha256:'a'.repeat(64),schemaVersion:'1.2',robotName:'so101_high_fidelity'};
const result=():Result=>({id:validationId,taskId,sourceModule:'embodex',summary:'SO-101 baseline',data:{...evidence},producedResources:[{outputKey:'robot',resourceId}],createdAt:time,updatedAt:time});
const resource=():Resource=>({id:resourceId,type:'ROBOT',scope:'PROJECT',sourceModule:'embodex',externalId:`design:${taskId}`,version:'1',displayMetadata:{name:'SO-101官方基线',description:'',tags:[],specifications:{}},myProjectCount:1,createdAt:time,updatedAt:time});
const page=(items:unknown[])=>({data:{items,pageInfo:{nextCursor:null,hasMore:false}}});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

describe('Task015 explicit baseline product workflow',()=>{
  let originalGet:typeof client.get;
  let originalPost:typeof client.post;
  let sessions:EmbodexBuildSession[];
  beforeEach(()=>{originalGet=client.get;originalPost=client.post;sessions=[];});
  afterEach(()=>{sessions.forEach(item=>item.dispose());client.get=originalGet;client.post=originalPost;});
  const session=()=>{const value=new EmbodexBuildSession(projectId,()=>{},60000);sessions.push(value);return value;};
  const success=(status:Task['status']='SUCCEEDED',output=result(),robot=resource())=>{
    client.get=(async (options:{url:string})=>options.url.endsWith('/results')?page([output]):options.url==='/api/v1/resources/{resourceId}'?{data:robot}:options.url==='/api/v1/tasks'?page([task(status)]):{data:task(status)}) as unknown as typeof client.get;
    client.post=(async (options:{url:string})=>options.url.endsWith('/validations')?{data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}}:{data:task(status)}) as unknown as typeof client.post;
  };

  test('trim and Unicode codepoint limits reject before any mutation',async()=>{
    assert.equal(normalizeBaselineRequirement(' \t😀😀😀\u3000'),'😀😀😀');
    assert.equal([...normalizeBaselineRequirement('😀'.repeat(4000))].length,4000);
    for(const value of ['ab','  ','😀'.repeat(4001)])assert.throws(()=>normalizeBaselineRequirement(value));
    let calls=0;client.post=(async()=>{calls++;return {};}) as unknown as typeof client.post;
    const current=session();await current.submit('ab');assert.equal(calls,0);assert.match(current.state.error||'',/3～4000/);
  });

  test('double click makes exactly one Validation then one Task with fixed baseline/empty inputs/idempotency',async()=>{
    success();let resolveValidation!:(value:unknown)=>void;const posts:Array<{url:string;body:unknown;headers?:Record<string,string>}>=[];
    client.post=(async (options:{url:string;body:unknown;headers?:Record<string,string>})=>{posts.push(options);return options.url.endsWith('/validations')?await new Promise<unknown>(resolve=>{resolveValidation=resolve;}):{data:task()};}) as unknown as typeof client.post;
    const current=session();const submission=current.submit('  构建官方模型  ');await flush();await current.submit('第二次备注');assert.equal(posts.length,1);
    assert.deepEqual(posts[0].body,{projectId,actionKey:'EMBODEX_DESIGN',inputs:{},configSnapshot:{requirement:'构建官方模型',templateId:'so101_v1',buildMode:'baseline'}});
    resolveValidation({data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}});await submission;
    assert.equal(posts.length,2);assert.deepEqual(posts[1].body,{projectId,validationId,actionKey:'EMBODEX_DESIGN'});
    assert.match(posts[1].headers?.['Idempotency-Key']||'',/^[0-9a-f-]{36}$/);
    assert.equal(current.state.robot?.id,resourceId);assert.equal(current.state.task?.status,'SUCCEEDED');
  });

  test('success requires exact evidence and matching produced PROJECT ROBOT identity',async()=>{
    for(const invalid of ['missing','partial','wrong-resource','other-task']){
      const output=result();const robot=resource();
      if(invalid==='missing')output.producedResources=[];
      if(invalid==='partial')output.data.urdfVerified=false;
      if(invalid==='wrong-resource')robot.externalId='design:other';
      if(invalid==='other-task')output.taskId=projectId;
      success('SUCCEEDED',output,robot);const current=session();await current.resume(taskId);
      assert.equal(current.state.robot,null);assert.equal(current.state.result,null);assert.match(current.state.error||'',/不能确认/);
    }
  });

  test('FAILED/TIMEOUT/CANCELED never fetch successful artifacts or automatically rebuild',async()=>{
    for(const status of ['FAILED','TIMEOUT','CANCELED'] as const){success(status);let mutations=0;client.post=(async()=>{mutations++;return {};}) as unknown as typeof client.post;
      const current=session();await current.resume(taskId);await current.submit('再次构建');assert.equal(mutations,0);assert.equal(current.state.robot,null);assert.equal(await current.download(),null);assert.equal(current.state.task?.status,status);
    }
  });

  test('dispose during Validation ignores late transport and cannot issue Task POST',async()=>{
    let resolveValidation!:(value:unknown)=>void;let calls=0;
    client.post=(async()=>{calls++;return await new Promise(resolve=>{resolveValidation=resolve;});}) as unknown as typeof client.post;
    const current=session();const submission=current.submit('构建官方模型');await flush();current.dispose();resolveValidation({data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}});await submission;assert.equal(calls,1);assert.equal(current.state.task,null);
  });

  test('uncertain Task POST blocks fresh submissions and recent reads do not replay POST',async()=>{
    success();let calls=0;client.post=(async (options:{url:string})=>{calls++;if(options.url.endsWith('/validations'))return {data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}};throw new Error('raw sensitive upstream path');}) as unknown as typeof client.post;
    const current=session();await current.submit('构建官方模型');await current.submit('再次构建');await current.loadRecent();assert.equal(calls,2);assert.equal(current.state.submissionUnknown,true);assert.match(current.state.error||'',/勿重复/);assert(!current.state.error?.includes('sensitive'));
  });

  test('restore rejects foreign project/Action and late prior reads after switching selected task',async()=>{
    const current=session();
    for(const changed of [{projectId:resourceId},{actionKey:'SIMCORE_TRAINING'},{status:'NOT_A_STATUS'}]){
      client.get=(async()=>({data:{...task(),...changed}})) as unknown as typeof client.get;await current.resume(taskId);assert.equal(current.state.task,null);
    }
    let resolveOld!:(value:unknown)=>void;client.get=(()=>new Promise(resolve=>{resolveOld=resolve;})) as unknown as typeof client.get;
    const old=current.resume(taskId);await flush();success('PENDING');await current.resume(taskId);resolveOld({data:{...task(),projectId:resourceId}});await old;assert.equal((current.state.task as Task|null)?.projectId,projectId);assert.equal((current.state.task as Task|null)?.status,'PENDING');
  });

  test('recent window is read-only and filtered by project/action',async()=>{
    const current=session();let mutations=0;client.post=(async()=>{mutations++;return {};}) as unknown as typeof client.post;
    client.get=(async (options:{query:unknown})=>{assert.deepEqual(options.query,{projectId,limit:20});return page([task(),{...task(),projectId:resourceId},{...task(),actionKey:'SIMCORE_TRAINING'}]);}) as unknown as typeof client.get;
    await current.loadRecent();assert.deepEqual(current.state.recent,[task()]);assert.equal(mutations,0);
  });

  test('a fresh intent is explicit and cannot release a TIMEOUT or pending task',async()=>{
    for(const status of ['PENDING','TIMEOUT','FAILED','SUCCEEDED'] as const){
      success(status);const current=session();await current.resume(taskId);let mutations=0;client.post=(async()=>{mutations++;return {};}) as unknown as typeof client.post;
      assert.equal(current.newIntent(),status==='FAILED'||status==='SUCCEEDED');assert.equal(mutations,0);
      if(status==='PENDING'||status==='TIMEOUT')assert.equal(current.state.task?.id,taskId);
    }
  });

  test('TIMEOUT A fence survives selecting historical SUCCEEDED B even without B artifacts; only confirmed A terminal releases',async()=>{
    const current=session();const oldId=resourceId;let aStatus:Task['status']='TIMEOUT';let posts=0;
    client.get=(async (options:{url:string;path?:{taskId?:string}})=>options.url.endsWith('/results')?page([]):{data:options.path?.taskId===oldId?{...task(),id:oldId}:task(aStatus)}) as unknown as typeof client.get;
    client.post=(async()=>{posts++;return {};}) as unknown as typeof client.post;
    await current.resume(taskId);assert.equal(current.newIntent(),false);
    await current.resume(oldId);assert.equal(current.state.task?.id,oldId);assert.deepEqual(current.state.unresolvedTaskIds,[taskId]);
    assert.equal(current.newIntent(),false);await current.submit('再次构建');assert.equal(posts,0);
    aStatus='FAILED';await current.resume(taskId);assert.deepEqual(current.state.unresolvedTaskIds,[]);assert.equal(current.newIntent(),true);assert.equal(posts,0);
  });

  test('unknown Task POST without an id cannot be released by selecting an unrelated historical success',async()=>{
    let posts=0;
    client.post=(async (options:{url:string})=>{posts++;if(options.url.endsWith('/validations'))return {data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}};throw new Error('network unknown');}) as unknown as typeof client.post;
    const current=session();await current.submit('构建官方模型');assert.equal(current.state.submissionUnknown,true);
    client.get=(async (options:{url:string})=>options.url.endsWith('/results')?page([]):{data:{...task(),id:resourceId}}) as unknown as typeof client.get;
    await current.resume(resourceId);assert.equal(current.state.submissionUnknown,true);assert.equal(current.newIntent(),false);await current.submit('再次构建');assert.equal(posts,2);
  });

  test('authorized ZIP uses current project/resource only and duplicates/disposed late downloads are ignored',async()=>{
    success();const current=session();await current.resume(taskId);let resolveDownload!:(value:unknown)=>void;let calls=0;
    client.get=(async (options:{url:string;path:unknown;query?:unknown})=>{calls++;assert.equal(options.url,'/api/v1/projects/{projectId}/resources/{resourceId}/runtime-model-package/download');assert.deepEqual(options.path,{projectId,resourceId});assert.equal(options.query,undefined);return await new Promise<unknown>(resolve=>{resolveDownload=resolve;});}) as unknown as typeof client.get;
    const pending=current.download();await flush();assert.equal(await current.download(),null);current.dispose();resolveDownload({data:new Blob(['zip'],{type:'application/zip'}),response:new Response(null,{headers:{'content-type':'application/zip'}})});assert.equal(await pending,null);assert.equal(calls,1);
  });

  test('URL marker exists before Task POST and unknown without id remains blocked after refresh/history selection',async()=>{
    let href=`https://example.test/projects/${projectId}/embodex?tab=parts`;let posts=0;
    const restored=()=>{const current=new EmbodexBuildSession(projectId,()=>{},60000,{initial:readDesignRecovery(new URL(href).search),persist:value=>{href=writeDesignRecovery(href,value);}});sessions.push(current);return current;};
    client.post=(async (options:{url:string;headers?:Record<string,string>})=>{
      posts++;if(options.url.endsWith('/validations'))return {data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}};
      assert.equal(readDesignRecovery(new URL(href).search)?.intentId,options.headers?.['Idempotency-Key']);throw new Error('unknown');
    }) as unknown as typeof client.post;
    const first=restored();await first.submit('构建官方模型');first.dispose();
    const refresh=restored();assert.equal(refresh.state.submissionUnknown,true);
    client.get=(async (options:{url:string})=>options.url.endsWith('/results')?page([]):{data:{...task(),id:resourceId}}) as unknown as typeof client.get;
    await refresh.resume(resourceId);assert.equal(refresh.newIntent(),false);await refresh.submit('再次构建');assert.equal(posts,2);
    assert(readDesignRecovery(new URL(href).search));assert.equal(new URL(href).searchParams.get('tab'),'parts');
    assert.equal(readDesignRecovery('?embodexPendingIntent=' )?.taskId,null);
  });

  test('confirmed Task URL pins original A across history and refresh; only original definitive terminal clears',async()=>{
    let href=`https://example.test/projects/${projectId}/embodex`;let status:Task['status']='TIMEOUT';
    const restored=()=>{const value=new EmbodexBuildSession(projectId,()=>{},60000,{initial:readDesignRecovery(new URL(href).search),persist:recovery=>{href=writeDesignRecovery(href,recovery);}});sessions.push(value);return value;};
    success('TIMEOUT');const first=restored();await first.submit('构建官方模型');assert.equal(readDesignRecovery(new URL(href).search)?.taskId,taskId);
    client.get=(async (options:{url:string;path?:{taskId?:string}})=>options.url.endsWith('/results')?page([]):{data:options.path?.taskId===resourceId?{...task(),id:resourceId}:task(status)}) as unknown as typeof client.get;
    await first.resume(resourceId);assert.equal(readDesignRecovery(new URL(href).search)?.taskId,taskId);first.dispose();
    const refresh=restored();assert.deepEqual(refresh.state.unresolvedTaskIds,[taskId]);await refresh.resume(resourceId);assert.equal(refresh.newIntent(),false);
    status='FAILED';await refresh.resume(taskId);assert.equal(readDesignRecovery(new URL(href).search),null);assert.equal(refresh.newIntent(),true);
  });

  test('late Task POST callback after unmount cannot rewrite URL or release refresh protection; safe rejection clears',async()=>{
    let href='https://example.test/embodex';let finish!:(value:unknown)=>void;
    const persisted=new EmbodexBuildSession(projectId,()=>{},60000,{initial:null,persist:value=>{href=writeDesignRecovery(href,value);}});sessions.push(persisted);
    client.post=(async(options:{url:string})=>options.url.endsWith('/validations')?{data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}}:await new Promise(resolve=>{finish=resolve;})) as unknown as typeof client.post;
    const submitting=persisted.submit('构建官方模型');await flush();const before=href;persisted.dispose();finish({data:task()});await submitting;assert.equal(href,before);
    const refresh=new EmbodexBuildSession(projectId,()=>{},60000,{initial:readDesignRecovery(new URL(href).search),persist:()=>{throw new Error('must not write');}});sessions.push(refresh);await refresh.submit('再次构建');assert.equal(refresh.state.submissionUnknown,true);
    href='https://example.test/embodex';const safe=new EmbodexBuildSession(projectId,()=>{},60000,{initial:null,persist:value=>{href=writeDesignRecovery(href,value);}});sessions.push(safe);
    client.post=(async(options:{url:string})=>options.url.endsWith('/validations')?{data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}}:{error:{code:'FORBIDDEN'},response:new Response(null,{status:403})}) as unknown as typeof client.post;
    await safe.submit('构建官方模型');assert.equal(readDesignRecovery(new URL(href).search),null);assert.equal(safe.state.submissionUnknown,false);
  });

  test('late original terminal read after switching view cannot clear pinned URL',async()=>{
    let href=writeDesignRecovery('https://example.test/embodex',{intentId:validationId,taskId});let finish!:(value:unknown)=>void;
    const current=new EmbodexBuildSession(projectId,()=>{},60000,{initial:readDesignRecovery(new URL(href).search),persist:value=>{href=writeDesignRecovery(href,value);}});sessions.push(current);
    client.get=(()=>new Promise(resolve=>{finish=resolve;})) as unknown as typeof client.get;
    const old=current.resume(taskId);await flush();
    client.get=(async(options:{url:string})=>options.url.endsWith('/results')?page([]):{data:{...task(),id:resourceId}}) as unknown as typeof client.get;
    await current.resume(resourceId);finish({data:task('FAILED')});await old;assert.equal(readDesignRecovery(new URL(href).search)?.taskId,taskId);assert.equal(current.newIntent(),false);
  });

  test('valid ZIP Blob returns while denied or non-ZIP responses produce safe errors',async()=>{
    success();const current=session();await current.resume(taskId);
    const blob=new Blob(['PKfixture'],{type:'application/zip'});client.get=(async()=>({data:blob,response:new Response(null,{headers:{'content-type':'application/zip','cache-control':'no-store'}})})) as unknown as typeof client.get;
    assert.equal(await current.download(),blob);
    client.get=(async()=>({data:new Blob(['bad']),response:new Response(null,{headers:{'content-type':'text/plain'}})})) as unknown as typeof client.get;assert.equal(await current.download(),null);assert.match(current.state.error||'',/下载失败/);
  });

  test('user chat UI stays separate from example parts and existing build download entry',()=>{
    const project=renderToStaticMarkup(React.createElement(AuthProvider,{children:React.createElement<{projectId?:string}>(EmbodexPage,{projectId})}));
    const demo=renderToStaticMarkup(React.createElement(AuthProvider,{children:React.createElement(EmbodexPage)}));
    for(const view of [project,demo]){
      assert(view.includes('class="embodex-root" style="height:calc(100dvh - 48px);width:100%"'));
      assert(view.includes('Simplaix Agent'));assert(view.includes('Type a message...'));assert(view.includes('aria-label="Clear chat history"'));assert(view.includes('aria-label="Minimize chat"'));assert(view.includes('<textarea'));assert(view.includes('aria-label="Send message"'));
      assert(!view.includes('已在当前 Simplaix 界面打开'));assert(!view.includes('setChatLog'));assert(!view.includes('官方基线用途备注'));
    }
    assert(project.includes('已有构建与模型包'));assert(project.includes('<dialog'));assert(!demo.includes('<dialog'));
    for(const name of ['embodex-sidebar','embodex-center-pane','embodex-agent-dock','embodex-parts-layout','embodex-parts-nav-panel'])assert(project.includes(name));assert(demo.includes('embodex-part-form-grid'));
    assert(project.includes('零件清单 · 原 URDF'));assert(!project.includes('示例 Unitree A1'));assert(!project.includes('Base</'));assert(project.includes('请登录后读取项目模型。'));assert(demo.includes('零件清单 · 示例'));
    const selects=project.match(/<select\b[^>]*>/g)||[];assert.equal(selects.length,1);assert(selects.every(select=>select.includes('disabled=""')));
    assert.match(project,/<button[^>]*disabled=""[^>]*title="下载原 URDF 单文件/);
    assert(demo.includes('选择项目后开始对话。'));assert(project.includes('请登录后发送消息。'));
  });
  test('UE original toolbar/metrics/viewport restored with disabled unsupported controls and no fake telemetry/player',()=>{
    const view=renderToStaticMarkup(React.createElement(ProjectUeViewer,{projectId}));
    for(const name of ['studio-stage-header','studio-stage-controls','btn-stage-pill','sim-render-canvas','sim-metrics-bar','sim-metric-chip','sim-world-grid'])assert(view.includes(name));
    for(const label of ['继续评测','注入动态障碍物','重置初始位姿'])assert.match(view,new RegExp('<button[^>]*disabled=""[^>]*>'+label+'</button>'));
    assert.equal((view.match(/class="metric-value">—/g)||[]).length,4);
    assert(!view.includes('<iframe'));for(const fake of ['60 FPS','0.42 mm','8.4ms','18.5 Mbps'])assert(!view.includes(fake));
    assert(view.includes('加载模型'));assert(view.includes('选择项目机器人并加载'));
    for(const implementation of ['本机','本地','同机','操作者','重启','信令','部署'])assert(!view.includes(implementation));
  });
  test('UE unknown/unavailable errors remain non-player and display neutral messages rather than backend operation details',()=>{
    let currentStatus='UNKNOWN';
    const useState=(initialize:unknown)=>{
      const initial=typeof initialize==='function'?(initialize as ()=>unknown)():initialize;
      const value=initial && typeof initial==='object' && 'projectId' in initial ? {...initial,resourcesComplete:true,selectedRobotId:resourceId,expectedRevision:validationId,error:'Local Runtime receipt configuration unavailable',runtime:{projectId,revision:validationId,robotResourceId:resourceId,status:currentStatus,playerUrl:null,error:{code:`RUNTIME_${currentStatus}`,message:'本机操作者须重启Runtime和信令服务；local launch receipt'}}}:initial;
      return [value,()=>{}];
    };
    // Evaluate the actual component with inert hooks, retaining its real player guard.
    const source=readFileSync(new URL('../components/ue/ProjectUeViewer.tsx',import.meta.url),'utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
    const module={exports:{} as {default?:React.ComponentType<{projectId:string}>}};
    runInNewContext(compiled,{module,exports:module.exports,require:(name:string)=>{
      if(name==='react')return {__esModule:true,default:React,useState,useEffect:()=>{},useRef:()=>({current:null})};
      assert.equal(name,'../../lib/ue-runtime');return {currentPlayerUrl,initialUeViewerState,UeViewerSession:class {}};
    }});
    const Viewer=module.exports.default;assert(Viewer);
    for(const status of ['UNKNOWN','UNAVAILABLE','FAILED']){
      currentStatus=status;const view=renderToStaticMarkup(React.createElement(Viewer,{projectId}));
      assert(!view.includes('<iframe'));assert(view.includes('刷新状态'));
      for(const implementation of ['本机','Local Runtime','receipt','操作者','信令','重启','部署'])assert(!view.includes(implementation));
      if(status==='UNKNOWN'){assert(view.includes('请勿重复加载'));assert.match(view,/<button[^>]*class="btn-stage-pill active"[^>]*disabled=""/);}
      if(status==='UNAVAILABLE')assert(view.includes('重试加载'));
      if(status==='FAILED')assert(view.includes('模型加载失败'));
    }
  });
  test('import-only Task restores actual safe Result/Resource without creating Validation or Task',async()=>{
    const importEvidence={receiptId:validationId,threadId:projectId,runId:taskId,cadRunId:resourceId,vendorModelId:'vendor-model',vendorModelVersionId:'vendor-version',modelId:resourceId,manifestSha256:'a'.repeat(64),templateId:'so101_v1',importOnly:true,solidworksBuilt:true,documentsCleaned:true,urdfVerified:true,physicsComplete:false,linkCount:8,jointCount:7,meshCount:12};
    const currentTask={...task(),actionKey:'EMBODEX_MODEL_IMPORT' as const};let invalid=false;
    client.post=(async()=>{throw new Error('no POST');}) as unknown as typeof client.post;
    client.get=(async(options:{url:string})=>options.url.endsWith('/results')?page([{...result(),data:{...importEvidence,...(invalid?{importOnly:false}:{})}}]):options.url.includes('/resources/')?{data:{...resource(),externalId:`import:${validationId}`}}:{data:currentTask}) as unknown as typeof client.get;
    const current=session();await current.resume(taskId);assert.equal(current.state.robot?.id,resourceId);assert.equal(current.state.result?.data.importOnly,true);invalid=true;await current.refresh();assert.equal(current.state.robot,null);assert(current.state.error);
    invalid=false;importEvidence.vendorModelId='bad\u0001vendor';await current.refresh();assert.equal(current.state.robot,null);assert(current.state.error);
  });

  test('actual page render hides prior owner/model before passive effects on user/logout/project switch',()=>{
    let activeUser=validationId,activeProject=projectId;
    const prior={userId:validationId,projectId,robots:[resource()],selectedId:resourceId,loading:false,loadingRobots:false,downloading:false,error:null,xml:'private original XML',bytes:new ArrayBuffer(3),modelId:resourceId,manifestSha256:'a'.repeat(64),parts:[{uid:'private',label:'PRIVATE_LINK',role:'URDF Link',parentLink:'root',visualsCount:1,linkName:'PRIVATE_LINK',jointName:'private_joint',jointType:'fixed',xyz:'0 0 0',rpy:'0 0 0',axis:'0 0 1'}],linkCount:2,jointCount:1};
    const source=readFileSync(new URL('../components/embodex/EmbodexSchemeDesignPage.tsx',import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;const module={exports:{} as {default?:React.ComponentType<{projectId?:string}>}};
    runInNewContext(compiled,{module,exports:module.exports,require:(name:string)=>{if(name==='react')return{__esModule:true,default:React,useState:(init:unknown)=>{const v=typeof init==='function'?(init as ()=>unknown)():init;return[v&&typeof v==='object'&&'robots' in v?prior:v,()=>{}];},useRef:(value:unknown)=>({current:value}),useEffect:()=>{},useLayoutEffect:()=>{}};if(name==='../../lib/auth-context')return{useAuth:()=>({status:activeUser?'authenticated':'anonymous',user:activeUser?{id:activeUser}:null})};if(name==='../../lib/embodex/parts')return{initialPartsState:(userId:string,projectId:string)=>({...prior,userId,projectId,robots:[],selectedId:'',xml:null,bytes:null,modelId:null,manifestSha256:null,parts:[],linkCount:0,jointCount:0})};if(name==='next/link')return{__esModule:true,default:'a'};return{__esModule:true,default:()=>null};}});
    const Page=module.exports.default!;assert(renderToStaticMarkup(React.createElement(Page,{projectId:activeProject})).includes('PRIVATE_LINK'));
    for(const mode of ['user','logout','project']){activeUser=mode==='logout'?'':mode==='user'?resourceId:validationId;activeProject=mode==='project'?resourceId:projectId;const html=renderToStaticMarkup(React.createElement(Page,{projectId:activeProject}));assert(!html.includes('PRIVATE_LINK'));assert(!html.includes('private original XML'));assert(!html.includes('示例 Unitree A1'));}
  });

  test('actual old copy/download callbacks reject new owner, project, selection and byte snapshots before passive cleanup',async()=>{
    const originalBytes=new TextEncoder().encode('PRIVATE_XML').buffer;
    const original={userId:validationId,projectId,robots:[resource()],selectedId:resourceId,loading:false,loadingRobots:false,downloading:false,error:null,xml:'PRIVATE_XML',bytes:originalBytes,modelId:resourceId,manifestSha256:'a'.repeat(64),parts:[],linkCount:8,jointCount:7};
    let activeUser=validationId,stored=original,refIndex=0,downloads=0,copies:string[]=[],toasts:string[]=[],resolveCopy:()=>void=()=>{};
    const refs:{current:unknown}[]=[],fakeSession={userId:validationId,projectId,state:original};
    const source=readFileSync(new URL('../components/embodex/EmbodexSchemeDesignPage.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,module={exports:{} as {default?:(props:{projectId:string})=>React.ReactElement}};
    runInNewContext(compiled,{module,exports:module.exports,Blob,TextEncoder,setTimeout:()=>0,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>{downloads++;}})},navigator:{clipboard:{writeText:(xml:string)=>{copies.push(xml);return new Promise<void>(resolve=>{resolveCopy=resolve;});}}},require:(name:string)=>{
      if(name==='react')return{__esModule:true,default:React,useState:(init:unknown)=>{const v=typeof init==='function'?(init as ()=>unknown)():init;return[v&&typeof v==='object'&&'robots' in v?stored:v,(value:unknown)=>{if(typeof value==='string'&&value.startsWith('原 XML'))toasts.push(value);}];},useRef:(value:unknown)=>{const index=refIndex++;if(!refs[index])refs[index]={current:index===0?fakeSession:value};return refs[index];},useEffect:()=>{},useLayoutEffect:()=>{}};
      if(name==='../../lib/auth-context')return{useAuth:()=>({status:activeUser?'authenticated':'anonymous',user:activeUser?{id:activeUser}:null})};
      if(name==='../../lib/embodex/parts')return{initialPartsState:(userId:string,projectId:string)=>({...original,userId,projectId,selectedId:'',xml:null,bytes:null,parts:[]})};if(name==='next/link')return{__esModule:true,default:'a'};return{__esModule:true,default:()=>null};}});
    const find=(node:React.ReactNode,title:string):React.ReactElement<{onClick:()=>void|Promise<void>}>|null=>{if(!React.isValidElement<{title?:string;children?:React.ReactNode;onClick:()=>void|Promise<void>}>(node))return null;if(node.props.title===title)return node;for(const child of React.Children.toArray(node.props.children)){const hit=find(child,title);if(hit)return hit;}return null;};
    const render=(id=projectId)=>{refIndex=0;return module.exports.default!({projectId:id});};
    const tree=render(),copy=find(tree,'复制所选模型的原 XML，不重新生成')!,download=find(tree,'下载原 URDF 单文件；网格请下载完整包')!;assert(copy&&download);
    for(const mode of ['user','logout','project','selection','bytes']){activeUser=mode==='user'?resourceId:mode==='logout'?'':validationId;stored=original;fakeSession.state=mode==='selection'?{...original,selectedId:taskId}:mode==='bytes'?{...original,bytes:originalBytes.slice(0)}:original;render(mode==='project'?resourceId:projectId);await copy.props.onClick();await download.props.onClick();assert.deepEqual(copies,[]);assert.equal(downloads,0);}
    activeUser=validationId;fakeSession.state=original;stored=original;render();const pending=copy.props.onClick();assert.deepEqual(copies,['PRIVATE_XML']);activeUser=resourceId;render();resolveCopy();await pending;assert.deepEqual(toasts,[]);
    activeUser=validationId;render();await download.props.onClick();assert.equal(downloads,1);const accepted=copy.props.onClick();resolveCopy();await accepted;assert.deepEqual(toasts,['原 XML 已复制']);
  });

  test('actual ExistingBuild async ZIP suppresses responses after new owner or task/resource/fingerprint render before effects',async()=>{
    for(const mode of ['user','logout','project','task','robot','result','fingerprint','current']){
      const original={...initialDesignState(projectId),task:task(),result:result(),robot:resource()};let stored=original,activeUser=validationId,stateIndex=0,refIndex=0,downloads=0,started=0,resolveDownload!:(blob:Blob)=>void;
      const refs:{current:unknown}[]=[],fakeSession={state:original,download:()=>{started++;return new Promise<Blob>(resolve=>{resolveDownload=resolve;});}};
      const source=readFileSync(new URL('../components/embodex/ExistingBuildArtifacts.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,module={exports:{} as {default?:(props:{projectId:string})=>React.ReactElement}};
      runInNewContext(compiled,{module,exports:module.exports,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>{downloads++;}})},require:(name:string)=>{if(name==='react')return{__esModule:true,default:React,useState:(init:unknown)=>{const index=stateIndex++;return[index===0?stored:index===1?validationId:typeof init==='function'?(init as ()=>unknown)():init,()=>{}];},useRef:(initial:unknown)=>{const index=refIndex++;if(!refs[index])refs[index]={current:index===2?fakeSession:initial};return refs[index];},useEffect:()=>{},useLayoutEffect:()=>{}};if(name==='../../lib/auth-context')return{useAuth:()=>({status:activeUser?'authenticated':'anonymous',user:activeUser?{id:activeUser}:null})};if(name==='../../lib/embodex/design-workflow')return{initialDesignState,designArtifactsReady};if(name==='next/link')return{__esModule:true,default:'a'};throw new Error(name);}});
      const find=(node:React.ReactNode):React.ReactElement<{onClick:()=>void}>|null=>{if(!React.isValidElement<{children?:React.ReactNode;onClick:()=>void}>(node))return null;if(node.type==='button'&&node.props.children==='下载 URDF 模型包 ZIP')return node;for(const child of React.Children.toArray(node.props.children)){const hit=find(child);if(hit)return hit;}return null;};
      const render=(id=projectId)=>{stateIndex=0;refIndex=0;return module.exports.default!({projectId:id});};
      const old=find(render())!;assert(old);old.props.onClick();assert.equal(started,1);
      if(mode==='user')activeUser=resourceId;if(mode==='logout')activeUser='';
      if(mode==='task')stored={...original,task:{...task(),id:validationId}};
      if(mode==='robot')stored={...original,robot:{...resource(),id:validationId}};
      if(mode==='result')stored={...original,result:{...result(),id:resourceId}};
      if(mode==='fingerprint')stored={...original,result:{...result(),data:{...evidence,manifestSha256:'b'.repeat(64)}}};
      fakeSession.state=stored;render(mode==='project'?resourceId:projectId);resolveDownload(new Blob(['private original package']));await flush();assert.equal(downloads,mode==='current'?1:0);
      if(mode!=='current'){old.props.onClick();assert.equal(started,1);}
    }
  });

  test('actual keyed build unmount layout cleanup blocks old ZIP before passive cleanup; import status is registration',async()=>{
    let stateIndex=0,refIndex=0,downloads=0,disposed=0,resolveDownload!:(blob:Blob)=>void;const refs:{current:unknown}[]=[],layouts:(()=>void|(()=>void))[]=[];
    let activeUser=validationId;let stored={...initialDesignState(projectId),task:task(),result:result(),robot:resource()};const oldSession={state:stored,dispose:()=>{disposed++;},download:()=>new Promise<Blob>(resolve=>{resolveDownload=resolve;})};let currentSession=oldSession;
    const source=readFileSync(new URL('../components/embodex/ExistingBuildArtifacts.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,module={exports:{} as {default?:(props:{projectId:string})=>React.ReactElement}};
    runInNewContext(compiled,{module,exports:module.exports,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>{downloads++;}})},require:(name:string)=>{if(name==='react')return{__esModule:true,default:React,useState:(init:unknown)=>{const index=stateIndex++;return[index===0?stored:index===1?activeUser:typeof init==='function'?(init as ()=>unknown)():init,()=>{}];},useRef:(initial:unknown)=>{const index=refIndex++;if(!refs[index])refs[index]={current:index===2?currentSession:initial};return refs[index];},useLayoutEffect:(effect:()=>void|(()=>void))=>{layouts.push(effect);},useEffect:()=>{}};if(name==='../../lib/auth-context')return{useAuth:()=>({status:'authenticated',user:{id:activeUser}})};if(name==='../../lib/embodex/design-workflow')return{initialDesignState,designArtifactsReady};if(name==='next/link')return{__esModule:true,default:'a'};throw new Error(name);}});
    const find=(node:React.ReactNode):React.ReactElement<{onClick:()=>void}>|null=>{if(!React.isValidElement<{children?:React.ReactNode;onClick:()=>void}>(node))return null;if(node.type==='button'&&node.props.children==='下载 URDF 模型包 ZIP')return node;for(const child of React.Children.toArray(node.props.children)){const hit=find(child);if(hit)return hit;}return null;};
    const render=(id=projectId)=>{stateIndex=0;refIndex=0;return module.exports.default!({projectId:id});};
    const old=render(),cleanup=layouts[0]() as ()=>void;find(old)!.props.onClick();assert(resolveDownload);
    // Commit deletes this keyed instance: layout cleanup runs synchronously;
    // its refs do not get a new-owner render and passive cleanup has not run.
    cleanup();assert.equal(disposed,1);
    refs.length=0;activeUser=resourceId;stored={...stored,projectId:resourceId};currentSession={...oldSession,state:stored,dispose:()=>{}};render(resourceId);layouts[layouts.length-1](); // New key owns different refs; old instance never renders again.
    resolveDownload(new Blob(['private old package']));await flush();assert.equal(downloads,0);find(old)!.props.onClick();assert.equal(downloads,0);
    activeUser=validationId;stored={...stored,projectId};
    for(const status of ['RUNNING','FAILED','TIMEOUT'] as const){stored={...stored,task:{...task(status),actionKey:'EMBODEX_MODEL_IMPORT'},robot:null as unknown as Resource};const html=renderToStaticMarkup(render());assert(html.includes(status==='RUNNING'?'正在校验并登记模型':status==='FAILED'?'模型登记未完成':'模型登记结果不确定'));assert(!html.includes('超时不证明 SolidWorks 已停止'));assert(!html.includes('可能保留中间构建文件'));}
    stored={...stored,task:{...task(),actionKey:'EMBODEX_MODEL_IMPORT'},result:result(),robot:resource(),recent:[{...task('RUNNING'),actionKey:'EMBODEX_MODEL_IMPORT'}]};const successHtml=renderToStaticMarkup(render());assert(successHtml.includes('模型已登记并取得平台产物'));assert(successHtml.includes('正在校验并登记模型'));assert(!successHtml.includes('完整构建及机器人产物已取得'));
    stored={...stored,task:task('TIMEOUT')};assert(renderToStaticMarkup(render()).includes('超时不证明 SolidWorks 已停止'));
  });
  test('actual Page layout unmount blocks pending full ZIP and old model-import URL callback without old-instance rerender',async()=>{
    let stateIndex=0,refIndex=0,downloads=0,copies=0,urlWrites=0,noticeClears=0,selectedProduced='',resolveDownload!:(blob:Blob)=>void,disposed=0;const refs:{current:unknown}[]=[],layouts:(()=>void|(()=>void))[]=[];
    const state={userId:validationId,projectId,robots:[resource()],selectedId:resourceId,loading:false,loadingRobots:false,downloading:false,error:null,xml:'PRIVATE',bytes:new ArrayBuffer(1),modelId:resourceId,manifestSha256:'a'.repeat(64),parts:[],linkCount:8,jointCount:7};const fakeSession={userId:validationId,projectId,state,dispose:()=>{disposed++;},loadRobots:(id:string)=>{selectedProduced=id;return Promise.resolve();},downloadPackage:()=>new Promise<Blob>(resolve=>{resolveDownload=resolve;})};
    const source=readFileSync(new URL('../components/embodex/EmbodexSchemeDesignPage.tsx',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,module={exports:{} as {default?:(props:{projectId:string})=>React.ReactElement}};
    runInNewContext(compiled,{module,exports:module.exports,Blob,URL:Object.assign(class extends URL {},{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}}),window:{location:{href:'https://example.test/embodex'},history:{state:null,replaceState:()=>{urlWrites++;}}},document:{createElement:()=>({click:()=>{downloads++;}})},navigator:{clipboard:{writeText:()=>{copies++;return Promise.resolve();}}},require:(name:string)=>{if(name==='react')return{__esModule:true,default:React,useState:(init:unknown)=>{const index=stateIndex++,v=typeof init==='function'?(init as ()=>unknown)():init;return[index===5?{userId:validationId,projectId,taskId}:index===6?{userId:validationId,projectId,text:'正在核实'}:v&&typeof v==='object'&&'robots' in v?state:v,(value:unknown)=>{if(index===6&&value===null)noticeClears++;}];},useRef:(initial:unknown)=>{const index=refIndex++;if(!refs[index])refs[index]={current:index===0?fakeSession:initial};return refs[index];},useLayoutEffect:(effect:()=>void|(()=>void))=>{layouts.push(effect);},useEffect:()=>{}};if(name==='../../lib/auth-context')return{useAuth:()=>({status:'authenticated',user:{id:validationId}})};if(name==='../../lib/embodex/parts')return{initialPartsState:()=>state};if(name==='next/link')return{__esModule:true,default:'a'};return{__esModule:true,default:()=>null};}});
    const find=(node:React.ReactNode,predicate:(e:React.ReactElement<Record<string,unknown>>)=>boolean):React.ReactElement<Record<string,unknown>>|null=>{if(!React.isValidElement<Record<string,unknown>>(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children as React.ReactNode)){const hit=find(child,predicate);if(hit)return hit;}return null;};
    const tree=module.exports.default!({projectId}),cleanup=layouts[0]() as ()=>void,download=find(tree,e=>e.props.children==='下载完整模型包 ZIP')!,agent=find(tree,e=>typeof e.props.onModelImport==='function')!;
    const artifacts=find(tree,e=>typeof e.props.onRobotReady==='function')!;assert(artifacts);(artifacts.props.onRobotReady as (robot:Resource,taskId:string)=>void)(resource(),validationId);assert.equal(noticeClears,0);(artifacts.props.onRobotReady as (robot:Resource,taskId:string)=>void)(resource(),taskId);assert.equal(noticeClears,1);assert.equal(selectedProduced,resourceId);
    (download.props.onClick as ()=>void)();assert(resolveDownload);cleanup();assert.equal(disposed,1);resolveDownload(new Blob(['private package']));await flush();assert.equal(downloads,0);
    (agent.props.onModelImport as (event:unknown)=>void)({status:'TASK_CREATED',projectId,taskId});assert.equal(urlWrites,0);
    const copy=find(tree,e=>e.props.title==='复制所选模型的原 XML，不重新生成')!,urdf=find(tree,e=>e.props.title==='下载原 URDF 单文件；网格请下载完整包')!;await (copy.props.onClick as ()=>Promise<void>)();(urdf.props.onClick as ()=>void)();assert.equal(copies,0);assert.equal(downloads,0);
  });

});

describe('Task-027 Embodex v1.7 publication workflow', () => {
  let originalGet: typeof client.get;
  let originalPost: typeof client.post;
  let sessions: EmbodexBuildSession[];

  beforeEach(() => {
    originalGet = client.get;
    originalPost = client.post;
    sessions = [];
  });

  afterEach(() => {
    sessions.forEach((item) => item.dispose());
    client.get = originalGet;
    client.post = originalPost;
  });

  const session = () => {
    const value = new EmbodexBuildSession(projectId, () => {}, 60000);
    sessions.push(value);
    return value;
  };

  test('normalizeTemplateId accepts valid identifiers and null, rejects invalid types and shapes', () => {
    assert.equal(normalizeTemplateId('so101_v1'), 'so101_v1');
    assert.equal(normalizeTemplateId('mock_template_a'), 'mock_template_a');
    assert.equal(normalizeTemplateId('a'), 'a');
    assert.equal(normalizeTemplateId('x'.repeat(128)), 'x'.repeat(128));
    assert.equal(normalizeTemplateId(null), null);

    const invalidCases: unknown[] = [
      undefined,
      '',
      '   ',
      'SO101',
      'So101',
      '123abc',
      '_leading',
      'hyphen-separated',
      'has space',
      'x'.repeat(129),
      123,
      {},
      [],
    ];
    for (const val of invalidCases) {
      assert.throws(
        () => normalizeTemplateId(val as string | null),
        /模板标识|templateId/,
        `Should reject invalid templateId: ${String(val)}`,
      );
    }
  });

  test('submit with v1.7 object payload sends 2-field snapshot without buildMode', async () => {
    let posts: Array<{ url: string; body: unknown; headers?: Record<string, string> }> = [];
    client.post = (async (options: { url: string; body: unknown; headers?: Record<string, string> }) => {
      posts.push(options);
      if (options.url.endsWith('/validations')) {
        return { data: { id: validationId, projectId, actionKey: 'EMBODEX_DESIGN' } };
      }
      return { data: task() };
    }) as unknown as typeof client.post;

    client.get = (async (options: { url: string }) => {
      if (options.url.endsWith('/results')) return page([result()]);
      if (options.url === '/api/v1/resources/{resourceId}') return { data: resource() };
      return { data: task() };
    }) as unknown as typeof client.get;

    const current = session();
    await current.submit({ requirement: '  正式机械臂发布任务  ', templateId: 'mock_template_a' });

    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, {
      projectId,
      actionKey: 'EMBODEX_DESIGN',
      inputs: {},
      configSnapshot: {
        requirement: '正式机械臂发布任务',
        templateId: 'mock_template_a',
      },
    });
    assert.equal('buildMode' in ((posts[0].body as Record<string, unknown>).configSnapshot as Record<string, unknown>), false);
    assert.equal(posts[1].headers?.['Idempotency-Key']?.length, 36);
  });

  test('submit with templateId: null sends JSON null without buildMode', async () => {
    let posts: Array<{ url: string; body: unknown; headers?: Record<string, string> }> = [];
    client.post = (async (options: { url: string; body: unknown; headers?: Record<string, string> }) => {
      posts.push(options);
      if (options.url.endsWith('/validations')) {
        return { data: { id: validationId, projectId, actionKey: 'EMBODEX_DESIGN' } };
      }
      return { data: task() };
    }) as unknown as typeof client.post;

    client.get = (async (options: { url: string }) => {
      if (options.url.endsWith('/results')) return page([result()]);
      if (options.url === '/api/v1/resources/{resourceId}') return { data: resource() };
      return { data: task() };
    }) as unknown as typeof client.get;

    const current = session();
    await current.submit({ requirement: '通用机器人设计', templateId: null });

    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, {
      projectId,
      actionKey: 'EMBODEX_DESIGN',
      inputs: {},
      configSnapshot: {
        requirement: '通用机器人设计',
        templateId: null,
      },
    });
  });

  test('legacy submit string payload continues sending 3-field baseline snapshot', async () => {
    let posts: Array<{ url: string; body: unknown; headers?: Record<string, string> }> = [];
    client.post = (async (options: { url: string; body: unknown; headers?: Record<string, string> }) => {
      posts.push(options);
      if (options.url.endsWith('/validations')) {
        return { data: { id: validationId, projectId, actionKey: 'EMBODEX_DESIGN' } };
      }
      return { data: task() };
    }) as unknown as typeof client.post;

    client.get = (async (options: { url: string }) => {
      if (options.url.endsWith('/results')) return page([result()]);
      if (options.url === '/api/v1/resources/{resourceId}') return { data: resource() };
      return { data: task() };
    }) as unknown as typeof client.get;

    const current = session();
    await current.submit('传统基线需求');

    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, {
      projectId,
      actionKey: 'EMBODEX_DESIGN',
      inputs: {},
      configSnapshot: {
        requirement: '传统基线需求',
        templateId: 'so101_v1',
        buildMode: 'baseline',
      },
    });
  });

  test('publicationStatus LOCATION_REGISTERED allows download; PENDING/NEEDS_ATTENTION suppresses download', async () => {
    const locId = '11111111-1111-4000-8000-111111111111';
    const regResult = (pubStatus: string, withArtifact = true): Result => ({
      ...result(),
      summary: 'Robot generation completed',
      data: {
        templateId: 'mock_template_a',
        modelId: resourceId,
        manifestSha256: 'a'.repeat(64),
        workspacePublicationStatus: pubStatus,
        registeredWorkspaceArtifacts: withArtifact
          ? [
              {
                artifactLocationId: locId,
                role: 'package',
                entryPath: 'model.zip',
              },
            ]
          : [],
      },
    });

    const regResource = (pubStatus: string): Resource => ({
      ...resource(),
      displayMetadata: {
        ...resource().displayMetadata,
        specifications: {
          workspacePublicationStatus: pubStatus,
          workspaceArtifactId: locId,
        },
      },
    });

    // 1. LOCATION_REGISTERED -> download allowed
    client.get = (async (options: { url: string }) => {
      if (options.url.endsWith('/results')) return page([regResult('LOCATION_REGISTERED', true)]);
      if (options.url === '/api/v1/resources/{resourceId}') return { data: regResource('LOCATION_REGISTERED') };
      if (options.url.includes('/runtime-model-package/download')) {
        return {
          data: new Blob(['package data']),
          response: {
            headers: new Headers({ 'content-type': 'application/zip' }),
          },
        };
      }
      return { data: task() };
    }) as unknown as typeof client.get;

    const current = session();
    await current.resume(taskId);
    assert.equal(current.state.publicationStatus, 'LOCATION_REGISTERED');
    const dl = await current.download();
    assert(dl !== null, 'Download must succeed when LOCATION_REGISTERED');

    // 2. PENDING -> download suppressed
    client.get = (async (options: { url: string }) => {
      if (options.url.endsWith('/results')) return page([regResult('PENDING', false)]);
      if (options.url === '/api/v1/resources/{resourceId}') return { data: regResource('PENDING') };
      return { data: task() };
    }) as unknown as typeof client.get;

    await current.refresh();
    assert.equal(current.state.publicationStatus, 'PENDING');
    const pendingDl = await current.download();
    assert.equal(pendingDl, null, 'Download must return null when PENDING');

    // 3. NEEDS_ATTENTION -> download suppressed
    client.get = (async (options: { url: string }) => {
      if (options.url.endsWith('/results')) return page([regResult('NEEDS_ATTENTION', false)]);
      if (options.url === '/api/v1/resources/{resourceId}') return { data: regResource('NEEDS_ATTENTION') };
      return { data: task() };
    }) as unknown as typeof client.get;

    await current.refresh();
    assert.equal(current.state.publicationStatus, 'NEEDS_ATTENTION');
    const attDl = await current.download();
    assert.equal(attDl, null, 'Download must return null when NEEDS_ATTENTION');
  });

  test('EmbodexPublicationForm renders with accessibility attributes and options', () => {
    let submittedPayload: unknown = null;
    const html = renderToStaticMarkup(
      React.createElement(EmbodexPublicationForm, {
        projectId,
        submitting: false,
        onSubmit: (payload) => {
          submittedPayload = payload;
        },
      }),
    );

    assert(html.includes('aria-label="正式机器人设计任务配置"'));
    assert(html.includes('SO-101 官方基线模板 (so101_v1)'));
    assert(html.includes('指定其他基线模板 ID'));
    assert(html.includes('未指定基线模板（通用机器人 / 自动选型，显式 null）'));
    assert(html.includes('id="embodex-publication-requirement"'));
    assert(html.includes('type="submit"'));
  });
});

// Run the actual page's hooks and callbacks with real sessions; only browser/UI and API are faked.
function publicationPageHarness(initialHref='https://example.test/projects/'+projectId+'/embodex') {
  let href=initialHref,userId=validationId,currentProject=projectId,index=0;
  const slots:unknown[]=[],effects:Array<()=>void>=[],cleanups:Array<()=>void>=[],events:string[]=[];
  const dialog={showModal:()=>events.push('show'),close:()=>events.push('close')};
  const source=readFileSync(new URL('../components/embodex/EmbodexSchemeDesignPage.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const module={exports:{} as {default?:(props:{projectId:string})=>React.ReactElement}};
  runInNewContext(compiled,{module,exports:module.exports,URL,URLSearchParams,setTimeout,window:{location:{get href(){return href;},get search(){return new URL(href).search;}},history:{state:null,replaceState:(_state:unknown,_title:string,value:string|URL)=>{href=String(value);}}},require:(name:string)=>{
    if(name==='react')return{__esModule:true,default:React,useState:(initial:unknown)=>{const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?(initial as ()=>unknown)():initial;return[slots[i],(value:unknown)=>{slots[i]=typeof value==='function'?(value as (old:unknown)=>unknown)(slots[i]):value;}];},useRef:(initial:unknown)=>{const i=index++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useLayoutEffect:(effect:()=>void|(()=>void),deps:unknown[])=>{const i=index++,key=JSON.stringify(deps);if(slots[i]!==key){slots[i]=key;effects.push(()=>{cleanups[i]?.();const cleanup=effect();cleanups[i]=typeof cleanup==='function'?cleanup:()=>{};});}},useEffect:()=>{}};
    if(name==='../../lib/auth-context')return{useAuth:()=>({status:userId?'authenticated':'anonymous',user:{id:userId}})};
    if(name==='../../lib/embodex/design-workflow')return{EmbodexBuildSession,readDesignRecovery,writeDesignRecovery};
    if(name==='../../lib/embodex/parts')return{initialPartsState:(userId:string,projectId:string)=>({userId,projectId,parts:[],robots:[]})};
    if(name==='next/link')return{__esModule:true,default:'a'};
    return{__esModule:true,default:()=>null};
  }});
  const find=(node:React.ReactNode,predicate:(element:React.ReactElement<Record<string,unknown>>)=>boolean):React.ReactElement<Record<string,unknown>>|null=>{
    if(!React.isValidElement<Record<string,unknown>>(node))return null;if(predicate(node))return node;
    for(const child of React.Children.toArray(node.props.children as React.ReactNode)){const found=find(child,predicate);if(found)return found;}return null;
  };
  const render=()=>{index=0;const tree=module.exports.default!({projectId:currentProject});
    for(const label of ['正式机器人设计发布','已有平台构建与模型包']){const element=find(tree,e=>e.props['aria-label']===label);if(element)(element.props.ref as {current:unknown}).current=dialog;}
    while(effects.length)effects.shift()!();return tree;
  };
  const open=()=>{const tree=render();(find(tree,e=>e.props.children==='平台设计发布')!.props.onClick as ()=>void)();return render();};
  return{events,render,open,find,get href(){return href;},switchOwner:(user:string,project=projectId)=>{userId=user;currentProject=project;render();},dispose:()=>{cleanups.forEach(cleanup=>cleanup?.());},submit:async(payload={requirement:'构建通用机器人',templateId:null as string|null})=>{const tree=open();const form=find(tree,e=>typeof e.props.onSubmit==='function')!;await (form.props.onSubmit as (value:unknown)=>Promise<void>)(payload);}};
}

describe('Task027 publication review regressions: real page callbacks and Resource projections',()=>{
  let originalGet:typeof client.get,originalPost:typeof client.post;
  const harnesses:ReturnType<typeof publicationPageHarness>[]=[];
  beforeEach(()=>{originalGet=client.get;originalPost=client.post;});
  afterEach(()=>{harnesses.splice(0).forEach(item=>item.dispose());client.get=originalGet;client.post=originalPost;});
  const harness=(href?:string)=>{const value=publicationPageHarness(href);harnesses.push(value);return value;};
  test('unknown page submission cannot replay after double click, close/reopen or full refresh',async()=>{
    let posts=0;client.post=(async(options:{url:string})=>{posts++;if(options.url.endsWith('/validations'))return{data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}};throw new Error('unknown');}) as unknown as typeof client.post;
    const first=harness();await Promise.all([first.submit(),first.submit()]);assert.equal(posts,2);assert(readDesignRecovery(new URL(first.href).search));
    await first.submit();assert.equal(posts,2);const restored=harness(first.href);await restored.submit();assert.equal(posts,2);
  });
  test('created task is handed directly to artifacts and URL; refresh restores without POST',async()=>{
    let posts=0;client.post=(async(options:{url:string})=>{posts++;return{data:options.url.endsWith('/validations')?{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}:task('RUNNING')};}) as unknown as typeof client.post;
    client.get=(async()=>({data:task('RUNNING')})) as unknown as typeof client.get;
    const current=harness();await current.submit();const tree=current.render();const artifacts=current.find(tree,e=>typeof e.props.onRobotReady==='function');assert(artifacts);assert.equal(artifacts.props.initialTaskId,taskId);assert.equal(new URL(current.href).searchParams.get('taskId'),taskId);assert.equal(posts,2);
    const restored=harness(current.href);restored.render();await flush();await restored.submit();assert.equal(posts,2);
  });
  test('old Validation returning after user/project/logout switch cannot issue Task or mutate dialogs',async()=>{
    for(const mode of ['user','project','logout']){
      let resolveValidation!:(value:unknown)=>void,posts=0;client.post=(()=>{posts++;return new Promise(resolve=>{resolveValidation=resolve;});}) as unknown as typeof client.post;
      const current=harness();const pending=current.submit();await flush();assert.equal(posts,1);
      current.switchOwner(mode==='user'?resourceId:mode==='logout'?'':validationId,mode==='project'?resourceId:projectId);const afterSwitch=current.events.length;
      resolveValidation({data:{id:validationId,projectId,actionKey:'EMBODEX_DESIGN'}});await pending;assert.equal(posts,1);assert.equal(current.events.length,afterSwitch);assert.equal(new URL(current.href).searchParams.get('taskId'),null);
    }
  });
  test('Result-only registration never supplies Resource qualification, and pending never becomes ready',async()=>{
    const output={...result(),summary:'Robot generation completed',data:{publicationStatus:'LOCATION_REGISTERED',workspaceArtifactId:resourceId,registeredWorkspaceArtifacts:[{artifactLocationId:resourceId}]}};
    for(const specs of [{},{workspacePublicationStatus:'PENDING'},{workspacePublicationStatus:'NEEDS_ATTENTION'},{workspacePublicationStatus:'UNKNOWN'},{workspacePublicationStatus:'LOCATION_REGISTERED',workspaceArtifactId:'bad'},{workspacePublicationStatus:'LOCATION_REGISTERED',workspaceArtifactId:resourceId}]){
      client.get=(async(options:{url:string})=>options.url.endsWith('/results')?page([output]):options.url.includes('/resources/')?{data:{...resource(),displayMetadata:{...resource().displayMetadata,specifications:specs}}}:{data:task()}) as unknown as typeof client.get;
      const current=new EmbodexBuildSession(projectId,()=>{},60000);try{await current.resume(taskId);assert.equal(designArtifactsReady(current.state),specs.workspacePublicationStatus==='LOCATION_REGISTERED'&&specs.workspaceArtifactId===resourceId);}finally{current.dispose();}
    }
  });
});

test('actual artifacts UI notifies and enables download only for qualified resources',()=>{
  const source=readFileSync(new URL('../components/embodex/ExistingBuildArtifacts.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  for(const publicationStatus of ['PENDING','NEEDS_ATTENTION','NOT_REGISTERED','LOCATION_REGISTERED',null] as const){
    let stateIndex=0,ready=0;const effects:Array<()=>void>=[],state={...initialDesignState(projectId),task:task(),result:result(),robot:resource(),publicationStatus};
    const module={exports:{} as {default?:(props:unknown)=>React.ReactElement}};
    runInNewContext(compiled,{module,exports:module.exports,require:(name:string)=>{
      if(name==='react')return{__esModule:true,default:React,useState:()=>[stateIndex++===0?state:validationId,()=>{}],useRef:(current:unknown)=>({current}),useLayoutEffect:()=>{},useEffect:(effect:()=>void)=>{effects.push(effect);}};
      if(name==='../../lib/auth-context')return{useAuth:()=>({status:'authenticated',user:{id:validationId}})};
      if(name==='../../lib/embodex/design-workflow')return{initialDesignState,designArtifactsReady};
      if(name==='next/link')return{__esModule:true,default:'a'};throw new Error(name);
    }});
    const tree=module.exports.default!({projectId,onRobotReady:()=>{ready++;}});
    effects[2](); // Actual ready notification effect; transport effects are intentionally not run.
    const html=renderToStaticMarkup(tree),expected=publicationStatus===null||publicationStatus==='LOCATION_REGISTERED';
    assert.equal(ready,expected?1:0);assert.equal(/<button[^>]*disabled=""[^>]*>下载 URDF 模型包 ZIP<\/button>/.test(html),!expected);
  }
});
