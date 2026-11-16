/** Primary V8 spec: guarded engineering entry, contextual parameters and immutable CAD sources. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const base = "http://127.0.0.1:3108/v8",
  output = resolve("test-results/v8-spec-guard");
await mkdir(output, { recursive: true });
const report = {
  mode: "isolated-local-development-preview",
  startedAt: new Date().toISOString(),
  cases: [],
  pageErrors: [],
  productionMutations: [],
};
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(25000);
page.on("pageerror", (e) => report.pageErrors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET" && r.url().includes("/api/v1/"))
    report.productionMutations.push(`${r.method()} ${r.url()}`);
});
const facts = (id) =>
  page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
        (p) => p.id === id,
      ),
    id,
  );
const loaded = () => page.locator('[data-model-loaded="true"]').waitFor();
const rail = () =>
  page.getByRole("complementary", { name: "模型参数面板", exact: true });
async function select(id) {
  await rail().getByLabel("搜索零件", { exact: true }).fill(id);
  await rail().locator(".vpart-catalog button").click();
  await rail().getByLabel("搜索零件", { exact: true }).fill("");
}
async function run(name, fn) {
  try {
    const evidence = await fn();
    report.cases.push({ name, status: "passed", evidence });
    console.log(`PASS ${name}`);
  } catch (e) {
    report.cases.push({ name, status: "failed", error: e.stack || String(e) });
    console.error(`FAIL ${name}: ${e.message}`);
    await page
      .screenshot({ path: join(output, `failure-${report.cases.length}.png`) })
      .catch(() => {});
  }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}
const q4 = "demo-example-q4-inspection",
  c2 = "demo-example-c2-logistics",
  ai = "demo-example-ai-review";
let originalAI;
try {
  await run(
    "Unapproved custom projects cannot hard-jump to engineering; redirect and no generation facts",
    async () => {
      await page.goto(base);
      await page
        .getByLabel("描述你的设计目标")
        .fill("QA主规格工程阶段前置条件");
      await page
        .locator("main")
        .getByRole("button", { name: "开始设计", exact: true })
        .click();
      await page.waitForURL(/\/requirements$/);
      const id = page.url().match(/\/projects\/([^/]+)/)[1];
      await page
        .getByRole("button", { name: "保存需求，选择路线", exact: true })
        .click();
      await page
        .getByRole("button", { name: "进入 AI 概念探索", exact: true })
        .click();
      await page.waitForURL(/\/concepts$/);
      const before = await facts(id);
      assert.equal(before.approvals.length, 0);
      assert(
        await page
          .locator(".vstagebar button")
          .filter({ hasText: "工程模型" })
          .isDisabled(),
      );
      await page.goto(`${base}/projects/${id}/cad`);
      await page.waitForURL(new RegExp(`/projects/${id}/concepts(?:[?#]|$)`));
      await page
        .getByText("请先完成前面的设计步骤，再继续此阶段。", { exact: true })
        .waitFor();
      assert.deepEqual(await facts(id), before);
    },
  );
  await run(
    "Saved ready template enters actual source-model engineering without inventing CAD runs",
    async () => {
      await page.goto(`${base}/projects/${q4}/cad`);
      await loaded();
      const before = await facts(q4);
      assert.equal(before.cadRuns.length, 0);
      await page
        .getByRole("heading", { name: "模型与配置", exact: true })
        .waitFor();
      assert(
        !(await page
          .locator(".vstagebar button")
          .filter({ hasText: "工程模型" })
          .isDisabled()),
      );
      assert.deepEqual(await facts(q4), before);
      await page.screenshot({
        path: join(output, "01-template-source-engineering.png"),
      });
    },
  );
  await run(
    "Wheel hides camera controls; actual camera assembly descendants expose bounded mm-to-metre view adjustment",
    async () => {
      await page.goto(`${base}/projects/${c2}/library`);
      await loaded();
      await rail().getByLabel("搜索零件", { exact: true }).fill("轮");
      await rail().locator(".vpart-catalog button").first().click();
      assert.equal(await page.locator("#sensor-offset").count(), 0);
      await select("dock-camera");
      assert.equal(await page.locator("#sensor-offset").count(), 1);
      await page.goto(`${base}/projects/${q4}/library`);
      await loaded();
      const before = await facts(q4);
      await select("inspection.camera-assembly");
      await rail()
        .getByRole("button", { name: /查看下级零件/ })
        .click();
      await rail().locator(".vpart-catalog button").first().click();
      assert.equal(await page.locator("#sensor-offset").count(), 1);
      await page.locator("#sensor-offset").focus();
      await page.locator("#sensor-offset").press("Home");
      const actual = await page
        .locator('[data-model-loaded="true"]')
        .evaluate((el) => ({
          before: el.dataset.partWorldBefore.split(",").map(Number),
          after: el.dataset.partWorldAfter.split(",").map(Number),
        }));
      assert(Math.abs(actual.after[1] - actual.before[1] + 0.075) < 1e-7);
      assert.deepEqual(await facts(q4), before);
      await page.screenshot({
        path: join(output, "02-contextual-source-parameter.png"),
      });
      return actual;
    },
  );
  await run(
    "Historical CAD retains its exact visible description ID and body after a newer concept revision",
    async () => {
      await page.goto(`${base}/projects/${ai}/cad`);
      await loaded();
      originalAI = await facts(ai);
      const run = originalAI.cadRuns.at(-1),
        source = originalAI.branches
          .find((b) => b.id === run.branchId)
          .revisions.find((r) => r.id === run.revisionId);
      await page
        .getByRole("heading", { name: "工程模型已生成", exact: true })
        .waitFor();
      const block = page.locator(".vengineering-description");
      assert.equal(
        await block.locator("summary code").innerText(),
        source.descriptionId,
      );
      await block.locator("summary").click();
      assert.equal(await block.locator("p").innerText(), source.description);
      await page.evaluate(
        ({ id, run }) => {
          const key = "embodex-v8-preview-v1",
            store = JSON.parse(localStorage.getItem(key)),
            p = store.projects.find((p) => p.id === id),
            b = p.branches.find((b) => b.id === run.branchId),
            old = b.revisions.at(-1),
            r = {
              ...old,
              id: "qa-newer-revision",
              sequence: old.sequence + 1,
              descriptionId: "qa-newer-description",
              description: "QA后续新描述，旧CAD仍属于原批准。",
            };
          b.revisions.push(r);
          b.latestRevisionId = r.id;
          localStorage.setItem(key, JSON.stringify(store));
        },
        { id: ai, run },
      );
      await page.reload();
      await loaded();
      await page
        .getByText("历史成果 · 需求或概念已更新", { exact: true })
        .waitFor();
      const after = await facts(ai);
      assert.deepEqual(after.cadRuns, originalAI.cadRuns);
      assert.deepEqual(after.approvals, originalAI.approvals);
      assert.equal(
        await page
          .locator(".vengineering-description summary code")
          .innerText(),
        run.sourceDescriptionId,
      );
      await page.screenshot({
        path: join(output, "03-historical-cad-description.png"),
      });
    },
  );
  await run(
    "Expired result shows a separate file state; invalid approval cannot open engineering or pair stale description",
    async () => {
      await page.evaluate((id) => {
        const key = "embodex-v8-preview-v1",
          store = JSON.parse(localStorage.getItem(key)),
          p = store.projects.find((p) => p.id === id);
        p.artifacts
          .filter((a) => a.kind === "model")
          .forEach((a) => (a.status = "expired"));
        localStorage.setItem(key, JSON.stringify(store));
      }, ai);
      await page.reload();
      await page
        .getByRole("heading", { name: "模型文件待就绪", exact: true })
        .waitFor();
      await page.getByText("链接已过期", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-model-loaded="true"]').count(), 0);
      await page.evaluate((id) => {
        const key = "embodex-v8-preview-v1",
          store = JSON.parse(localStorage.getItem(key)),
          p = store.projects.find((p) => p.id === id);
        p.approvals.forEach((a) => (a.description = "QA篡改批准正文"));
        localStorage.setItem(key, JSON.stringify(store));
      }, ai);
      const before = await facts(ai);
      await page.goto(`${base}/projects/${ai}/cad`);
      await page.waitForURL(new RegExp(`/projects/${ai}/concepts(?:[?#]|$)`));
      assert.deepEqual(await facts(ai), before);
      assert(
        await page
          .locator(".vstagebar button")
          .filter({ hasText: "工程模型" })
          .isDisabled(),
      );
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
