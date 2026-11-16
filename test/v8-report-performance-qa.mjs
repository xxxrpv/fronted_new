import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const baseline=process.argv.includes('--baseline'),out='test-results/v8-report-performance';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
await context.addInitScript(()=>{
  window.__encoding={calls:0,ms:0};const original=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{window.__encoding.calls++;window.__encoding.ms+=performance.now()-start;}};
});
const page=await context.newPage(),report={baseline,environment:'Headless Edge / SwiftShader, 1440×1000 DPR1; 60 identical rotation inputs at 16ms, then 350ms settling',cases:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
const base='http://127.0.0.1:3108/v8';
try{
 await page.goto(`${base}/login`);await page.getByLabel('账户',{exact:true}).fill('123');await page.getByLabel('密码',{exact:true}).fill('123');await page.getByRole('button',{name:'进入工作空间',exact:true}).click();
 for(const [name,id]of [['q4','demo-example-q4-inspection'],['c2','demo-example-c2-logistics']]){
  await page.goto(`${base}/projects/${id}/delivery`);await page.getByRole('button',{name:'查看完整方案',exact:true}).click();
  const f=page.locator('.official-report-dialog iframe').contentFrame();await f.locator('.solution-nav [data-solution-jump="interactive"]').click();
  const host=f.locator('[data-model-loaded="true"]').first();await host.waitFor({timeout:60000});await host.locator('[data-live-webgl-frame]').waitFor({state:'visible'});await page.waitForTimeout(800);
  const beforeEncoding=await page.evaluate(()=>({...window.__encoding}));
  await page.evaluate(()=>{const h=document.querySelector(".official-report-dialog iframe").contentDocument.querySelector("[data-model-loaded=\"true\"]");window.__frameChanges=0;window.__rafTimes=[];let last=performance.now();window.__sampleRaf=()=>{const now=performance.now();window.__rafTimes.push(now-last);last=now;window.__rafId=requestAnimationFrame(window.__sampleRaf);};window.__rafId=requestAnimationFrame(window.__sampleRaf);window.__frameObserver=new MutationObserver(records=>{window.__frameChanges+=records.filter(r=>r.attributeName==='src').length;});window.__frameObserver.observe(h,{subtree:true,attributes:true,attributeFilter:['src']});});
  const beforeShadow=Number(await host.getAttribute('data-shadow-updates')||0);
  const before=await host.getAttribute('data-rendered-frames');const beforePresented=await host.locator('video').count()?await host.locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames):0;
  const camera=await host.getAttribute('data-camera-position'),start=Date.now();
  await page.evaluate(async()=>{
    const host=document.querySelector('.official-report-dialog iframe').contentDocument.querySelector('[data-model-loaded="true"]');
    for(let i=0;i<60;i++){host.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await new Promise(r=>setTimeout(r,16));}
  });
  await page.waitForTimeout(350);const elapsed=Date.now()-start;
  const frames=Number(await host.getAttribute('data-rendered-frames'))-Number(before);
  const sample=await page.evaluate(()=>{cancelAnimationFrame(window.__rafId);window.__frameObserver.disconnect();const times=window.__rafTimes.sort((a,b)=>a-b);return{imageUpdates:window.__frameChanges,rafP50:times[Math.floor(times.length*.5)],rafP95:times[Math.floor(times.length*.95)]};});
  const afterEncoding=await page.evaluate(()=>({...window.__encoding}));
  const presented=await host.locator('video').count()?await host.locator('video').evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)-beforePresented:sample.imageUpdates;
  assert.notEqual(await host.getAttribute('data-camera-position'),camera);
  const result={name,elapsedMs:elapsed,shadowUpdates:Number(await host.getAttribute('data-shadow-updates')||0)-beforeShadow,gpuFrames:frames,presentedFrames:presented,presentedFps:Math.round(presented/elapsed*10000)/10,encodingCalls:afterEncoding.calls-beforeEncoding.calls,encodingMs:Math.round(afterEncoding.ms-beforeEncoding.ms),...sample,presentation:await host.getAttribute('data-renderer-presentation')};report.cases.push(result);console.log(JSON.stringify(result));
  if(!baseline){assert.equal(result.encodingCalls,0);assert.equal(result.presentation,'live-webgl-stream-v1');assert.equal(result.shadowUpdates,0);}
  await f.getByRole('button',{name:'拆解模型',exact:true}).click();
  const slider=f.getByRole('slider',{name:/拆解/}).first();
  if(await slider.count())await slider.evaluate(n=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const value of ['.2','.9','.4','1']){setter.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));}});
  await page.waitForTimeout(400);await f.getByRole('button',{name:'还原整机',exact:true}).click();assert.equal(await host.getAttribute('data-explode-level'),'0');
  await page.waitForTimeout(1200);const idle=await host.getAttribute('data-rendered-frames');await page.waitForTimeout(600);assert.equal(await host.getAttribute('data-rendered-frames'),idle);
  await page.screenshot({path:`${out}/${baseline?'before':'after'}-${name}.png`,fullPage:true});await f.getByRole('button',{name:'关闭完整设计方案',exact:true}).click();
 }
 assert.deepEqual(report.errors,[]);
}finally{await writeFile(`${out}/${baseline?'baseline':'optimized'}.json`,JSON.stringify(report,null,2));await browser.close();}
