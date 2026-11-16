import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const base = "http://127.0.0.1:3108/v8", out = "test-results/v8-delivery-usability";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();page.setDefaultTimeout(30000);
const report = { cases: [], errors: [], models: [], requests: {} };
page.on("pageerror", e => report.errors.push(e.message));
page.on("request", r => { if (/\/(go2-high-fidelity|mobile-amr|industrial-arm)\.glb/.test(r.url())) report.requests[r.url()] = (report.requests[r.url()] || 0) + 1; });
const shot = async name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const run = async (name, work) => { await work();report.cases.push({ name, passed: true });console.log("PASS", name); };
const id = "demo-example-q4-inspection";
const route = stage => page.goto(`${base}/projects/${id}/${stage}`);
const loaded = () => page.locator('[data-model-loaded="true"]').first().waitFor({ timeout: 60000 });
try {
  await page.goto(`${base}/login`);await page.getByLabel("账户", { exact: true }).fill("123");await page.getByLabel("密码", { exact: true }).fill("123");await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  for (const module of ["embodex", "simcore", "deployx"])
    await page.locator(`[data-dynamic-module="${module}"][data-preview-ready="true"]`).waitFor();
  report.showcaseRequests = { ...report.requests };
  assert.equal(Object.keys(report.showcaseRequests).length, 3);
  assert(Object.values(report.showcaseRequests).every(count => count === 1), "login and module cards share each public demonstration model download");
  await run("Route choices use equal buttons and development controls stay hidden", async () => {
    await route("start");const left = page.getByRole("button", { name: "浏览模板库", exact: true }), right = page.getByRole("button", { name: "开始专业定制", exact: true });await left.waitFor();
    const style = el => { const s = getComputedStyle(el);return [s.backgroundColor, s.color, s.borderRadius]; };
    assert.deepEqual(await left.evaluate(style), await right.evaluate(style));assert.equal(await page.locator(".vpreview-controls").count(), 0);await shot("equal-route-buttons");
  });
  await run("Both delivery cards expose online viewing and text-labelled downloads", async () => {
    await route("delivery");await page.locator(".vdelivery-card").first().waitFor();assert.equal(await page.locator(".vdelivery-card").count(), 2);
    for (const card of await page.locator(".vdelivery-card").all()) { assert.equal(await card.locator(".vartifact-actions .vbutton").count(), 1);assert(await card.locator(".vdownload").isEnabled());assert.equal((await card.locator(".vdownload").innerText()).trim(), "下载"); }
    assert(await page.getByRole("button", { name: "进入 Simcore", exact: true }).isEnabled());await shot("delivery-ready");
    await page.getByRole("button", { name: "查看完整方案", exact: true }).click();await page.getByRole("button", { name: "关闭完整设计方案", exact: true }).waitFor();await page.getByRole("button", { name: "关闭完整设计方案", exact: true }).click();
    await page.getByRole("button", { name: "在线查看", exact: true }).click();await loaded();await page.getByRole("button", { name: "关闭文件预览", exact: true }).click();
    for (let i = 0; i < 2; i++) { const pending = page.waitForEvent("download");await page.locator(".vdelivery-card .vdownload").nth(i).click();const download = await pending;await download.saveAs(`${out}/${download.suggestedFilename()}`);assert((await readFile(await download.path())).length > 100); }
  });
  await run("Reopening any project and refreshing a historic URL leave history closed", async () => {
    await page.getByRole("button", { name: "设计历程", exact: true }).click();await page.getByRole("dialog", { name: "设计历程", exact: true }).waitFor();
    await page.locator(".project-nav").filter({ hasText: "产线配送" }).click();assert.equal(await page.getByRole("dialog", { name: "设计历程", exact: true }).count(), 0);
    await page.locator(".project-nav").filter({ hasText: "仓储巡检" }).click();assert.equal(await page.getByRole("dialog", { name: "设计历程", exact: true }).count(), 0);
    await route("delivery?package=previous-view");await page.locator(".vdelivery-card").first().waitFor();await page.reload();await page.locator(".vdelivery-card").first().waitFor();assert.equal(await page.getByRole("dialog", { name: "设计历程", exact: true }).count(), 0);
  });
  await run("A changed requirement keeps actions visible and can generate matching current deliverables", async () => {
    await page.evaluate(id => {const key="embodex-v8-preview-v1",store=JSON.parse(localStorage.getItem(key)),p=store.projects.find(p=>p.id===id),r=structuredClone(p.requirements.at(-1));r.id+="-updated";r.sequence++;p.requirements.push(r);localStorage.setItem(key,JSON.stringify(store));}, id);
    await route("delivery");await page.getByRole("button", { name: "生成交付成果", exact: true }).waitFor();assert.equal(await page.locator(".vdelivery-card .vdownload:disabled").count(),2);assert(await page.getByRole("button", { name: "进入 Simcore", exact: true }).isDisabled());await shot("delivery-needs-generation");
    await page.getByRole("button", { name: "生成交付成果", exact: true }).click();await page.locator(".vdelivery-card .vdownload:not(:disabled)").nth(1).waitFor({timeout:60000});assert(await page.getByRole("button", { name: "进入 Simcore", exact: true }).isEnabled());
    await page.getByRole("button", { name: "进入 Simcore", exact: true }).click();await page.waitForURL(/\/simcore\?project=/);await page.getByRole("tab", { name: "机器人模型", exact: true }).click();await loaded();await shot("simcore-current-source");
  });
  await run("All catalog models render on demand and keep explosion, restore and camera controls", async () => {
    for (const template of ["sample-go2", "sample-inspection", "sample-mobile"]) {
      const start=Date.now();await route(`library?template=${template}`);await loaded();const elapsed=Date.now()-start, host=page.locator('[data-model-loaded="true"]').first();
      await page.waitForTimeout(1600);const first=Number(await host.getAttribute("data-rendered-frames"));await page.waitForTimeout(600);const second=Number(await host.getAttribute("data-rendered-frames"));assert(second-first<=2, `${template} keeps drawing while idle: ${second-first}`);
      await page.getByRole("button", { name: "拆解模型", exact: true }).click();assert(Number(await host.getAttribute("data-explode-level"))>0);assert(Number(await host.getAttribute("data-rendered-frames"))>second);
      await page.getByRole("button", { name: "还原整机", exact: true }).click();assert.equal(await host.getAttribute("data-explode-level"),"0");
      const before=await host.getAttribute("data-camera-position"), rect=await host.locator("canvas").boundingBox();await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.48,{steps:8});await page.mouse.up();assert.notEqual(await host.getAttribute("data-camera-position"), before);
      report.models.push({ template, loadMs: elapsed, idleFramesIn600ms: second-first });
    }
    await shot("mobile-model-interactive");
  });
  assert.equal(report.errors.length,0,report.errors.join("\n"));
} finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
