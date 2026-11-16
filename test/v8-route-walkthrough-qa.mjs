import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { enterPreviewDesign, viewConceptRevision } from "./v8-preview-browser.mjs";

// Every project below belongs to a fresh browser context, never the user's data.
const base = "http://127.0.0.1:3108/v8";
const inspect = process.argv.includes("--inspect");
const out = `test-results/v8-route-walkthrough${inspect ? "-before" : ""}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const report = { cases: [], issues: [], errors: [], layout: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const stageButton = (name) =>
  page.locator(".vstagebar > button").filter({ hasText: name });
const loaded = () =>
  page
    .locator('[data-model-loaded="true"]')
    .first()
    .waitFor({ timeout: 60000 });
const selectCamera = async () => {
  await page.getByLabel("搜索零件", { exact: true }).fill("dock-camera");
  await page.locator(".vpart-catalog button").first().click();
};
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const facts = (id) =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (p) => p.id === id,
      ),
    id,
  );
const waitFact = (id, code) =>
  page.waitForFunction(
    ([id, code]) => {
      const p = JSON.parse(
        localStorage.getItem("embodex-v8-preview-v1"),
      ).projects.find((p) => p.id === id);
      return new Function("p", `return ${code}`)(p);
    },
    [id, code],
    { timeout: 60000 },
  );
const check = (condition, message) => {
  if (!condition) report.issues.push(message);
  if (!inspect) assert(condition, message);
};
async function run(name, fn) {
  try {
    await fn();
    report.cases.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    report.cases.push({ name, passed: false, error: e.stack });
    await shot("failure");
    throw e;
  }
}
async function layout(name, activeLabel) {
  await page.waitForTimeout(120);
  const values = await page.evaluate(() => {
    const nav = document.querySelector(".vstagebar"),
      active = nav?.querySelector('[aria-current="step"]');
    const a = active?.getBoundingClientRect(),
      n = nav?.getBoundingClientRect();
    const history = nav?.querySelector(".vhistory-trigger");
    const right =
      history && getComputedStyle(history).position === "sticky"
        ? history.getBoundingClientRect().left
        : n.right;
    const coveredModelControls = [
      ...document.querySelectorAll('[aria-label="模型视角与缩放"] button'),
    ]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return (
          r.width &&
          r.top >= 128 &&
          r.bottom <= innerHeight &&
          [
            [0.5, 0.5],
            [0.9, 0.8],
          ].some(
            ([x, y]) =>
              !b.contains(
                document.elementFromPoint(
                  r.left + r.width * x,
                  r.top + r.height * y,
                ),
              ),
          )
        );
      })
      .map((b) => b.getAttribute("aria-label"));
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth - innerWidth,
      active: active?.textContent,
      activeVisible: !!a && a.left >= n.left - 1 && a.right <= right + 1,
      coveredModelControls,
      navScroll: nav?.scrollLeft,
      footers: [...document.querySelectorAll(".vstudio-footer button")].map(
        (b) => {
          const r = b.getBoundingClientRect();
          return {
            text: b.textContent.trim(),
            left: r.left,
            right: r.right,
            height: r.height,
          };
        },
      ),
    };
  });
  report.layout.push({ name, ...values });
  assert(
    values.active.includes(activeLabel),
    `${name}: stage must be ${activeLabel}`,
  );
  check(
    values.overflow <= 1,
    `${name}: horizontal overflow ${values.overflow}`,
  );
  check(values.activeVisible, `${name}: active stage is clipped`);
  check(
    !values.coveredModelControls.length,
    `${name}: model controls covered: ${values.coveredModelControls.join(", ")}`,
  );
  for (const b of values.footers)
    check(
      b.left >= -1 && b.right <= values.width + 1,
      `${name}: clipped button ${b.text}`,
    );
  await shot(name);
}
async function hit(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const result = await locator.evaluate((b) => {
    const r = b.getBoundingClientRect();
    const points = [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.9, 0.2],
      [0.9, 0.8],
    ];
    return {
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      covered: points
        .map(([x, y]) =>
          document.elementFromPoint(r.left + r.width * x, r.top + r.height * y),
        )
        .filter((n) => !b.contains(n))
        .map((n) => n?.className),
    };
  });
  check(
    result.covered.length === 0,
    `${label}: covered by ${JSON.stringify(result.covered)}`,
  );
}
async function newProject(name) {
  await enterPreviewDesign(page, base);
  await page.getByLabel("描述你的设计目标").fill(name);
  await page
    .locator("main")
    .getByRole("button", { name: "开始设计", exact: true })
    .click();
  await page.waitForURL(/\/requirements$/);
  const id = page.url().match(/\/projects\/([^/]+)/)[1];
  await page.getByLabel("任务与对象", { exact: true }).fill("室内设备巡检");
  await page.getByLabel("作业场景", { exact: true }).fill("仓库通道与设备测点");
  await button("保存需求，设计探索").click();
  await page.waitForURL(/\/start$/);
  return id;
}
async function previewDelivery(prefix) {
  assert.equal(
    await page.getByRole("dialog", { name: "设计历程", exact: true }).count(),
    0,
  );
  await layout(`${prefix}-delivery`, "方案交付");
  for (const b of await page.locator(".vdelivery-card button").all()) {
    assert(await b.isEnabled());
    await hit(b, `${prefix} ${await b.innerText()}`);
  }
  await button("在线查看").click();
  await page
    .getByRole("dialog", { name: "在线查看文件", exact: true })
    .waitFor();
  await loaded();
  await button("拆解模型").click();
  await page.keyboard.press("Escape");
  await button("查看完整方案").click();
  const iframe = page
    .getByRole("dialog", { name: "完整设计方案", exact: true })
    .locator("iframe");
  const frame = iframe.contentFrame();
  await frame.locator("#solution-title").waitFor();
  assert.equal(
    await frame.locator(".solution-nav [data-solution-jump]").count(),
    7,
  );
  const pending = page.waitForEvent("download");
  await frame.getByRole("button", { name: "下载 HTML", exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /\.html$/);
  await frame
    .getByRole("button", { name: "关闭完整设计方案", exact: true })
    .click();
  const historyVisible = await page.locator(".vhistory-trigger").isVisible();
  check(historyVisible, `${prefix}: history is hidden on phone`);
  if (historyVisible) {
    await button("设计历程").click();
    await page.getByRole("dialog", { name: "设计历程", exact: true }).waitFor();
    await button("关闭面板").click();
  }
}
let templateId, customId, branchId, revisionId;
try {
  await run(
    "Phone template route: select, adapt, save, inspect engineering, return and deliver",
    async () => {
      templateId = await newProject("路线复核 · 移动巡检平台");
      await layout("phone-exploration", "设计探索");
      await button("浏览模板库").click();
      await layout("phone-template-grid", "设计探索");
      await button("返回设计探索").click();
      await button("浏览模板库").click();
      await page
        .locator(".vtemplate-card")
        .filter({ hasText: "C2 · 精细移动平台" })
        .getByRole("button", { name: "查看模型", exact: true })
        .click();
      await loaded();
      await layout("phone-template-model", "模型概览");
      await selectCamera();
      const slider = page.locator("#sensor-offset");
      await slider.focus();
      await slider.press("ArrowRight");
      await slider.press("ArrowRight");
      await slider.press("ArrowRight");
      const offset = await slider.inputValue();
      await button("返回模板库").click();
      await page
        .getByRole("dialog", { name: "还有未保存的参数修改", exact: true })
        .waitFor();
      await button("继续编辑").click();
      assert.equal(await slider.inputValue(), offset);
      await hit(button("保存适配并查看成果"), "template save");
      await button("保存适配并查看成果").click();
      await page.waitForURL(/\/delivery$/);
      await waitFact(
        templateId,
        'p.artifacts.some(a => a.mimeType.startsWith("text/html"))',
      );
      const saved = await facts(templateId);
      assert.equal(saved.cadRuns.length, 0);
      assert.equal(saved.parameters.mobileCameraHeight, Number(offset) / 1000);
      await previewDelivery("phone-template");
      await stageButton("工程模型").click();
      await loaded();
      await layout("phone-template-engineering", "工程模型");
      await hit(button("返回模型适配"), "template engineering return");
      await button("返回模型适配").click();
      await page.waitForURL(/\/library/);
      check(
        new URL(page.url()).searchParams.get("template") === "sample-mobile",
        "Engineering return loses the current template",
      );
      if (!new URL(page.url()).searchParams.has("template"))
        await page
          .locator(".vtemplate-card")
          .filter({ hasText: "C2 · 精细移动平台" })
          .getByRole("button", { name: "查看模型", exact: true })
          .click();
      await loaded();
      await selectCamera();
      assert.equal(await slider.inputValue(), offset);
      await button("保存适配并查看成果").click();
      await page.waitForURL(/\/delivery$/);
      assert.equal(
        (await facts(templateId)).artifacts.length,
        saved.artifacts.length,
      );
      await button("继续完善设计").click();
      await loaded();
      await selectCamera();
      assert.equal(
        new URL(page.url()).searchParams.get("template"),
        "sample-mobile",
      );
      assert.equal(await slider.inputValue(), offset);
      await button("返回模板库").click();
      await button("返回设计探索").click();
      await page.waitForURL(/\/start$/);
    },
  );
  await run(
    "Phone custom route: options, revision, exact confirmation, engineering source and delivery return",
    async () => {
      customId = await newProject("路线复核 · 四足巡检设计");
      await button("开始专业定制").click();
      await layout("phone-custom-empty", "设计探索");
      await button("生成概念方向").click();
      await page.locator(".vconcept-card").first().waitFor({ timeout: 60000 });
      await button("返回设计探索").click();
      await button("开始专业定制").click();
      await layout("phone-custom-options", "设计探索");
      await button("比较方向").click();
      await page
        .getByRole("dialog", { name: "比较概念方向", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page
        .locator(".vconcept-card")
        .first()
        .getByRole("button", { name: "查看并深化", exact: true })
        .click();
      await loaded();
      branchId = page.url().match(/\/concepts\/([^/?]+)/)[1];
      await button("继续修改这个方向").click();
      await page
        .getByLabel("修改要求", { exact: true })
        .fill("保留维修空间，调整相机安装说明");
      await button("创建新修订").click();
      await waitFact(customId, "p.branches[0].revisions.length === 2");
      await viewConceptRevision(page, "V02");
      await page.locator("h1").filter({ hasText: "V02" }).waitFor();
      revisionId = new URL(page.url()).searchParams.get("revision");
      await layout("phone-custom-v02", "模型概览");
      await hit(
        page.getByRole("button", { name: /确认 V02，开始 CAD 建模/ }),
        "custom confirm",
      );
      await page
        .getByRole("button", { name: /确认 V02，开始 CAD 建模/ })
        .click();
      await hit(button("确认并创建样例工程任务"), "custom approval dialog");
      await button("确认并创建样例工程任务").click();
      await page.waitForURL(/\/cad/);
      await waitFact(
        customId,
        'p.cadRuns.at(-1)?.status === "succeeded" && p.artifacts.some(a=>a.mimeType.startsWith("text/html"))',
      );
      await loaded();
      await layout("phone-custom-engineering", "工程模型");
      const approved = await facts(customId);
      assert.equal(approved.cadRuns[0].revisionId, revisionId);
      await hit(button("返回来源概念"), "custom engineering return");
      await button("返回来源概念").click();
      await page.waitForURL(/\/concepts\//);
      assert.equal(
        new URL(page.url()).searchParams.get("revision"),
        revisionId,
      );
      await stageButton("工程模型").click();
      await loaded();
      await button("查看交付成果").click();
      await page.waitForURL(/\/delivery$/);
      await previewDelivery("phone-custom");
      await button("继续完善设计").click();
      await page.waitForURL(/\/concepts\//);
      assert(page.url().includes(branchId));
      assert.equal(
        new URL(page.url()).searchParams.get("revision"),
        revisionId,
      );
      await button("全部概念方向").click();
      await button("返回设计探索").click();
      await page.waitForURL(/\/start$/);
      const after = await facts(customId);
      assert.deepEqual(after.approvals, approved.approvals);
      assert.deepEqual(after.cadRuns, approved.cadRuns);
    },
  );
  await run(
    "320px and desktop: existing route buttons and stage restoration",
    async () => {
      for (const width of [320, 1440]) {
        await page.setViewportSize({
          width,
          height: width === 320 ? 740 : 1000,
        });
        for (const [id, stage, label] of [
          [templateId, "library?template=sample-mobile", "模型概览"],
          [templateId, "cad", "工程模型"],
          [customId, `concepts/${branchId}?revision=${revisionId}`, "模型概览"],
          [customId, "cad", "工程模型"],
          [customId, "delivery", "方案交付"],
        ]) {
          await page.goto(`${base}/projects/${id}/${stage}`);
          await page.locator(".vmain h1").waitFor();
          if (stage !== "delivery") await loaded();
          await layout(
            `${width}-${id === templateId ? "template" : "custom"}-${stage.split(/[/?]/)[0]}`,
            label,
          );
          for (const b of await page
            .locator(".vstudio-footer button,.vartifact-actions button")
            .all())
            if (await b.isEnabled())
              await hit(b, `${width}: ${await b.innerText()}`);
        }
      }
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ issues: report.issues, errors: report.errors }));
  await browser.close();
}
