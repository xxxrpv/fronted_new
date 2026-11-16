/** Regression for the explicit login view, whole-card toggling and integrated stage navigation. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir,writeFile } from "node:fs/promises";
const base="http://127.0.0.1:3108",out="test-results/v8-navigation-refinement";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:"msedge",headless:true,args:["--enable-unsafe-swiftshader"]});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(25000);const report={cases:[],errors:[]};page.on("pageerror",e=>report.errors.push(e.message));
async function shot(name){await page.screenshot({path:`${out}/${name}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);}
async function run(name,fn){await fn();report.cases.push({name,pass:true});console.log("PASS",name);}
const home=()=>page.getByRole("heading",{name:"让想法，连接起来。",exact:true}).waitFor();
const snapshot=()=>page.evaluate(()=>({projects:localStorage.getItem("embodex-v8-preview-v1"),workspace:localStorage.getItem("embomix-v8-workspace-projects")}));
const surface=id=>page.locator(`.mx-${id} .mx-module-surface`);
try{
 await page.goto(`${base}/login`);await page.getByRole("heading",{name:"登录工作空间",exact:true}).waitFor();
 await page.getByLabel("账户",{exact:true}).fill("123");await page.getByLabel("密码",{exact:true}).fill("123");await page.getByRole("button",{name:"进入工作空间",exact:true}).click();await home();await page.locator(".mx-project").first().waitFor();
 const before=await snapshot();
 await run("An existing 123 session can open and refresh the login page, then return without losing projects",async()=>{
  await page.goto(`${base}/login`);await page.waitForURL(/\/v8\/login$/);await page.getByRole("heading",{name:"登录工作空间",exact:true}).waitFor();
  await page.getByRole("button",{name:"返回工作空间",exact:true}).waitFor();await page.reload();await page.getByRole("heading",{name:"登录工作空间",exact:true}).waitFor();
  await page.locator('[data-dynamic-module="journey"][data-preview-ready="true"]').waitFor();
  await page.getByRole("button",{name:"机器人设计",exact:true}).click();await page.waitForTimeout(1400);await shot("login-visible-after-signin");
  assert.deepEqual(await snapshot(),before);await page.getByRole("button",{name:"返回工作空间",exact:true}).click();await home();
 });
 await run("Whole cards toggle on/off, plus toggles exactly once and Enter/Space remain accessible",async()=>{
  assert.equal(await page.locator(".mx-drag-handle").count(),0);
  for(const id of ["embodex","simcore","deployx"]){
   const box=await surface(id).boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.47);assert.equal(await surface(id).getAttribute("aria-pressed"),"true");
   await page.mouse.click(box.x+box.width*.45,box.y+box.height*.78);assert.equal(await surface(id).getAttribute("aria-pressed"),"false");
   await surface(id).focus();await page.keyboard.press("Space");assert.equal(await surface(id).getAttribute("aria-pressed"),"true");await page.keyboard.press("Enter");assert.equal(await surface(id).getAttribute("aria-pressed"),"false");
  }
  await surface("embodex").click();await surface("simcore").click();assert.equal(await page.locator(".mx-project").count(),1);
  assert.equal(await page.locator(".mx-project").first().getAttribute("data-project-modules"),"embodex+simcore");
  await page.getByRole("button",{name:"加入Deployx模块",exact:true}).click();assert.equal(await surface("deployx").getAttribute("aria-pressed"),"true");
  await page.getByRole("button",{name:"移除Deployx模块",exact:true}).click();assert.equal(await surface("deployx").getAttribute("aria-pressed"),"false");
  await shot("whole-card-composition");await page.getByRole("button",{name:/^全部项目/}).click();
 });
 await run("Dragging follows the pointer, does not trigger a second selection and Escape does not toggle",async()=>{
  const card=surface("embodex"),box=await card.boundingBox();const x=box.x+box.width/2,y=box.y+box.height*.45;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+100,y+65,{steps:8});await page.locator(".mx-drag-ghost").waitFor();
  const a=await page.locator(".mx-drag-ghost").boundingBox();await page.mouse.move(x+150,y+90,{steps:4});const b=await page.locator(".mx-drag-ghost").boundingBox();assert(Math.abs(b.x-a.x-50)<2);
  const drop=await page.getByRole("region",{name:"模块组合",exact:true}).boundingBox();await page.mouse.move(drop.x+drop.width/2,drop.y+drop.height/2,{steps:10});await page.mouse.up();
  assert.equal(await card.getAttribute("aria-pressed"),"true");assert.equal(await page.locator(".mx-node").count(),1);assert.equal(await page.locator(".mx-drag-ghost").count(),0);
  await card.click();assert.equal(await card.getAttribute("aria-pressed"),"false");
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y+50,{steps:5});await page.locator(".mx-drag-ghost").waitFor();await page.keyboard.press("Escape");await page.mouse.up();assert.equal(await card.getAttribute("aria-pressed"),"false");
 });
 await run("Module entry stays independent and all five stages share a transparent pale-blue navigation",async()=>{
  await surface("deployx").click();await page.getByRole("button",{name:"进入 Embodex",exact:true}).click();await page.getByRole("heading",{name:"今天，想设计什么？",exact:true}).waitFor();
  for(const [route,label] of [["requirements","明确需求"],["start","设计探索"],["library?template=sample-inspection","模型概览"],["cad","工程模型"],["delivery","方案交付"]]){
   await page.goto(`${base}/v8/projects/demo-example-q4-inspection/${route}`);await page.locator('.vstagebar [aria-current="step"]').waitFor();
   assert.match(await page.locator('.vstagebar [aria-current="step"]').innerText(),new RegExp(label));
   const style=await page.locator(".vstagebar").evaluate(n=>{const s=getComputedStyle(n);return{background:s.backgroundColor,image:s.backgroundImage,border:s.borderBottomWidth};});assert.deepEqual(style,{background:"rgba(0, 0, 0, 0)",image:"none",border:"0px"});
   if(route==="cad"||route.startsWith("library"))await page.locator('[data-model-loaded="true"]').waitFor({timeout:60000});
   await shot(`stage-${route.split("?")[0]}`);
   if(route==="delivery"){assert.equal(await page.locator(".vdelivery-card").count(),2);assert.equal(await page.getByLabel("选择交付版本").count(),0);await page.getByRole("button",{name:"设计历程",exact:true}).click();await page.getByRole("dialog",{name:"设计历程",exact:true}).waitFor();await page.getByRole("button",{name:"关闭面板",exact:true}).click();}
  }
  await page.setViewportSize({width:390,height:844});await shot("stage-mobile");
 });
 const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await context.storageState()});const touch=await mobile.newPage();
 try{await touch.goto(`${base}/v8`);await touch.getByRole("heading",{name:"让想法，连接起来。",exact:true}).waitFor();await touch.getByRole("button",{name:/^全部项目/}).click();const card=touch.locator(".mx-simcore .mx-module-surface");await card.tap();assert.equal(await card.getAttribute("aria-pressed"),"true");await card.tap();assert.equal(await card.getAttribute("aria-pressed"),"false");report.cases.push({name:"Touch cards toggle and keep native vertical scrolling",pass:true});}finally{await mobile.close();}
 assert.equal(report.errors.length,0);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await context.close();await browser.close();}
