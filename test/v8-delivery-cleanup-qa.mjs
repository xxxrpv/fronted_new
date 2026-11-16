import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { viewConceptRevision } from "./v8-preview-browser.mjs";
const out = "test-results/v8-delivery-cleanup",
  base = "http://127.0.0.1:3108/v8";
const id = "demo-example-complete-inspection";
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
const button = (name) => page.getByRole("button", { name, exact: true });
const read = () =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (p) => p.id === id,
      ),
    id,
  );
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
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
async function hit(locator) {
  await locator.scrollIntoViewIfNeeded();
  assert(
    await locator.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth &&
        b.contains(
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2),
        )
      );
    }),
  );
}
let original, branch;
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await button("进入工作空间").click();
  await page.goto(`${base}/projects/${id}/delivery`);
  await button("查看完整方案").waitFor();
  original = await read();
  branch = original.branches[0];
  await run(
    "History owns full versions; viewing old concepts and engineering remains read-only",
    async () => {
      await page.goto(`${base}/projects/${id}/concepts/${branch.id}`);
      await page.locator('[data-model-loaded="true"]').waitFor();
      assert.equal(
        await page
          .locator(
            "main .vversion-track,main .vrun-select,main code,main .veyebrow",
          )
          .count(),
        0,
      );
      await page.locator("main .vsource-details summary").click();
      const content = await page.locator("main").innerText();
      for (const value of [
        id,
        branch.id,
        branch.revisions.at(-1).id,
        branch.revisions.at(-1).descriptionId,
      ])
        assert(!content.includes(value));
      await shot("desktop-concept");
      await viewConceptRevision(page, "V01");
      assert((await page.locator("h1").innerText()).includes("V01"));
      assert(
        (await page.locator(".studio-heading").innerText()).includes(
          "历史版本",
        ),
      );
      await viewConceptRevision(page, "V02");
      await button("设计历程").click();
      const history = page.getByRole("dialog", {
        name: "设计历程",
        exact: true,
      });
      assert(
        await button("关闭面板").evaluate((n) => n === document.activeElement),
      );
      await history.getByText("需求记录", { exact: true }).click();
      assert(
        (await history.innerText()).includes(original.requirements.at(-1).text),
      );
      await shot("desktop-history");
      await history.locator(".vrun-select select").selectOption("0");
      await page.waitForURL(/\/cad\?run=/);
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
      await button("查看交付成果").click();
      await page.waitForURL(/\/delivery$/);
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
      assert.deepEqual(await read(), original);
    },
  );
  await run(
    "Official HTML keeps seven sections and controls, without decorative labels or visible source IDs",
    async () => {
      await button("查看完整方案").click();
      const f = page
        .getByRole("dialog", { name: "完整设计方案", exact: true })
        .locator("iframe")
        .contentFrame();
      await f.locator("#solution-title").waitFor();
      assert.equal(
        await f
          .locator(
            ".solution-kicker,.report-workbench-heading,.solution-parameter-note,.solution-example-label,.solution-hero-art figcaption",
          )
          .count(),
        0,
      );
      assert.equal(
        await f.locator(".solution-nav [data-solution-jump]").count(),
        7,
      );
      for (const selector of [
        ".report-close",
        '[data-report-export="html"]',
        '[data-report-export="print"]',
      ])
        assert(await f.locator(selector).isEnabled());
      const body = await f.locator("body").innerText();
      for (const value of [
        id,
        branch.id,
        branch.revisions.at(-1).id,
        branch.revisions.at(-1).descriptionId,
      ])
        assert(!body.includes(value));
      await f.locator('[data-model-loaded="true"]').waitFor({ timeout: 60000 });
      assert.equal(await f.locator(".report-workspace-loading").count(), 0);
      await shot("desktop-html");
      await f
        .locator('.solution-nav [data-solution-jump="interactive"]')
        .click();
      await f.locator('[data-model-loaded="true"]').waitFor({ timeout: 60000 });
      await f.getByRole("button", { name: "拆解模型", exact: true }).click();
      await f.getByLabel("拆解程度", { exact: true }).fill("70");
      assert.equal(
        await f.getByLabel("拆解程度", { exact: true }).inputValue(),
        "70",
      );
      await f
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      assert.deepEqual(await read(), original);
    },
  );
  await run(
    "Model and assistant close controls use SVG; geometry remains available on demand",
    async () => {
      await button("在线查看").click();
      const preview = page.getByRole("dialog", {
        name: "在线查看文件",
        exact: true,
      });
      await preview.locator('[data-model-loaded="true"]').waitFor();
      assert.equal(await button("关闭文件预览").locator("svg").count(), 1);
      await button("打开模型部件目录").click();
      const picker = page.getByLabel("选择模型组件", { exact: true });
      const value = await picker
        .locator("option")
        .evaluateAll(
          (nodes) => nodes.find((n) => n.value && n.value !== "all")?.value,
        );
      await picker.selectOption(value);
      const info = preview.locator('[class*="inspectionInfo"]');
      await info.waitFor();
      assert.equal(await info.getByText(/三角面/).isVisible(), false);
      await info.getByText("几何与来源", { exact: true }).click();
      assert(await info.getByText(/三角面/).isVisible());
      assert.equal(await button("关闭部件信息").locator("svg").count(), 1);
      await button("关闭部件信息").click();
      await button("关闭文件预览").focus();
      await page.keyboard.press("Enter");
      await button("打开 AI 助手").click();
      const assistant = page.getByRole("dialog", {
        name: "常驻设计助手",
        exact: true,
      });
      assert.equal(await button("收起设计助手").locator("svg").count(), 1);
      assert(!(await assistant.innerText()).includes("本地操作预览"));
      await page.keyboard.press("Escape");
    },
  );
  await run(
    "Phone history, dialogs and delivery actions fit and remain keyboard accessible",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/projects/${id}/concepts/${branch.id}`);
      await page.locator("h1").waitFor();
      await button("设计历程").click();
      await shot("phone-history");
      await hit(button("关闭面板"));
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .getByRole("dialog", { name: "设计历程", exact: true })
          .count(),
        0,
      );
      await viewConceptRevision(page, "V01");
      await viewConceptRevision(page, "V02");
      await page.locator('[data-model-loaded="true"]').waitFor();
      await page.locator(".vbranch-switch").scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      assert(
        await page.evaluate(() => {
          const assistant = document
            .querySelector(".vassistant-dock")
            .getBoundingClientRect();
          return [...document.querySelectorAll(".vbranch-switch button")].every(
            (button) => {
              const r = button.getBoundingClientRect();
              return (
                r.right <= 0 ||
                r.left >= innerWidth ||
                r.bottom <= 0 ||
                r.top >= innerHeight ||
                r.right <= assistant.left ||
                r.left >= assistant.right ||
                r.bottom <= assistant.top ||
                r.top >= assistant.bottom
              );
            },
          );
        }),
        "Assistant must not cover visible direction controls",
      );
      await button("调整此概念支持的参数").click();
      await page.getByLabel("相机总成高度偏移", { exact: true }).fill("25");
      await button("关闭面板").click();
      assert(
        await page
          .getByText("先保存参数为新版本，再确认方案", { exact: true })
          .isVisible(),
      );
      assert(
        await page
          .getByRole("button", { name: /确认 V02，开始 CAD 建模/ })
          .isDisabled(),
      );
      await button("设计历程").click();
      await page
        .locator(".vhistory-versions > details[open] .vversion-track")
        .getByRole("button", { name: /^V01 / })
        .click();
      const guard = page.getByRole("dialog", {
        name: "还有未保存的参数修改",
        exact: true,
      });
      await guard.waitFor();
      await guard
        .getByRole("button", { name: "放弃修改", exact: true })
        .click();
      await page.waitForURL(new RegExp(`revision=${branch.revisions[0].id}`));
      await viewConceptRevision(page, "V02");
      await page.goto(`${base}/projects/${id}/delivery`);
      await button("在线查看").click();
      await hit(button("关闭文件预览"));
      await page.keyboard.press("Escape");
      await button("查看完整方案").click();
      const f = page
        .getByRole("dialog", { name: "完整设计方案", exact: true })
        .locator("iframe")
        .contentFrame();
      await f.locator("#solution-title").waitFor();
      await shot("phone-html");
      await f
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .press("Enter");
      assert(await button("查看完整方案").isVisible());
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(await read(), original);
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
