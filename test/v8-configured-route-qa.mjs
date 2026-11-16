/** Local developer export contract: actual bytes, immutable geometry and closed gates. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createJiti } from 'jiti';
import { Matrix4, Quaternion, Vector3 } from 'three';
const origin = process.env.V8_PREVIEW_ORIGIN || 'http://127.0.0.1:3108';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname));
const output = resolve('test-results/v8-configured-route');
await mkdir(output, { recursive:true });
const report = { execution:'local-configured-preview-only', nativeCad:false, startedAt:new Date().toISOString(), cases:[] };
const sha = value => createHash('sha256').update(value).digest('hex');
const parse = bytes => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const len = bytes.readUInt32LE(12);
  return { json:JSON.parse(bytes.subarray(20,20+len).toString('utf8')), binary:bytes.subarray(20+len) };
};
const worlds = document => {
  const result = new Map();
  function visit(id,parent) {
    const node = document.nodes[id];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1])));
    const world = parent.clone().multiply(local); result.set(id,world);
    for (const child of node.children || []) visit(child,world);
  }
  for(const id of document.scenes[document.scene||0].nodes) visit(id,new Matrix4());
  return result;
};
const fixtures = [
  {asset:'inspection-reference',parameter:'inspectionCameraHeight',part:'inspection.camera-assembly',template:'sample-inspection'},
  {asset:'mobile-reference',parameter:'mobileCameraHeight',part:'dock-camera',template:'sample-mobile'},
  {asset:'go2-high-fidelity',template:'sample-go2'},
];
const recipeFor = f => ({assetKey:f.asset,parameterSnapshot:f.parameter?{[f.parameter]:.025}:{},provenance:{projectId:'route-qa-project',requirementId:'route-qa-requirement',templateId:f.template}});
const address = (recipe,asset=recipe.assetKey) => `${origin}/api/v8-preview/models/${asset}?recipe=${encodeURIComponent(JSON.stringify(recipe))}`;
async function run(name,fn) {
  try { const evidence=await fn(); report.cases.push({name,status:'passed',evidence}); console.log(`PASS ${name}`); }
  catch(error) { report.cases.push({name,status:'failed',error:error.stack}); console.error(`FAIL ${name}: ${error.message}`); }
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
}
for(const fixture of fixtures) await run(`${fixture.asset}: GET/HEAD hash, binary preservation and exact world offset`,async()=>{
  const recipe = recipeFor(fixture), sourceBytes=await readFile(`public/v8-assets/${fixture.asset}.glb`), before=sha(sourceBytes);
  const response=await fetch(address(recipe)), bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'model/gltf-binary');
  assert.equal(response.headers.get('x-v8-execution'),'local-configured-preview');
  assert.equal(Number(response.headers.get('content-length')),bytes.length);
  assert.equal(response.headers.get('x-v8-sha256'),sha(bytes));
  assert.equal(response.headers.get('x-v8-source-sha256'),before);
  const source=parse(sourceBytes), exported=parse(bytes), metadata=exported.json.asset.extras.embodexConfiguredExport;
  assert.deepEqual(exported.binary,source.binary,'all mesh BIN bytes retained');
  for(const key of ['meshes','accessors','bufferViews','materials','scenes']) assert.deepEqual(exported.json[key],source.json[key],key);
  assert.deepEqual(metadata.parameterSnapshot,recipe.parameterSnapshot); assert.deepEqual(metadata.provenance,recipe.provenance);
  assert.equal(metadata.nativeCad,false); assert.equal(metadata.engineeringVerified,false); assert.equal(metadata.sourceSha256,before);
  const originalWorlds=worlds(source.json), exportedWorlds=worlds(exported.json);
  const partIndex=fixture.part?source.json.nodes.findIndex(n=>n.extras?.assemblyId===fixture.part):-1;
  if(fixture.part) assert(partIndex>=0);
  const descendants=new Set(); const walk=id=>{descendants.add(id);for(const c of source.json.nodes[id].children||[])walk(c);}; if(partIndex>=0)walk(partIndex);
  let meshCount=0;
  for(const [id,matrix] of originalWorlds) {
    if(source.json.nodes[id].mesh===undefined) continue; meshCount++;
    const expected=matrix.clone(); if(descendants.has(id)) expected.elements[13]+=.025;
    expected.elements.forEach((value,i)=>assert(Math.abs(value-exportedWorlds.get(id).elements[i])<1e-9,`${fixture.asset} mesh node ${id} coordinate ${i}`));
  }
  const head=await fetch(address(recipe),{method:'HEAD'}); assert.equal(head.status,200); assert.equal((await head.arrayBuffer()).byteLength,0); assert.equal(head.headers.get('x-v8-sha256'),sha(bytes)); assert.equal(Number(head.headers.get('content-length')),bytes.length);
  const conditional=await fetch(address(recipe),{headers:{'If-None-Match':response.headers.get('etag')}}); assert.equal(conditional.status,304); assert.equal((await conditional.arrayBuffer()).byteLength,0);
  assert.equal(sha(await readFile(`public/v8-assets/${fixture.asset}.glb`)),before);
  return {bytes:bytes.length,sha256:sha(bytes),sourceSha256:before,meshCount,worldYOffset:fixture.part?.025:0,head:200,conditional:304};
});
await run('Reject unknown assets, mixed or missing sources, unsupported/out-of-range parameters and oversized recipe',async()=>{
  const good=recipeFor(fixtures[0]);
  const invalid=[
    ['unknown asset',{...good,assetKey:'quadruped'},'quadruped'],
    ['asset mismatch',good,'mobile-reference'],
    ['missing requirement',{...good,provenance:{projectId:'p',templateId:'t'}}],
    ['mixed sources',{...good,provenance:{...good.provenance,approvalId:'a'}}],
    ['incomplete CAD refs',{...good,provenance:{projectId:'p',requirementId:'r',approvalId:'a'}}],
    ['offset too large',{...good,parameterSnapshot:{inspectionCameraHeight:.051}}],
    ['unsupported parameter',{...good,parameterSnapshot:{wheelRadius:.02}}],
    ['string parameter',{...good,parameterSnapshot:{inspectionCameraHeight:'0.025'}}],
    ['extra recipe field',{...good,sourcePath:'C:/private'}],
  ];
  const statuses=[];
  for(const [name,recipe,asset] of invalid) {const response=await fetch(address(recipe,asset));assert([400,422].includes(response.status),`${name}: ${response.status}`);statuses.push({name,status:response.status});}
  const missing=await fetch(`${origin}/api/v8-preview/models/inspection-reference`); assert.equal(missing.status,400);
  const oversized=await fetch(`${origin}/api/v8-preview/models/inspection-reference?recipe=${'x'.repeat(8193)}`); assert.equal(oversized.status,400);
  return statuses;
});
await run('Production and disabled-preview handler return 404 before reading the model',async()=>{
  const previous={node:process.env.NODE_ENV,preview:process.env.ENABLE_V8_PREVIEW};
  const jiti=createJiti(import.meta.url); const route=await jiti.import('../app/api/v8-preview/models/[assetKey]/route.ts');
  try {
    for(const [node,preview] of [['production','1'],['development','0']]) {
      process.env.NODE_ENV=node; process.env.ENABLE_V8_PREVIEW=preview;
      for(const method of ['GET','HEAD']) {const response=await route[method](new Request(address(recipeFor(fixtures[0])),{method}),{params:Promise.resolve({assetKey:'inspection-reference'})}); assert.equal(response.status,404);}
    }
  } finally {for(const [key,value] of [['NODE_ENV',previous.node],['ENABLE_V8_PREVIEW',previous.preview]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  return {production:404,previewDisabled:404,nativeCad:false};
});
report.finishedAt=new Date().toISOString(); await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;
