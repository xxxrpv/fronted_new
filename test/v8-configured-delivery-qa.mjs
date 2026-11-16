import { enterPreviewDesign } from "./v8-preview-browser.mjs";
/** Isolated local UI: frozen configuration -> actual GLB -> source-specific delivery. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const base=process.env.V8_PREVIEW_URL||'http://127.0.0.1:3108/v8';
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname));
const output=resolve('test-results/v8-configured-delivery'); await mkdir(output,{recursive:true});
const report={execution:'isolated-local-development-preview',nativeCad:false,startedAt:new Date().toISOString(),cases:[],pageErrors:[],productionMutations:[]};
const browser=await chromium.launch({channel:process.env.V8_BROWSER_CHANNEL||'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(); page.setDefaultTimeout(22000);
page.on('pageerror',e=>report.pageErrors.push(e.message));
page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/v1/'))report.productionMutations.push(`${r.method()} ${r.url()}`);});
const key='embodex-v8-preview-v1';
const facts=id=>page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).projects.find(p=>p.id===id),{key,id});
async function poll(fn,label,timeout=35000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(160);}throw Error(`Timed out: ${label}`);}
const loaded=scope=>(scope||page).locator('[data-model-loaded="true"]').first().waitFor();
const shot=name=>page.screenshot({path:join(output,`${name}.png`),fullPage:true});
async function run(name,fn){try{const evidence=await fn();report.cases.push({name,status:'passed',evidence});console.log(`PASS ${name}`);}catch(error){report.cases.push({name,status:'failed',error:error.stack});console.error(`FAIL ${name}: ${error.message}`);await shot(`failure-${report.cases.length}`).catch(()=>{});}await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
async function setRange(locator,value){await locator.focus();await locator.press('Home');const min=Number(await locator.getAttribute('min')),step=Number(await locator.getAttribute('step'));for(let i=0;i<Math.round((value-min)/step);i++)await locator.press('ArrowRight');assert.equal(await locator.inputValue(),String(value));}
async function selectPart(scope,id){const rail=scope.getByRole('complementary',{name:'模型参数面板',exact:true});await rail.getByLabel('搜索零件',{exact:true}).fill(id);const options=rail.locator('.vpart-catalog button');await options.first().click();return rail;}
async function verifyFile(artifact){const response=await context.request.get(new URL(artifact.url,base).href);assert.equal(response.status(),200);const bytes=await response.body();assert.equal(bytes.length,artifact.sizeBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());const metadata=json.asset.extras.embodexConfiguredExport;assert.deepEqual(metadata.parameterSnapshot,artifact.parameterSnapshot);assert.deepEqual(metadata.provenance,artifact.modelRecipe.provenance);assert.equal(metadata.nativeCad,false);return{bytes:bytes.length,sha256:artifact.sha256,metadata};}
async function openReport(id,artifact){const row=page.locator('.vartifact').filter({has:page.getByText(artifact.fileName,{exact:true})});await row.getByRole('button',{name:'查看完整方案',exact:true}).click();const dialog=page.getByRole('dialog',{name:'完整设计方案',exact:true});await dialog.waitFor();const frame=dialog.locator('iframe').contentFrame();await frame.locator('.chapters a[href="#interactive"]').click();await loaded(frame);return{dialog,frame};}
const fixtures=[
 {id:'demo-example-q4-inspection',asset:'inspection-reference',parameter:'inspectionCameraHeight',part:'inspection.camera-assembly',label:'相机总成高度偏移'},
 {id:'demo-example-c2-logistics',asset:'mobile-reference',parameter:'mobileCameraHeight',part:'dock-camera',label:'对接相机高度偏移'},
];
const saved=new Map(); let aiSource,aiBranch,newRun,approvedSnapshot,oldModel;
try{
 await enterPreviewDesign(page,base);
 for(const f of fixtures)await run(`${f.asset}: save +25mm, actual GLB online and frozen report without double offset`,async()=>{
  await page.goto(`${base}/projects/${f.id}/library?template=${f.asset==="inspection-reference"?"sample-inspection":"sample-mobile"}`);await loaded();
  const rail=await selectPart(page,f.part);await setRange(rail.getByLabel(f.label,{exact:true}),25);
  const host=page.locator('[data-model-loaded="true"]').first();await poll(async()=>{const p=await host.getAttribute('data-part-world-before'),q=await host.getAttribute('data-part-world-after');return p&&q&&Math.abs(Number(q.split(',')[1])-Number(p.split(',')[1])-.005)<1e-8;},'actual last keyboard step +5mm to absolute25');
  await shot(`${f.asset}-25mm-layout`);
  await page.getByRole('button',{name:'保存适配并查看成果',exact:true}).click();await page.waitForURL(/\/delivery$/);
  const p=await poll(async()=>{const p=await facts(f.id);return p.artifacts.some(a=>a.kind==='model'&&a.modelRecipe&&a.status==='ready')&&p;},'configured file ready');
  const model=p.artifacts.filter(a=>a.kind==='model'&&a.modelRecipe).at(-1),html=p.artifacts.filter(a=>a.mimeType.startsWith('text/html')&&a.parameterSnapshot?.[f.parameter]===.025).at(-1);
  assert(model&&html);assert.equal(model.parameterSnapshot[f.parameter],.025);assert.equal(p.parameters[f.parameter],.025);assert.equal(model.status,'ready');const file=await verifyFile(model);
  const selected=await page.locator('[data-delivery-source]').getAttribute('data-delivery-source');assert(selected.startsWith(`template:${p.templateId}:`));
  const row=page.locator('.vartifact').filter({has:page.getByText(model.fileName,{exact:true})});await row.getByRole('button',{name:'在线查看',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'在线查看文件',exact:true});await modal.waitFor();await loaded(modal);
  assert.equal(await modal.locator('[data-model-loaded="true"]').getAttribute('data-model-sha256'),model.sha256);assert.deepEqual(JSON.parse(await modal.locator('[data-model-loaded="true"]').getAttribute('data-configured-parameters')),model.parameterSnapshot);await page.keyboard.press('Escape');
  const {frame}=await openReport(f.id,html),wrapper=frame.locator('[data-report-model-artifact]');
  assert.equal(await wrapper.getAttribute('data-report-model-artifact'),model.id);assert.equal(await wrapper.getAttribute('data-frozen-offset-mm'),'25');assert.equal(await wrapper.getAttribute('data-report-offset-mm'),'25');
  const reportHost=frame.locator('[data-model-loaded="true"]');assert.equal(await reportHost.getAttribute('data-model-sha256'),model.sha256);
  const reportRail=await selectPart(frame,f.part);await setRange(reportRail.getByLabel(f.label,{exact:true}),30);
  const movement=await poll(async()=>{const a=(await reportHost.getAttribute('data-part-world-before'))?.split(',').map(Number),b=(await reportHost.getAttribute('data-part-world-after'))?.split(',').map(Number);return a&&b&&Math.abs(b[1]-a[1]-.005)<1e-8&&{before:a,after:b};},'25 to 30 applies only +5mm');
  await reportRail.getByRole('button',{name:'还原',exact:true}).click();await poll(async()=>await wrapper.getAttribute('data-report-offset-mm')==='0','report resets absolute0');
  const reset=(await reportHost.getAttribute('data-part-world-after')).split(',').map(Number);assert(Math.abs(reset[1]-(movement.before[1]-.025))<1e-8,'reset restores true source Y');
  await shot(`${f.asset}-frozen-report`);await page.keyboard.press('Escape');
  const after=await facts(f.id);assert.deepEqual(after.parameters,p.parameters);assert.equal(after.artifacts.find(a=>a.id===model.id).sha256,model.sha256);saved.set(f.id,{model,html});return{...file,package:selected,reportInitial:25,adjustment:5,reset:0};
 });
 await run('AI parameters create a revision; confirmation/task/model freeze the exact +25mm source',async()=>{
  const id='demo-example-ai-review';await page.goto(`${base}/projects/${id}/concepts`);aiSource=await facts(id);aiBranch=aiSource.branches.find(b=>b.revisions.at(-1).assetKey==='inspection-reference');assert(aiBranch);
  await page.goto(`${base}/projects/${id}/concepts/${aiBranch.id}`);await loaded();await page.getByLabel('调整此概念支持的参数',{exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'部件参数',exact:true});await setRange(drawer.locator('#sensor-offset'),25);
  assert(await page.getByRole('button',{name:/确认 V\d+，开始 CAD 建模/}).isDisabled(),'unsaved parameters cannot be approved');
  await drawer.getByRole('button',{name:'保存参数为新版本',exact:true}).click();
  const p=await poll(async()=>{const p=await facts(id),b=p.branches.find(b=>b.id===aiBranch.id);return b.revisions.length===aiBranch.revisions.length+1&&p;},'parameter revision');
  const revision=p.branches.find(b=>b.id===aiBranch.id).revisions.at(-1);assert.equal(revision.parameterSnapshot.inspectionCameraHeight,.025);
  await page.getByRole('button',{name:'关闭面板',exact:true}).click().catch(()=>{});
  await page.getByRole('button',{name:/确认 V\d+，开始 CAD 建模/}).click();await page.getByRole('button',{name:'确认并创建样例工程任务',exact:true}).click();await page.waitForURL(/\/cad(?:\?|$)/);
  const ready=await poll(async()=>{const p=await facts(id),run=p.cadRuns.at(-1);return run.status==='succeeded'&&run.artifactIds.some(id=>p.artifacts.find(a=>a.id===id)?.status==='ready')&&p;},'configured CAD preview ready',45000);
  newRun=ready.cadRuns.at(-1);const approval=ready.approvals.find(a=>a.id===newRun.sourceApprovalId),task=ready.tasks.find(t=>t.id===newRun.taskId);oldModel=ready.artifacts.find(a=>newRun.artifactIds.includes(a.id));approvedSnapshot=structuredClone({approval,run:newRun,model:oldModel});
  assert.equal(newRun.revisionId,revision.id);assert.equal(newRun.sourceDescriptionId,revision.descriptionId);assert.equal(newRun.sourceDescription,revision.description);
  for(const record of [approval,newRun,task,oldModel])assert.deepEqual(record.parameterSnapshot,{inspectionCameraHeight:.025});assert.equal(task.sourceDescription,revision.description);assert.equal(newRun.validationStatus,'not_run');
  const file=await verifyFile(oldModel);await loaded();await page.getByRole('button',{name:'查看交付成果',exact:true}).click();await page.waitForURL(/\/delivery(?:\?|$)/);
  assert.equal(await page.locator('[data-delivery-source]').getAttribute('data-delivery-source'),`cad:${newRun.id}`);assert.equal(await page.locator('.vartifact').filter({has:page.getByText(oldModel.fileName,{exact:true})}).count(),1);await shot('ai-frozen-25mm-delivery');return{revisionId:revision.id,descriptionId:revision.descriptionId,approvalId:approval.id,cadRunId:newRun.id,...file};
 });
 await run('A later +30mm revision leaves the original approved CAD and delivery package unchanged',async()=>{
  assert(newRun);const id='demo-example-ai-review';await page.goto(`${base}/projects/${id}/concepts/${aiBranch.id}`);await loaded();await page.getByLabel('调整此概念支持的参数',{exact:true}).click();const drawer=page.getByRole('dialog',{name:'部件参数',exact:true});await setRange(drawer.locator('#sensor-offset'),30);await drawer.getByRole('button',{name:'保存参数为新版本',exact:true}).click();
  const p=await poll(async()=>{const p=await facts(id);return p.branches.find(b=>b.id===aiBranch.id).revisions.at(-1).parameterSnapshot.inspectionCameraHeight===.03&&p;},'30mm revision');
  assert.deepEqual(p.approvals.find(a=>a.id===approvedSnapshot.approval.id),approvedSnapshot.approval);assert.deepEqual(p.cadRuns.find(r=>r.id===newRun.id),approvedSnapshot.run);assert.deepEqual(p.artifacts.find(a=>a.id===oldModel.id),approvedSnapshot.model);
  await page.goto(`${base}/projects/${id}/cad?run=${newRun.id}`);await page.getByText('历史成果 · 需求或概念已更新',{exact:true}).waitFor();await loaded();assert.equal(await page.locator('[data-model-loaded="true"]').first().getAttribute('data-model-sha256'),oldModel.sha256);
  await page.getByRole('button',{name:'查看交付成果',exact:true}).click();await page.waitForURL(/\/delivery\?package=/);const history=page.locator(`[data-history-source="cad:${newRun.id}"]`);await history.waitFor();assert.equal(await page.locator('[data-delivery-source]').getAttribute('data-delivery-source'),'');const names=await history.locator('.vhistory-file>span').allTextContents();assert(names.includes(oldModel.fileName));assert.equal(await page.getByLabel('选择交付版本').count(),0);await shot('historic-25mm-package-after-30mm');return{frozenOffset:.025,newUnapprovedOffset:.03,package:`cad:${newRun.id}`,files:names};
 });
 await run('Invalid branch/revision/run/package deep links show explicit empty states without source mutation',async()=>{
  const id='demo-example-ai-review',before=await facts(id);const states=[];
  for(const url of [`concepts/not-a-branch`,`concepts/${aiBranch.id}?revision=not-a-revision`,'cad?run=not-a-run','delivery?package=not-a-package']){
   await page.goto(`${base}/projects/${id}/${url}`);await page.locator('main').waitFor();await delay(300);assert.equal(await page.locator('[data-model-loaded="true"]').count(),0,`${url} must not render fallback model`);assert.equal(await page.getByRole('button',{name:/确认 V\d+，开始 CAD 建模/}).count(),0);states.push({url,text:(await page.locator('main').innerText()).slice(-500)});
  }
  assert.deepEqual(await facts(id),before);return states;
 });
 await run('Online viewer rejects altered GLB bytes against the recorded SHA without model fallback',async()=>{
  const f=fixtures[0],savedFile=saved.get(f.id);assert(savedFile);await page.goto(`${base}/projects/${f.id}/delivery`);
  await context.route('**/api/v8-preview/models/**',async route=>{const response=await route.fetch();const bytes=await response.body();bytes[bytes.length-1]^=1;await route.fulfill({response,body:bytes});});
  const row=page.locator('.vartifact').filter({has:page.getByText(savedFile.model.fileName,{exact:true})});await row.getByRole('button',{name:'在线查看',exact:true}).click();await page.getByText('模型文件 SHA-256 与保存版本不一致，已停止加载。请重新核实文件来源。',{exact:true}).waitFor();assert.equal(await page.locator('[data-model-loaded="true"]').count(),0);await shot('tampered-model-blocked');await context.unroute('**/api/v8-preview/models/**');await page.keyboard.press('Escape');return{tampered:true,renderedModels:0};
 });
 await run('Export failure remains failed with no false-ready model; refresh retries the same frozen artifact',async()=>{
  const f=fixtures[1];await page.goto(`${base}/projects/${f.id}/library?template=${f.asset==="inspection-reference"?"sample-inspection":"sample-mobile"}`);await loaded();const rail=await selectPart(page,f.part);await setRange(rail.getByLabel(f.label,{exact:true}),35);
  await context.route('**/api/v8-preview/models/**',route=>route.fulfill({status:500,contentType:'application/json',body:'{"message":"QA controlled export unavailable"}'}));
  await page.getByRole('button',{name:'保存适配并查看成果',exact:true}).click();await page.waitForURL(/\/delivery$/);const failed=await poll(async()=>{const p=await facts(f.id);return p.artifacts.find(a=>a.kind==='model'&&a.parameterSnapshot?.[f.parameter]===.035&&a.status==='failed');},'failed artifact');
  assert.equal(failed.sizeBytes,0);assert(!failed.sha256);const row=page.locator('.vartifact').filter({has:page.getByText(failed.fileName,{exact:true})});assert(await row.getByRole('button',{name:'在线查看',exact:true}).isDisabled());await shot('export-failed-not-ready');
  await context.unroute('**/api/v8-preview/models/**');await page.getByRole('button',{name:'刷新文件状态',exact:true}).click();const ready=await poll(async()=>{const p=await facts(f.id);return p.artifacts.find(a=>a.id===failed.id&&a.status==='ready');},'same artifact retried');assert.equal(ready.url,failed.url);assert.deepEqual(ready.modelRecipe,failed.modelRecipe);return{artifactId:ready.id,before:'failed',after:'ready',...await verifyFile(ready)};
 });
 await run('Expired models stay in their exact historical package with online view disabled',async()=>{
  const f=fixtures[0],model=saved.get(f.id).model;await page.evaluate(({key,id,artifactId})=>{const store=JSON.parse(localStorage.getItem(key));store.projects.find(p=>p.id===id).artifacts.find(a=>a.id===artifactId).status='expired';localStorage.setItem(key,JSON.stringify(store));},{key,id:f.id,artifactId:model.id});await page.goto(`${base}/projects/${f.id}/delivery`);const row=page.locator('.vartifact').filter({has:page.getByText(model.fileName,{exact:true})});await row.waitFor();assert(await row.getByRole('button',{name:'在线查看',exact:true}).isDisabled());assert.equal(await page.locator('[data-model-loaded="true"]').count(),0);return{artifactId:model.id,status:'expired',download:false};
 });
 assert.equal(report.productionMutations.length,0);assert.equal(report.pageErrors.length,0);
}finally{report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;
