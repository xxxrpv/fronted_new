import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const out = "test-results/v8-overview-review";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const report = { cases: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
const run = async (name, fn) => {
  try {
    await fn();
    report.cases.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    report.cases.push({ name, passed: false, error: e.stack });
    await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
    throw e;
  }
};
const base = "http://127.0.0.1:3108/v8",
  q4 = "demo-example-q4-inspection";
const project = (id) => page.locator(`.mx-project[data-project-id="${id}"]`);
const overview = () =>
  page.getByRole("region", { name: "项目概览", exact: true });
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await run(
    "Project selection replaces the module chooser with saved requirements, progress and completed work",
    async () => {
      await page.locator(".mx-modules").waitFor();
      const saved = await page.evaluate(() =>
        localStorage.getItem("embodex-v8-preview-v1"),
      );
      await project(q4).click();
      await overview().waitFor();
      assert.equal(new URL(page.url()).pathname, "/v8");
      assert.equal(await page.locator(".mx-modules,.mx-composer").count(), 0);
      assert.equal(
        await overview()
          .getByRole("heading", { name: "需求", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await overview()
          .getByRole("heading", { name: "已完成", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await overview()
          .getByRole("heading", { name: "方案交付", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await overview().locator(".mx-overview-completed li").count(),
        4,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("embodex-v8-preview-v1"),
        ),
        saved,
      );
      await page.screenshot({
        path: `${out}/project-overview.png`,
        fullPage: true,
      });
      const c2 = page
        .locator(".mx-project")
        .filter({ hasText: "产线配送" })
        .first();
      await c2.click();
      await overview()
        .getByRole("heading", { name: /产线配送/ })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: `${out}/project-overview-mobile.png`,
        fullPage: true,
      });
      assert.equal(
        await page.locator("body").evaluate((n) => n.scrollWidth > innerWidth),
        false,
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page
        .getByRole("button", { name: "关闭项目概览", exact: true })
        .click();
      await page.locator(".mx-modules").waitFor();
    },
  );
  await run(
    "Module selection still toggles and filters; closed modules never open a workspace",
    async () => {
      const card = page.getByRole("button", {
        name: "选择 Embodex 模块",
        exact: true,
      });
      await card.click();
      assert.equal(await card.getAttribute("aria-pressed"), "true");
      assert(
        (
          await page
            .locator(".mx-project")
            .evaluateAll((nodes) => nodes.map((n) => n.dataset.projectModules))
        ).every((x) => x === "embodex"),
      );
      await card.click();
      assert.equal(await card.getAttribute("aria-pressed"), "false");
      await page
        .getByRole("button", { name: "查看 Simcore 项目", exact: true })
        .click();
      assert.equal(new URL(page.url()).pathname, "/v8");
      await page.locator(".mx-project").first().click();
      assert.equal(
        await overview()
          .getByRole("heading", { name: "暂未开放", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await overview()
          .getByRole("button", { name: /进入仿真/ })
          .count(),
        0,
      );
      await page.goto(`${base}/simcore`);
      await page.getByText("暂未开放", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("tab", { name: "机器人模型", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: /返回工作空间/ }).click();
      await page.getByRole("link", { name: "EmboMiX", exact: true }).click();
    },
  );
  await run(
    "Continuing design is explicit and reopening a project does not restore history",
    async () => {
      await project(q4).click();
      await page.getByRole("button", { name: "继续设计", exact: true }).click();
      await page.waitForURL(/\/projects\/.*\/delivery/);
      await page.getByRole("button", { name: "设计历程", exact: true }).click();
      await page
        .getByRole("dialog", { name: "设计历程", exact: true })
        .waitFor();
      await page.goto(base);
      await project(q4).click();
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: "继续设计", exact: true }).click();
      await page.locator(".vdelivery-card").first().waitFor();
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
    },
  );
  await run(
    "Two deliverables retain online viewing, downloads and a source-linked Simcore entrance while the module remains closed",
    async () => {
      assert.equal(await page.locator(".vdelivery-card").count(), 2);
      assert(
        await page
          .getByRole("button", { name: "进入 Simcore", exact: true })
          .isEnabled(),
      );
      assert.equal(
        await page.getByText("文件校验", { exact: true }).count(),
        0,
      );
      const workspace = await page.evaluate(() =>
        localStorage.getItem("embomix-v8-workspace-projects"),
      );
      await page
        .getByRole("button", { name: "进入 Simcore", exact: true })
        .click();
      await page.waitForURL(/\/simcore\?design=/);
      await page.getByText("暂未开放", { exact: true }).waitFor();
      assert.equal(
        await page.locator(".mx-simulation-source strong").innerText(),
        "仓储巡检 · Q4 示例",
      );
      assert(
        (await page.locator(".mx-simulation-source p").innerText()).endsWith(
          ".glb",
        ),
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("embomix-v8-workspace-projects"),
        ),
        workspace,
      );
      await page.screenshot({
        path: `${out}/simcore-entry.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "返回方案交付", exact: true })
        .click();
      await page.locator(".vdelivery-card").first().waitFor();
      const saved = await page.evaluate(() =>
        localStorage.getItem("embodex-v8-preview-v1"),
      );
      const pending = page.waitForEvent("download");
      await page.locator(".vdelivery-card .vdownload").first().click();
      const file = await pending;
      await file.saveAs(`${out}/card-export.html`);
      const html = await readFile(await file.path(), "utf8");
      assert(html.includes("solution-overview"));
      assert(html.includes("system-illustrated-card"));
      assert(html.includes("data:image/png;base64,"));
      assert(!html.includes("<script"));
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("embodex-v8-preview-v1"),
        ),
        saved,
      );
      await page.getByRole("button", { name: "在线查看", exact: true }).click();
      const model = page.locator('[data-model-loaded="true"]').first();
      await model.waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: "拆解模型", exact: true }).click();
      assert(Number(await model.getAttribute("data-explode-level")) > 0);
      await page.getByRole("button", { name: "还原整机", exact: true }).click();
      assert.equal(await model.getAttribute("data-explode-level"), "0");
      await page
        .getByRole("button", { name: "关闭文件预览", exact: true })
        .click();
    },
  );
  await run(
    "Engineering results open the matching delivery source without opening design history",
    async () => {
      const id = "demo-example-ai-review";
      await page.goto(`${base}/projects/${id}/cad`);
      const runId = await page.evaluate(
        (id) =>
          JSON.parse(localStorage.getItem("embodex-v8-preview-v1"))
            .projects.find((p) => p.id === id)
            .cadRuns.at(-1).id,
        id,
      );
      await page
        .getByRole("button", { name: "查看交付成果", exact: true })
        .click();
      await page.locator(".vdelivery-grid").waitFor();
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator(".vdelivery-grid")
          .getAttribute("data-delivery-source"),
        `cad:${runId}`,
      );
      await page.screenshot({
        path: `${out}/engineering-delivery.png`,
        fullPage: true,
      });
      await page.getByRole('button',{name:'查看完整方案',exact:true}).click();
      const reading=page.getByRole('dialog',{name:'完整设计方案',exact:true}).locator('iframe').contentFrame();
      await reading.locator('#solution-title').waitFor();
      assert.equal(await reading.locator('.solution-nav button').count(),7);
      await reading.getByRole('button',{name:'关闭完整设计方案',exact:true}).click();
      await page.reload();
      await page.locator(".vdelivery-grid").waitFor();
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: "设计历程", exact: true }).click();
      await page
        .getByRole("dialog", { name: "设计历程", exact: true })
        .waitFor();
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
