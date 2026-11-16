import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const out = "test-results/v8-official-report-parity";
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
page.setDefaultTimeout(25000);
const report = { cases: [], errors: [], styles: [] };
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
const base = "http://127.0.0.1:3108/v8";
const doc = () =>
  page
    .getByRole("dialog", { name: "完整设计方案", exact: true })
    .locator("iframe")
    .contentFrame();
const chapter = async (id) => {
  await doc().locator(`.solution-nav [data-solution-jump="${id}"]`).click();
  await doc()
    .locator(`.solution-nav [data-solution-jump="${id}"][aria-current="step"]`)
    .waitFor();
  await page.waitForTimeout(100);
};
const shot = async (name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await page.goto(`${base}/projects/demo-example-q4-inspection/delivery`);
  await page.getByRole("button", { name: "查看完整方案", exact: true }).click();
  await run(
    "Original seven chapters and four illustrated system cards render without a second reader design",
    async () => {
      await doc().locator(".system-illustrated-card").nth(3).waitFor();
      assert.equal(await doc().locator(".system-illustrated-card").count(), 4);
      assert.deepEqual(
        await doc().locator(".solution-nav button").allTextContents(),
        [
          "01需求与方案",
          "02交互式方案",
          "03整体方案",
          "04场景任务",
          "05投资预算",
          "06企业效益",
          "07交付流程",
        ],
      );
      assert.equal(await page.locator(".design-report-toolbar").count(), 0);
      for (const id of [
        "overview",
        "interactive",
        "system",
        "engineering",
        "budget",
        "economics",
        "delivery",
      ]) {
        await chapter(id);
        await shot(id);
      }
    },
  );
  await run(
    "Original stylesheet appearance matches the supplied website components",
    async () => {
      const reference = await context.newPage();
      const innerSize = await page
        .locator(".official-report-dialog>iframe")
        .evaluate((n) => ({ width: n.clientWidth, height: n.clientHeight }));
      await reference.setViewportSize(innerSize);
      const source = resolve("../../../网站设计/EmbodiX官网-交付版/dist");
      const css = await Promise.all(
        [
          "styles.css",
          "site.css",
          "solution.css",
          "solution-business.css",
          "solution-scenarios.css",
          "i18n.css",
        ].map((name) => readFile(resolve(source, name), "utf8")),
      );
      await reference.setContent(
        `<base href="http://127.0.0.1:3108/"><style>${css.join("\n")}</style><div class="case-experience is-expanded"><header class="case-toolbar toolbar-minimal"><div class="case-tools"><button class="icon-button">×</button></div></header><div class="case-frame-mount" style="height:620px"></div></div><img hidden data-robot-form="quadruped" src="/v8-assets/official-inspection-hero.png">`,
      );
      for (const name of [
        "solution-data.js",
        "solution-scenarios.js",
        "solution-business.js",
        "solution-business-ui.js",
        "solution.js",
      ])
        await reference.addScriptTag({
          content: await readFile(resolve(source, name), "utf8"),
        });
      await reference.evaluate(() =>
        window
          .initSolutionPage({
            shell: document.querySelector(".case-experience"),
            mount: document.querySelector(".case-frame-mount"),
            onProjectSelect() {},
            onModeSelect() {},
          })
          .setExpanded(true),
      );
      const style = (node) => {
        const s = getComputedStyle(node);
        return Object.fromEntries(
          [
            "backgroundImage",
            "color",
            "fontSize",
            "borderRadius",
            "padding",
            "gap",
            "boxShadow",
          ].map((k) => [k, s[k]]),
        );
      };
      for (const selector of [
        ".solution-hero h2",
        ".solution-brief",
        ".solution-primary",
        '.solution-nav button[aria-current="step"]',
        ".system-illustrated-card",
        ".system-card-action",
        ".business-budget-hero",
        ".business-detail>summary",
        ".business-parameter-group",
      ]) {
        const actual = await doc().locator(selector).first().evaluate(style),
          expected = await reference.locator(selector).first().evaluate(style);
        assert.deepEqual(actual, expected, selector);
        report.styles.push(selector);
      }
      await reference.screenshot({
        path: `out/reference-overview.png`.replace("out/", `${out}/`),
      });
      await reference.close();
    },
  );
  await run(
    "System actions control the real source model; rapid explosion and return remain interactive",
    async () => {
      await chapter("system");
      await doc().locator('[data-solution-mode="exploded"]').click();
      const model = doc().locator('[data-model-loaded="true"]').first();
      await model.waitFor({ timeout: 60000 });
      await page.waitForTimeout(600);
      assert.equal(await model.getAttribute("data-explode-level"), "0.65");
      await doc()
        .getByRole("button", { name: "还原整机", exact: true })
        .click();
      assert.equal(await model.getAttribute("data-explode-level"), "0");
      await chapter("system");
      await doc().locator('[data-solution-mode="sensors"]').click();
      await page.waitForTimeout(350);
      assert.equal(
        await model.getAttribute("data-inspection-mode"),
        "perception",
      );
      await shot("interactive-perception");
    },
  );
  await run(
    "Original task disclosures and linked budget calculations work, missing values remain unknown",
    async () => {
      await chapter("engineering");
      const task = doc().locator("[data-business-task]").nth(2);
      await task.click();
      assert.equal(await task.getAttribute("aria-expanded"), "true");
      await doc().locator("#business-task-detail h4").waitFor();
      await task.press("Enter");
      assert.equal(await task.getAttribute("aria-expanded"), "false");
      await chapter("budget");
      assert.equal(
        await doc().locator('[data-business-out="total"]').innerText(),
        "—",
      );
      for (const [key, value] of Object.entries({
        hardware: "100000",
        software: "20000",
        integration: "10000",
        contingencyRate: "10",
      })) {
        const input = doc().locator(`[data-business-field="${key}"]`);
        await input.evaluate((n) => {
          for (let p = n.parentElement; p; p = p.parentElement)
            if (p.tagName === "DETAILS") p.open = true;
        });
        await input.fill(value);
      }
      assert.equal(
        await doc().locator('[data-business-out="total"]').innerText(),
        "¥143,000",
      );
      assert.equal(
        await doc().locator('[data-business-out="netCash"]').innerText(),
        "—",
      );
      await doc().locator('[data-business-field="hardware"]').fill("");
      assert.equal(
        await doc().locator('[data-business-out="total"]').innerText(),
        "—",
      );
      await chapter("delivery");
      const delivery = doc().locator(".business-module-flow details").first();
      await delivery.locator("summary").click();
      assert(await delivery.evaluate((n) => n.open));
    },
  );
  await run(
    "Reading exports download, the underlying saved source stays unchanged, and mobile layout fits",
    async () => {
      const before = await page.evaluate(() =>
        localStorage.getItem("embodex-v8-preview-v1"),
      );
      const pending = page.waitForEvent("download");
      await doc().locator('[data-report-export="html"]').click();
      const file = await pending;
      await file.saveAs(`${out}/reading.html`);
      const html = await readFile(await file.path(), "utf8");
      assert(html.includes("solution-budget"));
      assert(html.includes("data:image/png;base64,"));
      assert(!html.includes('report-interactive-host"'));
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("embodex-v8-preview-v1"),
        ),
        before,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await chapter("overview");
      await shot("mobile-overview");
      assert.equal(
        await doc()
          .locator("body")
          .evaluate((n) => n.scrollWidth > innerWidth),
        false,
      );
      await doc()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("dialog", { name: "完整设计方案", exact: true })
          .count(),
        0,
      );
    },
  );
  await run(
    "The C2 report uses its own source images and preserves the original language switch",
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const source = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
          (p) => p.templateId === "sample-mobile",
        ),
      );
      await page.goto(`${base}/projects/${source.id}/delivery`);
      await page
        .getByRole("button", { name: "查看完整方案", exact: true })
        .click();
      await doc().locator("#solution-title").waitFor();
      assert(
        (await doc().locator("#solution-title").innerText()).includes(
          source.name,
        ),
      );
      assert.equal(
        await doc().locator("body").getAttribute("data-requirement-id"),
        source.requirements.at(-1).id,
      );
      assert(
        await doc()
          .locator(".system-illustrated-card img")
          .evaluateAll((nodes) =>
            nodes.some((n) => n.src.includes("official-c2-sensors")),
          ),
      );
      await doc().locator("[data-language-toggle]").click();
      await doc().locator('html[lang="en"]').waitFor();
      assert(
        (
          await doc().locator(".solution-nav button").first().innerText()
        ).includes("Brief & solution"),
      );
      await doc().locator("[data-language-toggle]").click();
      await doc().locator('html[lang="zh-CN"]').waitFor();
      assert(
        (
          await doc().locator(".solution-nav button").first().innerText()
        ).includes("需求与方案"),
      );
      await doc()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
    },
  );
  await run(
    "The complete example opens all seven chapters and its confirmed interactive model",
    async () => {
      const id = "demo-example-complete-inspection";
      await page.goto(`${base}/projects/${id}/delivery`);
      await page
        .getByRole("button", { name: "查看完整方案", exact: true })
        .click();
      await doc().locator("#solution-title").waitFor();
      assert(
        (await doc().locator("#solution-title").innerText()).includes(
          "完整流程示例",
        ),
      );
      assert.equal(
        await doc().locator("body").getAttribute("data-requirement-id"),
        `${id}-requirement-v01`,
      );
      for (const key of [
        "overview",
        "interactive",
        "system",
        "engineering",
        "budget",
        "economics",
        "delivery",
      ])
        await chapter(key);
      await chapter("interactive");
      await doc()
        .locator('[data-model-loaded="true"]')
        .first()
        .waitFor({ timeout: 60000 });
      await doc()
        .getByRole("button", { name: "拆解模型", exact: true })
        .click();
      assert(
        Number(
          await doc()
            .locator('[data-model-loaded="true"]')
            .first()
            .getAttribute("data-explode-level"),
        ) > 0,
      );
      await doc()
        .getByRole("button", { name: "还原整机", exact: true })
        .click();
      await shot("complete-example-interactive");
      await chapter("overview");
      await shot("complete-example-overview");
      await doc()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
