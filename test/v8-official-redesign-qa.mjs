import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { enterPreviewDesign } from "./v8-preview-browser.mjs";
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = "test-results/v8-official-redesign";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const report = { cases: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
const q4 = "demo-example-q4-inspection";
const snapshot = () =>
  page.evaluate(() => localStorage.getItem("embodex-v8-preview-v1"));
const loaded = () =>
  page.locator('[data-model-loaded="true"]').first().waitFor();
async function shot(name) {
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images, (img) => {
        img.loading = "eager";
        return img.decode().catch(() => {});
      }),
    );
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function run(name, fn) {
  try {
    await fn();
    report.cases.push({ name, status: "passed" });
    console.log("PASS", name);
  } catch (e) {
    report.cases.push({ name, status: "failed", error: e.stack });
    console.error("FAIL", name, e.message);
    await shot(`failure-${report.cases.length}`);
  }
}
try {
  await enterPreviewDesign(page, base);
  await run(
    "The five stages use the requested stable labels on both routes",
    async () => {
      await page.goto(`${base}/projects/${q4}/start`);
      await page
        .getByRole("heading", { name: "从哪里开始这项设计？", exact: true })
        .waitFor();
      const labels = await page
        .getByRole("navigation", { name: "设计阶段", exact: true })
        .locator("button:not(.vhistory-trigger)")
        .allTextContents();
      for (const [i, name] of [
        "明确需求",
        "设计探索",
        "模型概览",
        "工程模型",
        "方案交付",
      ].entries())
        assert(labels[i].includes(name));
      assert.equal(
        await page.locator(".vstart-card h2").nth(0).innerText(),
        "模板库",
      );
      assert.equal(
        await page.locator(".vstart-card h2").nth(1).innerText(),
        "专业定制",
      );
    },
  );
  await run(
    "Template browsing starts with a complete grid and remains read-only until save",
    async () => {
      const before = await snapshot();
      await page
        .getByRole("button", { name: "浏览模板库", exact: true })
        .click();
      await page.waitForURL(/\/library$/);
      await page.locator("main h1").filter({ hasText: "模板库" }).waitFor();
      assert.equal(await page.locator(".vtemplate-card").count(), 3);
      assert.equal(await page.locator("[data-model-loaded]").count(), 0);
      assert.equal(await page.locator(".vtemplate-card img").count(), 3);
      for (const card of await page.locator(".vtemplate-card").all())
        assert((await card.locator("p").first().innerText()).length > 20);
      await shot("01-template-grid");
      assert.equal(await snapshot(), before);
      await page
        .locator(".vtemplate-card")
        .filter({
          has: page.getByRole("heading", {
            name: "C2 · 精细移动平台",
            exact: true,
          }),
        })
        .getByRole("button", { name: "查看模型", exact: true })
        .click();
      await loaded();
      assert.match(page.url(), /template=sample-mobile/);
      await page
        .getByRole("button", { name: "返回模板库", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "模板库", exact: true })
        .waitFor();
      assert.equal(await snapshot(), before);
      await page.reload();
      await page
        .getByRole("heading", { name: "模板库", exact: true })
        .waitFor();
      assert.equal(await page.locator(".vtemplate-card").count(), 3);
    },
  );
  await run(
    "Grid return protects pending supported model parameter edits",
    async () => {
      await page
        .locator(".vtemplate-card")
        .filter({
          has: page.getByRole("heading", {
            name: "Q4 · 精细巡检构型",
            exact: true,
          }),
        })
        .getByRole("button", { name: "查看模型", exact: true })
        .click();
      await loaded();
      const before = await snapshot();
      const rail = page.getByRole("complementary", {
        name: "模型参数面板",
        exact: true,
      });
      await rail
        .getByLabel("搜索零件", { exact: true })
        .fill("inspection.camera-assembly");
      await rail.locator(".vpart-catalog button").first().click();
      const range = page.getByLabel("相机总成高度偏移", { exact: true });
      await range.press("End");
      await page
        .getByRole("button", { name: "返回模板库", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "还有未保存的参数修改",
        exact: true,
      });
      await dialog.waitFor();
      assert.equal(await snapshot(), before);
      await dialog
        .getByRole("button", { name: "放弃修改", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "模板库", exact: true })
        .waitFor();
      assert.equal(await snapshot(), before);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await shot("02-template-grid-mobile");
      await page.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await run(
    "Structured requirements preserve legacy notes, save a new revision, and restore every supplied value",
    async () => {
      await page.goto(`${base}/projects/${q4}/requirements`);
      await page
        .getByRole("heading", { name: "让设计目标更清晰", exact: true })
        .waitFor();
      const before = JSON.parse(await snapshot()).projects.find(
        (p) => p.id === q4,
      );
      await shot("03-requirements-initial");
      const values = {
        任务与对象: "巡检设备温升与仪表状态",
        作业场景: "室内仓库，每日两轮，异常人工复核",
        任务载荷: "相机与温度传感器，质量待确认",
        空间与工作范围: "通道净宽 1 m；目标高 0.4–1.8 m",
        作业性能: "每日两轮，覆盖率目标 95%",
        环境边界: "室内平整地面，弱光区域",
        安全与协作: "人员接近时停车，允许人工接管",
        系统对接: "图像、测点与设备台账对应",
        验收标准: "按固定路线测试 10 次，检查覆盖率与异常记录",
      };
      await page
        .locator(".vrequirement-group")
        .filter({
          has: page.locator("summary").filter({ hasText: "运行与安全" }),
        })
        .locator("summary")
        .click();
      await page
        .locator(".vrequirement-group")
        .filter({
          has: page.locator("summary").filter({ hasText: "对接与验收" }),
        })
        .locator("summary")
        .click();
      for (const [label, value] of Object.entries(values))
        await page.getByLabel(label, { exact: true }).fill(value);
      assert.deepEqual(
        JSON.parse(await snapshot()).projects.find((p) => p.id === q4),
        before,
      );
      await page
        .getByRole("button", { name: "保存需求，设计探索", exact: true })
        .click();
      await page.waitForURL(/\/start$/);
      const after = JSON.parse(await snapshot()).projects.find(
        (p) => p.id === q4,
      );
      assert.equal(after.requirements.length, before.requirements.length + 1);
      assert.deepEqual(after.requirements.slice(0, -1), before.requirements);
      assert.deepEqual(after.artifacts, before.artifacts);
      assert.equal(after.requirements.at(-1).missingFields.length, 0);
      assert.match(
        after.requirements.at(-1).constraints,
        /验收标准：按固定路线测试 10 次/,
      );
      await page.goto(`${base}/projects/${q4}/requirements`);
      await page.getByLabel("任务与对象", { exact: true }).waitFor();
      for (const [label, value] of Object.entries(values))
        assert.equal(
          await page.getByLabel(label, { exact: true }).inputValue(),
          value,
        );
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await shot("04-requirements-mobile");
      await page.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await run(
    "A standalone design can add Simcore with the exact selected model source, without duplicating or changing the design",
    async () => {
      // The earlier requirement edit makes its old delivery historical. Save a current adaptation first.
      await page.goto(`${base}/projects/${q4}/library?template=sample-inspection`);
      await page.locator('[data-model-loaded="true"]').waitFor();
      await page.getByRole("button",{name:"保存适配并查看成果",exact:true}).click();
      await page.waitForURL(/\/delivery$/);
      await page.getByRole("button",{name:"进入 Simcore",exact:true}).waitFor();
      const before = await snapshot();
      const sourceProject = JSON.parse(before).projects.find(
        (p) => p.id === q4,
      );
      await page
        .getByRole("button", { name: "进入 Simcore", exact: true })
        .click();
      await page.waitForURL(/\/v8\/simcore\?project=/);
      await page
        .getByRole("heading", { name: "场景库", exact: true })
        .waitFor();
      let locals = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("embomix-v8-workspace-projects") || "[]",
        ),
      );
      const owner = locals.find((p) => p.embodexProjectId === q4);
      assert(owner);
      assert.notEqual(owner.id, q4);
      assert.deepEqual(owner.modules, ["embodex", "simcore"]);
      const handoff = owner.simulationHandoff;
      assert(handoff);
      const model = sourceProject.artifacts.find(
        (a) => a.id === handoff.modelArtifactId,
      );
      assert.equal(model.kind, "model");
      assert.equal(model.status, "ready");
      assert.equal(handoff.fileName, model.fileName);
      assert.equal(handoff.source.projectId, q4);
      assert.equal(handoff.source.requirementId, model.requirementId);
      assert.equal(handoff.source.templateId, model.templateId);
      assert.deepEqual(
        handoff.source.parameterSnapshot,
        model.parameterSnapshot,
      );
      assert.equal(await snapshot(), before);
      await page.reload();
      await page
        .getByRole("heading", { name: "场景库", exact: true })
        .waitFor();
      assert.equal(await page.getByLabel("仿真项目").inputValue(),owner.id);
      await page.getByText("模型已就绪",{exact:true}).waitFor();
      await page.getByRole("button",{name:"查看来源模型 ↗",exact:true}).click();
      await page.locator('[data-model-loaded="true"]').waitFor();
      assert.equal(await page.locator('[data-model-loaded="true"]').first().getAttribute("data-model-sha256"), model.sha256);
      await shot("05-simcore-handoff");
      await page
        .getByRole("button", { name: "返回 Embodex 设计 ↗", exact: true })
        .click();
      await page.waitForURL(/\/projects\/demo-example-q4-inspection\/delivery/);
      await page
        .getByRole("button", { name: "进入 Simcore", exact: true })
        .click();
      await page.waitForURL(/\/v8\/simcore\?project=/);
      locals = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("embomix-v8-workspace-projects") || "[]",
        ),
      );
      assert.equal(locals.filter((p) => p.embodexProjectId === q4).length, 1);
      assert.equal(await snapshot(), before);
    },
  );
  await run("A recorded Simcore source is rechecked after expiry and cannot be handed off as ready", async () => {
    await page.evaluate((id) => {
      const projects=JSON.parse(localStorage.getItem('embodex-v8-preview-v1'));
      const owner=JSON.parse(localStorage.getItem('embomix-v8-workspace-projects')).find(p=>p.embodexProjectId===id);
      const model=projects.projects.find(p=>p.id===id).artifacts.find(a=>a.id===owner.simulationHandoff.modelArtifactId);
      model.status='expired';
      localStorage.setItem('embodex-v8-preview-v1',JSON.stringify(projects));
    }, q4);
    await page.reload();
    await page.getByRole('heading',{name:'场景库',exact:true}).waitFor();
    await page.locator('.sc-source').getByText('文件待核验',{exact:true}).waitFor();
    assert.equal(await page.locator('.sc-source').getByText('模型已就绪',{exact:true}).count(),0);
    assert(await page.getByRole('button',{name:'查看来源模型 ↗',exact:true}).isDisabled());
    await page.goto(`${base}/projects/${q4}/delivery`);
    await page.getByRole('heading',{name:'方案交付',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'进入 Simcore',exact:true}).isDisabled(),true);
  });
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
console.log(
  JSON.stringify({
    passed: report.cases.filter((c) => c.status === "passed").length,
    failed: report.cases.filter((c) => c.status === "failed").length,
    errors: report.errors,
  }),
);
if (report.errors.length || report.cases.some((c) => c.status === "failed"))
  process.exitCode = 1;
