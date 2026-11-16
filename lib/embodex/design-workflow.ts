import { createValidation, createTask, getTask, listTasks, listTaskResults, getResource, downloadProjectRobotRuntimePackage } from '../api/client';
import type { Task, Result, Resource, EmbodexDesignConfig } from '../api/generated/types.gen';

export function normalizeBaselineRequirement(value: string): string {
  const requirement=value.trim();
  const length=[...requirement].length;
  if (length<3 || length>4000) throw new Error('用途备注需为去除首尾空白后的 3～4000 个字符。');
  return requirement;
}

const TEMPLATE_ID_REGEX = /^[a-z][a-z0-9_]*$/;
export function normalizeTemplateId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('模板标识需为合法字符串或 null。');
  if (value.length < 1 || value.length > 128 || !TEMPLATE_ID_REGEX.test(value)) {
    throw new Error('模板标识需为 1～128 个以小写字母开头的字符，且仅包含小写字母、数字和下划线。');
  }
  return value;
}

export interface DesignSubmitPayload {
  requirement: string;
  templateId?: string | null;
  legacyBaseline?: boolean;
}

export interface DesignState {
  projectId:string;
  submitting:boolean;
  checking:boolean;
  downloading:boolean;
  submissionUnknown:boolean;
  unresolvedTaskIds:string[];
  task:Task|null;
  result:Result|null;
  robot:Resource|null;
  publicationStatus?: 'LOCATION_REGISTERED' | 'PENDING' | 'NEEDS_ATTENTION' | 'NOT_REGISTERED' | null;
  recent:Task[];
  loadingRecent:boolean;
  recentError:string|null;
  error:string|null;
}
export const initialDesignState=(projectId:string):DesignState=>({projectId,submitting:false,checking:false,downloading:false,submissionUnknown:false,unresolvedTaskIds:[],task:null,result:null,robot:null,publicationStatus:null,recent:[],loadingRecent:false,recentError:null,error:null});
export const designArtifactsReady=(state:DesignState)=>state.task?.status==='SUCCEEDED' && !!state.result && !!state.robot && (state.publicationStatus==null || state.publicationStatus==='LOCATION_REGISTERED');
export interface DesignRecovery { intentId:string; taskId:string|null }
export function readDesignRecovery(search:string):DesignRecovery|null {
  const params=new URLSearchParams(search);
  return params.has('embodexPendingIntent') ? {intentId:params.get('embodexPendingIntent')||'unknown',taskId:params.get('embodexPendingTask')||null}:null;
}
export function writeDesignRecovery(href:string,recovery:DesignRecovery|null):string {
  const url=new URL(href);
  url.searchParams.delete('embodexPendingIntent');url.searchParams.delete('embodexPendingTask');
  if (recovery) {
    url.searchParams.set('embodexPendingIntent',recovery.intentId);
    if (recovery.taskId) { url.searchParams.set('embodexPendingTask',recovery.taskId);url.searchParams.set('taskId',recovery.taskId); }
  }
  return url.href;
}
const waiting=new Set(['PENDING','QUEUED','RUNNING','CANCEL_REQUESTED']);
function verifiedEvidence(result:Result) {
  const data=result.data;
  return data.templateId==='so101_v1' && data.buildMode==='baseline' && data.parameterChangesApplied===false && data.physicsComplete===false
    && data.solidworksBuilt===true && data.urdfVerified===true && data.linkCount===8 && data.jointCount===7 && data.meshCount===12
    && data.schemaVersion==='1.2' && data.robotName==='so101_high_fidelity' && typeof data.modelId==='string'
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.modelId) && typeof data.manifestSha256==='string' && /^[a-f0-9]{64}$/.test(data.manifestSha256);
}

/** One explicit user submission; dispose also invalidates transports that ignore abort. */
const identityUuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function verifiedImport(result:Result){const d=result.data;return Object.keys(d).sort().join(',')===['receiptId','threadId','runId','cadRunId','vendorModelId','vendorModelVersionId','modelId','manifestSha256','templateId','importOnly','solidworksBuilt','documentsCleaned','urdfVerified','physicsComplete','linkCount','jointCount','meshCount'].sort().join(',')&& d.templateId==='so101_v1'&&d.importOnly===true&&d.solidworksBuilt===true&&d.documentsCleaned===true&&d.urdfVerified===true&&d.physicsComplete===false&&d.linkCount===8&&d.jointCount===7&&d.meshCount===12&&[d.receiptId,d.threadId,d.runId,d.cadRunId,d.modelId].every(identityUuid)&&typeof d.manifestSha256==='string'&&/^[a-f0-9]{64}$/.test(d.manifestSha256)&&[d.vendorModelId,d.vendorModelVersionId].every(value=>typeof value==='string'&&[...value].length>0&&[...value].length<=256&&!/[\x00-\x1f\x7f]/.test(value));}
export class EmbodexBuildSession {
  state:DesignState;
  private generation=0;
  private disposed=false;
  private controller=new AbortController();
  private timer:ReturnType<typeof setTimeout>|undefined;
  private unresolvedTasks=new Set<string>();
  private unknownAttempt=false;
  private recovery:DesignRecovery|null;
  constructor(private readonly projectId:string,private readonly change:(state:DesignState)=>void,private readonly pollIntervalMs=2000,private readonly recoveryOptions?:{initial:DesignRecovery|null;persist:(recovery:DesignRecovery|null)=>void}) {
    this.recovery=recoveryOptions?.initial||null;
    this.unknownAttempt=!!this.recovery && !this.recovery.taskId;
    if (this.recovery?.taskId) this.unresolvedTasks.add(this.recovery.taskId);
    this.state={...initialDesignState(projectId),submissionUnknown:this.unknownAttempt,unresolvedTaskIds:[...this.unresolvedTasks]};
  }
  private persistRecovery(recovery:DesignRecovery|null) { this.recoveryOptions?.persist(recovery);this.recovery=recovery; }
  private live(generation:number) { return !this.disposed && generation===this.generation; }
  private publish(patch:Partial<DesignState>) { if (!this.disposed) { this.state={...this.state,...patch,submissionUnknown:this.unknownAttempt,unresolvedTaskIds:[...this.unresolvedTasks]}; this.change(this.state); } }
  private validTask(task:Task) { return !!task.id && task.projectId===this.projectId && (task.actionKey==='EMBODEX_DESIGN'||task.actionKey==='EMBODEX_MODEL_IMPORT'||task.actionKey==='EMBODEX_PUBLISH_EXISTING') && [...waiting,'SUCCEEDED','FAILED','CANCELED','TIMEOUT'].includes(task.status); }
  private observeTask(task:Task) {
    if (waiting.has(task.status) || task.status==='TIMEOUT') this.unresolvedTasks.add(task.id);
    else this.unresolvedTasks.delete(task.id); // Only confirmation of that same Task releases its fence.
    if (!this.unknownAttempt && (!this.recovery || this.recovery.taskId===task.id)) {
      const next=this.unresolvedTasks.values().next().value as string|undefined;
      this.persistRecovery(next ? {intentId:this.recovery?.intentId||next,taskId:next}:null);
    }
  }
  dispose() { this.disposed=true; this.generation++; this.controller.abort(); clearTimeout(this.timer); }
  newIntent():boolean {
    if (this.disposed || this.unknownAttempt || this.unresolvedTasks.size || this.state.submitting || this.state.checking || this.state.downloading || !this.state.task || !['SUCCEEDED','FAILED','CANCELED'].includes(this.state.task.status)) return false;
    clearTimeout(this.timer);this.generation++;this.controller.abort();this.controller=new AbortController();
    this.publish({...initialDesignState(this.projectId),recent:this.state.recent});
    return true;
  }

  async loadRecent() {
    if (this.disposed || this.state.loadingRecent) return;
    const generation=this.generation;
    this.publish({loadingRecent:true,recentError:null});
    try {
      const response=await listTasks({query:{projectId:this.projectId,limit:20},signal:this.controller.signal});
      if (!this.live(generation)) return;
      if (response.error || !response.data || !Array.isArray(response.data.items)) throw new Error();
      this.publish({recent:response.data.items.filter(task=>this.validTask(task))});
    } catch { if (this.live(generation)) this.publish({recent:[],recentError:'最近任务读取失败，请确认项目权限或稍后刷新。'}); }
    finally { if (this.live(generation)) this.publish({loadingRecent:false}); }
  }

  async submit(value:string | DesignSubmitPayload) {
    if (this.disposed || this.unknownAttempt || this.unresolvedTasks.size || this.state.submitting || this.state.task) return;
    let requirement:string;
    let configSnapshot:EmbodexDesignConfig;
    try {
      if (typeof value === 'string') {
        requirement=normalizeBaselineRequirement(value);
        configSnapshot={requirement,templateId:'so101_v1',buildMode:'baseline'};
      } else {
        if (!value || typeof value !== 'object') throw new Error('无效的提交配置。');
        requirement=normalizeBaselineRequirement(value.requirement);
        if (value.legacyBaseline) {
          configSnapshot={requirement,templateId:'so101_v1',buildMode:'baseline'};
        } else {
          if (!Object.hasOwn(value, 'templateId') || value.templateId === undefined) {
            throw new Error('必须指定模板标识（合法字符串或 null）。');
          }
          const templateId=normalizeTemplateId(value.templateId);
          configSnapshot={requirement,templateId};
        }
      }
    }
    catch (error) { this.publish({error:(error as Error).message}); return; }
    const generation=this.generation;
    const idempotencyKey=crypto.randomUUID(); // One intent, never automatically replayed.
    let taskAttempted=false;
    this.publish({submitting:true,error:null,result:null,robot:null,publicationStatus:null});
    try {
      const validation=await createValidation({body:{projectId:this.projectId,actionKey:'EMBODEX_DESIGN',inputs:{},configSnapshot},signal:this.controller.signal});
      if (!this.live(generation)) return;
      if (validation.error || !validation.data || validation.data.projectId!==this.projectId || validation.data.actionKey!=='EMBODEX_DESIGN') throw new Error();
      // Synchronous URL persistence must succeed before the Task can be created.
      this.persistRecovery({intentId:idempotencyKey,taskId:null});
      taskAttempted=true;
      const response=await createTask({body:{projectId:this.projectId,validationId:validation.data.id,actionKey:'EMBODEX_DESIGN'},headers:{'Idempotency-Key':idempotencyKey},signal:this.controller.signal});
      if (!this.live(generation)) return;
      if (response.error) {
        // Explicit HTTP rejection is not a network unknown; no automatic retry either.
        if (response.response && response.response.status<500) taskAttempted=false;
        throw new Error();
      }
      if (!response.data || !this.validTask(response.data) || response.data.validationId!==validation.data.id) throw new Error();
      this.persistRecovery({intentId:idempotencyKey,taskId:response.data.id});
      this.observeTask(response.data);
      this.publish({task:response.data,submitting:false});
      await this.refresh();
    } catch {
      if (this.live(generation)) {
        this.unknownAttempt=taskAttempted;
        if (!taskAttempted) this.persistRecovery(null);
        this.publish({error:taskAttempted?'提交结果不确定，任务可能已创建。请核实原提交，勿重复构建；选择历史成功任务不能解除此状态。':'无法提交构建，请检查项目权限与服务配置。'});
      }
    } finally { if (this.live(generation)) this.publish({submitting:false}); }
  }

  async resume(taskId:string) {
    if (this.disposed || this.state.submitting || this.state.downloading) return;
    clearTimeout(this.timer);
    this.controller.abort(); this.controller=new AbortController();
    const generation=++this.generation;
    this.unresolvedTasks.add(taskId); // A failed read cannot prove the restored Task stopped.
    if (!this.recovery && !this.unknownAttempt) this.persistRecovery({intentId:taskId,taskId});
    this.publish({checking:true,task:null,result:null,robot:null,publicationStatus:null,error:null});
    try {
      const response=await getTask({path:{taskId},signal:this.controller.signal});
      if (!this.live(generation)) return;
      if (response.error || !response.data || response.data.id!==taskId || !this.validTask(response.data)) throw new Error();
      this.observeTask(response.data);
      this.publish({task:response.data,checking:false});
      await this.refresh();
    } catch { if (this.live(generation)) this.publish({error:'无法恢复该项目的设计任务，请检查任务标识与访问权限。'}); }
    finally { if (this.live(generation)) this.publish({checking:false,loadingRecent:false}); }
  }

  async refresh() {
    if (this.disposed || this.state.checking || !this.state.task) return;
    clearTimeout(this.timer);
    const generation=this.generation;
    const taskId=this.state.task.id;
    this.publish({checking:true,error:null,result:null,robot:null,publicationStatus:null});
    try {
      const response=await getTask({path:{taskId},signal:this.controller.signal});
      if (!this.live(generation)) return;
      if (response.error || !response.data || response.data.id!==taskId || !this.validTask(response.data)) throw new Error();
      const task=response.data;
      this.observeTask(task);
      this.publish({task});
      if (waiting.has(task.status)) {
        this.timer=setTimeout(()=>{void this.refresh();},this.pollIntervalMs);
        return;
      }
      if (task.actionKey==='EMBODEX_PUBLISH_EXISTING' && task.status==='TIMEOUT') {
        this.timer=setTimeout(()=>{void this.refresh();},this.pollIntervalMs);
        return;
      }
      if (task.status!=='SUCCEEDED') {
        if (task.actionKey==='EMBODEX_PUBLISH_EXISTING' && task.status==='FAILED') {
          try {
            const results=await listTaskResults({path:{taskId},query:{limit:20},signal:this.controller.signal});
            if (this.live(generation) && results.data && Array.isArray(results.data.items)) {
              const result=results.data.items.find(item=>item.taskId===taskId && item.sourceModule==='embodex');
              if (result && ((result as any).resultKind==='robot-publication' || result.data?.operation==='PUBLISH_EXISTING')) {
                const pubStatus = result.data?.publicationStatus || (result.data?.status === 'NEEDS_ATTENTION' ? 'NEEDS_ATTENTION' : 'NOT_REGISTERED');
                this.publish({
                  result,
                  robot: null,
                  publicationStatus: pubStatus as any,
                });
                return;
              }
            }
          } catch {
            // failed task result read error ignored
          }
        }
        return;
      }
      const results=await listTaskResults({path:{taskId},query:{limit:20},signal:this.controller.signal});
      if (!this.live(generation)) return;
      if (results.error || !results.data || !Array.isArray(results.data.items)) throw new Error();
      const result=results.data.items.find(item=>item.taskId===taskId && item.sourceModule==='embodex');
      const refs=result?.producedResources?.filter(item=>item.outputKey==='robot');
      if (!result || refs?.length!==1) throw new Error();

      const isImport = task.actionKey==='EMBODEX_MODEL_IMPORT';
      const isPublishExisting = task.actionKey==='EMBODEX_PUBLISH_EXISTING';
      const isLegacyBaseline = !isImport && !isPublishExisting && result.data?.buildMode==='baseline' && result.data?.templateId==='so101_v1';
      let isPublication = !isImport && (result.data?.publicationStatus!==undefined || result.data?.workspacePublicationStatus!==undefined || result.summary==='Robot generation completed' || isPublishExisting);

      if (isImport) {
        if (!verifiedImport(result) || result.producedResources?.length!==1) throw new Error();
      } else if (isPublishExisting) {
        if (result.sourceModule!=='embodex' || ((result as any).resultKind && (result as any).resultKind!=='robot-publication') || result.data?.operation!=='PUBLISH_EXISTING' || result.data?.publicationStatus!=='LOCATION_REGISTERED') throw new Error();
      } else if (isLegacyBaseline && !isPublication) {
        if (!verifiedEvidence(result)) throw new Error();
      } else if (isPublication) {
        if (result.sourceModule!=='embodex') throw new Error();
      } else {
        throw new Error();
      }

      const resource=await getResource({path:{resourceId:refs[0].resourceId},signal:this.controller.signal});
      if (!this.live(generation)) return;
      const robot=resource.data;
      const expectedExternalId = isImport ? `import:${result.data.receiptId}` : isPublishExisting ? `publication:${taskId}` : `design:${taskId}`;
      if (resource.error || !robot || robot.id!==refs[0].resourceId || robot.type!=='ROBOT' || robot.scope!=='PROJECT' || robot.sourceModule!=='embodex' || robot.externalId!==expectedExternalId || (robot.version!=='1'&&robot.version!=='v1')) throw new Error();
      if (!isImport && Object.hasOwn(robot.displayMetadata?.specifications || {},'workspacePublicationStatus')) isPublication=true;

      let publicationStatus: 'LOCATION_REGISTERED' | 'PENDING' | 'NEEDS_ATTENTION' | 'NOT_REGISTERED' | null = null;
      if (isPublishExisting) {
        publicationStatus = 'LOCATION_REGISTERED';
      } else if (isPublication) {
        const specs = robot.displayMetadata?.specifications;
        const status = specs?.workspacePublicationStatus;
        if (status === 'LOCATION_REGISTERED') {
          const artifactId = specs?.workspaceArtifactId;
          const workspaceUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/i;
          if (typeof artifactId !== 'string' || !workspaceUuidPattern.test(artifactId)) {
            throw new Error();
          }
          publicationStatus = 'LOCATION_REGISTERED';
        } else if (status === 'PENDING') {
          publicationStatus = 'PENDING';
          if (task.status === 'SUCCEEDED') {
            this.timer = setTimeout(() => { void this.refresh(); }, this.pollIntervalMs);
          }
        } else if (status === 'NEEDS_ATTENTION') {
          publicationStatus = 'NEEDS_ATTENTION';
        } else {
          publicationStatus = 'NOT_REGISTERED';
        }
      }
      this.publish({result,robot,publicationStatus});
    } catch { if (this.live(generation)) this.publish({result:null,robot:null,publicationStatus:null,error:'状态或产物读取未通过，不能确认完整交付。请刷新状态；不会自动重建。'}); }
    finally { if (this.live(generation)) this.publish({checking:false}); }
  }

  async download():Promise<Blob|null> {
    if (this.disposed || this.state.downloading || !designArtifactsReady(this.state) || !this.state.robot) return null;
    const generation=this.generation;
    const resourceId=this.state.robot.id;
    this.publish({downloading:true,error:null});
    try {
      const response=await downloadProjectRobotRuntimePackage({path:{projectId:this.projectId,resourceId},signal:this.controller.signal});
      if (!this.live(generation)) return null;
      if (!designArtifactsReady(this.state) || this.state.robot?.id!==resourceId) return null;
      if (response.error || !(response.data instanceof Blob) || !response.data.size || response.data.size>270*1024*1024 || response.response?.headers.get('content-type')?.split(';')[0].trim()!=='application/zip') throw new Error();
      return response.data;
    } catch { if (this.live(generation)) this.publish({error:'模型包下载失败，请核实当前项目关联、权限与模型包完整性。'}); return null; }
    finally { if (this.live(generation)) this.publish({downloading:false}); }
  }
}
