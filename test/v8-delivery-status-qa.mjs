/** Isolated saved-state UI check; never submits or advances a design task. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const base='http://127.0.0.1:3108/v8',key='embodex-v8-preview-v1',id='demo-example-q4-inspection';
const output=resolve('test-results/v8-delivery-status');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const report={execution:'isolated-local-preview-saved-state-fixtures',startedAt:new Date().toISOString(),cases:[],productionMutations:[],pageErrors:[]};
page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/v1/'))report.productionMutations.push(`${r.method()} ${r.url()}`);});
const read=()=>page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).projects.find(p=>p.id===id),{key,id});
let original,originalAI;
async function state(name,patch,label,ready,{legacy=false,history=false,sourceProject}={}){
 const p=structuredClone(sourceProject||original);patch(p);const before={tasks:p.tasks,approvals:p.approvals,cadRuns:p.cadRuns};
 await page.evaluate(({key,p})=>{const s=JSON.parse(localStorage.getItem(key));s.projects[s.projects.findIndex(x=>x.id===p.id)]=p;localStorage.setItem(key,JSON.stringify(s));},{key,p});
 const model=p.artifacts.find(a=>a.kind==='model');await page.goto(`${base}/projects/${p.id}/delivery${legacy?`?package=${encodeURIComponent(`unresolved:${model.id}`)}`:''}`);
 await page.getByRole('heading',{name:'设计成果',exact:true}).waitFor();const summary=page.locator('.vdelivery-summary');await summary.getByText(label,{exact:true}).waitFor();
 assert.equal(await summary.locator('.vdelivery-check.pending').count(),ready?0:1);
 const cad=page.locator('.vstagebar button').filter({hasText:'工程模型'});assert.equal(await cad.locator('span svg').count(),ready?1:0);
 if(!ready)assert.equal(await cad.locator('span').first().innerText(),'04');
 if(history)assert.equal(await page.getByLabel('选择交付版本').inputValue(),`template:${p.templateId}:${p.requirements.at(-1).id}:{"inspectionCameraHeight":0.025}`);
 await page.screenshot({path:join(output,`${name}.png`),fullPage:false});
 await page.goto(`${base}/projects/${p.id}/${p.route==='library'?'library':'concepts'}`);await page.locator('.vstagebar').waitFor();
 const delivery=page.locator('.vstagebar button').filter({hasText:'成果交付'});assert.equal(await delivery.locator('span svg').count(),ready?1:0);if(!ready)assert.equal(await delivery.locator('span').first().innerText(),'05');
 const after=await page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).projects.find(p=>p.id===id),{key,id:p.id});assert.deepEqual({tasks:after.tasks,approvals:after.approvals,cadRuns:after.cadRuns},before);
 return{summary:label,greenComplete:ready,taskMutation:false};
}
try{
 await page.goto(`${base}/projects/${id}/delivery`);await page.getByRole('heading',{name:'设计成果',exact:true}).waitFor();original=await read();originalAI=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).projects.find(p=>p.id==='demo-example-ai-review'),key);
 for(const [name,patch,label,ready,options] of [
  ['01-complete',()=>{},'文件已就绪',true],
  ['02-preparing',p=>{p.artifacts.find(a=>a.kind==='model').status='validating';},'文件准备中',false],
  ['03-failed-file',p=>{const a=p.artifacts.find(a=>a.kind==='model');a.status='failed';a.error='QA 保存状态：配置文件准备失败';},'部分文件可用',false],
  ['04-legacy',p=>{for(const a of p.artifacts){delete a.requirementId;delete a.assetKey;delete a.parameterSnapshot;}},'历史文件 · 来源不完整',false,{legacy:true}],
  ['05-old-ready-current-documents',p=>{p.parameters={inspectionCameraHeight:.025};p.artifacts.push(...p.artifacts.filter(a=>a.kind==='design_document').map(a=>({...a,id:`${a.id}-new`,fileName:`new-${a.fileName}`,parameterSnapshot:{inspectionCameraHeight:.025}})));},'部分文件可用',false,{history:true}],
  ['06-approved-design-documents-only',p=>{p.cadRuns=[];p.tasks=[];p.artifacts=p.artifacts.filter(a=>a.kind==='design_document');assert(p.approvals.length>0);assert(p.artifacts.length>0);},'部分文件可用',false,{sourceProject:originalAI}],
 ]){
  try{const evidence=await state(name,patch,label,ready,options);report.cases.push({name,status:'passed',evidence});console.log(`PASS ${name}`);}catch(error){report.cases.push({name,status:'failed',error:error.stack});console.error(`FAIL ${name}: ${error.message}`);}
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 }
 assert.equal(report.productionMutations.length,0);assert.equal(report.pageErrors.length,0);
}finally{report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;
