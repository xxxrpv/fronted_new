import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';

// Drive the production component handlers with controlled hooks/API timing.
// Native dialog focus behavior is verified separately in the browser integration gate.
const project={id:'11111111-2222-4333-8444-555555555555',name:'Original',description:'Existing',projectType:'EMBODIED_AI',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
function find(node:any, predicate:(value:any)=>boolean):any {
  if(!node||typeof node!=='object')return null;if(predicate(node))return node;
  for(const child of [node.props?.children].flat(Infinity)){const match=find(child,predicate);if(match)return match;}return null;
}
function harness(file:string, apis:any, clipboard?:any) {
  const states:any[]=[],refs:any[]=[],effectStates:any[]=[],pending:any[]=[],timers=new Map<number,()=>unknown>();
  let si=0,ri=0,ei=0,id=0,tree:any;
  const doc:any={body:{},activeElement:null,addEventListener(){},removeEventListener(){}};
  const same=(a:any[],b:any[])=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks={...React,
    useState(initial:any){const i=si++;if(!(i in states))states[i]=initial;return[states[i],(value:any)=>states[i]=typeof value==='function'?value(states[i]):value];},
    useRef(initial:any){const i=ri++;return refs[i]??(refs[i]={current:initial});},
    useEffect(fn:()=>any,deps:any[]){const i=ei++;if(!effectStates[i]||!same(effectStates[i].deps,deps))pending.push(()=>{effectStates[i]?.cleanup?.();effectStates[i]={deps,cleanup:fn()};});}
  };
  const code=ts.transpileModule(readFileSync(resolve(fileURLToPath(new URL('../components/projects/',import.meta.url)),file),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const mod:any={exports:{}};
  runInNewContext(code,{module:mod,exports:mod.exports,console,document:doc,navigator:{clipboard},
    window:{innerWidth:1000,innerHeight:800,addEventListener(){},removeEventListener(){}},
    setTimeout(fn:()=>unknown){const key=++id;timers.set(key,fn);return key;},clearTimeout(key:number){timers.delete(key);},
    require(name:string){if(name==='react')return{...hooks,__esModule:true,default:React};if(name==='react-dom')return{createPortal:(child:any)=>child};if(name==='./ProjectDialog')return{ProjectDialog:()=>null};if(name.endsWith('/sdk.gen')||name.endsWith('/client'))return apis;throw Error(name);}
  });
  function attach(node:any){
    if(!node||typeof node!=='object')return;
    if(node.props?.ref)node.props.ref.current={isConnected:true,focus(){doc.activeElement=node;},getBoundingClientRect(){return{right:500,bottom:100,top:70};},contains(){return false;},querySelector(){return{focus(){}};}};
    for(const child of [node.props?.children].flat(Infinity))attach(child);
  }
  return{states,render(props:any){si=ri=ei=0;tree=mod.exports[file.replace('.tsx','')](props);attach(tree);while(pending.length)pending.shift()();return tree;},fireTimers(){for(const [key,fn] of [...timers]){timers.delete(key);void fn();}}};
}
const event={preventDefault(){},stopPropagation(){}};
test('production DELETE uses actual HTTP status: 404 removes; 409 preserves; 204 succeeds',async()=>{
 for(const status of [404,409,204]){
  let removed=0;const h=harness('DeleteProjectModal.tsx',{deleteProject:async()=>status===204?{response:new Response(null,{status})}:{error:{error:{code:status===404?'NOT_FOUND':'PROJECT_HAS_ACTIVE_OPERATIONS'}},response:new Response(null,{status})}});
  const props={project,isOpen:true,onClose(){},onSuccess(id:string){assert.equal(id,project.id);removed++;}};
  h.render(props);const tree=h.render(props);await find(tree,(n:any)=>n.type==='button'&&n.props.children==='确认删除').props.onClick();
  assert.equal(removed,status===409?0:1);if(status===409)assert.match(h.states[1],/进行中/);
 }
});
test('production duplicate response is invalidated on input change back to original',async()=>{
 let resolveCheck!:(value:any)=>void;const pending=new Promise(r=>resolveCheck=r);
 const h=harness('EditProjectModal.tsx',{checkProjectName:()=>pending,updateProject:async()=>({data:project})});
 const props={project,isOpen:true,onClose(){},onSuccess(){}};h.render(props);let tree=h.render(props);
 find(tree,(n:any)=>n.type==='input'&&n.props.onChange).props.onChange({target:{value:'Taken'}});h.render(props);h.fireTimers();
 tree=h.render(props);find(tree,(n:any)=>n.type==='input'&&n.props.onChange).props.onChange({target:{value:project.name}});h.render(props);
 resolveCheck({data:{exists:true,available:false}});await new Promise(setImmediate);tree=h.render(props);
 assert.equal(h.states[0],project.name);assert.equal(h.states[2],null);assert.equal(find(tree,(n:any)=>n.type==='button'&&n.props.type==='submit').props.disabled,false);
});
test('production PATCH 409 retains input, raw Unicode limits stop invalid requests',async()=>{
 let calls=0;const h=harness('EditProjectModal.tsx',{updateProject:async()=>{calls++;return{error:{error:{code:'PROJECT_NAME_EXISTS'}},response:new Response(null,{status:409})};},checkProjectName:async()=>({data:{available:true}})});
 const props={project,isOpen:true,onClose(){},onSuccess(){throw Error('should not succeed');}};h.render(props);let tree=h.render(props);
 await find(tree,(n:any)=>n.type==='form').props.onSubmit(event);assert.equal(calls,1);assert.equal(h.states[0],project.name);assert.match(h.states[4],/占用/);
 tree=h.render(props);find(tree,(n:any)=>n.type==='input'&&n.props.onChange).props.onChange({target:{value:'😀'.repeat(201)}});tree=h.render(props);
 await find(tree,(n:any)=>n.type==='form').props.onSubmit(event);assert.equal(calls,1);
});
test('production clipboard copies the UUID, reports rejection, and calls no API',async()=>{
 for(const reject of [false,true]){
  const copied:string[]=[],toasts:string[]=[];const h=harness('ProjectActionMenu.tsx',{}, {writeText:async(value:string)=>{copied.push(value);if(reject)throw Error('denied');}});
  const props={project,onEdit(){},onDelete(){},onToast(value:string){toasts.push(value);}};
  let tree=h.render(props);find(tree,(n:any)=>n.type==='button'&&n.props['aria-haspopup']==='menu').props.onClick(event);tree=h.render(props);
  const copy=find(tree,(n:any)=>n.type==='button'&&find(n,(c:any)=>c.type==='span'&&c.props.children==='复制项目ID'));
  await copy.props.onClick(event);assert.deepEqual(copied,[project.id]);assert.equal(toasts.length,1);assert.match(toasts[0],reject?/失败/:/已复制/);
 }
});
