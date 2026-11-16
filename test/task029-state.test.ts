import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as rules from '../lib/deploy/deployx-state';
import type { DeployxDeploymentResponse, DeployxProjectResourcesResponse } from '../lib/api';

const fact = (value: boolean | null = null) => ({ value, source: value === null ? null : 'AUTHORIZED_UPSTREAM_SUMMARY' as const, observedAt: null });
const deployment = (extra: Partial<DeployxDeploymentResponse> = {}): DeployxDeploymentResponse => ({
  deploymentId: 'dep-1', projectId: 'p', platformTaskId: 'task-1', platformTaskStatus: 'RUNNING', upstreamTaskId: 'up-1',
  robotId: 'r', packageId: 'pkg', templateId: 't', modelAssetId: null, isShadow: false, progressionPolicy: 'MANUAL_STAGE',
  status: 'AWAITING_STAGE_ACTION', availableActions: ['BUILD_RELEASE'], steps: {}, attempts: [], executionSteps: [], resolutionGenerations: [],
  version: 0, submitStatus: 'SUBMITTED', observedAt: null, createdAt: '', updatedAt: '', environmentKey: 'test', parentDeploymentId: null,
  operations: [], relatedStops: [], retryDeployments: [], safety: { stopAccepted: fact(), safeStopVerified: fact(), lease: { value: null, source: null, observedAt: null }, newDeploymentAdmission: fact() }, ...extra,
});
const resources = (): DeployxProjectResourcesResponse => ({
  robots: [{ id:'r', name:'Robot', online:true, bindState:'BOUND', templateId:'t', createdAt:'', updatedAt:'' }],
  packages: [{ id:'pkg', originalName:'package', sha256:'a'.repeat(64), sizeBytes:10, status:'UNPACKED', createdAt:'', updatedAt:'' }],
  templates: [{ id:'t', name:'Template', arch:'arm64', runtime:'ros2', version:'1', createdAt:'', updatedAt:'' }], modelAssets:[],
  capabilities: { canCreateDeployment:true, canBuildRelease:true, canDeployToRobot:true, canStop:true, canCancel:true, canRecover:true, canViewLogs:true, canUploadPackage:false, canUnpackPackage:false, canTriggerValidation:false, canProbeHost:false, canBindRobot:false },
});
const reply = (data: unknown) => ({ data, response: new Response() });
const flush = () => new Promise<void>(r => setImmediate(r));
const deferred = () => { let resolve!: (v: unknown) => void; const promise = new Promise(r => { resolve=r; }); return { promise, resolve }; };
const source = readFileSync(new URL('../lib/deploy/useDeployxState.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function harness(api: Record<string, (opts: any) => any> = {}, storage = new Map<string,string>()) {
  let cursor=0; const cells:any[]=[]; let effects:(()=>void)[]=[]; let props:{projectId?:string, initialDeploymentId?:string, accountId?:string}={projectId:'p', accountId:'actor'};
  const intervals = new Set<()=>void>();
  const same=(a:unknown[]|undefined,b:unknown[]|undefined)=>Boolean(a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i])));
  const hooks={
    useState(initial:any){const i=cursor++; if(!(i in cells)) cells[i]=typeof initial==='function'?initial():initial; return [cells[i],(value:any)=>{cells[i]=typeof value==='function'?value(cells[i]):value;}];},
    useRef(initial:any){const i=cursor++; if(!(i in cells)) cells[i]={current:initial}; return cells[i];},
    useCallback(fn:any,deps:any[]){const i=cursor++; if(!cells[i]||!same(cells[i].deps,deps))cells[i]={fn,deps};return cells[i].fn;},
    useEffect(effect:any,deps:any[]){const i=cursor++; if(!cells[i]||!same(cells[i].deps,deps)){const prior=cells[i];cells[i]={deps};effects.push(()=>{prior?.cleanup?.();cells[i].cleanup=effect();});}},
  };
  const defaults:any={
    listDeployxProjectResources:async()=>reply(resources()), listDeployxDeployments:async()=>reply({items:[],meta:{page:1,pageSize:20,total:0,totalPages:0}}),
    getDeployxPackageDetail:async()=>reply(resources().packages[0]), getDeployxPackageManifest:async()=>reply({packageId:'pkg',entry:'run',runtime:'python',dependencies:[]}),
    getDeployxPackageValidation:async()=>reply({reports:[]}), getDeployxRobotStatus:async()=>reply({robotId:'r',online:true,lastSeenAt:null,lastStatus:null}),
    getDeployxDeploymentDetail:async()=>reply(deployment()), getDeployxLocalCapabilities:async(opts:any)=>reply({projectId:opts.path.projectId,target:opts.query,environmentKey:'test',decisions:{CREATE_DEPLOYMENT:true,BUILD_RELEASE:true,DEPLOY_TO_ROBOT:true,STOP:true,CANCEL:true,RECOVER:true,LOGS:true,UPLOAD_PACKAGE:false,UPLOAD_MODEL:false,UNPACK:false,VALIDATE_STAGE1:false,VALIDATE_STAGE2:false,BIND:false,PREPARE:false},evaluatedAt:''}), ...api,
  };
  const module={exports:{} as {useDeployxState:(props:any)=>any}};
  runInNewContext(compiled,{module,exports:module.exports,crypto,Error,JSON,AbortController,navigator:api.__navigator ? api.__navigator(undefined) : {locks:{request:async (_name:any,_opts:any,fn:any)=>fn({})}},XMLHttpRequest:api.__xhr,setInterval:(fn:()=>void)=>{intervals.add(fn);return fn;},clearInterval:(fn:()=>void)=>intervals.delete(fn),sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},require:(name:string)=>name==='react'?hooks:name==='./deployx-state'?rules:defaults});
  let state:any;
  const render=()=>{cursor=0;state=module.exports.useDeployxState(props);const next=effects;effects=[];next.forEach(f=>f());return state;};
  const settle=async()=>{for(let i=0;i<8;i++){render();await flush();}return render();};
  render();
  return {render,settle,get state(){return state;},change:(next:typeof props)=>{props={accountId:'actor',...next};return render();},tick:()=>{for(const fn of [...intervals])fn();},storage,unmount:()=>{cells.forEach(c=>c?.cleanup?.());intervals.clear();}};
}

test('Hook displays generated result errors; failed queries do not become empty success', async()=>{
  const h=harness({listDeployxProjectResources:async()=>({error:{error:{message:'项目不可用'}},response:new Response(null,{status:403})})});
  await h.settle(); assert.equal(h.state.resources,null);assert.equal(h.state.resourcesError,'项目不可用');h.unmount();
});

test('Hook uses a synchronous write lock and a single stable intent key; creation never builds automatically',async()=>{
  const gate=deferred();const sent:any[]=[];let latest:DeployxDeploymentResponse;
  const h=harness({createDeployxDeployment:async opts=>{sent.push(opts);return gate.promise;},getDeployxDeploymentDetail:async()=>reply(latest)});
  await h.settle();const handler=h.state.handleCreateDeployment;const one=handler();await handler();assert.equal(sent.length,1);
  assert.equal(sent[0].body.robotId,'r');const key=sent[0].body.idempotencyKey;assert.match(key,/^[a-f0-9-]{36}$/);
  latest=deployment({operations:[{operationId:key,idempotencyKey:key,submitStatus:'SUBMITTED'} as any]});gate.resolve(reply(latest));await one;await h.settle();
  assert.equal(h.state.currentDeployment.deploymentId,'dep-1');assert.equal(h.state.controls.build,true);assert.equal(h.state.controls.deploy,false);assert.equal(sent.length,1);h.unmount();
});

test('Unknown creation persists a pointer; remount reconciles by GET without another POST',async()=>{
  let posts=0;const storage=new Map<string,string>();
  const h=harness({createDeployxDeployment:async()=>{posts++;return {error:{message:'连接中断'},response:new Response(null,{status:502})};}},storage);
  await h.settle();await h.state.handleCreateDeployment();await h.settle();assert.equal(h.state.actionError,'连接中断');assert(h.state.pending);await h.state.handleCreateDeployment();assert.equal(posts,1);
  const pointer=JSON.parse([...storage.values()][0]);h.unmount();
  const d=deployment({submitStatus:'UNKNOWN_SUBMIT',operations:[{operationId:pointer.key,idempotencyKey:pointer.key,submitStatus:'UNKNOWN_SUBMIT'} as any]});
  const restored=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),createDeployxDeployment:async()=>{posts++;throw Error('must not resend');}},storage);
  await restored.settle();assert.equal(restored.state.currentDeployment.deploymentId,'dep-1');assert.equal(restored.state.controls.build,false);assert.equal(posts,1);restored.unmount();
});

test('Real capabilities, observed revisions, successful build and two independent manual actions gate writes',async()=>{
  const c=resources().capabilities;const d=deployment();const cap:any={decisions:{BUILD_RELEASE:true,DEPLOY_TO_ROBOT:true}};assert.equal(rules.deploymentControls(d,c,false,cap).build,true);
  assert.equal(rules.deploymentControls({...d,version:null},c).build,false);
  assert.equal(rules.deploymentControls(null,{...c,canCreateDeployment:false}).create,false);
  assert.equal(rules.deploymentControls({...d,availableActions:['DEPLOY_TO_ROBOT']},c).deploy,false);
  const ready=deployment({...d,steps:{build:{name:'build',status:'SUCCEEDED'}},availableActions:['DEPLOY_TO_ROBOT']});
  assert.equal(rules.deploymentControls(ready,c,false,cap).deploy,true);
  const actions:any[]=[];let active=d;
  const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(active),triggerDeployxDeploymentAction:async opts=>{actions.push(opts.body);active=ready;return reply(active);}});
  await h.settle();await h.state.handleConfirmDeploy();assert.equal(actions.length,0);await h.state.handleConfirmBuild();await h.settle();assert.equal(actions.length,1);assert.equal(actions[0].expectedTaskRevision,0);assert.equal(actions[0].action,'BUILD_RELEASE');h.unmount();
});

test('RECOVER switches using returned DEPLOY deploymentId and never its recovery STOP identity',async()=>{
  const failed=deployment({status:'SAFETY_BLOCKED'});const next=deployment({deploymentId:'dep-2',upstreamTaskId:'up-2',parentDeploymentId:'dep-1'});const reads:string[]=[];
  const h=harness({listDeployxDeployments:async()=>reply({items:[failed]}),getDeployxDeploymentDetail:async opts=>{reads.push(opts.path.deploymentId);return reply(opts.path.deploymentId==='dep-2'?next:failed);},recoverDeployxDeployment:async()=>reply({task:next,recoveryTaskId:'stop-1',operation:{submitStatus:'SUBMITTED'}})});
  await h.settle();assert(h.state.controls.recover);await h.state.handleRecover();await h.settle();assert.equal(h.state.currentDeployment.deploymentId,'dep-2');assert(reads.includes('dep-2'));assert(!reads.includes('stop-1'));assert.equal(h.state.pending,null);h.unmount();
});

test('Terminal deployments keep polling unresolved operations and unknown safety; safety completion is never inferred',async()=>{
  const d=deployment({status:'SUCCEEDED'});assert(rules.needsDeploymentPoll(d));assert(rules.deploymentControls(d,resources().capabilities,false,{decisions:{STOP:true}} as any).stop);assert(!rules.deploymentControls(d,resources().capabilities).restart);
  let reads=0;const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>{reads++;return reply(d);}});await h.settle();const prior=reads;h.tick();await h.settle();assert(reads>prior);h.unmount();
  const resolved=deployment({status:'CANCELLED',safety:{...d.safety,safeStopVerified:fact(true),newDeploymentAdmission:fact(true)}});assert(!rules.needsDeploymentPoll(resolved));
  assert(rules.needsDeploymentPoll({...resolved,operations:[{submitStatus:'UNKNOWN_SUBMIT'} as any]}));
  assert(rules.needsDeploymentPoll({...resolved,relatedStops:[{status:'RUNNING'} as any]}));
});

test('Project change invalidates delayed resource/deployment responses and clears cached projections',async()=>{
  const oldResources=deferred(),oldList=deferred();
  const h=harness({listDeployxProjectResources:async opts=>opts.path.projectId==='p'?oldResources.promise:reply({...resources(),packages:[]}),listDeployxDeployments:async opts=>opts.path.projectId==='p'?oldList.promise:reply({items:[]})});
  await flush();h.change({projectId:'other'});await h.settle();oldResources.resolve(reply(resources()));oldList.resolve(reply({items:[deployment()]}));await h.settle();
  assert.equal(h.state.resources.packages.length,0);assert.equal(h.state.currentDeployment,null);assert.equal(h.state.packageDetail,null);assert.equal(h.state.robotLogs,'');h.unmount();
});

test('Package change clears old manifest/reports before new failing requests complete',async()=>{
  const h=harness({getDeployxPackageDetail:async opts=>opts.path.packageId==='other'?{error:{message:'包不存在'}}:reply(resources().packages[0])});await h.settle();assert(h.state.packageDetail);
  h.state.setSelectedPackageId('other');await h.settle();assert.equal(h.state.packageDetail,null);assert.equal(h.state.packageManifest,null);assert.equal(h.state.packageValidations.length,0);assert.equal(h.state.actionError,'包不存在');h.unmount();
});

test('Stepper derives package and validation failures and running states from facts',()=>{
  assert.equal(rules.packageStepStatus({...resources().packages[0],status:'UNPACK_FAILED'}),'FAILED');assert.equal(rules.packageStepStatus({...resources().packages[0],status:'UPLOADED'}),'PENDING');
  assert.equal(rules.validationStepStatus([{status:'FAILED'} as any]),'FAILED');assert.equal(rules.validationStepStatus([{status:'PENDING'} as any]),'PENDING');assert.equal(rules.validationStepStatus([{status:'RUNNING'} as any]),'RUNNING');assert.equal(rules.validationStepStatus([{status:'PASSED'} as any]),'SUCCEEDED');
});

function loadComponent(name:string){
  const code=ts.transpileModule(readFileSync(new URL('../components/deploy/'+name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const module={exports:{} as {default:React.ComponentType<any>}};
  runInNewContext(code,{module,exports:module.exports,require:(name:string)=>name==='react'?React:new Proxy({},{get:(_t,p)=>p==='__esModule'?false:String(p)})});return module.exports.default;
}
test('Resource selection renders native keyboard buttons with pressed and disabled semantics',()=>{
  const C=loadComponent('steps/StepUploadPackage.tsx');const html=renderToStaticMarkup(React.createElement(C,{packages:resources().packages,models:[{id:'m',displayName:'Model'}],selectedPackageId:'pkg',selectedModelAssetId:null,onSelectPackage:()=>{},onModelAssetChange:()=>{},readOnly:false}));
  assert.match(html,/<button[^>]*aria-pressed="true"/);assert.equal((html.match(/aria-pressed=/g)||[]).length,3);
  const locked=renderToStaticMarkup(React.createElement(C,{packages:resources().packages,models:[],selectedPackageId:'pkg',selectedModelAssetId:null,onSelectPackage:()=>{},onModelAssetChange:()=>{},readOnly:true}));assert.match(locked,/<button[^>]*disabled=""[^>]*aria-pressed="true"/);
});


test('Unknown STOP locks new safety writes and terminal parent continues reading its operation',async()=>{
  const d=deployment({status:'SUCCEEDED'});let posts=0;let key='';let active=d;
  const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(active),stopDeployxDeployment:async opts=>{posts++;key=opts.headers['Idempotency-Key'];active={...d,operations:[{operationId:key,submitStatus:'UNKNOWN_SUBMIT',operationType:'STOP'} as any]};return {error:{error:{code:'STOP_TASK_FAILED',message:'停止结果未知'}},response:new Response(null,{status:409})};}});
  await h.settle();await h.state.handleStop();await h.settle();assert.equal(h.state.actionError,'停止结果未知');assert.equal(h.state.pending.key,key);assert.equal(h.state.controls.stop,false);await h.state.handleStop();assert.equal(posts,1);h.tick();await h.settle();assert.equal(h.state.currentDeployment.operations[0].submitStatus,'UNKNOWN_SUBMIT');h.unmount();
});

test('202 RECOVER adopts linked deployment only after operation is observed with a retry DEPLOY link',async()=>{
  const d=deployment({status:'SAFETY_BLOCKED'});const next=deployment({deploymentId:'retry-deploy',upstreamTaskId:'up-retry'});let active=d;
  const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async opts=>reply(opts.path.deploymentId==='retry-deploy'?next:active),recoverDeployxDeployment:async opts=>{active={...d,operations:[{operationId:opts.headers['Idempotency-Key'],operationType:'RECOVER',submitStatus:'UNKNOWN_SUBMIT',retryDeploymentId:null} as any]};return reply({operation:active.operations[0]});}});
  await h.settle();await h.state.handleRecover();await h.settle();assert.equal(h.state.currentDeployment.deploymentId,'dep-1');assert(h.state.pending);
  active={...active,operations:[{...active.operations[0],submitStatus:'SUBMITTED',retryDeploymentId:'retry-deploy'}],retryDeployments:[{deploymentId:'retry-deploy',upstreamTaskId:'up-retry',parentDeploymentId:'dep-1'}]};
  h.tick();await h.settle();assert.equal(h.state.currentDeployment.deploymentId,'retry-deploy');assert.equal(h.state.pending,null);assert(h.state.controls.build);h.unmount();
});

test('Reset invalidates an already pending poll; no stale deployment can reappear',async()=>{
  const d=deployment({status:'SUCCEEDED',safety:{...deployment().safety,newDeploymentAdmission:fact(true)}});const late=deferred();let calls=0;
  const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>++calls===1?reply(d):late.promise});
  await h.settle();h.tick();await flush();h.state.handleRestart();await h.settle();late.resolve(reply(d));await h.settle();assert.equal(h.state.currentDeployment,null);assert.equal(h.state.selectedPackageId,null);assert.equal(h.state.robotLogs,'');h.unmount();
});

test('Observed null revision prevents the actual Hook handler from posting; deterministic revision errors are visible and require a new manual action',async()=>{
  let d=deployment({version:null});let posts=0;
  const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),triggerDeployxDeploymentAction:async()=>{posts++;return {error:{error:{code:'TASK_REVISION_MISMATCH',message:'请刷新并重新确认'}},response:new Response(null,{status:409})};}});
  await h.settle();await h.state.handleConfirmBuild();assert.equal(posts,0);d=deployment();h.tick();await h.settle();await h.state.handleConfirmBuild();await h.settle();assert.equal(posts,1);assert.equal(h.state.actionError,'请刷新并重新确认');assert.equal(h.state.pending,null);h.unmount();
});


test('Terminal unknown safety polling has a finite observation budget and visible manual follow-up',async()=>{
  const d=deployment({status:'SUCCEEDED'});let reads=0;
  const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>{reads++;return reply(d);}});await h.settle();
  for(let i=0;i<7;i++){h.tick();await h.settle();}assert.equal(reads,4);assert.match(h.state.actionError,/暂停自动查询/);assert(!h.state.controls.restart);h.unmount();
});


test('Actual Workspace renders failed report/package steps and running build without false success',()=>{
  const code=ts.transpileModule(readFileSync(new URL('../components/deploy/DeployWorkspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const d=deployment({steps:{unpack:{name:'unpack',status:'FAILED'},build:{name:'build',status:'RUNNING'}}});
  const state={resources:resources(),selectedPackageId:'pkg',selectedModelAssetId:null,selectedRobotId:'r',selectedTemplateId:'t',packageDetail:{...resources().packages[0],status:'UNPACK_FAILED'},packageValidations:[{status:'FAILED'}],currentDeployment:d,controls:rules.deploymentControls(d,resources().capabilities),prepControls:rules.preparationControls(null,resources().capabilities),pending:null};
  const module={exports:{} as {default:React.ComponentType<any>}};
  runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{
    if(name==='react')return React;
    if(name.endsWith('.css'))return new Proxy({},{get:(_t,p)=>p==='__esModule'?false:String(p)});
    if(name.endsWith('auth-context'))return {useAuth:()=>({status:'authenticated',user:{id:'actor'}})};
    if(name.endsWith('useDeployxState'))return {useDeployxState:()=>state};
    if(name.endsWith('deployx-state'))return rules;
    if(name.endsWith('DeployWizardStepper'))return {__esModule:true,default:loadComponent('DeployWizardStepper.tsx')};
    return {__esModule:true,default:()=>null};
  }});
  const html=renderToStaticMarkup(React.createElement(module.exports.default,{projectId:'p'}));
  assert.equal((html.match(/class="stepDot stepDotError"/g)||[]).length,2);
  assert.match(html,/stepDotRunning/);assert.match(html,/安全停止确认：未知/);
});


test('RECOVER retry detail failure retains parent and logs, then the next poll adopts without a POST',async()=>{
  const parent=deployment({status:'SAFETY_BLOCKED'});
  const retry=deployment({deploymentId:'retry-after-outage',upstreamTaskId:'up-retry'});
  let active=parent,childReads=0,posts=0;
  const h=harness({
    listDeployxDeployments:async()=>reply({items:[parent]}),
    getDeployxDeploymentDetail:async opts=>{
      if(opts.path.deploymentId!=='retry-after-outage')return reply(active);
      if(++childReads===1)return {error:{error:{code:'DEPLOYX_UNAVAILABLE',message:'恢复任务暂不可读'}},response:new Response(null,{status:503})};
      return reply(retry);
    },
    getDeployxDeploymentRobotLogs:async()=>reply({content:'parent log snapshot'}),
    createDeployxDeployment:async()=>{posts++;throw Error('unexpected create');},
    triggerDeployxDeploymentAction:async()=>{posts++;throw Error('unexpected stage');},
    recoverDeployxDeployment:async()=>{posts++;throw Error('unexpected recover');},
  });
  await h.settle();await h.state.handleFetchLogs();await h.settle();assert.equal(h.state.robotLogs,'parent log snapshot');
  active={...parent,operations:[{operationId:'recover-op',operationType:'RECOVER',submitStatus:'SUBMITTED',retryDeploymentId:'retry-after-outage'} as any],retryDeployments:[{deploymentId:'retry-after-outage',upstreamTaskId:'up-retry',parentDeploymentId:'dep-1'}]};
  h.tick();await h.settle();assert.equal(childReads,1);assert.equal(h.state.currentDeployment.deploymentId,'dep-1');assert.equal(h.state.robotLogs,'parent log snapshot');assert.equal(h.state.actionError,'恢复任务暂不可读');
  h.tick();await h.settle();assert.equal(childReads,2);assert.equal(h.state.currentDeployment.deploymentId,'retry-after-outage');assert.equal(h.state.robotLogs,'');assert.equal(posts,0);h.unmount();
});

const rc4Caps = async (opts:any, extra:any = {}) => reply({projectId:opts.path.projectId,environmentKey:'test',target:opts.query,observedAt:'2026-10-29T00:00:00Z',decisions:{CREATE_DEPLOYMENT:true,UPLOAD_PACKAGE:true,UPLOAD_MODEL:true,UNPACK:true,VALIDATE_STAGE1:true,VALIDATE_STAGE2:true,BIND:true,PREPARE:true,STOP:true,CANCEL:true,LOGS:true},...extra});

test('RC4 capabilities follow target, account and anchored environment and never fall back to legacy',async()=>{
  const late=deferred(); let delayed=true;
  const h=harness({getDeployxLocalCapabilities:opts=>opts.query.robotId==='other'&&delayed?late.promise:rc4Caps(opts)});
  await h.settle();assert.equal(h.state.prepControls.uploadPackage,true);
  h.state.setSelectedRobotId('other');h.render();assert.equal(h.state.prepControls.uploadPackage,false);
  h.state.setSelectedRobotId('r');await h.settle();late.resolve(rc4Caps({path:{projectId:'p'},query:{robotId:'other'}}));await h.settle();assert.equal(h.state.selectedRobotId,'r');assert.equal(h.state.localCapabilities.target.robotId,'r');
  delayed=false;h.change({projectId:'p',accountId:'other'});h.render();assert.equal(h.state.prepControls.uploadPackage,false);await h.settle();assert(h.state.prepControls.uploadPackage);h.unmount();
  const wrong=harness({getDeployxLocalCapabilities:opts=>rc4Caps(opts,{projectId:'wrong'})});await wrong.settle();assert.equal(wrong.state.controls.create,false);assert.equal(wrong.state.prepControls.uploadPackage,false);wrong.unmount();
  const badEnv=harness({listDeployxDeployments:async()=>reply({items:[deployment()]}),getDeployxLocalCapabilities:opts=>rc4Caps(opts,{environmentKey:'other'})});await badEnv.settle();assert.equal(badEnv.state.localCapabilities,null);assert.equal(badEnv.state.controls.build,false);badEnv.unmount();
  const failed=harness({getDeployxLocalCapabilities:async()=>({error:{message:'offline'}})});await failed.settle();assert.equal(failed.state.controls.create,false);assert.equal(failed.state.prepControls.uploadPackage,false);failed.unmount();
});

test('RC4 unknown management request keeps its original key and recovers via preparation GET',async()=>{
  let post=0, key='', reads=0;const storage=new Map<string,string>();
  const h=harness({getDeployxLocalCapabilities:rc4Caps,validateDeployxStage1:async opts=>{post++;key=opts.headers['Idempotency-Key'];return {error:{message:'lost'},response:new Response(null,{status:504})};},getDeployxPreparationOperation:async opts=>{reads++;assert.equal(opts.path.operationId,key);return reply({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'UNKNOWN_SUBMIT'});}},storage);
  await h.settle();await h.state.handleValidateStage1();await h.settle();assert.equal(post,1);assert.equal(h.state.pending.key,key);await h.state.handleValidateStage1();assert.equal(post,1);h.tick();await h.settle();assert(reads>0);h.unmount();
  const r=harness({getDeployxLocalCapabilities:rc4Caps,getDeployxPreparationOperation:async opts=>{reads++;assert.equal(opts.path.operationId,key);return reply({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'UNKNOWN_SUBMIT'});},validateDeployxStage1:async()=>{post++;throw Error('no retransmit');}},storage);
  await r.settle();r.tick();await r.settle();assert.equal(post,1);assert.equal(r.state.pending.key,key);assert(reads>1);r.unmount();
});

test('RC4 submitted validation waits for a new authoritative report, and missing manifest blocks the handler',async()=>{
  let key='',posts=0,reports:any[]=[];
  const h=harness({getDeployxLocalCapabilities:rc4Caps,getDeployxPackageValidation:async()=>reply({reports}),validateDeployxStage1:async opts=>{posts++;key=opts.headers['Idempotency-Key'];return reply({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'SUBMITTED'});},getDeployxPreparationOperation:async()=>reply({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'SUBMITTED'})});
  await h.settle();await h.state.handleValidateStage1();await h.settle();h.tick();await h.settle();assert(h.state.pending);assert.equal(h.state.packageValidations.length,0);
  reports=[{id:'new',packageId:'pkg',stage:'stage1',status:'PASSED'}];h.tick();await h.settle();assert.equal(h.state.pending,null);assert.equal(h.state.packageValidations[0].id,'new');assert.equal(posts,1);h.unmount();
  const missing=harness({getDeployxLocalCapabilities:rc4Caps,getDeployxPackageManifest:async()=>({error:{message:'missing'}}),validateDeployxStage1:async()=>{posts++;}});await missing.settle();await missing.state.handleValidateStage1();assert.equal(posts,1);missing.unmount();
});

test('RC4 transfer reports real byte events, cancels and keeps the original key without retry',async()=>{
  let xhr:any, sends=0;
  class Xhr {upload:any={};headers:any={};status=0;responseText='';onload:any;onabort:any;onerror:any;withCredentials=false;open(_method:string,_path:string){} setRequestHeader(k:string,v:string){this.headers[k]=v;} send(file:any){xhr=this;sends++;assert.equal(file.name,'demo.zip');} abort(){this.onabort?.();}}
  const h=harness({getDeployxLocalCapabilities:rc4Caps,__xhr:Xhr as unknown as (opts:any)=>any,getDeployxPreparationOperation:async opts=>reply({operationId:opts.path.operationId,operationType:'UPLOAD_PACKAGE',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'UNKNOWN_SUBMIT'})});await h.settle();
  const running=h.state.handleUploadPackage({name:'demo.zip',size:1200,lastModified:1});await flush();h.render();xhr.upload.onprogress({lengthComputable:true,loaded:400,total:1200});h.render();assert.match(h.state.uploadStatus,/400 \/ 1200/);const key=xhr.headers['Idempotency-Key'];h.state.handleCancelUpload();await running;await h.settle();assert.equal(h.state.pending.key,key);assert.match(h.state.actionError,/远端结果未知/);await h.state.handleUploadPackage({name:'demo.zip',size:1200,lastModified:1});assert.equal(sends,1);h.unmount();
});


test('RC4 old project callback cannot mutate or release a new project request; unload rejects delayed observation',async()=>{
  const old=deferred(), next=deferred();let calls:any[]=[];
  const h=harness({getDeployxLocalCapabilities:rc4Caps,validateDeployxStage1:opts=>{calls.push(opts);return opts.path.projectId==='p'?old.promise:next.promise;},getDeployxPreparationOperation:async opts=>reply({operationId:opts.path.operationId,operationType:'VALIDATE_STAGE1',projectId:opts.path.projectId,environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'UNKNOWN_SUBMIT'})});
  await h.settle();const first=h.state.handleValidateStage1();await flush();h.change({projectId:'other'});await h.settle();const second=h.state.handleValidateStage1();await flush();h.render();assert.equal(calls.length,2);const newKey=h.state.pending.key;
  old.resolve({error:{message:'old failed'},response:new Response(null,{status:504})});await first;await h.settle();assert.equal(h.state.pending.key,newKey);assert.equal(h.state.prepLoading,true);assert.notEqual(h.state.actionError,'old failed');
  next.resolve({error:{message:'new failed'},response:new Response(null,{status:504})});await second;await h.settle();assert.equal(h.state.pending.key,newKey);h.unmount();
  const delayed=deferred();let reads=0;const u=harness({getDeployxLocalCapabilities:rc4Caps,validateDeployxStage1:async()=>({error:{message:'lost'},response:new Response(null,{status:504})}),getDeployxPreparationOperation:()=>{reads++;return delayed.promise;}});await u.settle();await u.state.handleValidateStage1();await u.settle();u.tick();await flush();assert.equal(reads,1);u.unmount();delayed.resolve(reply({operationId:'old',operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',submitStatus:'SUBMITTED',resourceId:null}));await flush();
});

test('RC4 target switch closes stale handlers synchronously and binding remains unavailable',async()=>{
  let posts=0, binds=0;const h=harness({getDeployxLocalCapabilities:rc4Caps,validateDeployxStage1:async()=>{posts++;},bindDeployxRobot:async()=>{binds++;}});await h.settle();const old=h.state.handleValidateStage1;h.state.setSelectedRobotId('other');await old();await h.state.handleBindRobot('r','t','1.0.0');assert.equal(posts,0);assert.equal(binds,0);h.unmount();
});


test('RC4 unpack, stage2 and prepare retain frozen intent and one key on response loss',async()=>{
  for (const [kind, method, handler] of [['UNPACK','unpackDeployxPackage','handleUnpackPackage'],['VALIDATE_STAGE2','validateDeployxStage2','handleValidateStage2'],['PREPARE','prepareDeployxRobot','handlePrepareRobot']] as const) {
    let calls=0,key='';const api:any={getDeployxLocalCapabilities:rc4Caps,getDeployxPackageDetail:async()=>reply({...resources().packages[0],status:'UPLOADED'}),getDeployxPreparationOperation:async (opts:any)=>reply({operationId:opts.path.operationId,operationType:kind,projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'UNKNOWN_SUBMIT'})};
    api[method]=async (opts:any)=>{calls++;key=opts.headers['Idempotency-Key'];return {error:{message:'lost'},response:new Response(null,{status:504})};};
    const h=harness(api);await h.settle();await h.state[handler]();await h.settle();assert.equal(calls,1);assert.equal(h.state.pending.key,key);assert.equal(h.state.pending.kind,kind);if(kind!=='PREPARE')assert.equal(h.state.pending.intent.packageId,'pkg');if(kind!=='UNPACK')assert.equal(h.state.pending.intent.robotId,'r');await h.state[handler]();assert.equal(calls,1);h.tick();await h.settle();assert.equal(h.state.pending.key,key);h.unmount();
  }
});

test('RC4 rejects wrong target or environment snapshot and never sends on an invalid file',async()=>{
  let sends=0;class Xhr { upload:any={};open(){} setRequestHeader(){} send(){sends++;} }
  const wrong=harness({getDeployxLocalCapabilities:(opts:any)=>rc4Caps(opts,{target:{...opts.query,robotId:'different'}}),__xhr:Xhr as unknown as (opts:any)=>any});await wrong.settle();assert.equal(wrong.state.prepControls.uploadPackage,false);wrong.unmount();
  const h=harness({getDeployxLocalCapabilities:rc4Caps,__xhr:Xhr as unknown as (opts:any)=>any});await h.settle();await h.state.handleUploadPackage({name:'demo.exe',size:10,lastModified:1});assert.equal(sends,0);h.render();assert.match(h.state.actionError,/ZIP|TAR/);await h.state.handleUploadPackage({name:'中文.zip',size:10,lastModified:1});h.render();assert.match(h.state.actionError,/英文文件名/);assert.equal(sends,0);h.unmount();
});


test('RC4 shared persistent pointer prevents a second page from posting',async()=>{
  const storage=new Map<string,string>(),gate=deferred();let posts=0;
  const api={getDeployxLocalCapabilities:rc4Caps,validateDeployxStage1:async()=>{posts++;return gate.promise;}};
  const a=harness(api,storage),b=harness(api,storage);await a.settle();await b.settle();const first=a.state.handleValidateStage1();await flush();await b.state.handleValidateStage1();await b.settle();assert.equal(posts,1);assert(b.state.pending);gate.resolve({error:{message:'lost'},response:new Response(null,{status:504})});await first;a.unmount();b.unmount();
});


test('RC4 upload pending leaves deployment logs and safety handlers independent while safety UNKNOWN remains locked',async()=>{
  for(const kind of ['STOP','CANCEL'] as const){
    const d=deployment();let posts=0,logs=0,xhr:any;
    class Xhr {upload:any={};headers:any={};onabort:any;open(){} setRequestHeader(k:string,v:string){this.headers[k]=v;} send(){xhr=this;} abort(){this.onabort?.();}}
    const api:any={getDeployxLocalCapabilities:rc4Caps,__xhr:Xhr,listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),getDeployxDeploymentRobotLogs:async()=>{logs++;return reply({content:'log'});}};
    api[kind==='STOP'?'stopDeployxDeployment':'cancelDeployxDeployment']=async()=>{posts++;return reply({operation:{submitStatus:'UNKNOWN_SUBMIT'}});};
    const h=harness(api);await h.settle();const upload=h.state.handleUploadPackage({name:'demo.zip',size:10,lastModified:1});await flush();await h.settle();assert(h.state.prepLoading);if(kind==='CANCEL'){h.state.handleCancelUpload();await upload;await h.settle();assert(h.state.pending);assert.equal(h.state.prepLoading,false);}assert(h.state.controls.logs);assert(h.state.controls[kind==='STOP'?'stop':'cancel']);await h.state.handleFetchLogs();assert.equal(logs,1);await h.state[kind==='STOP'?'handleStop':'handleCancel']();await h.settle();assert.equal(posts,1);assert(h.state.pending);await h.state[kind==='STOP'?'handleStop':'handleCancel']();assert.equal(posts,1);if(kind==='STOP'){xhr.abort();await upload;}h.unmount();
  }
});


test('RC4 no Web Locks blocks preparation without blocking an authorized STOP',async()=>{
  const d=deployment();let stop=0,prep=0;
  const h=harness({__navigator:()=>({}),getDeployxLocalCapabilities:rc4Caps,listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),prepareDeployxRobot:async()=>{prep++;},stopDeployxDeployment:async()=>{stop++;return reply({operation:{submitStatus:'UNKNOWN_SUBMIT'}});}});
  await h.settle();await h.state.handlePrepareRobot();h.render();assert.equal(prep,0);assert.match(h.state.actionError,/不支持跨标签页/);await h.state.handleStop();assert.equal(stop,1);h.unmount();
});


test('R3 F-S07 blocks actual CREATE, BUILD and DEPLOY during pending and UNKNOWN preparation',async()=>{
  for(const kind of ['CREATE_DEPLOYMENT','BUILD_RELEASE','DEPLOY_TO_ROBOT'] as const){
    const prepare=deferred();let writes=0;
    const d=kind==='DEPLOY_TO_ROBOT'?deployment({steps:{build:{name:'build',status:'SUCCEEDED'}},availableActions:['DEPLOY_TO_ROBOT']}):deployment();
    const decisions={CREATE_DEPLOYMENT:true,BUILD_RELEASE:true,DEPLOY_TO_ROBOT:true,PREPARE:true,STOP:true,CANCEL:true,LOGS:true};
    const api:any={getDeployxLocalCapabilities:(opts:any)=>rc4Caps(opts,{decisions}),prepareDeployxRobot:()=>prepare.promise,createDeployxDeployment:async()=>{writes++;},triggerDeployxDeploymentAction:async()=>{writes++;}};
    if(kind!=='CREATE_DEPLOYMENT'){api.listDeployxDeployments=async()=>reply({items:[d]});api.getDeployxDeploymentDetail=async()=>reply(d);}
    const h=harness(api);await h.settle();const send=kind==='CREATE_DEPLOYMENT'?()=>h.state.handleCreateDeployment():kind==='BUILD_RELEASE'?()=>h.state.handleConfirmBuild():()=>h.state.handleConfirmDeploy();
    const preparing=h.state.handlePrepareRobot();await flush();await h.settle();await send();assert.equal(writes,0);
    prepare.resolve({error:{message:'lost'},response:new Response(null,{status:504})});await preparing;await h.settle();assert.equal(h.state.controls[kind==='CREATE_DEPLOYMENT'?'create':kind==='BUILD_RELEASE'?'build':'deploy'],false);await send();assert.equal(writes,0);h.unmount();
  }
});

test('R3 pointer CAS preserves newer operation against a delayed old observer and blocks a third page',async()=>{
  const storage=new Map<string,string>(),oldRead=deferred();let posts=0,oldKey='',newKey='';let reports:any[]=[];
  const op=(key:string)=>({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'SUBMITTED'});
  const api={getDeployxLocalCapabilities:rc4Caps,getDeployxPackageValidation:async()=>reply({reports}),validateDeployxStage1:async(opts:any)=>{posts++;const key=opts.headers['Idempotency-Key'];if(!oldKey)oldKey=key;else newKey=key;return reply(op(key));},getDeployxPreparationOperation:async(opts:any)=>reply(op(opts.path.operationId))};
  const a=harness(api,storage);await a.settle();await a.state.handleValidateStage1();await a.settle();
  const b=harness({...api,getDeployxPreparationOperation:()=>oldRead.promise},storage);await b.settle();b.tick();await flush();
  reports=[{id:'old-result',stage:'stage1',packageId:'pkg',status:'PASSED'}];a.tick();await a.settle();assert.equal(a.state.pending,null);await a.state.handleValidateStage1();await a.settle();assert.equal(posts,2);const key='deployx-prep:actor:p';assert.equal(JSON.parse(storage.get(key)!).key,newKey);
  oldRead.resolve(reply(op(oldKey)));await b.settle();assert.equal(JSON.parse(storage.get(key)!).key,newKey);assert.equal(b.state.pending.key,newKey);
  const c=harness(api,storage);await c.settle();await c.state.handleValidateStage1();assert.equal(posts,2);assert.equal(c.state.pending.key,newKey);a.unmount();b.unmount();c.unmount();
});

test('R3 PREPARE confirmation binds robot and Project including old callback and ABA',()=>{
  const source=readFileSync(new URL('../components/deploy/steps/StepModelBinding.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  let cursor=0;const cells:any[]=[];const fakeReact={...React,useState(initial:any){const i=cursor++;if(!(i in cells))cells[i]=initial;return [cells[i],(value:any)=>{cells[i]=value;}];},useRef(initial:any){const i=cursor++;if(!(i in cells))cells[i]={current:initial};return cells[i];}};
  const module={exports:{} as {default:(props:any)=>any}};runInNewContext(code,{module,exports:module.exports,require:(name:string)=>name==='react'?fakeReact:name.endsWith('.css')?{}:require(name)});
  let sent:string[]=[];const props:any={projectId:'p1',packageId:'pkg',robots:[],templates:[],selectedRobotId:'A',selectedTemplateId:'t',robotStatus:null,onSelectRobot(){},onSelectTemplate(){},onCreateDeployment(){},canCreate:false,canPrepareRobot:true,onPrepareRobot:(id:string)=>sent.push(id)};
  const buttons=(tree:any)=>{const out:any[]=[];const visit=(n:any)=>{if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(visit);return;}if(n.type==='button')out.push(n);visit(n.props?.children);};visit(tree);return out;};
  const text=(n:any):string=>Array.isArray(n)?n.map(text).join(''):typeof n==='string'?n:n?.props?text(n.props.children):'';
  const render=()=>{cursor=0;return buttons(module.exports.default(props));};
  render().find(b=>text(b).includes('真机预备 (Prepare)')).props.onClick();let confirm=render().find(b=>text(b)==='确认');assert(confirm);
  props.selectedRobotId='B';assert(!render().find(b=>text(b)==='确认'));confirm.props.onClick();assert.deepEqual(sent,[]);
  props.selectedRobotId='A';assert(!render().find(b=>text(b)==='确认'));confirm.props.onClick();assert.deepEqual(sent,[]);
  render().find(b=>text(b).includes('真机预备 (Prepare)')).props.onClick();confirm=render().find(b=>text(b)==='确认');props.projectId='p2';assert(!render().find(b=>text(b)==='确认'));confirm.props.onClick();assert.deepEqual(sent,[]);
  render().find(b=>text(b).includes('真机预备 (Prepare)')).props.onClick();render().find(b=>text(b)==='确认').props.onClick();assert.deepEqual(sent,['A']);
});


test('R3 preparation CAS waits for a busy lock and preserves altered frozen intent',async()=>{
  for(const changed of [false,true]){
    const storage=new Map<string,string>();let busy=false,key='',posts=0;
    const locks={request:async(_name:any,_opts:any,fn:any)=>fn(busy?null:{})};
    const api={__navigator:()=>({locks}),getDeployxLocalCapabilities:rc4Caps,validateDeployxStage1:async(opts:any)=>{posts++;key=opts.headers['Idempotency-Key'];return reply({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'FAILED'});},getDeployxPreparationOperation:async()=>reply({operationId:key,operationType:'VALIDATE_STAGE1',projectId:'p',environmentKey:'test',resourceId:null,observedAt:null,submitStatus:'FAILED'})};
    const h=harness(api,storage);await h.settle();await h.state.handleValidateStage1();await h.settle();const slot='deployx-prep:actor:p';const original=storage.get(slot)!;
    if(changed){const altered=JSON.parse(original);altered.intent.packageId='different';storage.set(slot,JSON.stringify(altered));}
    busy=true;h.tick();await h.settle();assert(storage.has(slot));busy=false;h.tick();await h.settle();
    if(changed){assert.equal(JSON.parse(storage.get(slot)!).intent.packageId,'different');assert.equal(h.state.pending.intent.packageId,'different');}else assert.equal(storage.has(slot),false);
    assert.equal(posts,1);h.unmount();
  }
});


test('R4 upload adopts only after locked CAS for package and model under asynchronous grant and busy retry',async()=>{
  for(const kind of ['UPLOAD_PACKAGE','UPLOAD_MODEL'] as const) for(const scheduling of ['delayed','busy'] as const){
    const storage=new Map<string,string>();let xhr:any,key='',uploaded=false,reads=0,lockCalls=0,release:undefined|(()=>void);
    const locks={request:async(_name:any,_opts:any,callback:any)=>{lockCalls++;if(lockCalls===2&&scheduling==='delayed')return new Promise(resolve=>{release=()=>resolve(callback({}));});if(lockCalls===2&&scheduling==='busy')return callback(null);return callback({});}};
    const op=()=>({operationId:key,projectId:'p',environmentKey:'test',operationType:kind,submitStatus:'SUBMITTED',resourceId:'new-resource',observedAt:null});
    class Xhr {upload:any={};headers:any={};status=202;responseText='';onload:any;open(){}setRequestHeader(k:string,v:string){this.headers[k]=v;}send(){xhr=this;key=this.headers['Idempotency-Key'];uploaded=true;this.responseText=JSON.stringify(op());this.onload();}}
    const res=()=>{const r=resources();if(uploaded){if(kind==='UPLOAD_PACKAGE')r.packages.push({...r.packages[0],id:'new-resource'});else r.modelAssets.push({id:'new-resource',displayName:'model',sha256:null,authorizationSource:'CONTROLLED_MAPPING',observedAt:null});}return r;};
    const h=harness({__navigator:()=>({locks}),__xhr:Xhr as unknown as (opts:any)=>any,getDeployxLocalCapabilities:rc4Caps,listDeployxProjectResources:async()=>reply(res()),getDeployxPreparationOperation:async()=>{reads++;return reply(op());}},storage);
    await h.settle();await h.state[kind==='UPLOAD_PACKAGE'?'handleUploadPackage':'handleUploadModelAsset']({name:kind==='UPLOAD_PACKAGE'?'new.zip':'new.tar',size:20,lastModified:1});await h.settle();assert(xhr);const initial=kind==='UPLOAD_PACKAGE'?'pkg':null;
    h.tick();await h.settle();assert.equal(kind==='UPLOAD_PACKAGE'?h.state.selectedPackageId:h.state.selectedModelAssetId,initial);assert.equal(h.state.pending.key,key);assert.equal(h.state.controls.create,false);
    if(scheduling==='delayed'){assert(release);release();await h.settle();}else {h.tick();await h.settle();assert(reads>=2);}
    assert.equal(h.state.pending,null);assert(!storage.has('deployx-prep:actor:p'));assert.equal(kind==='UPLOAD_PACKAGE'?h.state.selectedPackageId:h.state.selectedModelAssetId,'new-resource');assert.equal(h.state.controls.create,true);h.unmount();
  }
});

test('R4 stale upload observer cannot adopt or erase a newer page operation for package and model',async()=>{
  for(const kind of ['UPLOAD_PACKAGE','UPLOAD_MODEL'] as const){
    const storage=new Map<string,string>();let key='',newKey='',uploaded=false,lockCalls=0,release:undefined|(()=>void);
    const locks={request:async(_name:any,_opts:any,callback:any)=>{lockCalls++;if(lockCalls===2)return new Promise(resolve=>{release=()=>resolve(callback({}));});return callback({});}};
    const op=(id:string)=>({operationId:id,projectId:'p',environmentKey:'test',operationType:kind,submitStatus:'SUBMITTED',resourceId:'new-resource',observedAt:null});
    class Xhr {upload:any={};headers:any={};status=202;responseText='';onload:any;open(){}setRequestHeader(k:string,v:string){this.headers[k]=v;}send(){key=this.headers['Idempotency-Key'];uploaded=true;this.responseText=JSON.stringify(op(key));this.onload();}}
    const res=()=>{const r=resources();if(uploaded){if(kind==='UPLOAD_PACKAGE')r.packages.push({...r.packages[0],id:'new-resource'});else r.modelAssets.push({id:'new-resource',displayName:'model',sha256:null,authorizationSource:'CONTROLLED_MAPPING',observedAt:null});}return r;};
    const api={__navigator:()=>({locks}),__xhr:Xhr as unknown as (opts:any)=>any,getDeployxLocalCapabilities:rc4Caps,listDeployxProjectResources:async()=>reply(res()),getDeployxPreparationOperation:async(opts:any)=>reply(op(opts.path.operationId)),prepareDeployxRobot:async(opts:any)=>{newKey=opts.headers['Idempotency-Key'];return {error:{message:'lost'},response:new Response(null,{status:504})};}};
    const a=harness(api,storage);await a.settle();await a.state[kind==='UPLOAD_PACKAGE'?'handleUploadPackage':'handleUploadModelAsset']({name:kind==='UPLOAD_PACKAGE'?'new.zip':'new.tar',size:20,lastModified:1});await a.settle();
    const b=harness(api,storage);await b.settle();a.tick();await a.settle();assert(release);b.tick();await b.settle();assert.equal(b.state.pending,null);await b.state.handlePrepareRobot();await b.settle();assert(newKey);assert.equal(JSON.parse(storage.get('deployx-prep:actor:p')!).key,newKey);
    release();await a.settle();assert.equal(JSON.parse(storage.get('deployx-prep:actor:p')!).key,newKey);assert.equal(a.state.pending.key,newKey);assert.equal(kind==='UPLOAD_PACKAGE'?a.state.selectedPackageId:a.state.selectedModelAssetId,kind==='UPLOAD_PACKAGE'?'pkg':null);assert(!a.state.resources.packages.some((x:any)=>x.id==='new-resource'));assert(!a.state.resources.modelAssets.some((x:any)=>x.id==='new-resource'));a.unmount();b.unmount();
  }
});

test('R4 delayed upload cleanup does not adopt into a changed Project',async()=>{
  for(const kind of ['UPLOAD_PACKAGE','UPLOAD_MODEL'] as const){
    const storage=new Map<string,string>();let key='',uploaded=false,lockCalls=0,release:undefined|(()=>void);
    const locks={request:async(_name:any,_opts:any,callback:any)=>{lockCalls++;if(lockCalls===2)return new Promise(resolve=>{release=()=>resolve(callback({}));});return callback({});}};
    const op=()=>({operationId:key,projectId:'p',environmentKey:'test',operationType:kind,submitStatus:'SUBMITTED',resourceId:'new-resource',observedAt:null});
    class Xhr {upload:any={};headers:any={};status=202;responseText='';onload:any;open(){}setRequestHeader(k:string,v:string){this.headers[k]=v;}send(){key=this.headers['Idempotency-Key'];uploaded=true;this.responseText=JSON.stringify(op());this.onload();}}
    const h=harness({__navigator:()=>({locks}),__xhr:Xhr as unknown as (opts:any)=>any,getDeployxLocalCapabilities:rc4Caps,listDeployxProjectResources:async(opts:any)=>{const r=resources();if(uploaded&&opts.path.projectId==='p'){if(kind==='UPLOAD_PACKAGE')r.packages.push({...r.packages[0],id:'new-resource'});else r.modelAssets.push({id:'new-resource',displayName:'model',sha256:null,authorizationSource:'CONTROLLED_MAPPING',observedAt:null});}return reply(r);},getDeployxPreparationOperation:async()=>reply(op())},storage);
    await h.settle();await h.state[kind==='UPLOAD_PACKAGE'?'handleUploadPackage':'handleUploadModelAsset']({name:kind==='UPLOAD_PACKAGE'?'new.zip':'new.tar',size:20,lastModified:1});await h.settle();h.tick();await h.settle();assert(release);h.change({projectId:'other'});await h.settle();release();await h.settle();assert(storage.has('deployx-prep:actor:p'));assert.equal(kind==='UPLOAD_PACKAGE'?h.state.selectedPackageId:h.state.selectedModelAssetId,kind==='UPLOAD_PACKAGE'?'pkg':null);assert(!h.state.resources.packages.some((x:any)=>x.id==='new-resource'));assert(!h.state.resources.modelAssets.some((x:any)=>x.id==='new-resource'));h.unmount();
  }
});


// Execute the real Workspace and step components against the actual hook harness.
function workspaceButtons(h: ReturnType<typeof harness>, step: number) {
  const code=ts.transpileModule(readFileSync(new URL('../components/deploy/DeployWorkspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const fakeReact={...React,useState:()=>[step,()=>{}]};
  const module={exports:{} as {default:(props:any)=>any}};
  runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{
    if(name==='react')return fakeReact;
    if(name.endsWith('.css'))return new Proxy({},{get:(_t,p)=>p==='__esModule'?false:String(p)});
    if(name.endsWith('auth-context'))return {useAuth:()=>({status:'authenticated',user:{id:'actor'}})};
    if(name.endsWith('useDeployxState'))return {useDeployxState:()=>h.state};
    if(name.endsWith('deployx-state'))return rules;
    if(name.endsWith('StepReleaseBuild'))return {__esModule:true,default:loadComponent('steps/StepReleaseBuild.tsx')};
    if(name.endsWith('StepExecutionDeploy'))return {__esModule:true,default:loadComponent('steps/StepExecutionDeploy.tsx')};
    return {__esModule:true,default:()=>null};
  }});
  const buttons:any[]=[];const visit=(node:any)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(typeof node.type==='function'){visit(node.type(node.props));return;}if(node.type==='button')buttons.push(node);visit(node.props?.children);};
  visit(module.exports.default({projectId:'p'}));
  const label=(node:any):string=>Array.isArray(node)?node.map(label).join(''):typeof node==='string'||typeof node==='number'?String(node):node?.props?label(node.props.children):'';
  return {find:(value:string)=>buttons.find(b=>label(b)===value),buttons};
}
const displayCaps = async (opts:any, decisions:any) => rc4Caps(opts,{decisions});

test('R5 Workspace displays target-authorized BUILD and DEPLOY with one actual handler call despite legacy false',async()=>{
  for(const action of ['BUILD_RELEASE','DEPLOY_TO_ROBOT'] as const){
    let calls=0;const d=action==='BUILD_RELEASE'?deployment():deployment({steps:{build:{name:'build',status:'SUCCEEDED'}},availableActions:['DEPLOY_TO_ROBOT']});
    const legacy=resources();legacy.capabilities={...legacy.capabilities,canBuildRelease:false,canDeployToRobot:false,canStop:false};
    const h=harness({listDeployxProjectResources:async()=>reply(legacy),listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),getDeployxLocalCapabilities:opts=>displayCaps(opts,{BUILD_RELEASE:true,DEPLOY_TO_ROBOT:true,STOP:true}),triggerDeployxDeploymentAction:async opts=>{calls++;assert.equal(opts.body.action,action);return {error:{error:{code:'FORBIDDEN',message:'blocked by test'}},response:new Response(null,{status:403})};}});
    await h.settle();const label=action==='BUILD_RELEASE'?'人工确认：开始构建 Release':'人工确认：下发至机器人真机';const btn=workspaceButtons(h,action==='BUILD_RELEASE'?4:5).find(label);assert(btn);assert.equal(btn.props.disabled,false);await btn.props.onClick();assert.equal(calls,1);h.unmount();
  }
});

test('R5 Workspace exposes terminal authorized STOP and accurate CANCEL and RECOVER labels',async()=>{
  for(const kind of ['STOP','CANCEL','RECOVER'] as const){
    let calls=0;const d=deployment({status:kind==='STOP'?'SUCCEEDED':kind==='RECOVER'?'SAFETY_BLOCKED':'RUNNING'});const legacy=resources();legacy.capabilities={...legacy.capabilities,canStop:false,canCancel:false,canRecover:false};
    const api:any={listDeployxProjectResources:async()=>reply(legacy),listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),getDeployxLocalCapabilities:(opts:any)=>displayCaps(opts,{STOP:true,CANCEL:true,RECOVER:true})};
    api[kind==='STOP'?'stopDeployxDeployment':kind==='CANCEL'?'cancelDeployxDeployment':'recoverDeployxDeployment']=async()=>{calls++;return {error:{error:{code:'FORBIDDEN',message:'blocked by test'}},response:new Response(null,{status:403})};};
    const h=harness(api);await h.settle();const btn=workspaceButtons(h,0).find(kind==='STOP'?'安全停止':kind==='CANCEL'?'取消部署':'受控恢复');assert(btn);assert.equal(btn.props.disabled,false);await btn.props.onClick();assert.equal(calls,1);h.unmount();
  }
});

test('R5 Workspace fails closed on false or missing local decisions even when legacy is true',async()=>{
  for(const mode of ['false','missing'] as const) for(const action of ['BUILD','DEPLOY','STOP','CANCEL','RECOVER'] as const){
    let calls=0;const d=action==='DEPLOY'?deployment({steps:{build:{name:'build',status:'SUCCEEDED'}},availableActions:['DEPLOY_TO_ROBOT']}):deployment({status:action==='RECOVER'?'SAFETY_BLOCKED':'RUNNING'});
    const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),getDeployxLocalCapabilities:async opts=>mode==='false'?displayCaps(opts,{BUILD_RELEASE:false,DEPLOY_TO_ROBOT:false,STOP:false,CANCEL:false,RECOVER:false}):{error:{message:'offline'}},triggerDeployxDeploymentAction:async()=>{calls++;},stopDeployxDeployment:async()=>{calls++;},cancelDeployxDeployment:async()=>{calls++;},recoverDeployxDeployment:async()=>{calls++;}});
    await h.settle();const key=action==='BUILD'?'handleConfirmBuild':action==='DEPLOY'?'handleConfirmDeploy':action==='STOP'?'handleStop':action==='CANCEL'?'handleCancel':'handleRecover';
    const view=workspaceButtons(h,action==='BUILD'?4:action==='DEPLOY'?5:0);const btn=view.buttons.find((b:any)=>b.props.onClick===h.state[key]);assert(btn);assert.equal(btn.props.disabled,true);assert.equal(btn.props.children,'未开放');await btn.props.onClick();assert.equal(calls,0);h.unmount();
  }
});

test('R5 busy or UNKNOWN preparation keeps authorized BUILD disabled and the actual handler cannot submit',async()=>{
  const d=deployment(),gate=deferred();let calls=0;const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),getDeployxLocalCapabilities:opts=>displayCaps(opts,{BUILD_RELEASE:true,PREPARE:true}),prepareDeployxRobot:()=>gate.promise,triggerDeployxDeploymentAction:async()=>{calls++;}});
  await h.settle();const running=h.state.handlePrepareRobot();await flush();await h.settle();let btn=workspaceButtons(h,4).find('人工确认：开始构建 Release');assert(btn);assert.equal(btn.props.disabled,true);await btn.props.onClick();assert.equal(calls,0);
  gate.resolve({error:{message:'unknown'},response:new Response(null,{status:504})});await running;await h.settle();btn=workspaceButtons(h,4).find('人工确认：开始构建 Release');assert(btn);assert.equal(btn.props.disabled,true);await btn.props.onClick();assert.equal(calls,0);h.unmount();
});

test('R5 account and target changes hide stale capability labels immediately',async()=>{
  const gate=deferred();const d=deployment();const h=harness({listDeployxDeployments:async()=>reply({items:[d]}),getDeployxDeploymentDetail:async()=>reply(d),getDeployxLocalCapabilities:opts=>opts.query.robotId==='other'?gate.promise:displayCaps(opts,{STOP:true,BUILD_RELEASE:true})});
  await h.settle();assert(workspaceButtons(h,0).find('安全停止'));h.state.setSelectedRobotId('other');h.render();const denied=workspaceButtons(h,0);assert(!denied.find('安全停止'));assert(denied.buttons.some((b:any)=>b.props.children==='未开放'&&b.props.disabled));
  h.change({projectId:'p',accountId:'other'});const afterAccount=workspaceButtons(h,0);assert(!afterAccount.find('安全停止'));h.unmount();
});
