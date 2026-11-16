/** Real seven-module scheme interactions in the same-origin, script-disabled reader. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { enterPreviewDesign } from "./v8-preview-browser.mjs";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
let playwright;
try {
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
} catch {
  playwright = require("C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright");
}
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
assert.equal(new URL(base).pathname.replace(/\/$/, ""), "/v8");
const nonVisual = process.env.V8_REPORT_PHASE === "nonvisual";
const output = resolve(
  nonVisual
    ? "test-results/v8-seven-module-report-nonvisual"
    : "test-results/v8-seven-module-report",
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
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.on("pageerror", (e) => report.pageErrors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET" && r.url().includes("/api/v1/"))
    report.productionMutations.push(`${r.method()} ${r.url()}`);
  if (/\.glb(?:\?|$)/.test(r.url())) report.modelRequests.push(r.url());
});
const id = "demo-example-q4-inspection";
const chapters = [
  ["overview", "需求与方案"],
  ["interactive", "交互式方案"],
  ["structure", "整体方案"],
  ["scenario", "场景任务"],
  ["budget", "投资预算"],
  ["economics", "企业效益"],
  ["delivery", "交付流程"],
];
const facts = () =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (p) => p.id === id,
      ),
    id,
  );
const dialog = () =>
  page.getByRole("dialog", { name: "完整设计方案", exact: true });
const frame = () => dialog().locator("iframe").contentFrame();
const shot = (name) =>
  page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
async function assertModelProjection(model, name) {
  const bounds = await model.locator("canvas").evaluate((canvas) => {
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const outer = await dialog().locator("iframe").boundingBox();
  const clip = {
    x: Math.round(outer.x + bounds.x + 50),
    y: Math.round(outer.y + bounds.y + 100),
    width: Math.floor(bounds.width - 130),
    height: Math.floor(
      Math.min(bounds.height - 100, 1000 - (outer.y + bounds.y + 100)),
    ),
  };
  const png = await page.screenshot({ clip });
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width,
    minY = info.height,
    maxX = 0,
    maxY = 0,
    count = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] < 140 && data[i + 1] < 155 && data[i + 2] < 170) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        count++;
      }
    }
  const aspect = (maxX - minX + 1) / (maxY - minY + 1);
  assert(
    count > 300,
    `${name}: model must have visible detailed dark geometry`,
  );
  assert(
    aspect > 0.5 && aspect < 6,
    `${name}: model pixel bounds must retain a plausible 3D aspect, got ${aspect}`,
  );
  await writeFile(join(output, `${name}-projection.png`), png);
  (report.projectionChecks ||= []).push({
    name,
    aspect,
    count,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}
let original, htmlArtifact;
async function open() {
  await page.goto(`${base}/projects/${id}/delivery`);
  await page.getByRole("heading", { name: "方案交付", exact: true }).waitFor();
  const p = await facts();
  const a =
    htmlArtifact || p.artifacts.find((a) => a.mimeType.startsWith("text/html"));
  const row = page
    .locator(".vartifact")
    .filter({ has: page.getByText(a.fileName, { exact: true }) });
  if (!(await row.count())) {
    await page.getByRole("button", { name: "设计历程", exact: true }).click();
    const entry = page.locator(".vhistory-delivery").filter({has:page.getByText(a.fileName,{exact:true})});
    await entry.locator(":scope > summary").click();
    await entry.locator(".vhistory-file").filter({has:page.getByText(a.fileName,{exact:true})}).getByRole("button",{name:"查看",exact:true}).click();
  } else {
    await row.getByRole("button",{name:"查看完整方案",exact:true}).click();
  }
  await dialog().waitFor();
}
async function chapter(key) {
  const link = frame().locator(`.chapters a[href="#${key}"]`);
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await frame()
    .locator(`.chapters a[href="#${key}"][aria-current="step"]`)
    .waitFor();
}
async function run(name, action) {
  if (nonVisual && /^(Interactive scheme|Inline controls)/.test(name)) return;
  try {
    const evidence = await action();
    report.cases.push({ name, status: "passed", evidence });
    console.log(`PASS ${name}`);
  } catch (e) {
    report.cases.push({ name, status: "failed", error: e.stack || String(e) });
    console.error(`FAIL ${name}: ${e.message}`);
    await shot(`failure-${report.cases.length}`).catch(() => {});
  }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}
const number = (text) =>
  Number(text.replace(/[^\d.-]/g, "")) * (text.includes("万") ? 10000 : 1);
async function metric(label) {
  return frame()
    .locator(".report-planning-results article > span")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("..")
    .locator("strong")
    .innerText();
}
async function drag(canvas, model) {
  await delay(150);
  const camera = await model.getAttribute("data-camera-position");
  const local = await canvas.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const outer = await dialog()
    .locator("iframe")
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + el.clientLeft, y: r.y + el.clientTop };
    });
  const b = { ...local, x: local.x + outer.x, y: local.y + outer.y };
  const viewport = page.viewportSize();
  const clip = {
    x: Math.max(0, b.x),
    y: Math.max(0, b.y),
    width: Math.min(b.width, viewport.width - Math.max(0, b.x)),
    height: Math.min(b.height, viewport.height - Math.max(0, b.y)),
  };
  const before = await page.screenshot({ clip, timeout: 10000 });
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
  await page.mouse.down();
  // In this script-disabled iframe Chromium can defer the move ACK until after
  // pointer capture ends. Send the real hardware-order events without waiting
  // for that ACK; prove actual input using camera coordinates AND visible pixels.
  const move = page.mouse.move(b.x + b.width * 0.72, b.y + b.height * 0.45, {
    steps: 1,
  });
  await delay(120);
  await Promise.race([
    page.mouse.up(),
    delay(5000).then(() => {
      throw Error("mouseup acknowledgement timeout");
    }),
  ]);
  const acknowledged = await Promise.race([
    move.then(() => true),
    delay(300).then(() => false),
  ]);
  await delay(250);
  assert.notDeepEqual(
    await page.screenshot({ clip, timeout: 10000 }),
    before,
    "actual composited inline model must change with pointer orbit",
  );
  assert(
    camera && (await model.getAttribute("data-camera-position")) !== camera,
  );
  (report.pointerEvidence ||= []).push({
    before: camera,
    after: await model.getAttribute("data-camera-position"),
    moveAcknowledged: acknowledged,
    actualCompositeChanged: true,
  });
}
try {
  await enterPreviewDesign(page, base);
  await open();
  original = await facts();
  htmlArtifact = original.artifacts.find((a) =>
    a.mimeType.startsWith("text/html"),
  );
  await run(
    "Seven exact modules and every chapter link navigate to the corresponding real section",
    async () => {
      assert.equal(
        await dialog().locator("iframe").getAttribute("sandbox"),
        "allow-same-origin allow-modals",
      );
      assert.equal(await frame().locator("script").count(), 0);
      assert.equal(await frame().locator(".chapters a").count(), 7);
      for (const [index, [key, label]] of chapters.entries()) {
        const link = frame().locator(`.chapters a[href="#${key}"]`);
        assert.equal(
          (await link.innerText()).replace(/\s/g, ""),
          `${String(index + 1).padStart(2, "0")}${label}`,
        );
        assert.equal(await frame().locator(`#${key}`).count(), 1);
        await chapter(key);
        if (key === "structure")
          await frame()
            .locator("#structure img")
            .evaluateAll((images) =>
              Promise.all(
                images.map((image) => image.decode().catch(() => {})),
              ),
            );
        await shot(`chapter-${key}`);
      }
      await chapter("overview");
      await shot("01-seven-module-overview");
      assert.deepEqual(await facts(), original);
    },
  );
  await run(
    "Interactive scheme embeds real GLB inside the reader; pointer drag and explosion affect actual geometry",
    async () => {
      await chapter("interactive");
      const model = frame().locator(
        '#report-interactive-host [data-model-loaded="true"]',
      );
      await model.waitFor();
      assert(Number(await model.getAttribute("data-mesh-count")) > 100);
      const canvas = model.locator("canvas");
      await model
        .locator("[data-live-webgl-frame]")
        .evaluate((image) => image.decode());
      await delay(150);
      const canvasSize = await canvas.evaluate((node) => ({
        width: node.width,
        height: node.height,
        cssWidth: node.getBoundingClientRect().width,
        cssHeight: node.getBoundingClientRect().height,
      }));
      assert(
        canvasSize.cssHeight > 300,
        "inline model canvas must retain usable height",
      );
      assert(
        Math.abs(
          canvasSize.width / canvasSize.height -
            canvasSize.cssWidth / canvasSize.cssHeight,
        ) < 0.03,
        "canvas CSS and drawing buffer aspect ratios must agree",
      );
      await shot("02-inline-real-glb-whole");
      await assertModelProjection(model, "whole");
      const imageFrame = await model
        .locator("img[data-live-webgl-frame]")
        .evaluate((img) => ({
          width: img.naturalWidth,
          height: img.naturalHeight,
          cssWidth: img.getBoundingClientRect().width,
          cssHeight: img.getBoundingClientRect().height,
          src: img.src,
        }));
      await writeFile(
        join(output, "inline-source-frame.png"),
        Buffer.from(imageFrame.src.split(",")[1], "base64"),
      );
      console.log(
        "INLINE_DIAGNOSTIC",
        JSON.stringify({
          canvasSize,
          image: { ...imageFrame, src: undefined },
          cameraAspect: await model.getAttribute("data-camera-aspect"),
          buffer: await model.getAttribute("data-renderer-buffer-size"),
        }),
      );
      await drag(canvas, model);
      await frame()
        .getByRole("button", { name: "拆解模型", exact: true })
        .click();
      const range = frame()
        .getByRole("complementary", { name: "模型参数面板", exact: true })
        .getByLabel("拆解程度", { exact: true });
      await range.focus();
      await range.press("End");
      for (
        let i = 0;
        i < 100 && Number(await model.getAttribute("data-explode-level")) !== 1;
        i++
      )
        await delay(30);
      assert.equal(
        Number(await model.getAttribute("data-explode-level")),
        1,
        "actual source meshes must explode fully",
      );
      await shot("02-inline-real-glb-exploded");
      await assertModelProjection(model, "exploded");
      for (const key of ["Home", "End", "ArrowLeft", "End"])
        await range.press(key);
      await delay(1600);
      let stalePixels = 1;
      for (let attempt = 0; attempt < 40 && stalePixels > 0.001; attempt++) {
        stalePixels = await model.evaluate((host) => {
          const canvas = host.querySelector("canvas");
          const image = host.querySelector("img[data-live-webgl-frame]");
          if (!image.complete || image.naturalWidth !== canvas.width || image.naturalHeight !== canvas.height) return 1;
          const visible = host.ownerDocument.createElement("canvas");
          visible.width = canvas.width; visible.height = canvas.height;
          const context = visible.getContext("2d");
          context.drawImage(image, 0, 0);
          const expected = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let different = 0;
          for (let i = 0; i < expected.length; i += 4)
            if (Math.abs(actual[i] - expected[i]) > 2 || Math.abs(actual[i + 1] - expected[i + 1]) > 2 || Math.abs(actual[i + 2] - expected[i + 2]) > 2) different++;
          return different / (expected.length / 4);
        });
        if (stalePixels > 0.001) await delay(50);
      }
      assert(stalePixels <= 0.001, "visible inline model must display the final geometry after rapid slider changes");
      const idleFrames = Number(await model.getAttribute("data-rendered-frames"));
      await delay(600);
      assert.equal(Number(await model.getAttribute("data-rendered-frames")), idleFrames, "settled inline model must stop redrawing");
      await frame()
        .getByRole("button", { name: "还原整机", exact: true })
        .click();
      for (const [index, width] of [1360, 1440, 1380, 1440].entries()) {
        await page.setViewportSize({ width, height: 1000 });
        await chapter("structure");
        await chapter("interactive");
        await model
          .locator("[data-live-webgl-frame]")
          .waitFor({ state: "visible" });
        await model
          .locator("[data-live-webgl-frame]")
          .evaluate((image) => image.decode());
        await delay(150);
        await assertModelProjection(model, `resized-${index}`);
      }
      assert.deepEqual(await facts(), original);
    },
  );
  await run(
    "Overall-system buttons and scenario SVG nodes change their actual planning details",
    async () => {
      await chapter("structure");
      const system = frame().locator("#structure .report-task-explorer");
      assert.equal(await system.locator(".report-task-tabs button").count(), 4);
      await system.locator(".report-task-tabs button").nth(1).click();
      assert.equal(
        await system.locator(".report-task-detail h4").innerText(),
        "感知配置",
      );
      assert.equal(
        await system
          .locator(".report-task-tabs button")
          .nth(1)
          .getAttribute("aria-pressed"),
        "true",
      );
      await chapter("scenario");
      await frame().getByLabel("单次任务时长", { exact: true }).fill("10");
      await frame().getByLabel("每日作业窗口", { exact: true }).fill("8");
      await frame().getByLabel("电池能量", { exact: true }).fill("500");
      await frame().getByLabel("任务平均功耗", { exact: true }).fill("100");
      assert.equal(
        await frame()
          .locator("#scenario .business-operation-result strong")
          .nth(0)
          .innerText(),
        "48",
      );
      assert.equal(
        await frame()
          .locator("#scenario .business-operation-result strong")
          .nth(1)
          .innerText(),
        "300",
      );
      const task = frame().locator("#scenario .report-task-explorer");
      assert.equal(
        await task.locator('.report-task-diagram [role="button"]').count(),
        5,
      );
      await task.locator('.report-task-diagram [role="button"]').nth(2).click();
      assert.equal(
        await task.locator(".report-task-detail h4").innerText(),
        "到点观察",
      );
      assert.match(
        await task.locator(".report-task-detail").innerText(),
        /记录计划|观察|核验|复查/,
      );
      await shot("03-system-scenario-selected");
      assert.deepEqual(await facts(), original);
    },
  );
  await run(
    "Budget and enterprise benefit controls calculate explicit assumptions without modifying saved source",
    async () => {
      await chapter("budget");
      assert.match(await metric("一次投入"), /待|—/);
      const values = {
        设备数量: "2",
        "单台硬件预算（元）": "100000",
        "软件与任务开发（元）": "20000",
        "集成与现场部署（元）": "10000",
        "预备费比例（%）": "10",
        "年度维护费（元）": "10000",
        "年度能源费（元）": "2000",
        "其他年度运行费（元）": "3000",
      };
      for (const [label, value] of Object.entries(values))
        await frame().getByLabel(label, { exact: true }).fill(value);
      assert.equal(number(await metric("一次投入")), 253000);
      assert.equal(number(await metric("年度运行费")), 15000);
      assert.equal(number(await metric("三年总成本")), 298000);
      await chapter("economics");
      for (const [label, value] of Object.entries({
        "年净释放工时（小时）": "1000",
        "人工综合成本（元/小时）": "100",
        "工时价值现金兑现比例（%）": "50",
        "其他年度现金节省（元）": "10000",
      }))
        await frame().getByLabel(label, { exact: true }).fill(value);
      assert.equal(number(await metric("年度净现金")), 45000);
      assert(
        Math.abs(number(await metric("简单回收期")) - 253000 / 45000) < 0.01,
      );
      assert.equal(number(await metric("三年净现金")), -118000);
      await frame()
        .getByRole("button", { name: "按 75% 兑现比例测算", exact: true })
        .click();
      assert.equal(number(await metric("年度净现金")), 70000);
      await frame()
        .getByRole("button", { name: "按 50% 兑现比例测算", exact: true })
        .click();
      assert.equal(number(await metric("年度净现金")), 45000);
      assert.equal(
        await frame()
          .getByRole("img", { name: "三年累计净现金示意", exact: true })
          .count(),
        1,
      );
      assert.match(
        await frame().locator("#economics").innerText(),
        /假设|兑现/,
      );
      await shot("03-explicit-assumptions-calculated");
      assert.deepEqual(await facts(), original);
      assert.equal(
        (await facts()).artifacts.find((a) => a.id === htmlArtifact.id).content,
        htmlArtifact.content,
      );
      return {
        investment: 253000,
        annualOperating: 15000,
        threeYearCost: 298000,
        annualNetCash: 45000,
        payback: 253000 / 45000,
        threeYearNetCash: -118000,
        scope: "temporary user assumptions; not verified investment results",
      };
    },
  );
  await run(
    "Inline controls remain live during unrelated task polling without losing their controller",
    async () => {
      await dialog()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      await page.evaluate((id) => {
        const key = "embodex-v8-preview-v1",
          store = JSON.parse(localStorage.getItem(key)),
          p = store.projects.find((p) => p.id === id);
        p.tasks.push({
          id: "qa-future-background-task",
          projectId: id,
          type: "concepts",
          status: "running",
          currentStep: "QA背景同步",
          createdAt: "2099-01-01T00:00:00.000Z",
          updatedAt: "2099-01-01T00:00:00.000Z",
          scenario: "success",
          requestedCount: 1,
          resultIds: [],
          requirementId: p.requirements.at(-1).id,
          submissionState: "accepted",
        });
        localStorage.setItem(key, JSON.stringify(store));
      }, id);
      await open();
      await chapter("interactive");
      const model = frame().locator(
        '#report-interactive-host [data-model-loaded="true"]',
      );
      await model.waitFor();
      await delay(2100);
      const canvas = model.locator("canvas");
      await drag(canvas, model);
      await frame()
        .getByRole("button", { name: "拆解模型", exact: true })
        .click();
      await frame()
        .getByRole("heading", { name: "分层拆解", exact: true })
        .waitFor();
      assert(Number(await model.getAttribute("data-explode-level")) > 0);
      assert.deepEqual((await facts()).artifacts, original.artifacts);
      assert.equal(
        (await facts()).tasks.filter(
          (t) => t.id === "qa-future-background-task",
        ).length,
        1,
      );
      await dialog()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      await page.evaluate(
        ({ id, original }) => {
          const key = "embodex-v8-preview-v1",
            s = JSON.parse(localStorage.getItem(key));
          s.projects[s.projects.findIndex((p) => p.id === id)] = original;
          localStorage.setItem(key, JSON.stringify(s));
        },
        { id, original },
      );
    },
  );
  await run(
    "Expired recorded GLB never falls back to a guessed template URL inside an otherwise valid report",
    async () => {
      await page.evaluate((id) => {
        const key = "embodex-v8-preview-v1",
          s = JSON.parse(localStorage.getItem(key)),
          p = s.projects.find((p) => p.id === id);
        p.artifacts
          .filter((a) => a.kind === "model")
          .forEach((a) => (a.status = "expired"));
        localStorage.setItem(key, JSON.stringify(s));
      }, id);
      const start = report.modelRequests.length;
      await open();
      await chapter("interactive");
      await frame()
        .locator('#report-interactive-host [role="alert"]')
        .waitFor();
      assert.equal(
        await frame().locator("#report-interactive-host canvas").count(),
        0,
      );
      assert.equal(report.modelRequests.length, start);
      await shot("04-expired-model-blocked-in-report");
      await dialog()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      await page.evaluate(
        ({ id, original }) => {
          const key = "embodex-v8-preview-v1",
            s = JSON.parse(localStorage.getItem(key));
          s.projects[s.projects.findIndex((p) => p.id === id)] = original;
          localStorage.setItem(key, JSON.stringify(s));
        },
        { id, original },
      );
    },
  );
  await run(
    "Mobile seven-module reading and inline workspace fit without horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open();
      await chapter("interactive");
      await frame()
        .locator('#report-interactive-host [data-model-loaded="true"]')
        .waitFor();
      const widths = await frame()
        .locator("html")
        .evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
      assert(widths.scroll <= widths.width + 1);
      await shot("05-mobile-seven-module-interactive");
      await chapter("budget");
      assert.match(await metric("一次投入"), /待|—/);
      await shot("06-mobile-assumption-inputs");
      assert.deepEqual(await facts(), original);
      return widths;
    },
  );
  await run(
    "Historical Q4 report retains its own inline model and frozen parameter snapshot after saving a different C2 template",
    async () => {
      await dialog()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/projects/${id}/library?template=sample-mobile`);
      await page
        .locator(
          '[data-model-loaded="true"][data-source-kind="supplied-concept-reference"]',
        )
        .waitFor();
      await page
        .getByRole("button", { name: "保存适配并查看成果", exact: true })
        .click();
      await page.waitForURL(/\/delivery$/);
      const changed = await facts();
      assert.equal(changed.templateId, "sample-mobile");
      await open();
      await frame()
        .getByRole("button", { name: /进入交互工作台/ })
        .click();
      const model = frame().locator(
        '#report-interactive-host [data-model-loaded="true"]',
      );
      await model.waitFor();
      assert.equal(
        await model.getAttribute("data-source-kind"),
        "licensed-concept-reference",
      );
      const inspector = frame().getByRole("complementary", {
        name: "模型参数面板",
        exact: true,
      });
      await inspector
        .getByLabel("搜索零件", { exact: true })
        .fill("inspection.camera-assembly");
      await inspector.locator(".vpart-catalog button").first().click();
      assert.equal(
        Number(await frame().locator("#sensor-offset").inputValue()),
        (htmlArtifact.parameterSnapshot?.inspectionCameraHeight || 0) * 1000,
      );
      assert(await dialog().isVisible());
      assert.match(page.url(), /\/delivery(?:\?|$)/);
      assert.deepEqual(await facts(), changed);
      assert.equal(
        changed.artifacts.find((a) => a.id === htmlArtifact.id).content,
        htmlArtifact.content,
      );
      await shot("07-historical-q4-inline-source");
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
