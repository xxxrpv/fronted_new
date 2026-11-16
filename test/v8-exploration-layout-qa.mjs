import assert from "node:assert/strict";
import { viewConceptRevision } from "./v8-preview-browser.mjs";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = "test-results/v8-exploration-layout";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const report = { cases: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
const base = "http://127.0.0.1:3108/v8",
  id = "demo-example-ai-review";
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
const active = () => page.locator('.vstagebar [aria-current="step"]');
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await run(
    "Custom choices stay in exploration; preview and return preserve the project and stage semantics",
    async () => {
      await page.goto(`${base}/projects/${id}/start`);
      await page
        .getByRole("button", { name: "开始专业定制", exact: true })
        .click();
      await page.waitForURL(/\/concepts$/);
      assert((await active().innerText()).includes("设计探索"));
      assert.equal(
        await page.locator(".vsummary-short,.vsummary-line").count(),
        0,
      );
      const before = await page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem("embodex-v8-preview-v1"),
          ).projects.find((p) => p.id === id),
        id,
      );
      await page
        .getByRole("button", { name: "返回设计探索", exact: true })
        .click();
      await page.waitForURL(/\/start$/);
      assert(
        await page
          .getByRole("button", { name: "编辑需求", exact: true })
          .isEnabled(),
      );
      await page
        .getByRole("button", { name: "开始专业定制", exact: true })
        .click();
      await page.waitForURL(/\/concepts$/);
      await page.reload();
      await page.locator(".vconcept-card").first().waitFor();
      assert((await active().innerText()).includes("设计探索"));
      await shot("concept-grid");
      await page.locator(".vconcept-card .vtemplate-preview").first().click();
      await page.waitForURL(/\/concepts\/[^/?]+/);
      assert((await active().innerText()).includes("模型概览"));
      await page
        .getByRole("button", { name: "全部概念方向", exact: true })
        .click();
      await page.waitForURL(/\/concepts$/);
      assert((await active().innerText()).includes("设计探索"));
      assert(
        await page
          .locator(".vstagebar button")
          .filter({ hasText: "模型概览" })
          .isDisabled(),
      );
      await page
        .locator(".vconcept-card .vtemplate-copy>.vbutton")
        .first()
        .click();
      await page.waitForURL(/\/concepts\/[^/?]+/);
      assert((await active().innerText()).includes("模型概览"));
      const after = await page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem("embodex-v8-preview-v1"),
          ).projects.find((p) => p.id === id),
        id,
      );
      assert.deepEqual(after.branches, before.branches);
      assert.deepEqual(after.approvals, before.approvals);
      assert.deepEqual(after.cadRuns, before.cadRuns);
    },
  );
  await run(
    "Concept choices reuse the template card layout, surfaces and transparent posters with design tradeoffs",
    async () => {
      await page.goto(`${base}/projects/${id}/library`);
      await page.locator(".vtemplate-card").first().waitFor();
      const read = (n) => {
        const s = getComputedStyle(n);
        return Object.fromEntries(
          [
            "backgroundColor",
            "borderRadius",
            "padding",
            "fontSize",
            "minHeight",
          ].map((k) => [k, s[k]]),
        );
      };
      const styles = {};
      for (const selector of [
        ".vtemplate-card",
        ".vtemplate-preview",
        ".vtemplate-copy",
        ".vtemplate-copy h2",
        ".vtemplate-copy details",
        ".vtemplate-copy>.vbutton",
      ])
        styles[selector] = await page.locator(selector).first().evaluate(read);
      await page.goto(`${base}/projects/${id}/concepts`);
      await page.locator(".vconcept-card").first().waitFor();
      for (const [selector, expected] of Object.entries(styles))
        assert.deepEqual(
          await page.locator(selector).first().evaluate(read),
          expected,
          selector,
        );
      assert.equal(
        await page
          .locator(".vconcept-card summary")
          .filter({ hasText: "设计取舍" })
          .count(),
        await page.locator(".vconcept-card").count(),
      );
      assert.equal(await page.locator(".vconcept-art").count(), 0);
      assert(
        (
          await page
            .locator(".vconcept-card img")
            .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")))
        ).every((src) => src.includes("/catalog/")),
      );
      await page
        .getByRole("button", { name: "再探索更多方向", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".vconcept-card").length === 4,
      );
      await page
        .locator(".vconcept-card img")
        .evaluateAll((images) =>
          Promise.all(images.map((img) => img.decode())),
        );
      await shot("all-concept-grid");
      const summary = page.locator(".vconcept-card summary").first();
      await summary.click();
      assert(await summary.evaluate((n) => n.parentElement.open));
    },
  );
  await run(
    "Concept confirmation and engineering delivery align with their canvas on desktop",
    async () => {
      await page
        .locator(".vconcept-card .vtemplate-copy>.vbutton")
        .first()
        .click();
      await page
        .locator('[data-model-loaded="true"]')
        .first()
        .waitFor({ timeout: 60000 });
      const check = async (name) => {
        const canvas = await page
            .locator(".vmain .vstudio-canvas")
            .first()
            .boundingBox(),
          button = await page.getByRole("button", { name }).boundingBox();
        assert(
          Math.abs(canvas.x + canvas.width - button.x - button.width) < 2,
          `${name}: ${JSON.stringify({ canvas, button })}`,
        );
      };
      await check(/确认 V\d+，开始 CAD 建模/);
      const confirmButton = page.getByRole("button", {
        name: /确认 V\d+，开始 CAD 建模/,
      });
      await confirmButton.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      assert(
        await confirmButton.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return [
            [0.1, 0.1],
            [0.5, 0.5],
            [0.9, 0.1],
            [0.9, 0.9],
          ].every(([x, y]) =>
            n.contains(
              document.elementFromPoint(
                r.left + r.width * x,
                r.top + r.height * y,
              ),
            ),
          );
        }),
      );
      await shot("concept-detail");
      await viewConceptRevision(page, "V01");
      await page.waitForURL(/revision=/);
      assert((await active().innerText()).includes("模型概览"));
      await page.goto(`${base}/projects/${id}/cad`);
      await page
        .getByRole("button", { name: "查看交付成果", exact: true })
        .waitFor();
      await check("查看交付成果");
      await page
        .locator('[data-model-loaded="true"]')
        .first()
        .waitFor({ timeout: 60000 });
      await shot("engineering");
    },
  );
  await run(
    "Phone choices, model stage and returns remain usable without overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/projects/${id}/concepts`);
      await page.locator(".vconcept-card").first().waitFor();
      await shot("phone-concept-grid");
      assert.equal(
        await page.locator("body").evaluate((n) => n.scrollWidth > innerWidth),
        false,
      );
      await page.locator(".vconcept-card .vtemplate-preview").first().click();
      await page.waitForURL(/\/concepts\/[^/?]+/);
      assert((await active().innerText()).includes("模型概览"));
      const confirm = page.getByRole("button", {
        name: /确认 V\d+，开始 CAD 建模/,
      });
      await confirm.scrollIntoViewIfNeeded();
      assert(await confirm.isEnabled());
      const b = await confirm.boundingBox();
      assert(b.x >= 0 && b.x + b.width <= 390);
      await page.waitForTimeout(100);
      assert(
        await confirm.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return n.contains(
            document.elementFromPoint(
              r.left + r.width * 0.9,
              r.top + r.height * 0.5,
            ),
          );
        }),
      );
      await page
        .getByRole("button", { name: "打开 AI 助手", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "常驻设计助手", exact: true })
        .waitFor();
      assert(
        await page
          .getByRole("dialog", { name: "常驻设计助手", exact: true })
          .evaluate((n) => {
            const r = n.getBoundingClientRect();
            return r.top >= 0 && r.left >= 0 && r.right <= innerWidth;
          }),
      );
      await page
        .getByRole("button", { name: "收起设计助手", exact: true })
        .click();
      await shot("phone-concept-detail");
      await page
        .getByRole("button", { name: "全部概念方向", exact: true })
        .click();
      await page
        .getByRole("button", { name: "返回设计探索", exact: true })
        .click();
      await page.waitForURL(/\/start$/);
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
