import { enterPreviewDesign } from "./v8-preview-browser.mjs";
/** Product behaviors reviewed against the V8 brief; isolated browser storage only. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base=process.env.V8_PREVIEW_URL||'http://127.0.0.1:3108/v8';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const output=resolve('test-results/v8-product-review/behavior');await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),cases:[],errors:[],productionMutations:[]};
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
let page,context;
const all=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('embodex-v8-preview-v1')).projects);
const facts=async(id)=>(await all()).find(p=>p.id===id);
const q4='demo-example-q4-inspection',custom='demo-example-ai-review';
async function goto(path=''){await page.goto(base+(path || "/embodex"));await page.locator('main h1').first().waitFor();}
async function loaded(){await page.locator('[data-model-loaded="true"]').first().waitFor();}
async function range(locator,value){await locator.focus();await locator.press('Home');const min=Number(await locator.getAttribute('min')),step=Number(await locator.getAttribute('step'));for(let i=0;i<(value-min)/step;i++)await locator.press('ArrowRight');assert.equal(await locator.inputValue(),String(value));}
async function camera(){const rail=page.getByRole('complementary',{name:'模型参数面板',exact:true});await rail.getByLabel('搜索零件',{exact:true}).fill('inspection.camera-assembly');await rail.locator('.vpart-catalog button').first().click();return page.getByLabel('相机总成高度偏移',{exact:true});}
async function mainActionVisible(button){const box=await button.boundingBox();assert(box&&box.y>=0&&box.y+box.height<=1000,'primary action should fit initial desktop viewport');assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'primary action must not be covered');}
async function run(name,fn){context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/v1/'))report.productionMutations.push(r.url());});try{await enterPreviewDesign(page,base);await fn();report.cases.push({name,status:'passed'});console.log('PASS',name);}catch(error){report.cases.push({name,status:'failed',error:error.stack});await page.screenshot({path:`${output}/failure-${report.cases.length}.png`}).catch(()=>{});console.error('FAIL',name,error.message);}finally{await context.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}}
try{
 await run('Workspace retains typed intent; catalog browsing creates no project until explicit use',async()=>{
  const before=await all();await page.getByLabel('描述你的设计目标').fill('我的设计目标，保留原有输入');
  await page.locator('.vsidebar').getByRole('button',{name:/专业定制/}).click();
  assert.equal(await page.getByLabel('描述你的设计目标').inputValue(),'我的设计目标，保留原有输入');
  await page.locator('.ventry-options button').first().click();
  const modal=page.getByRole('dialog',{name:'模板库',exact:true});await modal.waitFor();
  assert.equal(await modal.locator('article').count(),3);assert.deepEqual(await all(),before);
  await modal.getByRole('button',{name:'用此模型开始设计',exact:true}).last().click();
  await page.waitForURL(/\/library\?template=sample-mobile/);await loaded();
  const projects=await all();assert.equal(projects.length,before.length+1);const p=projects.find(p=>!before.some(b=>b.id===p.id));
  assert.equal(p.route,'library');assert.equal(p.tasks.length,0);assert.equal(p.cadRuns.length,0);
 });
 await run('Navigation to AI route selection is read-only and recommendation follows the selected project',async()=>{
  await goto(`/projects/${q4}/library?template=sample-inspection`);await loaded();const before=await facts(q4);
  await page.locator('.vsidebar').getByRole('button',{name:/专业定制/}).click();
  await page.waitForURL(/\/start$/);assert.deepEqual(await facts(q4),before);
  await page.locator('.vstart-card').first().getByRole('heading',{name:'模板库',exact:true}).waitFor();
  assert.equal(await page.locator('.vstart-card').first().getByRole('heading',{name:'模板库',exact:true}).count(),1);
  assert.equal(await page.locator('.vstart-card .primary').count(),1);
 });
 await run('Unsaved template parameters are guarded and save-on-leave freezes the actual configuration',async()=>{
  await goto(`/projects/${q4}/library?template=sample-inspection`);await loaded();await mainActionVisible(page.getByRole('button',{name:'保存适配并查看成果',exact:true}));
  await range(await camera(),25);await page.getByRole('navigation',{name:'设计阶段'}).getByRole('button',{name:/明确需求/}).click();
  const dialog=page.getByRole('dialog',{name:'还有未保存的参数修改',exact:true});await dialog.waitFor();
  assert.equal((await facts(q4)).parameters.inspectionCameraHeight,0);
  await dialog.getByRole('button',{name:'保存后继续',exact:true}).click();await page.waitForURL(/\/requirements$/);
  const p=await facts(q4),model=p.artifacts.filter(a=>a.kind==='model').at(-1);assert.equal(p.parameters.inspectionCameraHeight,.025);assert.equal(model.parameterSnapshot.inspectionCameraHeight,.025);assert.equal(model.status,'ready');assert(model.sha256);assert.equal(p.cadRuns.length,0);
 });
 await run('Historical concept selection protects pending parameters and reopens the same version',async()=>{
  const p=await facts(custom),b=p.branches[0],old=b.revisions[0];await goto(`/projects/${custom}/concepts/${b.id}`);await loaded();
  await mainActionVisible(page.getByRole('button',{name:/确认 V\d+，开始 CAD 建模/}));
  await page.getByRole('button',{name:'调整此概念支持的参数',exact:true}).click();await range(page.getByLabel('相机总成高度偏移',{exact:true}),25);
  await page.getByRole('button',{name:'设计历程',exact:true}).click();
  await page.locator('.vhistory-versions > details[open] .vversion-track').getByRole('button',{name:/^V01 /}).click();
  const dialog=page.getByRole('dialog',{name:'还有未保存的参数修改',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'放弃修改',exact:true}).click();
  await page.waitForURL(new RegExp(`revision=${old.id}`));
  await page.locator('.vbreadcrumbs button').click();await page.getByRole('heading',{name:'今天，想设计什么？'}).waitFor();
  await page.locator('.vproject-row').filter({hasText:p.name}).click();await page.waitForURL(new RegExp(`revision=${old.id}`));
  assert.deepEqual(await facts(custom),p);
 });
 await run('Unsubmitted concept requests can be retained or discarded without generating a task',async()=>{
  const p=await facts(custom),b=p.branches[0];await goto(`/projects/${custom}/concepts/${b.id}`);await loaded();
  await page.getByRole('button',{name:'继续修改这个方向',exact:true}).click();await page.getByLabel('修改要求',{exact:true}).fill('修改相机防护结构');
  await page.getByRole('button',{name:'关闭面板',exact:true}).click();await page.locator('.vbreadcrumbs button').click();
  const dialog=page.getByRole('dialog',{name:'还有未提交的修改要求',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'放弃修改',exact:true}).click();
  await page.getByRole('heading',{name:'今天，想设计什么？'}).waitFor();assert.deepEqual(await facts(custom),p);
 });
 await run('Project search has an empty result state and stable name sorting',async()=>{
  await page.getByLabel('搜索项目',{exact:true}).fill('没有这个项目xyz');await page.getByRole('heading',{name:'没有找到匹配的项目'}).waitFor();
  await page.getByLabel('搜索项目',{exact:true}).fill('');await page.getByLabel('排序项目',{exact:true}).selectOption('name');
  const names=await page.locator('.vproject-row .vproject-title strong').allTextContents();assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,'zh-CN')));
 });
 await run('Delivery has one report entry and opens the seven interactive modules',async()=>{
  await goto(`/projects/${q4}/delivery`);assert.equal(await page.getByRole('button',{name:'查看完整方案',exact:true}).count(),1);
  await page.getByRole('button',{name:'查看完整方案',exact:true}).click();const frame=page.getByRole('dialog',{name:'完整设计方案'}).locator('iframe').contentFrame();
  await frame.locator('.chapters a').first().waitFor();
  assert.deepEqual(await frame.locator('.chapters a').allTextContents(),['01需求与方案','02交互式方案','03整体方案','04场景任务','05投资预算','06企业效益','07交付流程']);
  await frame.locator('.chapters a[href="#interactive"]').click();await frame.locator('[data-model-loaded="true"]').first().waitFor();
 });
 await run('Mobile concept actions and helper stay reachable without covering each other',async()=>{
  await page.setViewportSize({width:390,height:844});const p=await facts(custom),b=p.branches[0];await goto(`/projects/${custom}/concepts/${b.id}`);await loaded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const button=page.getByRole('button',{name:/确认 V\d+，开始 CAD 建模/});await button.scrollIntoViewIfNeeded();
  assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();await page.getByRole('dialog',{name:'常驻设计助手'}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='assistant-message');
  await page.getByRole('button',{name:'收起设计助手',exact:true}).click();
 });
 await run('A historical CAD link keeps its original source after switching to template adaptation',async()=>{
  const p=await facts(custom),run=p.cadRuns[0];await goto(`/projects/${custom}/library?template=sample-inspection`);await loaded();
  await page.getByRole('button',{name:'保存适配并查看成果',exact:true}).click();await page.waitForURL(/\/delivery$/);
  assert.equal((await facts(custom)).route,'library');
  await goto(`/projects/${custom}/cad?run=${run.id}`);await loaded();
  assert.equal(await page.getByRole('button',{name:'已确认概念',exact:true}).count(),1);
  await page.getByRole('button',{name:'返回来源概念',exact:true}).click();await page.waitForURL(new RegExp(`concepts/${run.branchId}\\?revision=${run.revisionId}`));
  assert.equal((await facts(custom)).route,'library');
 });
 await run('Viewing a historical template configuration does not become an unsaved edit',async()=>{
  const before=await facts(q4),report=before.artifacts.find(a=>a.mimeType.startsWith('text/html'));
  await goto(`/projects/${q4}/library?template=sample-inspection`);await loaded();await range(await camera(),25);
  await page.getByRole('button',{name:'保存适配并查看成果',exact:true}).click();await page.waitForURL(/\/delivery$/);
  const saved=await facts(q4);assert.equal(saved.parameters.inspectionCameraHeight,.025);
  await goto(`/projects/${q4}/library?template=${report.templateId}&report=${report.id}`);await loaded();
  await page.getByRole('navigation',{name:'设计阶段'}).getByRole('button',{name:/设计探索/}).click();await page.waitForURL(/\/start$/);
  assert.equal(await page.getByRole('dialog',{name:'还有未保存的参数修改',exact:true}).count(),0);
  assert.deepEqual(await facts(q4),saved);
 });
}finally{await browser.close();report.completedAt=new Date().toISOString();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.cases.filter(c=>c.status==='passed').length,failed:report.cases.filter(c=>c.status==='failed').length,errors:report.errors}));
if(report.cases.some(c=>c.status==='failed')||report.errors.length||report.productionMutations.length)process.exitCode=1;
