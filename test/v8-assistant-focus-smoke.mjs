/** Narrow real-browser regression: natural short name resolves an actual source part. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
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
const output = resolve("test-results/v8-assistant-focus");
await mkdir(output, { recursive: true });
const report = {
  mode: "isolated-local-development-preview",
  startedAt: new Date().toISOString(),
  pageErrors: [],
  productionMutations: [],
  passed: 0,
  failed: 0,
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
});
try {
  await page.goto(base);
  await page
    .getByLabel("描述你的设计目标")
    .fill("自然语言真实部件聚焦定向复验");
  await page
    .locator("main")
    .getByRole("button", { name: "开始设计", exact: true })
    .click();
  await page.waitForURL(/\/requirements$/);
  const projectId = page.url().match(/\/projects\/([^/]+)/)[1];
  await page
    .getByRole("button", { name: "保存需求，选择路线", exact: true })
    .click();
  await page.getByRole("button", { name: /浏览.*资源/ }).click();
  await page
    .locator(".vtemplate-picker button")
    .filter({ hasText: "C2 · 精细移动平台" })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-model-loaded="true"]')
        ?.getAttribute("data-source-kind") === "supplied-concept-reference",
  );
  const sourcePart = page
    .getByLabel("选择模型组件", { exact: true })
    .locator('option[value="dock-camera"]');
  report.actualLabel = await sourcePart.innerText();
  assert.match(report.actualLabel, /近距对接相机/);
  const facts = () =>
    page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
          (project) => project.id === id,
        ),
      projectId,
    );
  const before = await facts();
  const sourcePath = resolve("public/v8-assets/mobile-reference.glb");
  const sourceHash = createHash("sha256")
    .update(await readFile(sourcePath))
    .digest("hex");
  await page.getByRole("button", { name: '设计助手' }).click();
  const send = async (command) => {
    const messages = page.locator(".vassistant-messages .assistant");
    const previous = await messages.count();
    await page
      .getByRole("textbox", { name: "与设计助手交流", exact: true })
      .fill(command);
    await page
      .getByRole("button", { name: "发送设计助手消息", exact: true })
      .click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".vassistant-messages .assistant").length >
        count,
      previous,
    );
    return messages.last().innerText();
  };
  report.command = "聚焦近距对接相机";
  report.receipt = await send(report.command);
  assert.match(report.receipt, /已执行/);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-model-loaded="true"]')
        ?.getAttribute("data-inspection-mode") === "part",
  );
  assert.equal(
    await page.getByLabel("选择模型组件", { exact: true }).inputValue(),
    "dock-camera",
  );
  assert(
    await page
      .getByRole("dialog", { name: "常驻设计助手", exact: true })
      .isVisible(),
  );
  assert.equal(
    await page.locator(".vdrawer").count(),
    0,
    "tool focus must not open a competing parameter drawer",
  );
  assert(
    await page
      .getByRole("button", { name: "关闭部件信息", exact: true })
      .isVisible(),
    "real source part details must be visible",
  );
  report.canonicalPartId = "dock-camera";
  await page.screenshot({
    path: join(output, "natural-shortname-real-part.png"),
    fullPage: true,
  });
  await send("还原整机");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-model-loaded="true"]')
        ?.getAttribute("data-inspection-mode") === "whole",
  );
  report.offsetReceipt = await send("将dock-camera抬高25毫米");
  assert.match(report.offsetReceipt, /已执行/);
  report.actualOffset = await page
    .locator('[data-model-loaded="true"]')
    .evaluate((host) => ({
      part: host.dataset.adjustedPart,
      before: host.dataset.partWorldBefore.split(",").map(Number),
      after: host.dataset.partWorldAfter.split(",").map(Number),
    }));
  assert.equal(report.actualOffset.part, "dock-camera");
  assert(
    Math.abs(
      report.actualOffset.after[1] - report.actualOffset.before[1] - 0.025,
    ) < 1e-7,
  );
  assert.equal(await page.locator(".vdrawer").count(), 0);
  assert.equal(
    createHash("sha256")
      .update(await readFile(sourcePath))
      .digest("hex"),
    sourceHash,
  );
  report.unchangedSourceHash = sourceHash;
  const after = await facts();
  for (const key of ["tasks", "approvals", "cadRuns"])
    assert.deepEqual(after[key], before[key]);
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.productionMutations.length, 0);
  report.passed = 1;
  console.log(
    "PASS natural short-name focus resolves actual dock-camera, drawer remains closed, real world-Y +25mm, unchanged source/generation facts",
  );
} catch (error) {
  report.failed = 1;
  report.error = error.stack || String(error);
  await page
    .screenshot({ path: join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
