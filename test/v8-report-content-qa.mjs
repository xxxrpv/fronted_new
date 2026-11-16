import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  enterPreviewDesign,
  viewConceptRevision,
} from "./v8-preview-browser.mjs";

const base = "http://127.0.0.1:3108/v8",
  out = "test-results/current-review";
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
page.on("pageerror", (error) => report.errors.push(error.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const facts = (id) =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (p) => p.id === id,
      ),
    id,
  );
const frame = () =>
  page
    .getByRole("dialog", { name: "完整设计方案", exact: true })
    .locator("iframe")
    .contentFrame();
const loaded = () =>
  page
    .locator('[data-model-loaded="true"]')
    .first()
    .waitFor({ timeout: 60000 });
async function run(name, test) {
  try {
    await test();
    report.cases.push({ name, passed: true });
    console.log("PASS", name);
  } catch (error) {
    report.cases.push({ name, passed: false, error: error.stack });
    await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
    throw error;
  }
}
async function create(goal, task, site) {
  await enterPreviewDesign(page, base);
  await page.getByLabel("描述你的设计目标").fill(goal);
  await page
    .locator("main")
    .getByRole("button", { name: "开始设计", exact: true })
    .click();
  await page.waitForURL(/\/requirements$/);
  const id = page.url().match(/\/projects\/([^/]+)/)[1];
  const fields = {
    任务与对象: task,
    作业场景: site,
    任务载荷: "视觉相机与可拆卸防护罩，维护净空 35 mm",
    空间与工作范围: "通道净宽 1.2 m，设备高度不超过 0.9 m",
    作业性能: "每日 3 次任务，单次目标时长 18 分钟",
    环境边界: "室内平整地面，低照度，无淋雨",
    安全与协作: "接近人员时停车，异常交由值班员接管",
    系统对接: "通过本地 HTTP 接口提交任务结果与图像",
    验收标准: "连续 12 次测试，完整记录各次任务结果",
  };
  for (const [label, value] of Object.entries(fields)) {
    const input = page.getByLabel(label, { exact: true });
    const group = page.locator(".vrequirement-group").filter({ has: input });
    if ((await group.getAttribute("open")) === null)
      await group.locator("summary").click();
    await input.fill(value);
  }
  await button("保存需求，设计探索").click();
  await page.waitForURL(/\/start$/);
  return { id, goal, fields };
}
async function verifyReport(projectCase, parameter, expectedOffset) {
  await button("查看完整方案").click();
  const f = frame();
  await f.locator("#solution-title").waitFor();
  await f.locator('[data-model-loaded="true"]').waitFor({ timeout: 60000 });
  const before = await facts(projectCase.id);
  const html = before.artifacts
    .filter((a) => a.mimeType.startsWith("text/html"))
    .at(-1);
  const model = before.artifacts.find(
    (a) =>
      a.kind === "model" &&
      a.requirementId === html.requirementId &&
      a.revisionId === html.revisionId &&
      a.parameterSnapshot?.[parameter] === expectedOffset,
  );
  assert(model, "Exact model source must exist");
  assert.equal(
    await f.locator("body").getAttribute("data-requirement-id"),
    html.requirementId,
  );
  assert.equal(
    await f
      .locator("[data-report-model-artifact]")
      .getAttribute("data-report-model-artifact"),
    model.id,
  );
  assert.equal(
    await f
      .locator("[data-report-offset-mm]")
      .getAttribute("data-report-offset-mm"),
    String(expectedOffset * 1000),
  );
  const content = await f.locator(".case-experience").textContent();
  for (const text of [projectCase.goal, ...Object.values(projectCase.fields)])
    assert(content.includes(text), `Missing frozen requirement: ${text}`);
  for (const text of [
    "装配工位 A-03",
    "批次 M-07",
    "料架配送",
    "仓库测点巡检",
    "停机风机叶片检测",
    "机门、卡盘和主轴",
  ])
    assert(!content.includes(text), `Unrelated website example: ${text}`);
  assert.equal(
    await f.locator(".business-export,[data-business-export]").count(),
    0,
  );
  assert.equal(await f.locator(".solution-nav button").count(), 7);
  await f.locator('.solution-nav [data-solution-jump="engineering"]').click();
  await f.locator('[data-business-task="execute"]').click();
  assert(
    (await f.locator("#business-task-detail").innerText()).includes(
      projectCase.fields["任务与对象"],
    ),
  );
  await page.screenshot({
    path: `${out}/${parameter}-tasks.png`,
    fullPage: true,
  });
  await f.locator('.solution-nav [data-solution-jump="budget"]').click();
  assert.equal(await f.locator('[data-business-out="total"]').innerText(), "—");
  await f.locator('[data-business-field="hardware"]').evaluate((n) => {
    for (let p = n.parentElement; p; p = p.parentElement)
      if (p.tagName === "DETAILS") p.open = true;
  });
  await f.locator('[data-business-field="hardware"]').fill("90000");
  for (const label of ["单台每日能力", "年度净工时变化", "年度净现金"])
    assert.equal(
      await f
        .locator("[data-business-comparison] tbody tr")
        .filter({
          has: f.getByRole("rowheader", {
            name: label,
            exact: true,
            includeHidden: true,
          }),
        })
        .locator("td")
        .textContent(),
      "—",
    );
  assert.equal(await f.locator("[data-business-cash-chart]").textContent(), "");
  assert.equal(
    await f.locator(".business-export,[data-business-export]").count(),
    0,
  );
  const pending = page.waitForEvent("download");
  await f.locator('[data-report-export="html"]').click();
  const download = await pending;
  await download.saveAs(`${out}/${parameter}.html`);
  const offline = await readFile(`${out}/${parameter}.html`, "utf8");
  assert(offline.includes(projectCase.fields["任务与对象"]));
  assert(!offline.includes("保存当前方案"));
  assert(!offline.includes("下载方案 JSON"));
  const offlinePage = await context.newPage();
  await offlinePage.route("http**://**/*", (route) => route.abort());
  await offlinePage.setContent(offline);
  assert.equal(
    await offlinePage.locator('[data-business-field="hardware"]').inputValue(),
    "90000",
  );
  assert.equal(
    await offlinePage.locator(".report-task-reading > article").count(),
    5,
  );
  assert.equal(await offlinePage.locator("[data-business-task]").count(), 0);
  await offlinePage.close();
  assert.deepEqual(await facts(projectCase.id), before);
  await f
    .getByRole("button", { name: "关闭完整设计方案", exact: true })
    .click();
  return html;
}
try {
  let template, originalHtml;
  await run(
    "Template HTML uses the saved hospital requirements and configured C2 model, with only top export controls",
    async () => {
      template = await create(
        "为医院设计轮式送检平台",
        "在检验科与病区之间运输密封样本箱",
        "医院一层走廊与检验科",
      );
      await button("浏览模板库").click();
      await page
        .locator(".vtemplate-card")
        .filter({ hasText: "C2 · 精细移动平台" })
        .getByRole("button", { name: "查看模型", exact: true })
        .click();
      await loaded();
      const inspector = page.getByRole("complementary", {
        name: "模型参数面板",
        exact: true,
      });
      await inspector
        .getByLabel("搜索零件", { exact: true })
        .fill("dock-camera");
      await inspector.locator(".vpart-catalog button").first().click();
      await page.getByLabel("对接相机高度偏移", { exact: true }).fill("25");
      await button("保存适配并查看成果").click();
      await page.waitForURL(/\/delivery$/);
      await page.waitForFunction(
        (id) =>
          JSON.parse(localStorage.getItem("embodex-v8-preview-v1"))
            .projects.find((p) => p.id === id)
            .artifacts.some((a) => a.mimeType.startsWith("text/html")),
        template.id,
      );
      originalHtml = await verifyReport(template, "mobileCameraHeight", 0.025);
      assert.equal((await facts(template.id)).cadRuns.length, 0);
    },
  );
  await run(
    "Historical HTML keeps its original requirements after upstream changes",
    async () => {
      await page
        .getByRole("navigation", { name: "设计阶段" })
        .getByRole("button", { name: /明确需求/ })
        .click();
      await page
        .getByLabel("任务与对象", { exact: true })
        .fill("新增任务：转运手术器械");
      await button("保存需求，设计探索").click();
      await page.waitForURL(/\/start$/);
      await page.goto(`${base}/projects/${template.id}/delivery`);
      assert(await button("查看完整方案").isDisabled());
      await button("设计历程").click();
      const file = page
        .locator(".vhistory-file")
        .filter({ hasText: originalHtml.fileName })
        .first();
      await file.evaluate((n) => {
        for (let p = n.parentElement; p; p = p.parentElement)
          if (p.tagName === "DETAILS") p.open = true;
      });
      await file.getByRole("button", { name: "查看", exact: true }).click();
      await frame().locator("#solution-title").waitFor();
      assert.equal(
        await frame().locator("body").getAttribute("data-requirement-id"),
        originalHtml.requirementId,
      );
      const content = await frame().locator(".case-experience").textContent();
      assert(content.includes(template.fields["任务与对象"]));
      assert(!content.includes("新增任务：转运手术器械"));
      await frame()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
    },
  );
  await run(
    "Custom HTML uses the confirmed exhibition revision and its engineering model",
    async () => {
      const custom = await create(
        "设计四足机器人用于展馆夜间巡查",
        "巡查展柜状态并记录展品区域的环境图像",
        "博物馆三层展厅",
      );
      await button("开始专业定制").click();
      await button("生成概念方向").click();
      await page
        .locator(".vconcept-card")
        .filter({ hasText: "四足" })
        .first()
        .getByRole("button", { name: "查看并深化", exact: true })
        .click();
      await loaded();
      await button("调整此概念支持的参数").click();
      await page.getByLabel("相机总成高度偏移", { exact: true }).fill("15");
      await button("保存参数为新版本").click();
      await page.waitForFunction(
        (id) =>
          JSON.parse(localStorage.getItem("embodex-v8-preview-v1"))
            .projects.find((p) => p.id === id)
            .branches.some((b) => b.revisions.length === 2),
        custom.id,
      );
      await viewConceptRevision(page, "V02");
      await page
        .getByRole("button", { name: /确认 V02，开始 CAD 建模/ })
        .click();
      await button("确认并创建样例工程任务").click();
      await page.waitForURL(/\/cad/);
      await button("查看交付成果").waitFor({ timeout: 60000 });
      await button("查看交付成果").click();
      await page.waitForURL(/\/delivery$/);
      await page.waitForFunction(
        (id) =>
          JSON.parse(localStorage.getItem("embodex-v8-preview-v1"))
            .projects.find((p) => p.id === id)
            .artifacts.some((a) => a.mimeType.startsWith("text/html")),
        custom.id,
        { timeout: 60000 },
      );
      const html = await verifyReport(custom, "inspectionCameraHeight", 0.015);
      const p = await facts(custom.id);
      assert.equal(html.revisionId, p.approvals.at(-1).revisionId);
      assert.equal(html.descriptionId, p.cadRuns.at(-1).sourceDescriptionId);
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(
    `${out}/report-content.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
