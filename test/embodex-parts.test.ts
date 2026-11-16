import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { client } from '../lib/api/client';
import { EmbodexPartsSession, parseOriginalUrdf } from '../lib/embodex/parts';
import type { Resource } from '../lib/api/generated/types.gen';
const user='00000000-0000-4000-8000-000000000001',project='00000000-0000-4000-8000-000000000002',a='00000000-0000-4000-8000-000000000003',b='00000000-0000-4000-8000-000000000004';
const time='2026-10-13T00:00:00Z';const robot=(id:string):Resource=>({id,type:'ROBOT',scope:'PROJECT',sourceModule:'embodex',externalId:'fixture',version:'1',displayMetadata:{name:id,description:'',tags:[],specifications:{}},myProjectCount:1,createdAt:time,updatedAt:time});
const xml='\uFEFF<?xml version="1.0"?><robot name="original"><link name="move_base"/><link name="arm"><visual/></link><joint name="hinge" type="revolute"><parent link="move_base"/><child link="arm"/><origin xyz="1 2 3" rpy="0 0 1"/><axis xyz="0 1 0"/></joint></robot>';
// Browser DOMParser is native. Offline tests provide its direct DOM result to test
// the actual graph reader, not an alternate XML parser or XML validity claim.
interface FixtureElement {localName:string;namespaceURI:null;children:FixtureElement[];getAttribute:(key:string)=>string|null}
const element=(name:string,attrs:Record<string,string>={},children:FixtureElement[]=[]):FixtureElement=>({localName:name,namespaceURI:null,children,getAttribute:(key:string)=>attrs[key]??null});
const root=()=>element('robot',{},[element('link',{name:'move_base'}),element('link',{name:'arm'},[element('visual')]),element('joint',{name:'hinge',type:'revolute'},[element('parent',{link:'move_base'}),element('child',{link:'arm'}),element('origin',{xyz:'1 2 3',rpy:'0 0 1'}),element('axis',{xyz:'0 1 0'})])]);
let documentRoot=root(),malformed=false,parseCalls=0;
const doc=()=>{const all:FixtureElement[]=[];const visit=(e:FixtureElement)=>{all.push(e);e.children.forEach(visit);};visit(documentRoot);return{documentElement:documentRoot,getElementsByTagName:(name:string)=>name==='parsererror'?(malformed?[{}]:[]):all.filter(e=>e.localName===name)};};
const originalParser=globalThis.DOMParser,originalGet=client.get;const sessions:EmbodexPartsSession[]=[];
const packet=async(id=a,body=xml,extra:Record<string,string>={})=>{const bytes=new TextEncoder().encode(body),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');return{data:bytes.buffer,response:new Response(null,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store','x-embodix-resource-id':id,'x-embodix-model-id':b,'x-embodix-manifest-sha256':'a'.repeat(64),'x-embodix-urdf-sha256':hash,...extra}})};};
const setGet=(handler:(options:{url:string;signal?:AbortSignal;parseAs?:string;path?:{resourceId?:string}})=>unknown)=>{client.get=handler as unknown as typeof client.get;};
const make=()=>{const s=new EmbodexPartsSession(user,project,()=>{});sessions.push(s);return s;};
const list={data:{items:[robot(a),robot(b)],pageInfo:{hasMore:false,nextCursor:null}}};
describe('Task015 original URDF parts (offline)',()=>{
  beforeEach(()=>{documentRoot=root();malformed=false;parseCalls=0;globalThis.DOMParser=class{parseFromString(){parseCalls++;return doc();}} as unknown as typeof DOMParser;});
  afterEach(()=>{sessions.splice(0).forEach(s=>s.dispose());client.get=originalGet;globalThis.DOMParser=originalParser;});
  test('graph counts retain virtual root while physical cards omit it; originals remain byte exact',async()=>{setGet(async o=>o.url.endsWith('/urdf')?packet():list);const s=make();await s.loadRobots();assert.equal(s.state.selectedId,'');assert.equal(s.state.parts.length,0);await s.select(a);assert.equal(s.state.error,null);assert.equal(s.state.xml,xml);assert.equal(new TextDecoder('utf-8',{ignoreBOM:true}).decode(s.state.bytes!),xml);assert.equal(s.state.linkCount,2);assert.equal(s.state.jointCount,1);assert.equal(s.state.parts.length,1);assert.deepEqual(s.state.parts[0],{uid:'urdf-1-arm',label:'arm',role:'URDF Link · 只读',parentLink:'move_base',visualsCount:1,linkName:'arm',jointName:'hinge',jointType:'revolute',xyz:'1 2 3',rpy:'0 0 1',axis:'0 1 0'});assert.deepEqual(new Uint8Array(await new Blob([s.state.bytes!]).arrayBuffer()),new TextEncoder().encode(xml));});
  test('DTD/entity, parsererror, nested links and bad joint endpoints fail closed',()=>{assert.throws(()=>parseOriginalUrdf('<!DOCTYPE robot [<!ENTITY e SYSTEM "x">]><robot/>'));assert.equal(parseCalls,0);malformed=true;assert.throws(()=>parseOriginalUrdf('malformed'));malformed=false;documentRoot.children.push(element('wrapper',{},[element('link',{name:'nested'})]));assert.throws(()=>parseOriginalUrdf(xml));documentRoot=root();documentRoot.children[2].children[0]=element('parent',{link:'absent'});assert.throws(()=>parseOriginalUrdf(xml));});
  test('identity/hash/UTF8/size/mime/cache failures never expose XML or cards',async()=>{for(const extra of ([{'x-embodix-resource-id':b},{'x-embodix-model-id':'bad'},{'x-embodix-urdf-sha256':'b'.repeat(64)},{'cache-control':'public'},{'content-type':'text/html'}] as Record<string,string>[])){setGet(async o=>o.url.endsWith('/urdf')?packet(a,xml,extra):list);const s=make();await s.loadRobots();await s.select(a);assert(s.state.error);assert.equal(s.state.xml,null);assert.deepEqual(s.state.parts,[]);}
    const invalid=new Uint8Array([0xff]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',invalid)),x=>x.toString(16).padStart(2,'0')).join('');const p=await packet(a,xml,{'x-embodix-urdf-sha256':hash});setGet(async o=>o.url.endsWith('/urdf')?{...p,data:invalid.buffer}:list);const s=make();await s.loadRobots();await s.select(a);assert(s.state.error);
    setGet(async o=>o.url.endsWith('/urdf')?{...p,data:new ArrayBuffer(4194305)}:list);await s.select(a);assert(s.state.error);});
  test('explicit selection clears prior bytes immediately and suppresses late transports ignoring abort',async()=>{let finish!:(value:unknown)=>void;let calls=0;setGet(async o=>o.url.endsWith('/urdf')?(++calls===1?await new Promise(resolve=>{finish=resolve;}):packet(b)):list);const s=make();await s.loadRobots();const old=s.select(a);assert.equal(s.state.bytes,null);await s.select(b);finish(await packet(a));await old;assert.equal(s.state.selectedId,b);assert.equal(s.state.xml,xml);await s.select('');assert.equal(s.state.xml,null);assert.deepEqual(s.state.parts,[]);});
  test('authoritative empty/error never invents demo; owner disposal suppresses late list and bytes',async()=>{setGet(async()=>({data:{items:[],pageInfo:{hasMore:false}}}));const s=make();await s.loadRobots();assert.deepEqual(s.state.robots,[]);await s.select(a);assert(s.state.error);assert.equal(s.state.bytes,null);let finish!:(value:unknown)=>void;setGet(()=>new Promise(resolve=>{finish=resolve;}));const old=s.loadRobots();s.dispose();finish(list);await old;assert.deepEqual(s.state.robots,[]);});
  test('a late produced-resource list refresh cannot override a newer explicit selection',async()=>{setGet(async o=>o.url.endsWith('/urdf')?packet(o.path?.resourceId===b?b:a):list);const s=make();await s.loadRobots();let finish!:(value:unknown)=>void;setGet(o=>o.url.endsWith('/urdf')?packet(b):new Promise(resolve=>{finish=resolve;}));const refresh=s.loadRobots(a);await s.select(b);finish(list);await refresh;assert.equal(s.state.selectedId,b);});
  test('full package download uses current authorized resource, rejects MIME and selection/dispose stale completion',async()=>{setGet(async o=>o.url.endsWith('/urdf')?packet():list);const s=make();await s.loadRobots();await s.select(a);let finish!:(value:unknown)=>void;setGet(o=>{assert.equal(o.path?.resourceId,a);assert.equal(o.parseAs,'blob');return new Promise(resolve=>{finish=resolve;});});const download=s.downloadPackage();await s.select('');finish({data:new Blob(['zip']),response:new Response(null,{headers:{'content-type':'application/zip'}})});assert.equal(await download,null);assert.equal(s.state.downloading,false);});
  test('package MIME/cache rejection keeps the original model and does not return unsafe download',async()=>{setGet(async o=>o.url.endsWith('/urdf')?packet():list);const s=make();await s.loadRobots();await s.select(a);for(const headers of [{'content-type':'text/plain','cache-control':'no-store'},{'content-type':'application/zip','cache-control':'public'}]){setGet(async()=>({data:new Blob(['unsafe']),response:new Response(null,{headers})}));assert.equal(await s.downloadPackage(),null);assert(s.state.error);assert.equal(s.state.xml,xml);}});
  test('root links without in-edge joints are identified and limits are extracted', () => {
    documentRoot = element('robot', {}, [
      element('link', { name: 'base_link' }, [element('visual')]),
      element('link', { name: 'link1' }, [element('visual')]),
      element('joint', { name: 'joint1', type: 'revolute' }, [
        element('parent', { link: 'base_link' }),
        element('child', { link: 'link1' }),
        element('origin', { xyz: '0 0 0.5', rpy: '0 0 0' }),
        element('axis', { xyz: '0 0 1' }),
        element('limit', { lower: '-3.14', upper: '3.14', effort: '10', velocity: '2.5' }),
      ]),
    ]);
    const parsed = parseOriginalUrdf('<robot name="demo"/>');
    assert.equal(parsed.linkCount, 2);
    assert.equal(parsed.jointCount, 1);
    assert.equal(parsed.rootLinkName, 'base_link');
    assert.equal(parsed.parts.length, 2);
    assert.equal(parsed.parts[0].linkName, 'base_link');
    assert.equal(parsed.parts[0].role, '根连杆 · 无关节');
    assert.equal(parsed.parts[0].jointType, '—');
    assert.equal(parsed.parts[0].parentLink, '—');
    assert.equal(parsed.parts[1].linkName, 'link1');
    assert.equal(parsed.parts[1].jointType, 'revolute');
    assert.deepEqual(parsed.parts[1].limit, { lower: '-3.14', upper: '3.14', effort: '10', velocity: '2.5' });
  });
  test('transmission and gazebo sub-elements containing link or joint text/ref are not mistaken for root graph elements', () => {
    documentRoot = element('robot', {}, [
      element('link', { name: 'base' }),
      element('link', { name: 'arm' }),
      element('joint', { name: 'hinge', type: 'revolute' }, [
        element('parent', { link: 'base' }),
        element('child', { link: 'arm' }),
      ]),
      // Gazebo plot tag with <link>text</link> (no name attr)
      element('gazebo', {}, [
        element('plugin', {}, [
          element('plot', {}, [
            element('link', {}),
          ]),
        ]),
      ]),
      // Transmission tag with <joint name="hinge"/> (no type attr or parent child)
      element('transmission', { name: 'hinge_tran' }, [
        element('joint', { name: 'hinge' }),
      ]),
    ]);
    const parsed = parseOriginalUrdf('<robot name="demo"/>');
    assert.equal(parsed.linkCount, 2);
    assert.equal(parsed.jointCount, 1);
    assert.equal(parsed.parts.length, 2);
  });
});
