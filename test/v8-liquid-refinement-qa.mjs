import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:3108/v8";
const out = "test-results/v8-liquid-refinement";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const report = { cases: [], errors: [], overflow: [] };
page.on("pageerror", e => report.errors.push(e.message));
async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) report.overflow.push(name);
}
async function run(name, work) { try { await work(); report.cases.push({ name, pass: true }); console.log("PASS", name); } catch (error) { report.cases.push({ name, pass: false, error: error.stack }); console.error("FAIL", name, error.message); await shot(`failure-${report.cases.length}`); throw error; } }
const login = async () => {
  await page.getByRole("tab", { name: "密码登录", exact: true }).click();
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await page.getByRole("heading", { name: "让想法，连接起来。" }).waitFor();
};
const assistant = async text => {
  const dialog = page.getByRole("dialog", { name: "常驻设计助手" });
  if (!await dialog.isVisible()) await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
  await page.getByLabel("与设计助手交流", { exact: true }).fill(text);
  await page.getByRole("button", { name: "发送设计助手消息", exact: true }).click();
};
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "登录工作空间" }).waitFor();
  await run("Login restores password, SMS, registration and recovery with a text-to-deployment story", async () => {
    await page.locator('[data-dynamic-module="journey"][data-preview-ready="true"]').waitFor();
    assert.equal(await page.locator(".mx-login-media").getByText(/Embodex|Simcore|Deployx/).count(), 0);
    await page.waitForTimeout(1800);
    await shot("01-login-requirements");
    for (const phase of ["机器人设计", "场景仿真", "真机部署"]) {
      await page.getByRole("button", { name: phase, exact: true }).click();
      await page.waitForTimeout(1150);
      await shot(`login-${phase}`);
    }
    await page.getByRole("tab", { name: "短信登录", exact: true }).click();
    await page.getByLabel("手机号码", { exact: true }).fill("12");
    await page.getByRole("button", { name: "获取验证码" }).click();
    assert.match(await page.locator(".mx-login-error").innerText(), /11 位/);
    await shot("02-login-sms");
    await page.getByRole("button", { name: "注册账户", exact: true }).click();
    await page.getByRole("heading", { name: "创建账户" }).waitFor();
    await shot("03-login-register");
    await page.getByRole("button", { name: "返回登录" }).click();
    await page.getByRole("button", { name: "忘记密码" }).click();
    await shot("04-login-reset");
    await page.getByRole("button", { name: "返回登录" }).click();
    await login();
  });
  await run("All module cards animate multiple photoreal scenes, with no grid or heavy selected badge", async () => {
    for (const module of ["embodex", "simcore", "deployx"]) {
      await page.locator(`[data-dynamic-module="${module}"][data-preview-ready="true"]`).waitFor();
      const art = page.locator(`[data-dynamic-module="${module}"]`);
      assert.equal(await art.getAttribute("data-motion-kind"), "articulated-3d");
      assert.equal(await art.locator(".mx-three-host").getAttribute("data-model-count"), "3");
      assert.equal(await art.locator("img").count(), 0);
      assert.equal(await art.locator(".mx-three-host").getAttribute("data-motion-profile"), ({embodex:"sketch-materialize",simcore:"repeated-validation",deployx:"connect-transfer-calibrate-execute"})[module]);
      const canvas = page.locator(`[data-dynamic-module="${module}"] canvas`);
      const a = await canvas.screenshot(); await page.waitForTimeout(650); const b = await canvas.screenshot();
      assert(!a.equals(b));
    }
    assert(await page.locator(".mx-project-dot").count() >= 5);
    const colors = await page.locator(".mx-project-dot").evaluateAll(nodes => new Set(nodes.map(n => getComputedStyle(n).backgroundColor)).size);
    assert(colors >= 3);
    await page.locator(".mx-project").first().hover();
    const background = await page.locator(".mx-project").first().evaluate(n => getComputedStyle(n).backgroundColor);
    assert(!background.includes("255, 255, 255"));
    await shot("05-workspace");
  });
  await run("The complete card follows the pointer, drops exactly once and Escape cancels", async () => {
    const card = page.locator(".mx-embodex .mx-module-image"), bounds = await card.boundingBox();
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 80, start.y + 60, { steps: 8 });
    const ghost = page.locator(".mx-drag-ghost"); await ghost.waitFor();
    assert.match(await ghost.innerText(), /Embodex/);
    const first = await ghost.boundingBox(); await page.mouse.move(start.x + 150, start.y + 90, { steps: 4 }); const second = await ghost.boundingBox();
    assert(Math.abs(second.x - first.x - 70) < 2); assert(Math.abs(second.y - first.y - 30) < 2);
    await shot("06-pointer-drag");
    const drop = await page.getByRole("region", { name: "模块组合", exact: true }).boundingBox();
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 10 }); await page.mouse.up();
    assert.equal(await ghost.count(), 0);
    await page.getByRole("button", { name: "移除Embodex模块", exact: true }).waitFor();
    const all = page.locator(".mx-embodex .mx-module-actions button");
    assert.equal(await all.count(),1);
    assert.equal(await page.locator(".mx-drag-handle").count(),0);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 90, start.y + 60); await ghost.waitFor(); await page.keyboard.press("Escape"); await page.mouse.up(); assert.equal(await ghost.count(), 0);
  });
  await run("Workspace assistant performs exact module filtering and opens Simcore", async () => {
    await assistant("组合 Embodex 和 Simcore");
    await page.getByRole("button", { name: "移除Simcore模块", exact: true }).waitFor();
    assert.equal(await page.locator(".mx-project").count(), 1);
    await shot("07-workspace-assistant");
    await assistant("打开 Simcore");
    await page.waitForURL(/\/simcore$/);
    await page.getByRole("heading", { name: "场景库" }).waitFor();
    await shot("08-simcore");
    await page.getByRole("button", { name: /工业工作站/ }).click();
    await page.getByLabel("运行时长").fill("120");
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    await page.reload();
    await page.getByRole("heading", { name: "场景库" }).waitFor();
    assert.equal(await page.getByLabel("运行时长").inputValue(), "120");
    assert.equal(await page.getByRole("button", { name: /工业工作站/ }).getAttribute("aria-pressed"), "true");
    assert(await page.getByRole("button", { name: "运行仿真" }).isDisabled());
    await assistant("打开仓储场景");
    await page.getByRole("button", { name: /仓储物流/ }).waitFor();
    if (await page.getByRole("button", { name: "收起设计助手" }).isVisible()) await page.getByRole("button", { name: "收起设计助手" }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await shot("09-simcore-mobile");
    await page.getByRole("button", { name: "返回工作空间", exact: true }).click();
    await page.getByRole("heading", { name: "让想法，连接起来。" }).waitFor();
    await shot("10-workspace-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await run("Template cards use source-rendered transparent posters and open their matching interactive models", async () => {
    await page.goto(`${base}/projects/demo-example-q4-inspection/library`);
    await page.getByRole("heading",{name:"模板库",exact:true}).waitFor();
    const posters=page.locator(".vtemplate-preview img");
    assert.equal(await posters.count(),3);
    assert((await posters.evaluateAll(nodes=>nodes.map(n=>n.getAttribute("src")))).every(src=>src.startsWith("/v8-assets/catalog/")));
    assert((await page.locator(".vtemplate-preview").evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor))).every(color=>color==="rgba(0, 0, 0, 0)"));
    await posters.evaluateAll(nodes=>Promise.all(nodes.map(n=>n.decode())));
    await shot("template-transparent-posters");
    await page.getByRole("button",{name:"预览Q4 · 精细巡检构型",exact:true}).click();
    await page.locator('[data-model-loaded="true"]').waitFor({timeout:60000});
    assert.match(page.url(),/template=sample-inspection/);
    await page.getByRole("button",{name:"返回模板库",exact:true}).click();
    await page.getByRole("heading",{name:"模板库",exact:true}).waitFor();
  });
  await run("Design stages have clear glass states and AI navigation keeps unsaved-change protection", async () => {
    const id = "demo-example-q4-inspection";
    for (const [stage,name] of [["requirements","明确需求"],["start","设计探索"],["library?template=sample-inspection","模型概览"],["cad","工程模型"],["delivery","方案交付"]]) {
      await page.goto(`${base}/projects/${id}/${stage}`);
      await page.locator(".vstagebar [aria-current=step]").waitFor();
      assert.match(await page.locator(".vstagebar [aria-current=step]").innerText(), new RegExp(name));
      const spans = await page.locator(".vstagebar .current>span").evaluateAll(nodes => nodes.map(n => ({ image: getComputedStyle(n).backgroundImage, width: n.clientWidth })));
      assert(spans.every(s => s.image === "none")); assert(spans[1].width > 30);
      if (stage.startsWith("library")) await page.locator('[data-model-loaded="true"]').waitFor({ timeout: 60000 });
      if(stage==="delivery") {assert.equal(await page.getByLabel("选择交付版本").count(),0);assert.equal(await page.locator(".vdelivery-card").count(),2);}
      await shot(`studio-${name}`);
    }
    await assistant("打开明确需求");
    await page.waitForURL(/\/requirements$/);
    if (await page.getByRole("button", { name: "收起设计助手" }).isVisible()) await page.getByRole("button", { name: "收起设计助手" }).click();
    await page.getByLabel("设计目标", { exact: true }).fill("未保存的巡检需求");
    await assistant("打开方案交付");
    await page.getByRole("dialog", { name: /未保存/ }).waitFor();
    assert(page.url().endsWith("/requirements"));
  });
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  assert.equal(report.overflow.length, 0, report.overflow.join(","));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await context.close(); await browser.close();
}
if (report.cases.some(c => !c.pass) || report.errors.length || report.overflow.length) process.exitCode = 1;
