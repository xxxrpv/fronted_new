import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = "test-results/v8-report-stream-interaction";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const report = { cases: [], errors: [] };
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
async function initContext(options = {}, fallback = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  await context.addInitScript(
    ({ fallback }) => {
      window.__capturedStreams = [];
      const original = HTMLCanvasElement.prototype.captureStream;
      if (fallback) HTMLCanvasElement.prototype.captureStream = undefined;
      else
        HTMLCanvasElement.prototype.captureStream = function (...args) {
          const stream = original.apply(this, args);
          window.__capturedStreams.push(stream);
          return stream;
        };
    },
    { fallback },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  return { context, page };
}
async function open(page, id = "demo-example-q4-inspection") {
  await page.goto(`${base}/projects/${id}/delivery`);
  await page.getByRole("button", { name: "查看完整方案", exact: true }).click();
  const frame = page.locator(".official-report-dialog iframe").contentFrame();
  await frame
    .locator('.solution-nav [data-solution-jump="interactive"]')
    .click();
  const host = frame.locator('[data-model-loaded="true"]').first();
  await host.waitFor({ timeout: 60000 });
  await host.locator("[data-live-webgl-frame]").waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  return { frame, host };
}
async function pixels(page) {
  return page.evaluate(() => {
    const doc = document.querySelector(
      ".official-report-dialog iframe",
    ).contentDocument;
    const host = doc.querySelector('[data-model-loaded="true"]'),
      media =
        host.querySelector("video") ||
        host.querySelector("img[data-live-webgl-frame]");
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(media, 0, 0, 160, 100);
    const data = Array.from(ctx.getImageData(0, 0, 160, 100).data),
      colors = new Set();
    let min = 255,
      max = 0;
    for (let i = 0; i < data.length; i += 16) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
      colors.add(data.slice(i, i + 3).join(","));
    }
    return {
      data,
      unique: colors.size,
      min,
      max,
      width: media.videoWidth || media.naturalWidth,
      height: media.videoHeight || media.naturalHeight,
      hostWidth: host.clientWidth,
      hostHeight: host.clientHeight,
      presentation: host.dataset.rendererPresentation,
    };
  });
}
const difference = (a, b) =>
  a.data.reduce((sum, v, i) => sum + Math.abs(v - b.data[i]), 0) /
  a.data.length;
const nonempty = (sample) => {
  assert(sample.unique > 100);
  assert(sample.max - sample.min > 80);
  assert(
    Math.abs(
      sample.width / sample.height - sample.hostWidth / sample.hostHeight,
    ) < 0.02,
  );
};
async function setSlider(page, values) {
  await page.evaluate((values) => {
    const doc = document.querySelector(
        ".official-report-dialog iframe",
      ).contentDocument,
      n = doc.getElementById("inspector-explode");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    for (const value of values) {
      setter.call(n, String(value));
      n.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
}
async function run(name, fn) {
  try {
    await fn();
    report.cases.push({ name, passed: true });
    console.log("PASS", name);
  } catch (error) {
    report.cases.push({ name, passed: false, error: error.stack });
    throw error;
  }
}
try {
  const { context, page } = await initContext();
  const { frame, host } = await open(page);
  await run(
    "Native pointer orbit and wheel zoom update visible stream pixels",
    async () => {
      assert.equal(
        await host.getAttribute("data-renderer-presentation"),
        "live-webgl-stream-v1",
      );
      const start = await pixels(page);
      nonempty(start);
      const before = await host.getAttribute("data-camera-position"),
        box = await host.boundingBox();
      await page.mouse.move(
        box.x + box.width * 0.45,
        box.y + box.height * 0.55,
      );
      await page.mouse.down();
      const move = page.mouse.move(
        box.x + box.width * 0.7,
        box.y + box.height * 0.58,
        { steps: 24 },
      );
      await page.waitForTimeout(800);
      await page.mouse.up();
      await Promise.race([move, page.waitForTimeout(2000)]);
      await page.waitForTimeout(800);
      assert.notEqual(await host.getAttribute("data-camera-position"), before);
      assert(difference(start, await pixels(page)) > 0.4);
      const zoomBefore = await host.getAttribute("data-camera-position");
      await page.mouse.wheel(0, -250);
      await page.waitForTimeout(800);
      assert.notEqual(
        await host.getAttribute("data-camera-position"),
        zoomBefore,
      );
      await page.screenshot({ path: `${out}/desktop-orbit.png` });
    },
  );
  await run(
    "Rapid decomposition publishes its final visible pose, and real part/perception controls remain usable",
    async () => {
      await frame
        .getByRole("button", { name: "还原整机", exact: true })
        .click();
      await page.waitForTimeout(700);
      const originalWhole = await pixels(page);
      await frame
        .getByRole("button", { name: "拆解模型", exact: true })
        .click();
      await setSlider(page, [100]);
      await page.waitForTimeout(800);
      const reference = await pixels(page);
      nonempty(reference);
      await setSlider(page, [20, 90, 40, 80, 0, 100]);
      await page.waitForTimeout(900);
      assert.equal(await host.getAttribute("data-explode-level"), "1");
      const final = await pixels(page);
      nonempty(final);
      assert(
        difference(reference, final) < 2,
        "Rapid final visible frame differs from the same settled pose",
      );
      await frame
        .getByRole("button", { name: "还原整机", exact: true })
        .click();
      assert.equal(await host.getAttribute("data-explode-level"), "0");
      await page.waitForTimeout(700);
      assert(
        difference(originalWhole, await pixels(page)) < 2,
        "Whole view did not return to its original visible pose",
      );
      await frame.locator(".vpart-catalog button").first().click();
      await frame.getByLabel("选中零件详情", { exact: true }).waitFor();
      await frame
        .getByRole("button", { name: "查看感知外观", exact: true })
        .click();
      assert.equal(
        await host.getAttribute("data-inspection-mode"),
        "perception",
      );
      await page.waitForTimeout(600);
      nonempty(await pixels(page));
      await page.screenshot({ path: `${out}/desktop-perception.png` });
    },
  );
  await run(
    "Offscreen chapter pauses GPU work, and closing releases all stream tracks",
    async () => {
      await frame
        .locator('.solution-nav [data-solution-jump="budget"]')
        .click();
      await page.waitForTimeout(1000);
      const frames = await host.getAttribute("data-rendered-frames");
      await page.waitForTimeout(650);
      assert.equal(await host.getAttribute("data-rendered-frames"), frames);
      assert(
        (await page.evaluate(
          () =>
            window.__capturedStreams
              .flatMap((s) => s.getTracks())
              .filter((t) => t.readyState === "live").length,
        )) > 0,
      );
      await frame
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(
          () =>
            window.__capturedStreams
              .flatMap((s) => s.getTracks())
              .filter((t) => t.readyState === "live").length,
        ),
        0,
      );
    },
  );
  await context.close();
  const mobile = await initContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const m = await open(mobile.page, "demo-example-c2-logistics");
  await run(
    "DPR 2 phone and resized desktop stream stay sharp, proportional and nonempty",
    async () => {
      const initial = await pixels(mobile.page);
      nonempty(initial);
      assert(initial.width >= initial.hostWidth * 1.9);
      assert.equal(
        await mobile.page
          .locator("body")
          .evaluate((n) => n.scrollWidth > innerWidth),
        false,
      );
      await mobile.page.screenshot({ path: `${out}/phone.png` });
      await mobile.page.setViewportSize({ width: 1360, height: 950 });
      await mobile.page.waitForTimeout(900);
      nonempty(await pixels(mobile.page));
      await mobile.page.screenshot({ path: `${out}/resized.png` });
      await m.frame
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
    },
  );
  await mobile.context.close();
  const fallback = await initContext({}, true);
  const f = await open(fallback.page);
  await run(
    "Unsupported stream capture keeps the image compatibility fallback available",
    async () => {
      assert.equal(
        await f.host.getAttribute("data-renderer-presentation"),
        "live-webgl-image-fallback",
      );
      await fallback.page.waitForTimeout(500);
      nonempty(await pixels(fallback.page));
      const before = await pixels(fallback.page);
      await f.host.press("ArrowRight");
      await fallback.page.waitForTimeout(500);
      assert(difference(before, await pixels(fallback.page)) > 0.1);
      await fallback.page.screenshot({ path: `${out}/fallback.png` });
      await f.frame
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
    },
  );
  await fallback.context.close();
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
