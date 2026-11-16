import { registerConversationWriter, revokeUserConversations, clearUserStoredConversation } from './conversation-storage';
import type { EmbodexConversationRequest, EmbodexConversationMessage, EmbodexConversationToolCall } from '../api/generated/types.gen';

type Message = EmbodexConversationMessage;
type RecordValue = Record<string, unknown>;
export interface ModelImportEvent {status:'TASK_CREATED'|'NOT_IMPORTED'|'UNCONFIRMED';projectId:string;threadId:string;runId:string;receiptId?:string;validationId?:string;taskId?:string;code?:string}
export interface BuildConfirmationState {
  status: 'READY' | 'INVALIDATED' | 'NONE';
  confirmationId: string | null;
  epoch: number;
}

export interface ConversationState {
  userId: string; projectId: string; busy: boolean;
  events: RecordValue[]; messages: Message[]; tools: {id:string;name:string;status:string}[];
  notice: string | null; outcome: 'idle'|'finished'|'unconfirmed';
  confirmation: BuildConfirmationState;
  epoch: number;
}
export const initialConversationState=(userId:string,projectId:string,initialMessages:Message[]=[],initialEpoch=0):ConversationState=>({
  userId,
  projectId,
  busy: false,
  events: [],
  messages: initialMessages,
  tools: [],
  notice: null,
  outcome: 'idle',
  confirmation: { status: 'NONE', confirmationId: null, epoch: initialEpoch },
  epoch: initialEpoch,
});
const bytes=(value:string)=>new TextEncoder().encode(value).length;
const object=(value:unknown):RecordValue=>{
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('protocol');
  return value as RecordValue;
};
const text=(value:unknown,limit=1048576):string=>{
  if(typeof value!=='string'||[...value].length>limit)throw new Error('protocol');return value;
};
const id=(value:unknown):string=>{const result=text(value,128);if(!result)throw new Error('protocol');return result;};

// Project/user context and credentials never enter the request body. Native fetch
// deliberately issues one POST; no SSE helper reconnect or hidden replay.
export interface SessionOptions {
  initialThreadId?: string;
  initialMessages?: Message[];
  initialEpoch?: number;
  verifyAuth?: () => Promise<'authenticated' | 'unauthenticated' | 'unknown'>;
}

export class EmbodexConversationSession {
  state:ConversationState;
  private active=true;
  private controller:AbortController|null=null;
  private reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
  readonly threadId:string;
  private messageEpoch:number;
  private unregisterWriter: () => void;
  private verifyAuth?: () => Promise<'authenticated' | 'unauthenticated' | 'unknown'>;
  constructor(
    readonly userId:string,
    readonly projectId:string,
    private publish:(state:ConversationState)=>void,
    private transport:typeof fetch=fetch,
    private onModelImport?:(event:ModelImportEvent)=>void,
    options?: SessionOptions
  ) {
    this.unregisterWriter = registerConversationWriter(userId, () => {
      this.dispose();
      this.state = initialConversationState(userId, projectId);
      this.publish(this.state);
    });
    this.threadId = options?.initialThreadId || crypto.randomUUID();
    this.messageEpoch = options?.initialEpoch || 0;
    this.verifyAuth = options?.verifyAuth;
    this.state = initialConversationState(userId, projectId, options?.initialMessages || [], this.messageEpoch);
  }
  get writable() { return this.active; }
  private update(patch:Partial<ConversationState>) {if(!this.active)return;this.state={...this.state,...patch};this.publish(this.state);}
  setConfirmation(status: 'READY' | 'INVALIDATED' | 'NONE', confirmationId: string | null, epoch: number) {
    if (!this.active || epoch !== this.state.epoch) return;
    this.update({
      confirmation: { status, confirmationId, epoch },
    });
  }
  stop(){this.controller?.abort();if(this.reader)void this.reader.cancel().catch(()=>{});}
  dispose(){this.active=false;this.unregisterWriter();this.controller?.abort();if(this.reader)void this.reader.cancel().catch(()=>{});}
  async send(value:string,onAccepted?:()=>void):Promise<boolean> {
    const content=value.trim();
    if(!this.active||this.state.busy||!content||[...content].length>16000)return false;
    const runId=crypto.randomUUID();
    const messages:Message[]=[...this.state.messages,{id:crypto.randomUUID(),role:'user',content}];
    const body:EmbodexConversationRequest={threadId:this.threadId,runId,messages};
    const serialized=JSON.stringify(body);
    if(messages.length>200||bytes(serialized)>65536){this.update({notice:'会话上下文超过本轮限制，未发送；请精简内容。'});return false;}
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>{controller.abort();if(this.reader)void this.reader.cancel().catch(()=>{});},1200000);
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let terminal=false;let started=false;let importSeen=false;let currentMessage:string|null=null;let currentTool:string|null=null;
    this.messageEpoch += 1;
    const currentEpoch = this.messageEpoch;
    let pendingConfirmation: { status: 'READY'; confirmationId: string; runId: string } | null = null;
    let readySeenThisRun = false;
    let invalidatableConfirmation = this.state.confirmation.confirmationId;
    this.update({
      messages,
      events: [],
      busy: true,
      notice: null,
      outcome: 'idle',
      confirmation: { status: 'NONE', confirmationId: null, epoch: currentEpoch },
      epoch: currentEpoch,
    });
    const replaceMessage=(message:Message)=>{
      const rows=this.state.messages;const index=rows.findIndex(row=>row.id===message.id);
      if(index>=0){const old=rows[index];if(old.role!==message.role || (old.role==='tool'&&message.role==='tool'&&old.toolCallId!==message.toolCallId))throw new Error('protocol');}
      this.update({messages:index<0?[...rows,message]:rows.map((row,i)=>i===index?message:row)});
    };
    const assistant=(messageId:string)=>{
      const row=this.state.messages.find(row=>row.id===messageId);
      if(row&&row.role!=='assistant')throw new Error('protocol');
      return row?.role==='assistant'?row:{id:messageId,role:'assistant' as const,content:''};
    };
    const findTool=(toolId:string)=>{
      for(const row of this.state.messages)if(row.role==='assistant'){
        const call=row.toolCalls?.find(call=>call.id===toolId);if(call)return {row,call};
      }
      throw new Error('protocol');
    };
    const toolStatus=(toolId:string,name:string,status:string)=>{
      this.update({tools:[...this.state.tools.filter(tool=>tool.id!==toolId),{id:toolId,name,status}]});
    };
    const startTool=(event:RecordValue)=>{
      const toolId=id(event.toolCallId);const name=text(event.toolCallName,256);if(!name)throw new Error('protocol');
      const parent=event.parentMessageId==null?(currentMessage||crypto.randomUUID()):id(event.parentMessageId);
      const row=assistant(parent);const existing=row.toolCalls?.find(call=>call.id===toolId);
      if(existing&&existing.function.name!==name)throw new Error('protocol');
      if(!existing&&(row.toolCalls||[]).length>=32)throw new Error('limit');
      const call:EmbodexConversationToolCall={id:toolId,type:'function',function:{name,arguments:''}};
      replaceMessage({...row,toolCalls:existing?row.toolCalls:[...(row.toolCalls||[]),call]});
      currentTool=toolId;toolStatus(toolId,name,'正在调用');return toolId;
    };
    const appendArgs=(toolId:string,delta:string)=>{
      const {row,call}=findTool(toolId);const args=call.function.arguments+delta;text(args);
      replaceMessage({...row,toolCalls:row.toolCalls?.map(item=>item.id===toolId?{...item,function:{...item.function,arguments:args}}:item)});
    };
    const snapshot=(value:unknown):Message[]=>{
      if(!Array.isArray(value)||value.length>200)throw new Error('protocol');
      const rows:Message[]=[];
      for(const raw of value){const row=object(raw);if(row.role==='system'||row.role==='developer')continue;
        const messageId=id(row.id);const name=row.name==null?undefined:text(row.name,128);
        if(row.role==='user'){const content=text(row.content,16000);if(!content)throw new Error('protocol');rows.push({id:messageId,role:'user',content,...(name?{name}:{})});}
        else if(row.role==='assistant'){
          const content=row.content==null?null:text(row.content);let calls:EmbodexConversationToolCall[]|undefined;
          if(row.toolCalls!=null){if(!Array.isArray(row.toolCalls)||row.toolCalls.length>32)throw new Error('protocol');calls=row.toolCalls.map(rawCall=>{const call=object(rawCall),fn=object(call.function);if(call.type!=='function')throw new Error('protocol');const name=text(fn.name,256);if(!name)throw new Error('protocol');return{id:id(call.id),type:'function',function:{name,arguments:text(fn.arguments)}};});}
          rows.push({id:messageId,role:'assistant',content,...(name?{name}:{}),...(calls?{toolCalls:calls}:{})});
        } else if(row.role==='tool')rows.push({id:messageId,role:'tool',toolCallId:id(row.toolCallId),content:text(row.content)});
        else throw new Error('protocol');
      }
      if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('protocol');
      const calls=new Set(rows.flatMap(row=>row.role==='assistant'?(row.toolCalls||[]).map(call=>call.id):[]));
      if(rows.some(row=>row.role==='tool'&&!calls.has(row.toolCallId)))throw new Error('protocol');
      return rows;
    };
    const handle=(event:RecordValue)=>{
      const type=text(event.type,128);
      // Never retain an upstream error payload; even mocks/dev services may carry secrets.
      this.update({events:[...this.state.events,type==='RUN_ERROR'?{type,code:'CONVERSATION_UNCONFIRMED',message:'Conversation outcome is unconfirmed.'}:event]});
      if(type==='RUN_STARTED'||type==='RUN_FINISHED'){
        if(event.threadId!==this.threadId||event.runId!==runId)throw new Error('protocol');
        if(type==='RUN_STARTED')started=true;
        if(type==='RUN_FINISHED'){
          terminal=true;
          const patch: Partial<ConversationState> = {
            outcome: 'finished',
            notice: null,
          };
          if (pendingConfirmation) {
            patch.confirmation = { status: 'READY', confirmationId: pendingConfirmation.confirmationId, epoch: currentEpoch };
          }
          this.update(patch);
          return;
        }
      }
      const strictUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
      if (type === 'CUSTOM' && event.name === 'EMBODIX_BUILD_CONFIRMATION_READY') {
        if (!started || terminal) throw new Error('protocol');
        const value = object(event.value);
        if (readySeenThisRun) throw new Error('protocol');
        readySeenThisRun = true;
        const required = ['status', 'projectId', 'threadId', 'runId', 'confirmationId'];
        if (Object.keys(value).sort().join(',') !== required.sort().join(',')) throw new Error('protocol');
        if (value.status !== 'READY' || value.projectId !== this.projectId || value.threadId !== this.threadId || value.runId !== runId) {
          throw new Error('protocol');
        }
        if (typeof value.confirmationId !== 'string' || !strictUuid.test(value.confirmationId)) throw new Error('protocol');
        pendingConfirmation = { status: 'READY', confirmationId: value.confirmationId, runId };
        invalidatableConfirmation = value.confirmationId;
        return;
      }
      if (type === 'CUSTOM' && event.name === 'EMBODIX_BUILD_CONFIRMATION_INVALIDATED') {
        if (!started || terminal) throw new Error('protocol');
        const value = object(event.value);
        const required = ['status', 'projectId', 'threadId', 'runId', 'confirmationId', 'reason'];
        if (Object.keys(value).sort().join(',') !== required.sort().join(',')) throw new Error('protocol');
        if (value.status !== 'INVALIDATED' || value.reason !== 'NEW_BUILD_STARTED' || value.projectId !== this.projectId || value.threadId !== this.threadId || value.runId !== runId) {
          throw new Error('protocol');
        }
        if (typeof value.confirmationId !== 'string' || !strictUuid.test(value.confirmationId)) throw new Error('protocol');
        if (value.confirmationId !== invalidatableConfirmation) throw new Error('protocol');
        invalidatableConfirmation = null;
        pendingConfirmation = null;
        this.update({ confirmation: { status: 'INVALIDATED', confirmationId: null, epoch: currentEpoch }, notice: '上一次构建确认已失效（发起了新修改）。' });
        return;
      }
      if(type==='CUSTOM'&&event.name==='EMBODIX_MODEL_IMPORT'){
        if(importSeen||Object.keys(event).sort().join(',')!=='name,type,value')throw new Error('protocol');importSeen=true;
        const value=object(event.value),status=value.status;
        if(!started||value.projectId!==this.projectId||value.threadId!==this.threadId||value.runId!==runId)throw new Error('protocol');
        const required=status==='TASK_CREATED'?['status','projectId','threadId','runId','receiptId','validationId','taskId']:['status','projectId','threadId','runId','code'];
        if(Object.keys(value).sort().join(',')!==required.sort().join(','))throw new Error('protocol');
        if(status==='TASK_CREATED'){
          const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
          if(![value.receiptId,value.validationId,value.taskId].every(item=>typeof item==='string'&&uuid.test(item)))throw new Error('protocol');
          this.onModelImport?.({status,projectId:this.projectId,threadId:this.threadId,runId,receiptId:value.receiptId as string,validationId:value.validationId as string,taskId:value.taskId as string});
        }else if((status==='NOT_IMPORTED'||status==='UNCONFIRMED')&&value.code==='MODEL_IMPORT_NOT_CONFIRMED'){
          this.onModelImport?.({status,projectId:this.projectId,threadId:this.threadId,runId,code:value.code as string});
        }else throw new Error('protocol');
        return;
      }
      if(type==='RUN_ERROR'){terminal=true;this.update({outcome:'unconfirmed',notice:'本轮结果未确认，可能已执行；不会自动重发。'});return;}
      if(type==='TEXT_MESSAGE_START'){if(event.role!=='assistant')throw new Error('protocol');currentMessage=id(event.messageId);replaceMessage(assistant(currentMessage));}
      else if(type==='TEXT_MESSAGE_CONTENT'||type==='TEXT_MESSAGE_CHUNK'){
        if(event.role!=null&&event.role!=='assistant')throw new Error('protocol');
        const messageId=event.messageId==null?currentMessage:id(event.messageId);if(!messageId)throw new Error('protocol');currentMessage=messageId;
        if(event.delta!=null){const row=assistant(messageId);const content=(row.content||'')+text(event.delta);text(content);replaceMessage({...row,content});}
      } else if(type==='TEXT_MESSAGE_END'){if(id(event.messageId)!==currentMessage)throw new Error('protocol');currentMessage=null;}
      else if(type==='TOOL_CALL_START')startTool(event);
      else if(type==='TOOL_CALL_ARGS')appendArgs(id(event.toolCallId),text(event.delta));
      else if(type==='TOOL_CALL_CHUNK'){
        let toolId=event.toolCallId==null?currentTool:id(event.toolCallId);
        if(event.toolCallName!=null){toolId=startTool({...event,toolCallId:toolId});}
        if(!toolId)throw new Error('protocol');if(event.delta!=null)appendArgs(toolId,text(event.delta));
      } else if(type==='TOOL_CALL_END'){const toolId=id(event.toolCallId),{call}=findTool(toolId);toolStatus(toolId,call.function.name,'调用事件结束，结果待反馈');if(currentTool===toolId)currentTool=null;}
      else if(type==='TOOL_CALL_RESULT'){
        const toolId=id(event.toolCallId),{call}=findTool(toolId);if(event.role!=null&&event.role!=='tool')throw new Error('protocol');
        replaceMessage({id:id(event.messageId),role:'tool',toolCallId:toolId,content:text(event.content)});toolStatus(toolId,call.function.name,'已收到工具反馈');
      } else if(type==='MESSAGES_SNAPSHOT')this.update({messages:snapshot(event.messages)});
      // State/thinking/raw/custom/future events are retained in bounded turn context;
      // they are not executed, navigation targets, or model-package evidence.
    };
    try{
      onAccepted?.();
      const transport=this.transport;
      const response=await transport(`/api/v1/projects/${encodeURIComponent(this.projectId)}/embodex/conversation`,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:serialized,signal:controller.signal});
      if(!this.active)return true;
      if(response.status === 401) {
        let authResult: 'authenticated' | 'unauthenticated' | 'unknown' = 'unknown';
        if (this.verifyAuth) {
          try {
            authResult = await this.verifyAuth();
          } catch {
            authResult = 'unknown';
          }
        } else {
          try {
            const check = await transport('/api/v1/auth/me', {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store',
            });
            if (check.status === 200) authResult = 'authenticated';
            else if (check.status === 401) authResult = 'unauthenticated';
            else authResult = 'unknown';
          } catch {
            authResult = 'unknown';
          }
        }
        if (!this.active) return true;
        if (authResult === 'unauthenticated') {
          revokeUserConversations(this.userId);
          clearUserStoredConversation(this.userId);
          return true;
        }
        this.update({
          outcome: 'unconfirmed',
          notice: authResult === 'authenticated'
            ? '会话服务授权响应异常，已保留聊天记录，请重试。'
            : '网络或服务异常，未确认认证状态，已保留聊天记录。',
        });
        return true;
      }
      if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')||!response.body)throw new Error('transport');
      reader=response.body.getReader();this.reader=reader;const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='';let total=0;
      while(this.active&&!terminal){
        const chunk=await reader.read();if(!this.active)return true;
        if(chunk.done){buffer+=decoder.decode();break;}
        total+=chunk.value.byteLength;if(total>8388608)throw new Error('limit');buffer+=decoder.decode(chunk.value,{stream:true});
        let match:RegExpExecArray|null;
        while(!terminal&&(match=/\r?\n\r?\n/.exec(buffer))){
          const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);if(bytes(frame)>1048576)throw new Error('limit');
          const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
          if(data)handle(object(JSON.parse(data)));
        }
        if(bytes(buffer)>1048576)throw new Error('limit');
      }
      if(this.active&&!terminal)this.update({outcome:'unconfirmed',notice:'连接已中断，结果未确认，可能已执行；不会自动重发。'});
    }catch{
      if(this.active)this.update({outcome:'unconfirmed',notice:'本轮结果未确认，可能已执行；不会自动重发。请核实工具执行状态。'});
    }finally{
      clearTimeout(timeout);this.reader=null;if(reader)void reader.cancel().catch(()=>{});if(this.controller===controller)this.controller=null;
      this.update({busy:false});
    }
    return true;
  }
}
