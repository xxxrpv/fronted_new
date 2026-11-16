import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:3108/v8",
  key = "embodex-v8-preview-v1",
  out = "test-results/v8-final-delivery";
const q4 = "demo-example-q4-inspection",
  ai = "demo-example-complete-inspection";
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
let baseline;
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
const run = async (name, fn) => {
  try {
    await fn();
    report.cases.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    report.cases.push({ name, passed: false, error: e.stack });
    await shot("failure");
    throw e;
  }
};
const restore = async () => {
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [key, baseline],
  );
};
const route = (id) => page.goto(`${base}/projects/${id}/delivery`);
const read = (id) =>
  page.evaluate(
    ([key, id]) =>
      JSON.parse(localStorage.getItem(key)).projects.find((p) => p.id === id),
    [key, id],
  );
const mutate = async (id, code) =>
  page.evaluate(
    ([key, id, code]) => {
      const s = JSON.parse(localStorage.getItem(key)),
        p = s.projects.find((p) => p.id === id);
      new Function("p", code)(p);
      localStorage.setItem(key, JSON.stringify(s));
    },
    [key, id, code],
  );
const doc = () =>
  page
    .getByRole("dialog", { name: "完整设计方案", exact: true })
    .locator("iframe")
    .contentFrame();
const noText = async () => {
  assert.equal(
    await page
      .locator(".vdelivery-card")
      .getByRole("button", { name: "查看文本", exact: true })
      .count(),
    0,
  );
  assert(
    !(await page.locator(".vdelivery-grid").innerText()).includes("Markdown"),
  );
};
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await page.locator(".mx-project").first().waitFor();
  baseline = await page.evaluate((key) => localStorage.getItem(key), key);
  await run(
    "New requirement never substitutes old deliverables; historical HTML remains readable and downloadable",
    async () => {
      await restore();
      const original = await read(ai),
        html = original.artifacts.find((a) =>
          a.mimeType.startsWith("text/html"),
        );
      await mutate(
        ai,
        "const r=structuredClone(p.requirements.at(-1));r.id+='-new';r.sequence++;p.requirements.push(r);",
      );
      await route(ai);
      await page.locator(".vdelivery-grid").waitFor();
      assert.equal(
        await page
          .locator(".vdelivery-grid")
          .getAttribute("data-delivery-source"),
        "",
      );
      assert.equal(await page.locator(".vdelivery-card .vartifact").count(), 0);
      await noText();
      assert(
        await page
          .getByRole("button", { name: "继续完善设计", exact: true })
          .first()
          .isEnabled(),
      );
      await page.getByRole("button", { name: "设计历程", exact: true }).click();
      const drawer = page.getByRole("dialog", {
        name: "设计历程",
        exact: true,
      });
      const file = drawer
        .locator(".vhistory-file")
        .filter({ hasText: html.fileName })
        .first();
      await file.evaluate((n) => {
        for (let p = n.parentElement; p; p = p.parentElement)
          if (p.tagName === "DETAILS") p.open = true;
      });
      await file.getByRole("button", { name: "查看", exact: true }).click();
      await doc().locator("#solution-title").waitFor();
      assert.equal(
        await doc().locator("body").getAttribute("data-requirement-id"),
        html.requirementId,
      );
      await doc()
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      await page.getByRole("button", { name: "设计历程", exact: true }).click();
      const historical = page
        .locator(".vhistory-file")
        .filter({ hasText: html.fileName })
        .first();
      await historical.evaluate((n) => {
        for (let p = n.parentElement; p; p = p.parentElement)
          if (p.tagName === "DETAILS") p.open = true;
      });
      const pending = page.waitForEvent("download");
      await historical
        .getByRole("button", { name: "下载", exact: true })
        .click();
      const download = await pending;
      await download.saveAs(`${out}/historical.html`);
      assert(
        (await readFile(await download.path(), "utf8")).includes("data:image/"),
      );
      await shot("history-preserved");
    },
  );
  await run(
    "New concept revision hides stale HTML while preserving explicit continuation",
    async () => {
      await restore();
      await mutate(
        ai,
        "const b=p.branches[0],r=structuredClone(b.revisions.at(-1));r.id+='-new';r.descriptionId+='-new';r.sequence++;b.revisions.push(r);b.latestRevisionId=r.id;",
      );
      await route(ai);
      await page.locator(".vdelivery-grid").waitFor();
      assert.equal(await page.locator(".vdelivery-card .vartifact").count(), 0);
      await noText();
      assert(
        (await page.locator(".vdelivery-prepare").innerText()).includes(
          "先确认",
        ),
      );
      await shot("new-version-incomplete");
    },
  );
  for (const id of [q4, ai])
    await run(
      `${id}: ready source without HTML offers one idempotent final generation`,
      async () => {
        await restore();
        await mutate(
          id,
          "p.artifacts=p.artifacts.filter(a=>!a.mimeType.startsWith('text/html'));for(const r of p.cadRuns)r.artifactIds=r.artifactIds.filter(id=>p.artifacts.some(a=>a.id===id));",
        );
        await route(id);
        await page
          .getByRole("button", { name: "生成最终方案", exact: true })
          .waitFor();
        await noText();
        assert.equal(
          (await read(id)).artifacts.filter((a) =>
            a.mimeType.startsWith("text/html"),
          ).length,
          0,
        );
        await page
          .getByRole("button", { name: "生成最终方案", exact: true })
          .evaluate((n) => {
            n.click();
            n.click();
          });
        await page
          .getByRole("button", { name: "查看完整方案", exact: true })
          .waitFor();
        assert.equal(
          (await read(id)).artifacts.filter((a) =>
            a.mimeType.startsWith("text/html"),
          ).length,
          1,
        );
        await page.reload();
        await page
          .getByRole("button", { name: "查看完整方案", exact: true })
          .waitFor();
        assert.equal(
          (await read(id)).artifacts.filter((a) =>
            a.mimeType.startsWith("text/html"),
          ).length,
          1,
        );
        await noText();
        await shot(id === q4 ? "template-final" : "custom-final");
      },
    );
  await run(
    "Failed model preparation cannot generate HTML and exposes recovery",
    async () => {
      await restore();
      await mutate(
        q4,
        "p.artifacts=p.artifacts.filter(a=>!a.mimeType.startsWith('text/html'));p.artifacts.find(a=>a.kind==='model').status='failed';",
      );
      await route(q4);
      await page.locator(".vdelivery-prepare").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "生成最终方案", exact: true })
          .count(),
        0,
      );
      assert(
        (await page.locator(".vdelivery-prepare").innerText()).includes("失败"),
      );
      assert(
        await page
          .getByRole("button", { name: "刷新文件状态", exact: true })
          .isEnabled(),
      );
      assert.equal(
        (await read(q4)).artifacts.filter((a) =>
          a.mimeType.startsWith("text/html"),
        ).length,
        0,
      );
      await shot("failed-model");
    },
  );
  await run(
    "Confirmed concept with no engineering model cannot show or generate final HTML",
    async () => {
      await restore();
      await mutate(
        ai,
        "p.cadRuns=[];p.tasks=p.tasks.filter(t=>t.type!=='cad');p.artifacts=p.artifacts.filter(a=>a.kind==='design_document'&&!a.mimeType.startsWith('text/html'));",
      );
      await route(ai);
      await page.locator(".vdelivery-prepare").waitFor();
      assert(
        (await page.locator(".vdelivery-prepare").innerText()).includes(
          "工程模型",
        ),
      );
      assert.equal(
        await page
          .getByRole("button", { name: "生成最终方案", exact: true })
          .count(),
        0,
      );
      assert(
        await page
          .getByRole("button", { name: "查看完整方案", exact: true })
          .isDisabled(),
      );
      await noText();
      await shot("confirmed-awaiting-engineering");
    },
  );
  await run(
    "Delivery buttons are reachable on desktop and phone; download exposes an in-progress state",
    async () => {
      await restore();
      await route(q4);
      await page
        .getByRole("button", { name: "查看完整方案", exact: true })
        .waitFor();
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route(
        "**/v8-assets/inspection-reference.glb",
        async (route) => {
          await gate;
          await route.continue();
        },
      );
      const modelDownload = page
        .locator(".vdelivery-card")
        .filter({
          has: page.getByRole("heading", { name: "三维模型", exact: true }),
        })
        .locator(".vdownload");
      const pending = page.waitForEvent("download");
      await modelDownload.click();
      await page.locator('.vdownload[aria-busy="true"]').waitFor();
      assert(await modelDownload.isDisabled());
      assert((await modelDownload.innerText()).includes("准备中"));
      release();
      await pending;
      await page.unroute("**/v8-assets/inspection-reference.glb");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(
          await page
            .locator("body")
            .evaluate((n) => n.scrollWidth > innerWidth),
          false,
        );
        for (const button of await page
          .locator(".vdelivery-card .vartifact-actions button")
          .all()) {
          await button.scrollIntoViewIfNeeded();
          assert(await button.isVisible());
          assert(await button.isEnabled());
          const box = await button.boundingBox();
          assert(box.x >= 0 && box.x + box.width <= width);
          assert(await button.evaluate(n => {
            const r=n.getBoundingClientRect();
            return [[.1,.1],[.5,.5],[.9,.1],[.9,.9]].every(([x,y])=>n.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)));
          }), 'Action is partly covered by another control');
        }
        await shot(width === 390 ? "phone-delivery" : "desktop-delivery");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "查看完整方案", exact: true })
        .click();
      await doc().locator("#solution-title").waitFor();
      await shot("phone-reader");
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
