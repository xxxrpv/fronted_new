import { getProjectRobotRuntimeUrdf, downloadProjectRobotRuntimePackage } from '../api/client';
import type { Resource } from '../api/generated/types.gen';
import { fetchProjectRobots } from '../ue-runtime';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sha=/^[a-f0-9]{64}$/;
export interface UrdfPart { uid:string;label:string;role:string;parentLink:string;visualsCount:number;linkName:string;jointName:string;jointType:string;xyz:string;rpy:string;axis:string;limit?:{lower:string;upper:string;effort:string;velocity:string} }
export interface ParsedUrdf { parts:UrdfPart[];linkCount:number;jointCount:number;rootLinkName?:string }
const direct=(element:Element,name:string)=>Array.from(element.children).filter(child=>child.localName===name && !child.namespaceURI);
export function parseOriginalUrdf(xml:string):ParsedUrdf {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsafe XML');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const robot=doc.documentElement;
  if(doc.getElementsByTagName('parsererror').length || robot.localName!=='robot' || robot.namespaceURI)throw new Error('Invalid XML');
  const links=direct(robot,'link'),joints=direct(robot,'joint');
  const allNamedLinks=Array.from(doc.getElementsByTagName('link')).filter(e=>e.getAttribute('name')!==null);
  const allDefinedJoints=Array.from(doc.getElementsByTagName('joint')).filter(e=>e.getAttribute('type')!==null||direct(e,'parent').length>0);
  if(!links.length || links.length>512 || joints.length>512 || allNamedLinks.length!==links.length || allDefinedJoints.length!==joints.length)throw new Error('Invalid graph');
  const names=new Set(links.map(link=>link.getAttribute('name')));if(names.has(null)||names.has('')||names.size!==links.length)throw new Error('Invalid links');
  const jointNames=new Set<string>();const byChild=new Map<string,Element>();
  for(const joint of joints){const parent=direct(joint,'parent'),child=direct(joint,'child'),name=joint.getAttribute('name')||'',target=child[0]?.getAttribute('link')||'';
    if(!name||jointNames.has(name)||parent.length!==1||child.length!==1||!names.has(parent[0].getAttribute('link'))||!names.has(target)||byChild.has(target))throw new Error('Invalid joints');
    jointNames.add(name);byChild.set(target,joint);
  }
  const rootLinks=links.map(l=>l.getAttribute('name')!).filter(n=>!byChild.has(n));
  const rootLinkName=rootLinks[0]||'—';
  const parts=links.flatMap((link,index)=>{const linkName=link.getAttribute('name')!,joint=byChild.get(linkName),visuals=direct(link,'visual');
    if(!joint&&!visuals.length&&/^(world|map|odom|move_base)$/i.test(linkName))return [];
    const origin=joint?direct(joint,'origin')[0]:undefined,axis=joint?direct(joint,'axis')[0]:undefined;
    const limitEl=joint?direct(joint,'limit')[0]:undefined;
    const part:UrdfPart={uid:`urdf-${index}-${linkName}`,label:linkName,role:joint?'URDF Link · 只读':'根连杆 · 无关节',parentLink:joint?direct(joint,'parent')[0].getAttribute('link')!:'—',visualsCount:visuals.length,linkName,jointName:joint?.getAttribute('name')||'—',jointType:joint?(joint.getAttribute('type')||'unknown'):'—',xyz:origin?.getAttribute('xyz')||'0 0 0',rpy:origin?.getAttribute('rpy')||'0 0 0',axis:axis?.getAttribute('xyz')||'0 0 1'};
    if(limitEl){
      part.limit={lower:limitEl.getAttribute('lower')||'—',upper:limitEl.getAttribute('upper')||'—',effort:limitEl.getAttribute('effort')||'—',velocity:limitEl.getAttribute('velocity')||'—'};
    }
    return [part];
  });return {parts,linkCount:links.length,jointCount:joints.length,rootLinkName};
}
export interface PartsState {userId:string;projectId:string;robots:Resource[];selectedId:string;loading:boolean;loadingRobots:boolean;downloading:boolean;error:string|null;xml:string|null;bytes:ArrayBuffer|null;modelId:string|null;manifestSha256:string|null;parts:UrdfPart[];linkCount:number;jointCount:number}
export const initialPartsState=(userId:string,projectId:string):PartsState=>({userId,projectId,robots:[],selectedId:'',loading:false,loadingRobots:false,downloading:false,error:null,xml:null,bytes:null,modelId:null,manifestSha256:null,parts:[],linkCount:0,jointCount:0});
export class EmbodexPartsSession {
  state:PartsState;private active=true;private generation=0;private listGeneration=0;private controller=new AbortController();private listController=new AbortController();
  constructor(readonly userId:string,readonly projectId:string,private publish:(state:PartsState)=>void){this.state=initialPartsState(userId,projectId);}
  private update(value:Partial<PartsState>){if(this.active){this.state={...this.state,...value};this.publish(this.state);}}
  dispose(){this.active=false;this.controller.abort();this.listController.abort();}
  async loadRobots(selectProducedId?:string){this.listController.abort();this.listController=new AbortController();const generation=++this.listGeneration,selectionGeneration=this.generation;this.update({loadingRobots:true,error:null});
    try{const robots=await fetchProjectRobots(this.projectId,this.listController.signal);if(!this.active||generation!==this.listGeneration)return;this.update({robots});if(this.state.selectedId&&!robots.some(robot=>robot.id===this.state.selectedId))await this.select('');if(selectProducedId&&selectionGeneration===this.generation){if(!robots.some(robot=>robot.id===selectProducedId))throw new Error();await this.select(selectProducedId);}}
    catch{if(this.active&&generation===this.listGeneration){await this.select('');this.update({robots:[],error:'项目模型列表读取失败，请刷新；不会显示示例产物。'});}}
    finally{if(this.active&&generation===this.listGeneration)this.update({loadingRobots:false});}
  }
  async select(resourceId:string){this.controller.abort();this.controller=new AbortController();const generation=++this.generation;this.update({selectedId:resourceId,loading:!!resourceId,downloading:false,error:null,xml:null,bytes:null,modelId:null,manifestSha256:null,parts:[],linkCount:0,jointCount:0});if(!resourceId)return;
    try{if(!uuid.test(resourceId)||!this.state.robots.some(robot=>robot.id===resourceId&&robot.type==='ROBOT'))throw new Error();
      const result=await getProjectRobotRuntimeUrdf({path:{projectId:this.projectId,resourceId},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(30000)]),parseAs:'arrayBuffer',cache:'no-store'});
      if(!this.active||generation!==this.generation)return;const data:unknown=result.data,headers=result.response?.headers;
      if(result.error||!headers||!(data instanceof ArrayBuffer)||!data.byteLength||data.byteLength>4194304||!headers.get('content-type')?.toLowerCase().startsWith('application/xml')||headers.get('cache-control')!=='no-store'||headers.get('x-embodix-resource-id')?.toLowerCase()!==resourceId.toLowerCase())throw new Error();
      const modelId=headers.get('x-embodix-model-id')||'',manifestSha256=headers.get('x-embodix-manifest-sha256')||'',urdfSha=headers.get('x-embodix-urdf-sha256')||'';if(!uuid.test(modelId)||!sha.test(manifestSha256)||!sha.test(urdfSha))throw new Error();
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');if(actual!==urdfSha)throw new Error();
      const xml=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data),parsed=parseOriginalUrdf(xml);if(this.active&&generation===this.generation)this.update({xml,bytes:data,modelId,manifestSha256,...parsed});
    }catch{if(this.active&&generation===this.generation)this.update({error:'模型原 URDF 读取或完整性校验失败，请重新选择或刷新。'});}
    finally{if(this.active&&generation===this.generation)this.update({loading:false});}
  }
  async downloadPackage():Promise<Blob|null>{if(!this.active||!this.state.bytes||this.state.downloading)return null;const generation=this.generation,resourceId=this.state.selectedId;this.update({downloading:true,error:null});try{const result=await downloadProjectRobotRuntimePackage({path:{projectId:this.projectId,resourceId},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(30000)]),parseAs:'blob',cache:'no-store'});if(!this.active||generation!==this.generation)return null;const data:unknown=result.data;if(result.error||!(data instanceof Blob)||data.size>270*1024*1024||result.response?.headers.get('cache-control')!=='no-store'||!result.response?.headers.get('content-type')?.startsWith('application/zip'))throw new Error();return data;}catch{if(this.active&&generation===this.generation)this.update({error:'完整模型包下载失败，请核实当前项目权限。'});return null;}finally{if(this.active&&generation===this.generation)this.update({downloading:false});}}
}
