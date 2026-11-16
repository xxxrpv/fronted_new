/** Source-aligned mode behavior, frozen scheme entry and actual GLB interaction. Local preview only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
} catch {
  playwright = require("C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright");
}
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
assert.equal(new URL(base).pathname.replace(/\/$/, ""), "/v8");
const viewerOnly = process.env.V8_PARITY_PHASE === "viewer";
const output = resolve(
  viewerOnly
    ? "test-results/v8-official-parity-viewer"
    : "test-results/v8-official-parity",
);
await mkdir(output, { recursive: true });
const report = {
  mode: "isolated-local-development-preview",
  startedAt: new Date().toISOString(),
  cases: [],
  pageErrors: [],
  productionMutations: [],
  modelRequests: [],
};
const browser = await playwright.chromium.launch({
  channel: process.env.V8_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (error) => report.pageErrors.push(error.message));
page.on("request", (request) => {
  if (request.method() !== "GET" && request.url().includes("/api/v1/"))
    report.productionMutations.push(`${request.method()} ${request.url()}`);
  if (/\.glb(?:\?|$)/.test(request.url()))
    report.modelRequests.push(request.url());
});
const q4 = "demo-example-q4-inspection",
  c2 = "demo-example-c2-logistics";
const host = () => page.locator('[data-model-loaded="true"]').first();
const rail = () =>
  page.getByRole("complementary", { name: "模型参数面板", exact: true });
const facts = (id) =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (p) => p.id === id,
      ),
    id,
  );
const shot = (name) =>
  page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
const loaded = () => host().waitFor();
async function frame() {
  await delay(180);
  return host().locator("canvas").screenshot();
}
async function separation(value) {
  await page.waitForFunction(
    (value) =>
      Number(
        document.querySelector('[data-model-loaded="true"]')?.dataset
          .explodeLevel,
      ) === value,
    value,
  );
}
async function run(name, action) {
  if (viewerOnly && name.startsWith("Scheme overview")) return;
  try {
    const evidence = await action();
    report.cases.push({ name, status: "passed", evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({
      name,
      status: "failed",
      error: error.stack || String(error),
    });
    console.error(`FAIL ${name}: ${error.message}`);
    await shot(`failure-${report.cases.length}`).catch(() => {});
  }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}
try {
  await page.goto(`${base}/projects/${q4}/library`);
  await loaded();
  let immutable = await facts(q4);
  await run(
    "Whole mode exposes the actual searchable/category catalog and real parent-child part details",
    async () => {
      await rail()
        .getByRole("heading", { name: "本体与组成", exact: true })
        .waitFor();
      const count = await rail().locator(".vpart-catalog button").count();
      assert(count > 30);
      await rail()
        .getByLabel("搜索零件", { exact: true })
        .fill("inspection.camera-assembly");
      assert.equal(
        await rail().locator(".vpart-catalog button").count(),
        1,
        "source assembly ID must be searchable",
      );
      const part = rail().locator(".vpart-catalog button").first();
      const label = await part.innerText();
      await part.click();
      await rail().getByLabel("选中零件详情", { exact: true }).waitFor();
      assert.match(
        await rail().getByLabel("选中零件详情", { exact: true }).innerText(),
        /包围尺寸|三角面/,
      );
      const drill = rail().getByRole("button", { name: /查看下级零件/ });
      assert(
        await drill.count(),
        "actual source camera assembly must expose its existing child parts",
      );
      await drill.click();
      const children = await rail()
        .locator(".vpart-catalog button")
        .allTextContents();
      assert(children.length > 0 && children.length < count);
      await rail()
        .getByRole("button", { name: "← 返回零件目录", exact: true })
        .click();
      await rail().getByLabel("搜索零件", { exact: true }).fill("");
      const categories = await rail()
        .getByLabel("筛选零件分类", { exact: true })
        .locator("option")
        .evaluateAll((options) =>
          options.map((o) => ({ value: o.value, label: o.textContent })),
        );
      const perception = categories.find((c) => /感知/.test(c.label));
      assert(perception);
      await rail()
        .getByLabel("筛选零件分类", { exact: true })
        .selectOption(perception.value);
      const filtered = await rail().locator(".vpart-catalog button").count();
      assert(filtered > 0 && filtered < count);
      await rail().getByLabel("筛选零件分类", { exact: true }).selectOption("");
      await shot("01-whole-real-catalog");
      assert.deepEqual(await facts(q4), immutable);
      return {
        actualParts: count,
        sourceCameraLabel: label,
        actualChildren: children,
        categories,
      };
    },
  );
  await run(
    "Explode mode enters at65%, remembers slider, toggles0/100 and changes actual material transparency",
    async () => {
      await page.getByRole("button", { name: "拆解模型", exact: true }).click();
      await separation(0.65);
      await rail()
        .getByRole("heading", { name: "分层拆解", exact: true })
        .waitFor();
      const range = rail().getByLabel("拆解程度", { exact: true });
      await range.focus();
      await range.press("End");
      await separation(1);
      const solid = await frame();
      const xray = rail().getByRole("button", {
        name: "透视外壳",
        exact: true,
      });
      await xray.click();
      assert.equal(await xray.getAttribute("aria-pressed"), "true");
      assert.notDeepEqual(
        await frame(),
        solid,
        "xray must change real rendered mesh materials",
      );
      await shot("02-exploded-xray");
      await rail()
        .getByRole("button", { name: "合拢整机", exact: true })
        .click();
      await separation(0);
      await rail()
        .getByRole("button", { name: "一键拆解", exact: true })
        .click();
      await separation(1);
      await range.focus();
      await range.press("Home");
      for (let i = 0; i < 45; i++) await range.press("ArrowRight");
      await separation(0.45);
      await page.getByRole("button", { name: "还原整机", exact: true }).click();
      await separation(0);
      await page.getByRole("button", { name: "拆解模型", exact: true }).click();
      await separation(0.45);
      assert.equal(await xray.getAttribute("aria-pressed"), "true");
      assert.deepEqual(await facts(q4), immutable);
    },
  );
  await run(
    "Perception mode exposes only source-supported fields and real schematic FOV/sensor render changes",
    async () => {
      await page
        .getByRole("button", { name: "查看感知外观", exact: true })
        .click();
      await separation(0);
      await rail()
        .getByRole("heading", { name: "多模态感知", exact: true })
        .waitFor();
      const fields = [];
      for (const name of ["雷达视场", "视觉视场", "热像视场"]) {
        const button = rail().getByRole("button", { name: new RegExp(name) });
        if (
          (await button.isEnabled()) &&
          (await button.getAttribute("aria-pressed")) === "true"
        )
          await button.click();
      }
      assert.equal(
        Number(await host().getAttribute("data-fov-visible-count")),
        0,
      );
      for (const name of ["雷达视场", "视觉视场", "热像视场"]) {
        const button = rail().getByRole("button", { name: new RegExp(name) });
        const available = await button.isEnabled();
        const before = await button.getAttribute("aria-pressed");
        let actualSourceGroups = 0;
        if (available) {
          const pixels = await frame();
          await button.click();
          assert.notEqual(await button.getAttribute("aria-pressed"), before);
          assert.notDeepEqual(await frame(), pixels);
          actualSourceGroups = Number(
            await host().getAttribute("data-fov-visible-count"),
          );
          assert(
            actualSourceGroups > 0,
            "an enabled field must display actual source-anchored helpers",
          );
          await button.click();
          assert.equal(
            Number(await host().getAttribute("data-fov-visible-count")),
            0,
          );
        }
        fields.push({
          name,
          available,
          before,
          actualSourceGroups,
          after: await button.getAttribute("aria-pressed"),
        });
      }
      const actualFields = JSON.parse(await host().getAttribute("data-fov"));
      const actualVisibleCount = Number(
        await host().getAttribute("data-fov-visible-count"),
      );
      assert.equal(actualVisibleCount, 0);
      assert(Object.values(actualFields).every((value) => value === false));
      assert(
        fields.some((f) => f.available),
        "real inspection attachments should expose an optical view field",
      );
      const views = await rail()
        .locator(".vsensor-view-buttons button")
        .allTextContents();
      assert.deepEqual(
        new Set(views),
        new Set(["外观", "RGB", "热像", "深度", "点云"]),
      );
      for (const name of views.filter((v) => v !== "外观")) {
        const before = await frame();
        await rail()
          .locator(".vsensor-view-buttons")
          .getByRole("button", { name, exact: true })
          .click();
        assert.notDeepEqual(
          await frame(),
          before,
          `${name} must change the actual renderer`,
        );
      }
      await rail()
        .locator(".vsensor-view-buttons")
        .getByRole("button", { name: "热像", exact: true })
        .click();
      const single = await frame();
      const compare = rail().getByRole("button", {
        name: "同帧对照",
        exact: true,
      });
      await compare.click();
      assert.equal(await compare.getAttribute("aria-pressed"), "true");
      assert.notDeepEqual(
        await frame(),
        single,
        "same-frame RGB and sensor comparison must render separate real channels",
      );
      assert.match(await rail().innerText(), /示意/);
      await shot("03-perception-real-source");
      assert.deepEqual(await facts(q4), immutable);
      return {
        fields,
        availableSensorViews: views,
        limitation:
          "schematic optical views; no real sensor/algorithm data or validation",
      };
    },
  );
  await run(
    "Dimensions and camera tools operate on real geometry; compact rail retains readable labels",
    async () => {
      await page.getByRole("button", { name: "还原整机", exact: true }).click();
      const before = await frame();
      await rail()
        .getByRole("button", { name: "显示尺寸", exact: true })
        .click();
      assert.notDeepEqual(await frame(), before);
      await rail()
        .getByRole("button", { name: "隐藏尺寸", exact: true })
        .click();
      const iso = await frame();
      await page
        .getByRole("button", { name: "模型侧视图", exact: true })
        .click();
      assert.notDeepEqual(await frame(), iso);
      const side = await frame();
      await page
        .getByRole("button", { name: "模型俯视图", exact: true })
        .click();
      assert.notDeepEqual(await frame(), side);
      const width = (await rail().boundingBox()).width;
      const font = await rail()
        .locator("h3")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert(width <= 205 && font >= 11 && font <= 14);
      await shot("04-dimensions-camera-readable-rail");
      return { railWidth: width, sectionFont: font };
    },
  );
  await run(
    "Delivered GLB opens a real interactive mesh and pointer dragging rotates the actual view",
    async () => {
      const before = await facts(c2);
      const artifact = before.artifacts.find((a) => a.kind === "model");
      await page.goto(`${base}/projects/${c2}/delivery`);
      const row = page
        .locator(".vartifact")
        .filter({ has: page.getByText(artifact.fileName, { exact: true }) });
      await row.getByRole("button", { name: "在线查看", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "在线查看文件",
        exact: true,
      });
      const model = dialog.locator('[data-model-loaded="true"]');
      await model.waitFor();
      assert(Number(await model.getAttribute("data-mesh-count")) >= 457);
      assert.equal(await dialog.locator("img").count(), 0);
      const canvas = model.locator("canvas"),
        pixels = await canvas.screenshot(),
        bounds = await canvas.boundingBox();
      const cameraBefore = await model.getAttribute("data-camera-position");
      await page.mouse.move(
        bounds.x + bounds.width * 0.55,
        bounds.y + bounds.height * 0.55,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width * 0.7,
        bounds.y + bounds.height * 0.48,
        { steps: 14 },
      );
      await page.mouse.up();
      await delay(220);
      assert.notDeepEqual(
        await canvas.screenshot(),
        pixels,
        "actual pointer drag must rotate rendered GLB, not a static picture",
      );
      assert(
        cameraBefore &&
          (await model.getAttribute("data-camera-position")) !== cameraBefore,
        "OrbitControls must move the actual Three camera",
      );
      await shot("05-online-glb-after-real-pointer-drag");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.deepEqual(await facts(c2), before);
    },
  );
  await run(
    "Scheme overview has the requested project/chapter/hero format; historical entry restores its exact template snapshot",
    async () => {
      await page.goto(`${base}/projects/${q4}/library?template=sample-mobile`);
      await loaded();
      await page
        .getByRole("button", { name: "保存适配并查看成果", exact: true })
        .click();
      await page.waitForURL(/\/delivery$/);
      immutable = await facts(q4);
      assert.equal(immutable.templateId, "sample-mobile");
      const originalReport = immutable.artifacts.find(
        (a) =>
          a.templateId === "sample-inspection" &&
          a.mimeType.startsWith("text/html"),
      );
      assert(originalReport);
      const row = page.locator(".vartifact").filter({
        has: page.getByText(originalReport.fileName, { exact: true }),
      });
      await row.getByRole("button", { name: "查看完整方案", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "完整设计方案",
        exact: true,
      });
      const frame = dialog.locator("iframe").contentFrame();
      await dialog.locator(".design-report-project-chip").waitFor();
      assert.equal(
        await dialog.locator(".design-report-project-chip").innerText(),
        immutable.name,
      );
      await frame.locator(".hero-art img").waitFor();
      assert.equal(
        await dialog.locator("iframe").getAttribute("sandbox"),
        "allow-same-origin allow-modals",
      );
      assert.equal(await frame.locator(".chapters a").count(), 7);
      assert.equal(await frame.locator("script").count(), 0);
      assert((await frame.locator(".hero-art").boundingBox()).width > 300);
      await shot("06-reference-scheme-overview");
      await frame.getByRole("button", { name: /进入交互工作台/ }).click();
      const inline = frame.locator(
        '#report-interactive-host [data-model-loaded="true"]',
      );
      await inline.waitFor();
      assert.equal(
        await inline.getAttribute("data-source-kind"),
        "licensed-concept-reference",
      );
      assert.equal(
        Number(await frame.locator("#sensor-offset").inputValue()),
        25,
        "frozen Q4 HTML snapshot must override later saved C2 template/parameters only in the view",
      );
      assert(await dialog.isVisible());
      assert.match(page.url(), /\/delivery$/);
      assert.deepEqual(await facts(q4), immutable);
      await shot("07-historical-scheme-correct-workbench");
    },
  );
  await run(
    "Mobile mode panels and online overview remain within the viewport",
    async () => {
      await page.goto(`${base}/projects/${q4}/library`);
      await loaded();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "查看感知外观", exact: true })
        .click();
      await rail()
        .getByRole("heading", { name: "多模态感知", exact: true })
        .waitFor();
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(dimensions.scroll <= dimensions.viewport + 1);
      await shot("08-mobile-source-parity");
      return dimensions;
    },
  );
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.productionMutations.length, 0);
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.cases.filter((c) => c.status === "passed").length,
    failed: report.cases.filter((c) => c.status === "failed").length,
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  await context.close();
  await browser.close();
  if (
    report.summary.failed ||
    report.pageErrors.length ||
    report.productionMutations.length
  )
    process.exitCode = 1;
}
