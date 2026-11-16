/** Local browser check for unsaved template deep links and historical-source isolation. */
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
const output = resolve("test-results/v8-library-link");
await mkdir(output, { recursive: true });
const report = {
  mode: "isolated-local-development-preview",
  startedAt: new Date().toISOString(),
  cases: [],
  pageErrors: [],
  productionMutations: [],
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
const projectId = "demo-project-1";
const library = `${base}/projects/${projectId}/library`;
const facts = () =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (project) => project.id === id,
      ),
    projectId,
  );
async function model(id, kind) {
  await page.waitForFunction(
    (kind) =>
      document
        .querySelector('[data-model-loaded="true"]')
        ?.getAttribute("data-source-kind") === kind,
    kind,
  );
  assert.equal(
    await page.locator(".vtemplate-picker button.active").count(),
    1,
  );
  const names = {
    "sample-go2": "Go2 · 精细结构参考",
    "sample-inspection": "Q4 · 精细巡检构型",
    "sample-mobile": "C2 · 精细移动平台",
  };
  assert.match(
    await page.locator(".vtemplate-picker button.active").innerText(),
    new RegExp(names[id]),
  );
  assert.equal(
    await page.locator('[data-model-loaded="true"] canvas').count(),
    1,
  );
}
try {
  // Establish an actual saved Go2 template through the public preview flow.
  await page.goto(`${library}?template=sample-go2`);
  await model("sample-go2", "licensed-original-mesh-conversion");
  await page
    .getByRole("button", { name: "使用此模型并查看成果", exact: true })
    .click();
  await page.waitForURL(/\/delivery$/);
  const historical = await facts();
  assert.equal(historical.templateId, "sample-go2");
  assert(historical.artifacts.length > 0);
  report.savedHistoricalTemplate = historical.templateId;

  await page.goto(`${library}?template=sample-inspection`);
  await model("sample-inspection", "licensed-concept-reference");
  await page.reload();
  await model("sample-inspection", "licensed-concept-reference");
  assert.equal(
    new URL(page.url()).searchParams.get("template"),
    "sample-inspection",
  );
  assert.deepEqual(await facts(), historical);
  await page.screenshot({
    path: join(output, "inspection-deep-link-reloaded.png"),
    fullPage: true,
  });
  report.cases.push({
    name: "Explicit inspection link and reload preserve unsaved precise selection and saved Go2 facts",
    status: "passed",
  });

  await page
    .locator(".vtemplate-picker button")
    .filter({ hasText: "C2 · 精细移动平台" })
    .click();
  await model("sample-mobile", "supplied-concept-reference");
  assert.equal(
    new URL(page.url()).searchParams.get("template"),
    "sample-mobile",
  );
  await page.reload();
  await model("sample-mobile", "supplied-concept-reference");
  assert.deepEqual(await facts(), historical);
  await page.screenshot({
    path: join(output, "mobile-picker-link-reloaded.png"),
    fullPage: true,
  });
  report.cases.push({
    name: "Mobile picker updates URL and reload preserves selection without changing historical template",
    status: "passed",
  });

  for (const query of ["not-a-template", "sample-quadruped"]) {
    await page.goto(`${library}?template=${query}`);
    await model("sample-go2", "licensed-original-mesh-conversion");
    assert.deepEqual(await facts(), historical);
  }
  report.cases.push({
    name: "Unknown and retired query IDs are rejected; saved historical model remains authoritative",
    status: "passed",
  });
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.productionMutations.length, 0);
} catch (error) {
  report.cases.push({
    name: "library link smoke",
    status: "failed",
    error: error.stack || String(error),
  });
  await page
    .screenshot({ path: join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(error);
  process.exitCode = 1;
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
}
