import assert from 'node:assert/strict';
import { describe,test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { EmbodexConversationSession,initialConversationState } from '../lib/embodex/conversation';
import { MarkdownContent } from '../components/embodex/headless-chat/message-list';
import type { HeadlessChatContextType } from '../components/embodex/headless-chat';

const user='00000000-0000-4000-8000-000000000002',project='00000000-0000-4000-8000-000000000001';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const find=(node:unknown,predicate:(node:React.ReactElement<Record<string,unknown>>)=>boolean):React.ReactElement<Record<string,unknown>>|null=>{
  if(!React.isValidElement(node))return null;const element=node as React.ReactElement<Record<string,unknown>>;if(predicate(element))return element;
  for(const child of React.Children.toArray(element.props.children as React.ReactNode)){const result=find(child,predicate);if(result)return result;}return null;
};
const button=(node:unknown,label:string)=>{const result=find(node,e=>e.type==='button'&&e.props['aria-label']===label);assert(result,label);return result;};
function load(name:string,imports:Record<string,unknown>,hooks:Record<string,unknown>={}){
  const source=readFileSync(new URL('../components/embodex/'+name,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const module={exports:{} as Record<string,(props:Record<string,unknown>)=>React.ReactNode>};
  runInNewContext(compiled,{module,exports:module.exports,crypto,require:(name:string)=>{if(name==='react')return {__esModule:true,default:React,...React,...hooks};assert(name in imports,name);return imports[name];}});
  return module.exports;
}
function inputHarness(context:Partial<HeadlessChatContextType>,initial='  修改需求  '){
  let draft=initial;const textarea={style:{height:'auto'},scrollHeight:80};let refs=0;
  const base={isLoading:false,canSend:true,uploadedImages:[],setUploadedImages:()=>{},isDockVisible:false,setIsDockVisible:()=>{},navigate:()=>{},stopGeneration:()=>{},...context};
  const Input=load('headless-chat/chat-input.tsx',{'./index':{useHeadlessChat:()=>base}},{useState:()=>[draft,(value:string|((old:string)=>string))=>{draft=typeof value==='function'?value(draft):value;}],useRef:()=>({current:refs++===0?null:textarea})}).ChatInput;
  return {tree:Input({}),draft:()=>draft,setDraft:(value:string)=>{draft=value;},textarea};
}
const doneResponse=(options:RequestInit)=>{const body=JSON.parse(options.body as string);return new Response('data: '+JSON.stringify({type:'RUN_FINISHED',threadId:body.threadId,runId:body.runId})+'\n\n',{headers:{'content-type':'text/event-stream'}});};

describe('original Embodex presentation with platform-only adapters (offline)',()=>{
  test('actual original ChatInput plus actual Session: both local caps keep draft/history; acceptance clears and renders user message',async()=>{
    for(const cap of ['bytes','messages','accepted']){
      let posts=0;const session=new EmbodexConversationSession(user,project,()=>{},(async(_url,options)=>{posts++;return doneResponse(options!);}) as typeof fetch);
      if(cap==='bytes')session.state.messages=[{id:'large',role:'assistant',content:'x'.repeat(66000)}];
      if(cap==='messages')session.state.messages=Array.from({length:200},(_,index)=>({id:String(index),role:'user',content:'原需求'}));
      const old=session.state.messages;const harness=inputHarness({sendMessage:(message,onAccepted)=>{void session.send(message.content,onAccepted);}});
      (button(harness.tree,'Send message').props.onClick as ()=>void)();
      if(cap==='accepted'){assert.equal(harness.draft(),'');assert.equal(session.state.messages[0].content,'修改需求');}
      else{assert.equal(harness.draft(),'  修改需求  ');assert.equal(posts,0);assert.equal(session.state.messages,old);}
      await flush();assert.equal(posts,cap==='accepted'?1:0);session.dispose();
    }
  });
  test('original local draft cannot be cleared by delayed acceptance after newer input; Enter/ShiftEnter/autoresize retained',()=>{
    let accept:(()=>void)|undefined,calls=0;
    const h=inputHarness({sendMessage:(_message,onAccepted)=>{calls++;accept=onAccepted;}});
    const textarea=find(h.tree,e=>e.type==='textarea')!;
    const key=textarea.props.onKeyDown as (event:{key:string;shiftKey:boolean;preventDefault:()=>void})=>void;
    key({key:'Enter',shiftKey:true,preventDefault:()=>{throw new Error('ShiftEnter keeps newline');}});assert.equal(calls,0);
    key({key:'Enter',shiftKey:false,preventDefault:()=>{}});assert.equal(calls,1);
    h.setDraft('后来新输入');accept?.();assert.equal(h.draft(),'后来新输入');
    (textarea.props.onChange as (e:{target:{value:string}})=>void)({target:{value:'输入'}});assert.equal(h.draft(),'输入');assert.equal(h.textarea.style.height,'80px');
  });
  test('auth/busy/length guards, Stop button, ∞ existing views and no baseline or fake scripts',()=>{
    for(const changed of [{canSend:false},{isLoading:true}]){
      const h=inputHarness({...changed,sendMessage:()=>{throw new Error('must not send');}});
      if(changed.isLoading){assert(button(h.tree,'Stop generation'));}
      else{assert.equal(button(h.tree,'Send message').props.disabled,true);(button(h.tree,'Send message').props.onClick as ()=>void)();}
    }
    const long=inputHarness({sendMessage:()=>{}},'a'.repeat(16001));assert.equal(button(long.tree,'Send message').props.disabled,true);
    let stopped=0,toggled=false;const stop=inputHarness({isLoading:true,stopGeneration:()=>{stopped++;}});(button(stop.tree,'Stop generation').props.onClick as ()=>void)();assert.equal(stopped,1);
    const dock=inputHarness({setIsDockVisible:value=>{toggled=value;}});(button(dock.tree,'Toggle app dock').props.onClick as ()=>void)();assert.equal(toggled,true);
    let view='';const menu=inputHarness({isDockVisible:true,navigate:value=>{view=value;}});
    const ue=find(menu.tree,e=>e.type==='button'&&e.props.children==='UE 交互')!;(ue.props.onClick as ()=>void)();assert.equal(view,'ue');
    const source=readFileSync(new URL('../components/embodex/headless-chat/index.tsx',import.meta.url),'utf8');assert(!source.includes('current.submit'));assert(!source.includes('/api/chat/history'));assert(!source.includes('useCopilotChatHeadless_c'));
  });
  test('actual wrapper remount key isolates draft/context immediately across user/logout/project switches',()=>{
    let uid=user,pid=project;
    const Wrapper=load('EmbodexBaselineBuildPanel.tsx',{'../../lib/auth-context':{useAuth:()=>({status:uid?'authenticated':'unauthenticated',user:uid?{id:uid}:null})},'./headless-chat':{__esModule:true,default:()=>null}}).default;
    const keys:string[]=[];
    for(const next of [[user,project],['other-user',project],['',project],[user,'other-project']]){
      [uid,pid]=next;const tree=Wrapper({projectId:pid});const panel=find(tree,e=>e.props.userId!==undefined)!;assert(panel);assert.equal(panel.props.userId,uid);assert.equal(panel.props.projectId,pid);keys.push(String(panel.key));
    }
    assert.equal(new Set(keys).size,4);
  });
  test('safe Markdown preserves GFM table/code while raw HTML, URLs and images cannot execute or navigate',()=>{
    const content='**Bold**\n\n| A | B |\n|---|---|\n| one | two |\n\n```js\n<script>not executed</script>\n```\n\n<img src="x" onerror="alert(1)">\n\n[link](javascript:alert(1)) ![image](https://example.test/private)';
    const html=renderToStaticMarkup(React.createElement(MarkdownContent,{content}));
    assert(html.includes('<strong>Bold</strong>'));assert(html.includes('<table>'));assert(html.includes('<pre>'));assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(!html.includes('<a '));assert(!html.includes('src='));assert(!html.includes('href='));
  });

  test('actual MessageList scrolls only its outer message viewport, without scrolling page or parts/UE ancestors',()=>{
    let target:unknown;let top=0,behavior='';let effect:(()=>void)|undefined;
    const viewport={scrollHeight:321,scrollTo:function(this:unknown,options:{top:number;behavior:string}){target=this;top=options.top;behavior=options.behavior;},scrollIntoView:()=>{throw new Error('must not scroll ancestors');}};
    const ref={current:viewport};
    const List=load('headless-chat/message-list.tsx',{'./index':{useHeadlessChat:()=>({messages:[{id:'u',role:'user',content:'内容'}],isLoading:false})},'react-markdown':{__esModule:true,default:()=>null},'remark-gfm':{__esModule:true,default:()=>null}},
      {useRef:()=>ref,useEffect:(callback:()=>void)=>{effect=callback;}}).MessageList;
    const tree=List({welcomeMessage:'Welcome'});const outer=find(tree,e=>e.props.className==='flex-1 min-h-0 px-4 py-2 chat-message-scroll')!;
    assert(outer);assert.equal(outer.props.ref,ref);effect?.();assert.equal(target,viewport);assert.equal(top,321);assert.equal(behavior,'smooth');
  });
  test('actual Header Clear/minimize/expand/close controls remain functional',async()=>{
    let minimized=false,open=true,clears=0;
    const context={isMinimized:false,setIsMinimized:(value:boolean)=>{minimized=value;},setIsOpen:(value:boolean)=>{open=value;},clearHistory:async()=>{clears++;}};
    const Header=load('headless-chat/chat-header.tsx',{'./index':{useHeadlessChat:()=>context}},{useState:()=>[false,()=>{}]}).ChatHeader;
    let tree=Header({});await (button(tree,'Clear chat history').props.onClick as ()=>Promise<void>)();assert.equal(clears,1);
    (button(tree,'Minimize chat').props.onClick as ()=>void)();assert(minimized);(button(tree,'Close chat').props.onClick as ()=>void)();assert.equal(open,false);
    context.isMinimized=true;tree=Header({});(button(tree,'Expand chat').props.onClick as ()=>void)();assert.equal(minimized,false);
  });
  test('actual platform context displays accepted message; Clear owns a fresh thread and cleanup disposes the replacement',async()=>{
    let receivedImports=0;const values:unknown[]=[];let position=0,refPosition=0;const callbackRef={current:undefined};const effects:(()=>void|(()=>void))[]=[];const ref={current:null as EmbodexConversationSession|null};
    const mocked={__esModule:true,default:()=>null};
    const refsMap: Record<number, { current: unknown }> = { 0: callbackRef, 1: ref };
    const Panel=load('headless-chat/index.tsx',{'../../../lib/embodex/conversation':{EmbodexConversationSession,initialConversationState},'./chat-header':{ChatHeader:()=>null},'./chat-input':{ChatInput:()=>null},'./message-list':{MessageList:()=>null},'./floating-panel':{FloatingChatPanel:mocked.default}},
      {useState:(initial:unknown)=>{const index=position++;if(!(index in values))values[index]=typeof initial==='function'?(initial as ()=>unknown)():initial;return[values[index],(value:unknown)=>{values[index]=typeof value==='function'?(value as (old:unknown)=>unknown)(values[index]):value;}];},useRef:(initial:unknown)=>{const pos=refPosition++;if(!refsMap[pos])refsMap[pos]={current:initial};return refsMap[pos];},useEffect:(effect:()=>void|(()=>void))=>{effects.push(effect);}}).default;
    const context=()=>{position=0;refPosition=0;const tree=Panel({userId:user,projectId:project,onModelImport:()=>{receivedImports++;}}) as React.ReactElement<{children:React.ReactElement<{value:HeadlessChatContextType}>}>;return tree.props.children.props.value;};
    context();const cleanup=effects[0]() as ()=>void;const first=ref.current!;const originalFetch=globalThis.fetch;let posts=0;
    globalThis.fetch=(async(_url,options)=>{posts++;const body=JSON.parse(options!.body as string);const events=[{type:'RUN_STARTED',threadId:body.threadId,runId:body.runId},{type:'CUSTOM',name:'EMBODIX_MODEL_IMPORT',value:{status:'TASK_CREATED',projectId:project,threadId:body.threadId,runId:body.runId,receiptId:user,validationId:user,taskId:user}},{type:'RUN_FINISHED',threadId:body.threadId,runId:body.runId}];return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});}) as typeof fetch;
    // Session captures transport at creation: use Clear to create the new one under fake fetch.
    try{await context().clearHistory();const next=ref.current!;assert.notEqual(next.threadId,first.threadId);let accepted=0;context().sendMessage({id:'intent',role:'user',content:'真实接线'},()=>{accepted++;});assert.equal(accepted,1);assert.equal(context().messages[0].content,'真实接线');await flush();assert.equal(posts,1);assert.equal(receivedImports,1);cleanup();assert.equal(ref.current,null);assert.equal(await next.send('不得再发'),false);}
    finally{globalThis.fetch=originalFetch;ref.current?.dispose();}
  });
  test('Stop aborts only owned transport, keeps partial transcript and allows explicit next turn',async()=>{
    let signal:AbortSignal|undefined;let push!:ReadableStreamDefaultController<Uint8Array>;let calls=0;
    const session=new EmbodexConversationSession(user,project,()=>{},(async(_url,options)=>{if(++calls>1)return doneResponse(options!);signal=options?.signal as AbortSignal;return new Response(new ReadableStream({start(c){push=c;}}),{headers:{'content-type':'text/event-stream'}});}) as typeof fetch);
    const pending=session.send('需求');await flush();push.enqueue(new TextEncoder().encode('data: {"type":"TEXT_MESSAGE_CHUNK","messageId":"a","delta":"部分"}\n\n'));await flush();session.stop();await pending;
    assert.equal(signal?.aborted,true);assert.equal(session.state.outcome,'unconfirmed');assert.equal(session.state.messages[1].content,'部分');assert(!session.state.notice?.includes('已取消CAD'));assert.equal(calls,1);assert.equal(await session.send('显式下一轮'),true);assert.equal(calls,2);session.dispose();
  });
  test('existing build capability is outside chat, read-only and reachable through page native dialog',()=>{
    const page=readFileSync(new URL('../components/embodex/EmbodexSchemeDesignPage.tsx',import.meta.url),'utf8');assert(page.includes('navigate={setActiveView}'));assert(page.includes('已有构建与模型包'));assert(page.includes('showModal()'));assert(page.includes('<ExistingBuildArtifacts'));assert(!page.includes('setChatLog'));assert(!page.includes('handleSendAgentMessage'));
    const build=readFileSync(new URL('../components/embodex/ExistingBuildArtifacts.tsx',import.meta.url),'utf8');assert(build.includes('current.download()'));assert(build.includes('readDesignRecovery'));assert(build.includes('current.resume(taskId)'));assert(build.includes('current.loadRecent()'));assert(!build.includes('.submit('));assert(!build.includes('newIntent('));
    const source=readFileSync(new URL('../components/embodex/headless-chat/index.tsx',import.meta.url),'utf8');assert(!source.includes('ExistingBuild'));assert(!source.includes('RobotSpec'));
  });
});

