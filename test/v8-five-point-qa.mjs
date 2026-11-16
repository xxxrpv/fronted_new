/** Latest five requested changes: actual files, engineering, inspector and typical examples. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
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
const output = resolve("test-results/v8-five-point");
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
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => report.pageErrors.push(error.message));
page.on("request", (request) => {
  if (request.method() !== "GET" && request.url().includes("/api/v1/"))
    report.productionMutations.push(`${request.method()} ${request.url()}`);
  if (/\.glb(?:\?|$)/.test(request.url()))
    report.modelRequests.push(request.url());
});
const ids = [
  "demo-example-q4-inspection",
  "demo-example-c2-logistics",
  "demo-example-ai-review",
];
let emptyProjectId;
const facts = (id) =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (project) => project.id === id,
      ),
    id,
  );
const loaded = () => page.locator('[data-model-loaded="true"]').waitFor();
const shot = (name) =>
  page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
async function run(name, action) {
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
  await run(
    "Three useful typical projects appear once; migration preserves user-modified and unknown projects",
    async () => {
      await page.goto(base);
      await page.getByRole("heading", { name: "今天，想设计什么？" }).waitFor();
      assert.equal(
        await page.locator(".vproject-row").count(),
        3,
        "fresh preview should contain only the three useful example projects",
      );
      await page
        .getByLabel("描述你的设计目标")
        .fill("QA 用户保留的独立设计项目");
      await page
        .locator("main")
        .getByRole("button", { name: "开始设计", exact: true })
        .click();
      await page.waitForURL(/\/requirements$/);
      emptyProjectId = page.url().match(/\/projects\/([^/]+)/)[1];
      const original = await facts(emptyProjectId);
      // Simulate a pre-migration cache in this isolated context, retaining original facts.
      const unknown = {
        ...original,
        id: "qa-user-existing",
        name: "QA 未知来源保留项目",
        requirements: original.requirements.map((r) => ({
          ...r,
          id: `unknown-${r.id}`,
          projectId: "qa-user-existing",
        })),
      };
      await page.evaluate(
        ({ ids, unknown }) => {
          const key = "embodex-v8-preview-v1",
            store = JSON.parse(localStorage.getItem(key));
          store.projects = store.projects.filter((p) => !ids.includes(p.id));
          store.projects.push(unknown);
          delete store.exampleSeedVersion;
          localStorage.setItem(key, JSON.stringify(store));
        },
        { ids, unknown },
      );
      await page.goto(base);
      await page.getByRole("heading", { name: "今天，想设计什么？" }).waitFor();
      assert.deepEqual(await facts(emptyProjectId), original);
      assert.deepEqual(await facts(unknown.id), unknown);
      for (const id of ids) {
        const p = await facts(id);
        assert(p && p.artifacts.length >= 3);
        assert.equal(
          await page
            .locator(".vproject-row")
            .filter({ hasText: p.name })
            .count(),
          1,
        );
      }
      await page.reload();
      const counts = await page.evaluate(
        (ids) =>
          ids.map(
            (id) =>
              JSON.parse(
                localStorage.getItem("embodex-v8-preview-v1"),
              ).projects.filter((p) => p.id === id).length,
          ),
        ids,
      );
      assert.deepEqual(counts, [1, 1, 1]);
      await shot("01-typical-projects");
      return { ids, counts };
    },
  );
  await run(
    "Left real model and right inspector; exact part selection, explosion and bounded physical preview offset",
    async () => {
      await page.goto(`${base}/projects/${ids[0]}/library`);
      await loaded();
      const before = await facts(ids[0]);
      const canvas = await page
        .locator(".vmodel-workspace .vstudio-canvas")
        .boundingBox();
      const rail = await page
        .getByRole("complementary", { name: "模型参数面板", exact: true })
        .boundingBox();
      assert(
        canvas.x + canvas.width <= rail.x + 2 &&
          Math.abs(canvas.y - rail.y) < 3,
      );
      assert(
        rail.width <= 205 && canvas.width > 700,
        "desktop should prioritize the wide model and compact parameter rail",
      );
      const labelFont = await page
        .locator(".vmodel-inspector h3")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert(
        labelFont >= 11 && labelFont <= 14,
        "parameter labels must retain the requested readable size in the compact rail",
      );
      const inspector = page.getByRole("complementary", {
        name: "模型参数面板",
        exact: true,
      });
      await inspector
        .getByLabel("搜索零件", { exact: true })
        .fill("inspection.camera-assembly");
      await inspector.locator(".vpart-catalog button").click();
      await inspector.getByLabel("搜索零件", { exact: true }).fill("");
      await page.getByLabel("选中零件详情", { exact: true }).waitFor();
      assert.match(
        await page.getByLabel("选中零件详情", { exact: true }).innerText(),
        /三角面|包围尺寸/,
      );
      assert.equal(await page.locator(".vdrawer").count(), 0);
      await page.getByRole("button", { name: "拆解模型", exact: true }).click();
      await page.getByLabel("拆解程度", { exact: true }).focus();
      await page.getByLabel("拆解程度", { exact: true }).press("End");
      await page.waitForFunction(
        () =>
          +document.querySelector('[data-model-loaded="true"]').dataset
            .explodeLevel === 1,
      );
      await shot("02-model-left-inspector-right-exploded");
      await page.getByRole("button", { name: "还原整机", exact: true }).click();
      await page
        .getByRole("button", { name: "查看感知外观", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-model-loaded="true"]').dataset
            .inspectionMode === "perception",
      );
      const parameter = page.locator("#sensor-offset");
      await parameter.focus();
      await parameter.press("Home");
      await page.waitForFunction(
        () =>
          document.querySelector('[data-model-loaded="true"]').dataset
            .adjustedPart === "inspection.camera-assembly",
      );
      const displacement = await page
        .locator('[data-model-loaded="true"]')
        .evaluate((el) => ({
          before: el.dataset.partWorldBefore.split(",").map(Number),
          after: el.dataset.partWorldAfter.split(",").map(Number),
        }));
      assert(Math.abs(displacement.after[1] - displacement.before[1]) > 0.001);
      assert.deepEqual(
        await facts(ids[0]),
        before,
        "unsaved view controls cannot change persisted template or engineering facts",
      );
      return { canvas, rail, displacement };
    },
  );
  await run(
    "Tablet and phone stack model above inspector with no horizontal overflow",
    async () => {
      const evidence = [];
      for (const width of [820, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const canvas = await page
            .locator(".vmodel-workspace .vstudio-canvas")
            .boundingBox(),
          rail = await page.locator(".vmodel-inspector").boundingBox();
        const overflow = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(overflow.scroll <= overflow.width + 1);
        assert(
          rail.y >= canvas.y + canvas.height - 2,
          `inspector must stack at ${width}`,
        );
        await shot(`03-model-inspector-${width}`);
        evidence.push({ width, canvas, rail, overflow });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      return evidence;
    },
  );
  await run(
    "Template engineering loads saved source GLB; new project engineering remains an honest empty view",
    async () => {
      const before = await facts(ids[0]);
      await page.goto(`${base}/projects/${ids[0]}/cad`);
      await loaded();
      await page
        .getByRole("heading", { name: "模型与配置", exact: true })
        .waitFor();
      assert.equal(before.cadRuns.length, 0);
      assert.deepEqual(await facts(ids[0]), before);
      await shot("04-template-engineering-source");
      const freshBefore = await facts(emptyProjectId);
      await page.goto(`${base}/projects/${emptyProjectId}/cad`);
      await page
        .getByRole("heading", { name: "先确定一个设计方案", exact: true })
        .waitFor();
      assert.equal(await page.locator('[data-model-loaded="true"]').count(), 0);
      assert.deepEqual(await facts(emptyProjectId), freshBefore);
      await shot("05-engineering-prerequisites");
    },
  );
  await run(
    "HTML, Markdown and GLB open online from actual authorized artifact rows; viewing is immutable",
    async () => {
      const id = ids[1],
        before = await facts(id);
      await page.goto(`${base}/projects/${id}/delivery`);
      for (const artifact of before.artifacts) {
        const row = page
          .locator(".vartifact")
          .filter({ has: page.getByText(artifact.fileName, { exact: true }) });
        const open = row.getByRole("button", {
          name: artifact.mimeType.startsWith("text/html")
            ? "查看完整方案"
            : artifact.kind === "model"
              ? "在线查看"
              : "查看文本",
          exact: true,
        });
        await open.click();
        if (artifact.mimeType.startsWith("text/html")) {
          const reportDialog = page.getByRole("dialog", {
            name: "完整设计方案",
            exact: true,
          });
          await reportDialog.waitFor();
          await reportDialog
            .locator("iframe")
            .contentFrame()
            .getByRole("heading", { name: "整体方案", exact: true })
            .waitFor();
          await reportDialog
            .getByRole("button", { name: "关闭完整设计方案", exact: true })
            .click();
        } else {
          const dialog = page.getByRole("dialog", {
            name: "在线查看文件",
            exact: true,
          });
          await dialog.waitFor();
          await dialog
            .getByRole("heading", { name: artifact.fileName, exact: true })
            .waitFor();
          if (artifact.kind === "model") {
            await dialog.locator('[data-model-loaded="true"]').waitFor();
            assert.equal(await dialog.locator("canvas").count(), 1);
          } else {
            await dialog
              .getByRole("article", { name: "Markdown 方案正文", exact: true })
              .waitFor();
            assert.match(await dialog.innerText(), /产线|来源/);
            assert.equal(await dialog.locator("script,img").count(), 0);
          }
          await shot(
            `06-online-${artifact.kind === "model" ? "glb" : "markdown"}`,
          );
          const close = dialog.getByRole("button", {
            name: "关闭文件预览",
            exact: true,
          });
          await close.focus();
          await page.keyboard.press("Shift+Tab");
          assert(
            await dialog.evaluate((el) => el.contains(document.activeElement)),
          );
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
        }
        assert(await open.evaluate((el) => document.activeElement === el));
      }
      assert.deepEqual(await facts(id), before);
    },
  );
  await run(
    "Custom engineering uses matching ready artifact; unavailable or unauthorized result cannot request a GLB",
    async () => {
      const id = ids[2],
        before = await facts(id);
      await page.goto(`${base}/projects/${id}/cad`);
      await loaded();
      assert.deepEqual(await facts(id), before);
      await shot("07-custom-engineering-source");
      const model = before.artifacts.find((a) => a.kind === "model");
      for (const change of [
        { status: "validating" },
        { status: "expired" },
        { authorized: false },
      ]) {
        await page.evaluate(
          ({ id, artifactId, change }) => {
            const key = "embodex-v8-preview-v1",
              store = JSON.parse(localStorage.getItem(key));
            const project = store.projects.find((p) => p.id === id);
            Object.assign(
              project.artifacts.find((a) => a.id === artifactId),
              change,
            );
            store.scenario = "files-pending";
            localStorage.setItem(key, JSON.stringify(store));
          },
          { id, artifactId: model.id, change },
        );
        const start = report.modelRequests.length;
        await page.reload();
        await page
          .getByRole("alert")
          .filter({ hasText: "文件尚未就绪、来源不一致或没有读取权限。" })
          .waitFor();
        assert.equal(
          await page.locator('[data-model-loaded="true"]').count(),
          0,
        );
        assert.equal(
          report.modelRequests.length,
          start,
          "blocked engineering file must not be requested",
        );
        await page.goto(`${base}/projects/${id}/delivery`);
        const row = page
          .locator(".vartifact")
          .filter({ has: page.getByText(model.fileName, { exact: true }) });
        assert(
          await row
            .getByRole("button", { name: "在线查看", exact: true })
            .isDisabled(),
        );
        // Return to engineering for the next state; restore the fixture between cases.
        await page.evaluate(
          ({ id, model }) => {
            const key = "embodex-v8-preview-v1",
              store = JSON.parse(localStorage.getItem(key));
            const p = store.projects.find((p) => p.id === id);
            p.artifacts[p.artifacts.findIndex((a) => a.id === model.id)] =
              model;
            localStorage.setItem(key, JSON.stringify(store));
          },
          { id, model },
        );
        await page.goto(`${base}/projects/${id}/cad`);
        await loaded();
      }
      await shot("08-ready-engineering-restored");
    },
  );
  await run(
    "Retired missing example links redirect while retaining the template query; existing edited IDs stay intact",
    async () => {
      const isolated = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const fresh = await isolated.newPage();
      fresh.on("pageerror", (error) => report.pageErrors.push(error.message));
      try {
        await fresh.goto(
          `${base}/projects/demo-project-1/library?template=sample-mobile`,
        );
        await fresh.waitForURL(
          new RegExp(`/projects/${ids[0]}/library\\?template=sample-mobile$`),
        );
        await fresh
          .locator(
            '[data-model-loaded="true"][data-source-kind="supplied-concept-reference"]',
          )
          .waitFor();
        assert.match(
          await fresh.locator(".vtemplate-picker button.active").innerText(),
          /C2 · 精细移动平台/,
        );
        await fresh.screenshot({
          path: join(output, "09-retired-link-preserves-selection.png"),
          fullPage: true,
        });
      } finally {
        await isolated.close();
      }
      const before = await facts(emptyProjectId);
      await page.goto(`${base}/projects/${emptyProjectId}/cad`);
      await page
        .getByRole("heading", { name: "先确定一个设计方案", exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).pathname,
        `/v8/projects/${emptyProjectId}/cad`,
      );
      assert.deepEqual(await facts(emptyProjectId), before);
    },
  );
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.productionMutations.length, 0);
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.cases.filter((item) => item.status === "passed").length,
    failed: report.cases.filter((item) => item.status === "failed").length,
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
