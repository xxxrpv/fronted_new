import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { EmbodexConversationSession } from '../lib/embodex/conversation';

const project='00000000-0000-4000-8000-000000000001';
const user='00000000-0000-4000-8000-000000000002';
const frame=(event:unknown)=>'data: '+JSON.stringify(event)+'\r\n\r\n';
const response=(events:unknown[],split=3)=>{
  const bytes=new TextEncoder().encode(events.map(frame).join(''));
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=split)c.enqueue(bytes.slice(i,i+split));c.close();}}),{headers:{'content-type':'text/event-stream'}});
};
type Body={threadId:string;runId:string;messages:Record<string,unknown>[]};
const fetcher=(handler:(body:Body,options:RequestInit,url:string)=>Response|Promise<Response>)=>((url:unknown,options:RequestInit)=>handler(JSON.parse(options.body as string),options,String(url))) as typeof fetch;
const finished=(body:Body)=>({type:'RUN_FINISHED',threadId:body.threadId,runId:body.runId});

describe('Task015 explicit project conversation (offline streams only)',()=>{
  test('multi-turn POST retains assistant toolCalls/results and never submits baseline',async()=>{
    let calls=0;let firstThread='';
    const session=new EmbodexConversationSession(user,project,()=>{},fetcher((body,options,url)=>{
      calls++;assert.equal(url,`/api/v1/projects/${project}/embodex/conversation`);assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
      assert.deepEqual(Object.keys(body),['threadId','runId','messages']);
      if(calls===1){firstThread=body.threadId;assert.equal(body.messages[0].content,'改成四轴');return response([
        {type:'RUN_STARTED',threadId:body.threadId,runId:body.runId},
        {type:'TEXT_MESSAGE_START',messageId:'a',role:'assistant'},
        {type:'TEXT_MESSAGE_CONTENT',messageId:'a',delta:'可以继续修改。'},
        {type:'TOOL_CALL_START',toolCallId:'c',toolCallName:'design',parentMessageId:'a'},
        {type:'TOOL_CALL_ARGS',toolCallId:'c',delta:'{"axes":'},
        {type:'TOOL_CALL_ARGS',toolCallId:'c',delta:'4}'},
        {type:'TOOL_CALL_END',toolCallId:'c'},
        {type:'TOOL_CALL_RESULT',messageId:'t',toolCallId:'c',content:'{"status":"success","path":"not-a-platform-package"}'},finished(body)]);}
      assert.equal(body.threadId,firstThread);assert.equal(body.messages.length,4);
      const assistant=body.messages[1];assert.deepEqual(assistant.toolCalls,[{id:'c',type:'function',function:{name:'design',arguments:'{"axes":4}'}}]);
      assert.equal(body.messages[2].role,'tool');assert.equal(body.messages[2].toolCallId,'c');assert.equal(body.messages[3].content,'再缩短一点');
      return response([{type:'TEXT_MESSAGE_CHUNK',messageId:'b',role:'assistant',delta:'收到'},finished(body)]);
    }));
    assert.equal(await session.send(' 改成四轴 '),true);assert.equal(session.state.outcome,'finished');assert(!('robot' in session.state));assert.equal(session.state.notice, null);
    assert.equal(await session.send('再缩短一点'),true);assert.equal(calls,2);assert.equal(session.state.messages.at(-1)?.content,'收到');session.dispose();
  });

  test('receiver-sensitive transport is called without a Session receiver, as browser native fetch requires',async()=>{
    let receiver:unknown='not-called';let calls=0;
    const transport=function(this:unknown,_input:RequestInfo|URL,options?:RequestInit):Promise<Response>{
      receiver=this;calls++;if(this!==undefined)throw new TypeError('Invalid receiver');
      const body=JSON.parse(options?.body as string) as Body;return Promise.resolve(response([finished(body)]));
    };
    const session=new EmbodexConversationSession(user,project,()=>{},transport as typeof fetch);
    await session.send('真实请求');assert.equal(receiver,undefined);assert.equal(calls,1);assert.equal(session.state.outcome,'finished');session.dispose();
  });
  test('snapshot strips system/developer context but preserves valid function/tool transcript',async()=>{
    let calls=0;const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>{
      calls++;if(calls===2){assert(!body.messages.some(row=>row.role==='system'));assert.equal(body.messages[1].role,'assistant');assert.equal(body.messages[2].toolCallId,'call');return response([finished(body)]);}
      return response([{type:'MESSAGES_SNAPSHOT',messages:[{id:'sys',role:'system',content:'private'},{id:'u',role:'user',content:'需求'},{id:'a',role:'assistant',content:null,toolCalls:[{id:'call',type:'function',function:{name:'design',arguments:'{}'}}]},{id:'t',role:'tool',toolCallId:'call',content:'反馈'}]},finished(body)]);
    }));await session.send('需求');await session.send('继续');assert.equal(calls,2);session.dispose();
  });
  test('tool chunks keep JSON arguments and results; tool end alone never finishes the turn',async()=>{
    const session=new EmbodexConversationSession(user,project,()=>{},fetcher(()=>response([{type:'TOOL_CALL_CHUNK',toolCallId:'c',toolCallName:'build',delta:'{'},{type:'TOOL_CALL_CHUNK',delta:'}'},{type:'TOOL_CALL_END',toolCallId:'c'}])));
    await session.send('生成URDF');assert.equal(session.state.outcome,'unconfirmed');assert.equal(session.state.messages[1].role,'assistant');assert.match(session.state.tools[0].status,/待反馈/);session.dispose();
  });
  test('EOF, mismatched terminal, malformed JSON, upstream error and HTTP rejection are neutral unknown without retries',async()=>{
    for(const variant of ['eof','mismatch','json','error','http']){
      let calls=0;const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>{calls++;
        if(variant==='http')return new Response('secret stack local path',{status:502});
        if(variant==='json')return new Response('data: {broken}\n\n',{headers:{'content-type':'text/event-stream'}});
        if(variant==='error')return response([{type:'RUN_ERROR',message:'sk-secret D:/private',code:'secret'}]);
        if(variant==='mismatch')return response([{...finished(body),runId:'foreign'}]);return response([{type:'CUSTOM',name:'status',value:'success'}]);
      }));await session.send('你好');assert.equal(calls,1);assert.equal(session.state.outcome,'unconfirmed');assert.equal(session.state.busy,false);assert(!session.state.notice?.includes('secret'));assert(!JSON.stringify(session.state.events).includes('sk-secret'));assert.match(session.state.notice||'',/不会自动重发/);session.dispose();
    }
  });
  test('explicit next turn after interrupted run is allowed, carries partial history and has fresh run identity',async()=>{
    const runs:string[]=[];const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>{runs.push(body.runId);return response([{type:'TEXT_MESSAGE_CHUNK',messageId:'partial'+runs.length,delta:'部分回答'}]);}));
    await session.send('一');await session.send('二');assert.equal(runs.length,2);assert.notEqual(runs[0],runs[1]);assert.equal(session.state.messages.length,4);session.dispose();
  });
  test('duplicate clicks issue one POST; dispose aborts and ignores late response; new project/user uses empty fresh context',async()=>{
    let resolve!:(response:Response)=>void;let signal:AbortSignal|undefined;let updates=0,calls=0;
    const session=new EmbodexConversationSession(user,project,()=>{updates++;},fetcher((_body,options)=>{calls++;signal=options.signal as AbortSignal;return new Promise(finish=>{resolve=finish;});}));
    const pending=session.send('消息');assert.equal(await session.send('重复'),false);assert.equal(calls,1);const before=updates;session.dispose();assert.equal(signal?.aborted,true);resolve(response([]));await pending;assert.equal(updates,before);
    const next=new EmbodexConversationSession('other-user','other-project',()=>{},fetcher(body=>{assert.equal(body.messages.length,1);assert.notEqual(body.threadId,session.threadId);return response([finished(body)]);}));await next.send('新需求');next.dispose();
  });
  test('unmount while streaming ignores late chunks and cancels owned reader',async()=>{
    let push!:ReadableStreamDefaultController<Uint8Array>;let canceled=false;let updates=0;
    const session=new EmbodexConversationSession(user,project,()=>{updates++;},fetcher(()=>new Response(new ReadableStream({start(c){push=c;},cancel(){canceled=true;}}),{headers:{'content-type':'text/event-stream'}})));
    const pending=session.send('继续');await new Promise(resolve=>setImmediate(resolve));const before=updates;session.dispose();await pending;assert.equal(updates,before);assert.equal(canceled,true);
  });
  test('1..16000 Unicode characters and 64KiB body cap reject without POST or silent truncation',async()=>{
    let calls=0;const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>{calls++;return response([finished(body)]);}));
    assert.equal(await session.send(' '),false);assert.equal(await session.send('a'.repeat(16001)),false);assert.equal(await session.send('😀'),true);assert.equal(calls,1);
    session.state.messages=[{id:'huge',role:'assistant',content:'x'.repeat(66000)}];assert.equal(await session.send('一'),false);assert.equal(calls,1);assert.match(session.state.notice||'',/未发送/);session.dispose();
  });
  test('oversize event and UTF8 corruption fail closed; no body or internal parser error leaks',async()=>{
    for(const variant of ['frame','utf8']){
      const bytes=variant==='frame'?new TextEncoder().encode('data: '+ 'x'.repeat(1048577)):new Uint8Array([0xff,0xff]);
      const session=new EmbodexConversationSession(user,project,()=>{},fetcher(()=>new Response(new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),{headers:{'content-type':'text/event-stream'}})));
      await session.send('消息');assert.equal(session.state.outcome,'unconfirmed');assert.equal(session.state.busy,false);session.dispose();
    }
  });
  test('orphan tool snapshot is unknown; event success does not synthesize Result/Resource',async()=>{
    const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>response([{type:'MESSAGES_SNAPSHOT',messages:[{id:'bad',role:'tool',toolCallId:'orphan',content:'success'}]},finished(body)])));
    await session.send('生成');assert.equal(session.state.outcome,'unconfirmed');assert(!('result' in session.state));session.dispose();
  });


  test('8MiB cumulative output cap is enforced independently of valid single frames',async()=>{
    const events=Array.from({length:44},()=>({type:'CUSTOM',name:'bounded',value:'x'.repeat(200000)}));
    const session=new EmbodexConversationSession(user,project,()=>{},fetcher(()=>response(events,300000)));
    await session.send('请求');assert.equal(session.state.outcome,'unconfirmed');assert(session.state.events.length<44);session.dispose();
  });
  test('overall 1200-second budget aborts the one request without a retry',async()=>{
    const original=globalThis.setTimeout;let budget=0,calls=0;
    globalThis.setTimeout=((callback:()=>void,delay:number)=>{budget=delay;queueMicrotask(callback);return 0;}) as unknown as typeof setTimeout;
    const session=new EmbodexConversationSession(user,project,()=>{},fetcher((_body,options)=>{calls++;return new Promise((_resolve,reject)=>{options.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}));
    try{await session.send('需求');assert.equal(budget,1200000);assert.equal(calls,1);assert.equal(session.state.outcome,'unconfirmed');}
    finally{globalThis.setTimeout=original;session.dispose();}
  });

  // Original UI component safety regressions now run in original-chat.test.ts.

  test('only matching live server CUSTOM restores Task; reserved event never enters next-turn message history',async()=>{
    const imports:unknown[]=[];let turns=0;
    const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>{turns++;assert(!JSON.stringify(body.messages).includes('EMBODIX_MODEL_IMPORT'));return response([{type:'RUN_STARTED',threadId:body.threadId,runId:body.runId},...(turns===1?[{type:'CUSTOM',name:'EMBODIX_MODEL_IMPORT',value:{status:'TASK_CREATED',projectId:project,threadId:body.threadId,runId:body.runId,receiptId:user,validationId:user,taskId:user}}]:[]),finished(body)]);}),event=>imports.push(event));
    await session.send('构建模型');assert.equal(imports.length,1);assert.equal((imports[0] as {taskId:string}).taskId,user);assert.equal(session.state.messages.length,1);await session.send('继续聊天');assert.equal(turns,2);assert.equal(imports.length,1);session.dispose();
  });
  test('mismatched, forged-shaped and duplicate reserved events cannot report a model success',async()=>{
    for(const invalid of ['project','run','extra','duplicate']){let calls=0;const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>{const value={status:'TASK_CREATED',projectId:invalid==='project'?user:project,threadId:body.threadId,runId:invalid==='run'?user:body.runId,receiptId:user,validationId:user,taskId:user,...(invalid==='extra'?{path:'not-a-capability'}:{})};const event={type:'CUSTOM',name:'EMBODIX_MODEL_IMPORT',value};return response([{type:'RUN_STARTED',threadId:body.threadId,runId:body.runId},event,...(invalid==='duplicate'?[event]:[]),finished(body)]);}),()=>{calls++;});await session.send('模型');assert.equal(session.state.outcome,'unconfirmed');assert.equal(calls,invalid==='duplicate'?1:0);assert(!('robot' in session.state));session.dispose();}
  });
  test('safe NOT_IMPORTED and UNCONFIRMED have no Task and ordinary next chat stays available',async()=>{for(const status of ['NOT_IMPORTED','UNCONFIRMED']){const imports:{status:string;taskId?:string}[]=[];const session=new EmbodexConversationSession(user,project,()=>{},fetcher(body=>response([{type:'RUN_STARTED',threadId:body.threadId,runId:body.runId},{type:'CUSTOM',name:'EMBODIX_MODEL_IMPORT',value:{status,projectId:project,threadId:body.threadId,runId:body.runId,code:'MODEL_IMPORT_NOT_CONFIRMED'}},finished(body)])),event=>imports.push(event));assert.equal(await session.send('模型'),true);assert.equal(imports[0].taskId,undefined);assert.equal(await session.send('仍可对话'),true);session.dispose();}});

  test('Task-030 SSE comments and slow tool sequence (END -> comments -> RESULT -> summary -> FINISHED)', async () => {
    const rawFrames = [
      'data: ' + JSON.stringify({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' }) + '\n\n',
      ': keep-alive\n\n',
      'data: ' + JSON.stringify({ type: 'TOOL_CALL_START', toolCallId: 'call1', toolCallName: 'generate_robot_spec' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'TOOL_CALL_END', toolCallId: 'call1' }) + '\n\n',
      ': keep-alive\n\n',
      ': keep-alive\r\n\r\n',
      ': ping\n\n',
      'data: ' + JSON.stringify({ type: 'TOOL_CALL_RESULT', messageId: 'res1', toolCallId: 'call1', content: '{"status":"ok","spec":"generated"}' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '方案已生成。' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'TEXT_MESSAGE_END', messageId: 'm1' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' }) + '\n\n',
    ].join('');

    const session = new EmbodexConversationSession(user, project, () => {}, ((_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as Body;
      const patched = rawFrames
        .replaceAll('t1', body.threadId)
        .replaceAll('r1', body.runId);
      const bytes = new TextEncoder().encode(patched);
      return Promise.resolve(new Response(new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
          c.close();
        }
      }), { headers: { 'content-type': 'text/event-stream' } }));
    }) as typeof fetch);

    await session.send('生成足式机器人');
    assert.equal(session.state.outcome, 'finished');
    assert.equal(session.state.tools.length, 1);
    assert.equal(session.state.tools[0].name, 'generate_robot_spec');
    assert.equal(session.state.tools[0].status, '已收到工具反馈');
    const toolMsg = session.state.messages.find(m => m.role === 'tool');
    assert(toolMsg);
    assert.equal(toolMsg.content, '{"status":"ok","spec":"generated"}');
    const assistantMsg = session.state.messages.find(m => m.role === 'assistant' && m.content === '方案已生成。');
    assert(assistantMsg);
    assert.equal(session.state.notice, null);
    session.dispose();
  });

  test('Task-030 session.stop() cancels stream with unconfirmed outcome and no auto-resend', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    let canceled = false;
    const session = new EmbodexConversationSession(user, project, () => {}, (() => {
      return Promise.resolve(new Response(new ReadableStream({
        start(c) { push = c; },
        cancel() { canceled = true; }
      }), { headers: { 'content-type': 'text/event-stream' } }));
    }) as typeof fetch);

    const pending = session.send('开始慢任务');
    await new Promise(r => setImmediate(r));
    push.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'cad' }) + '\n\n'));
    push.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ type: 'TOOL_CALL_END', toolCallId: 't1' }) + '\n\n'));
    push.enqueue(new TextEncoder().encode(': keep-alive\n\n'));

    // User clicks stop
    session.stop();
    await pending;

    assert.equal(canceled, true);
    assert.equal(session.state.outcome, 'unconfirmed');
    assert.match(session.state.notice || '', /结果未确认，可能已执行；不会自动重发/);
    session.dispose();
  });

});
