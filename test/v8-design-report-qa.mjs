/** Complete report interaction/export QA against local preview only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
const origin = new URL(base);
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
assert.equal(origin.pathname.replace(/\/$/, ""), "/v8");
const output = resolve("test-results/v8-design-report-qa");
await mkdir(join(output, "downloads"), { recursive: true });
const report = {
  mode: "isolated-local-preview",
  checks: [],
  errors: [],
  requests: [],
  startedAt: new Date().toISOString(),
  limits: [
    "Edge Chromium desktop emulation; native system print dialog and Safari/Firefox not exercised.",
    "Engineering and performance claims remain unverified; source/format/download behavior only.",
  ],
};
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  reducedMotion: "reduce",
});
await context.route("**/*", (route) => {
  const req = route.request(),
    url = new URL(req.url());
  if (
    (/^https?:$/.test(url.protocol) && url.origin !== origin.origin) ||
    (/\/api\/v1\//.test(url.pathname) && req.method() !== "GET")
  ) {
    report.requests.push(req.url());
    return route.abort();
  }
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (e) => report.errors.push(e.message));
const save = () =>
  writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
async function run(name, fn) {
  try {
    const detail = await fn();
    report.checks.push({ name, status: "passed", ...detail });
    console.log(`PASS ${name}`);
  } catch (e) {
    report.checks.push({ name, status: "failed", error: e.stack || String(e) });
    console.error(`FAIL ${name}: ${e.message}`);
    await page
      .screenshot({ path: join(output, `failure-${report.checks.length}.png`) })
      .catch(() => {});
  }
  await save();
}
let projectId;
let projectName;
let htmlContent;
async function openTemplate(name) {
  await page.goto(base);
  await page.getByRole("heading", { name: "今天，想设计什么？" }).waitFor();
  const p = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects.find(
      (p) => !p.branches.length,
    ),
  );
  projectId = p.id;
  projectName = p.name;
  await page.goto(`${base}/projects/${projectId}/library`);
  await page.locator(".vtemplate-picker").getByRole("button", { name }).click();
  await page
    .locator('[data-model-loaded="true"]')
    .first()
    .waitFor({ timeout: 90000 });
  await page
    .getByRole("button", { name: /(?:保存适配|使用此模型)并查看成果/ })
    .click();
  await page.waitForURL(/\/delivery$/);
  await page.getByRole("button", { name: "查看完整方案", exact: true }).click();
  await page
    .getByRole("dialog", { name: "完整设计方案", exact: true })
    .waitFor();
}
try {
  await run(
    "Saved Go2 HTML artifact opens full scheme with matching model/requirement/rights",
    async () => {
      await openTemplate(/Go2.*精细结构参考/);
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      await iframe
        .locator("#report-title")
        .filter({ hasText: projectName })
        .waitFor();
      await iframe.locator(".hero-art img").waitFor();
      await page.waitForFunction(() => {
        const f = document.querySelector(".design-report-dialog iframe");
        const img = f?.contentDocument?.querySelector(".hero-art img");
        return !!img?.complete && img.naturalWidth > 0;
      });
      assert.match(
        await iframe
          .locator(".source-row")
          .allTextContents()
          .then((a) => a.join("\n")),
        /BSD-3-Clause/,
      );
      const facts = await page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem("embodex-v8-preview-v1"),
          ).projects.find((p) => p.id === id),
        projectId,
      );
      const artifact = facts.artifacts
        .filter((a) => a.mimeType.startsWith("text/html"))
        .at(-1);
      assert(artifact?.content.startsWith("<!doctype html>"));
      assert.equal(artifact.sizeBytes, Buffer.byteLength(artifact.content));
      assert(artifact.requirementId);
      assert.equal(
        await page.locator(".design-report-brand").innerText(),
        "Embodex",
      );
      assert.equal(
        await page.locator(".design-report-title h2").innerText(),
        "方案概览",
      );
      assert.equal(
        await page.locator(".design-report-project-chip").innerText(),
        projectName,
      );
      assert.equal(
        await iframe
          .locator(".report-header")
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      assert.equal(
        await iframe.getByRole("button", { name: "进入交互工作台" }).count(),
        1,
      );
      return { artifact: artifact.fileName, bytes: artifact.sizeBytes };
    },
  );
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "phone", width: 390, height: 844 },
    { name: "small-phone", width: 360, height: 800 },
  ]) {
    await run(
      `${viewport.name}: report chapters, readable flow and no horizontal overflow`,
      async () => {
        await page.setViewportSize(viewport);
        const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
        const overflow = await iframe
          .locator("html")
          .evaluate((el) => ({ scroll: el.scrollWidth, width: innerWidth }));
        assert(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
        const dialog = page.getByRole("dialog", {
          name: "完整设计方案",
          exact: true,
        });
        const box = await dialog.boundingBox();
        assert(
          box.x >= 0 &&
            box.x + box.width <= viewport.width + 1 &&
            box.y >= 0 &&
            box.y + box.height <= viewport.height + 1,
        );
        await iframe.getByRole("link", { name: "07 交付流程" }).click();
        await iframe
          .getByRole("heading", { name: "交付流程", exact: true })
          .waitFor();
        await page.waitForFunction(() => {
          const f = document.querySelector(".design-report-dialog iframe");
          return (
            f?.contentDocument?.URL === "about:srcdoc" &&
            f.contentDocument.getElementById("delivery").getBoundingClientRect()
              .top < 160
          );
        });
        assert.equal(
          await iframe
            .locator('meta[name="embodex-report-format"]')
            .getAttribute("content"),
          "embodex-design-report-v1",
        );
        assert.deepEqual(
          await iframe.locator(".chapters a").allTextContents(),
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
        await iframe.getByRole("link", { name: "01 需求与方案" }).click();
        await page.waitForFunction(
          () =>
            document.querySelector(".design-report-dialog iframe")
              ?.contentWindow?.scrollY < 2,
        );
        await page.screenshot({
          path: join(output, `${viewport.name}-go2-scheme.png`),
        });
        return { overflow, dialog: box };
      },
    );
  }
  await run(
    "Offline HTML download embeds actual PNG, keeps immutable source, opens without server image requests",
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "下载离线 HTML", exact: true })
        .click();
      const download = await pending;
      const path = join(output, "downloads", download.suggestedFilename());
      await download.saveAs(path);
      htmlContent = await readFile(path, "utf8");
      assert.match(download.suggestedFilename(), /-offline\.html$/);
      assert.match(htmlContent, /src="data:image\/png;base64,/);
      assert(htmlContent.includes(`data-project-id="${projectId}"`));
      assert.doesNotMatch(htmlContent, /<script\b/i);
      const p = await context.newPage();
      await p.route("**/*", (r) =>
        /^https?:/.test(r.request().url()) ? r.abort() : r.continue(),
      );
      await p.setContent(htmlContent, { waitUntil: "load" });
      const natural = await p
        .locator(".hero-art img")
        .evaluate((i) => ({ complete: i.complete, width: i.naturalWidth }));
      assert(natural.complete && natural.width > 0);
      await p.screenshot({ path: join(output, "offline-html-opened.png") });
      await p.emulateMedia({ media: "print" });
      assert.equal(
        await p
          .locator(".chapters")
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      assert.equal(
        await p
          .locator("body")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgb(255, 255, 255)",
      );
      await p.screenshot({ path: join(output, "print-layout.png") });
      await p.close();
      return {
        file: download.suggestedFilename(),
        bytes: Buffer.byteLength(htmlContent),
        image: natural,
      };
    },
  );
  await run(
    "Keyboard Tab wraps between iframe endpoints and parent toolbar",
    async () => {
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      const first = iframe.locator(".chapters a").first();
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "关闭完整设计方案", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      const last = iframe.locator("summary").last();
      await last.focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "打印方案或另存为 PDF", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
    },
  );
  await run(
    "Source license opens as a controlled local document and leaves report chapters intact",
    async () => {
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      const opened = context.waitForEvent("page");
      await iframe.getByRole("link", { name: "查看完整来源许可" }).click();
      const source = await opened;
      await source.waitForLoadState("domcontentloaded");
      assert.equal(
        new URL(source.url()).pathname,
        "/v8-assets/go2-LICENSE.txt",
      );
      assert.match(
        await source.locator("body").innerText(),
        /Unitree Robotics/,
      );
      assert.equal(await source.evaluate(() => window.opener), null);
      assert.equal(
        await iframe.locator("html").evaluate(() => document.URL),
        "about:srcdoc",
      );
      assert.equal(await iframe.locator(".chapters a").count(), 7);
      await source.close();
      await page.bringToFront();
    },
  );
  await run(
    "Escape from report iframe closes reader and restores invoking button focus",
    async () => {
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      await iframe.getByRole("link", { name: "02 交互式方案" }).focus();
      await page.keyboard.press("Escape");
      await page
        .getByRole("dialog", { name: "完整设计方案", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByRole("button", { name: "查看完整方案", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
    },
  );
  await run(
    "AMR scheme uses matching detailed preview and project-source ownership",
    async () => {
      await openTemplate(/C2.*精细移动平台/);
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      await iframe
        .locator("#report-title")
        .filter({ hasText: projectName })
        .waitFor();
      assert.match(
        await iframe.locator(".hero-art img").getAttribute("src"),
        /mobile-reference\.png/,
      );
      assert.match(
        await iframe.locator("body").innerText(),
        /项目提供的原创概念源/,
      );
      assert.match(
        await iframe.locator("body").innerText(),
        /不将其重新标为 CC0/,
      );
      await page.screenshot({ path: join(output, "desktop-amr-scheme.png") });
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "下载离线 HTML", exact: true })
        .click();
      const d = await download;
      await d.saveAs(join(output, "downloads", d.suggestedFilename()));
      return { file: d.suggestedFilename() };
    },
  );
  await run(
    "Overall solution and scenario diagrams select actual system/task details inside the report",
    async () => {
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      await iframe.getByRole("link", { name: "03 整体方案" }).click();
      const structure = iframe.locator('[data-report-diagram="structure"]');
      assert.equal(
        await structure.locator(".report-task-tabs button").count(),
        4,
      );
      await structure.locator(".report-task-tabs button").last().click();
      assert.equal(
        await structure
          .locator(".report-task-tabs button")
          .last()
          .getAttribute("aria-pressed"),
        "true",
      );
      const detail = await structure.locator(".report-task-detail").innerText();
      assert(detail.trim().length > 30);
      await iframe.getByRole("link", { name: "04 场景任务" }).click();
      const scenario = iframe.locator('[data-report-diagram="scenario"]');
      assert.equal(
        await scenario.locator(".report-task-tabs button").count(),
        5,
      );
      await scenario
        .locator(".report-task-diagram [role=button]")
        .nth(2)
        .click();
      assert.equal(
        await scenario
          .locator(".report-task-tabs button")
          .nth(2)
          .getAttribute("aria-pressed"),
        "true",
      );
      assert(
        (await scenario.locator(".report-task-detail").innerText()).trim()
          .length > 30,
      );
      await page.screenshot({
        path: join(output, "scenario-task-selection.png"),
      });
      return { systemGroups: 4, taskNodes: 5 };
    },
  );
  await run(
    "Budget and enterprise controls compute explicit assumptions, keep model/report identity, export readable values",
    async () => {
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      const before = await page.evaluate(() =>
        localStorage.getItem("embodex-v8-preview-v1"),
      );
      const fields = {
        设备数量: "2",
        "单台硬件预算（元）": "100000",
        "软件与任务开发（元）": "20000",
        "集成与现场部署（元）": "30000",
        "预备费比例（%）": "10",
        "年度维护费（元）": "10000",
        "年度能源费（元）": "5000",
        "其他年度运行费（元）": "0",
        "年净释放工时（小时）": "1000",
        "人工综合成本（元/小时）": "50",
        "工时价值现金兑现比例（%）": "50",
        "其他年度现金节省（元）": "1000",
      };
      await iframe.getByRole("link", { name: "05 投资预算" }).click();
      assert.equal(
        await iframe
          .locator('[data-planning-kind="budget"] input')
          .first()
          .inputValue(),
        "",
      );
      for (const [label, value] of Object.entries(fields))
        await iframe.getByLabel(label, { exact: true }).fill(value);
      assert.match(
        await iframe
          .locator(
            '[data-planning-kind="budget"] .report-planning-results article',
          )
          .filter({ hasText: /^一次投入/ })
          .innerText(),
        /275,000 元/,
      );
      assert.match(
        await iframe
          .locator(
            '[data-planning-kind="economics"] .report-planning-results article',
          )
          .filter({ hasText: /^年度净现金/ })
          .innerText(),
        /11,000 元/,
      );
      assert.match(
        await iframe
          .locator(
            '[data-planning-kind="economics"] .report-planning-results article',
          )
          .filter({ hasText: /^简单回收期/ })
          .innerText(),
        /25 年/,
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("embodex-v8-preview-v1"),
        ),
        before,
      );
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "下载离线 HTML", exact: true })
        .click();
      const d = await pending;
      const path = join(output, "downloads", "assumptions-reading.html");
      await d.saveAs(path);
      const exported = await readFile(path, "utf8");
      assert.match(exported, /275,000 元/);
      assert.match(exported, /11,000 元/);
      assert.match(exported, /本次阅读导出的用户测算假设/);
      assert.doesNotMatch(exported, /<canvas\b|<input\b|<script\b/i);
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("embodex-v8-preview-v1"),
        ),
        before,
      );
      await iframe.getByRole("link", { name: "06 企业效益" }).click();
      await page.screenshot({
        path: join(output, "economics-assumptions.png"),
      });
      await iframe.getByRole("link", { name: "01 需求与方案" }).click();
      return { investment: 275000, annualNet: 11000, paybackYears: 25 };
    },
  );
  await run(
    "Hero opens the matching inline model workbench without modifying the saved report",
    async () => {
      const frozen = await page.evaluate((id) => {
        const p = JSON.parse(
          localStorage.getItem("embodex-v8-preview-v1"),
        ).projects.find((p) => p.id === id);
        return p.artifacts
          .filter((a) => a.mimeType.startsWith("text/html"))
          .at(-1).content;
      }, projectId);
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      await iframe.getByRole("button", { name: "进入交互工作台" }).click();
      await iframe
        .locator('#report-interactive-host [data-model-loaded="true"]')
        .first()
        .waitFor({ timeout: 90000 });
      await page.waitForFunction(
        () =>
          document
            .querySelector(".design-report-dialog iframe")
            ?.contentDocument?.getElementById("interactive")
            .getBoundingClientRect().top < 160,
      );
      assert.equal(
        await page
          .getByRole("dialog", { name: "完整设计方案", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page.evaluate((id) => {
          const p = JSON.parse(
            localStorage.getItem("embodex-v8-preview-v1"),
          ).projects.find((p) => p.id === id);
          return p.artifacts
            .filter((a) => a.mimeType.startsWith("text/html"))
            .at(-1).content;
        }, projectId),
        frozen,
      );
      await page.screenshot({
        path: join(output, "hero-opened-matching-workbench.png"),
      });
      return { project: projectId, model: "mobile-reference.glb" };
    },
  );
  await run(
    "A saved five-chapter fixture presents seven interactive chapters without rewriting its stored facts",
    async () => {
      await page
        .getByRole("button", { name: "关闭完整设计方案", exact: true })
        .click();
      const legacy = await page.evaluate((id) => {
        const store = JSON.parse(localStorage.getItem("embodex-v8-preview-v1"));
        const project = store.projects.find((p) => p.id === id);
        const artifact = project.artifacts
          .filter((a) => a.mimeType.startsWith("text/html"))
          .at(-1);
        const doc = new DOMParser().parseFromString(
          artifact.content,
          "text/html",
        );
        const requirement = doc.getElementById("requirements");
        doc.getElementById("overview").after(requirement);
        requirement.className = "section";
        for (const id of ["interactive", "budget", "economics"])
          doc.getElementById(id).remove();
        doc.getElementById("scenario").id = "verification";
        const nav = doc.querySelector(".chapters");
        nav.replaceChildren(
          ...[
            ["overview", "方案概述"],
            ["requirements", "需求与场景"],
            ["structure", "整体方案"],
            ["verification", "验证计划"],
            ["delivery", "成果与来源"],
          ].map(([id, label], index) => {
            const a = doc.createElement("a");
            a.href = "#" + id;
            a.textContent = String(index + 1).padStart(2, "0") + " " + label;
            return a;
          }),
        );
        artifact.content = "<!doctype html>\n" + doc.documentElement.outerHTML;
        artifact.sizeBytes = new TextEncoder().encode(
          artifact.content,
        ).byteLength;
        localStorage.setItem("embodex-v8-preview-v1", JSON.stringify(store));
        return {
          html: artifact.content,
          text: requirement.querySelector(".brief-text").textContent,
        };
      }, projectId);
      await page.goto(`${base}/projects/${projectId}/delivery`);
      await page
        .getByRole("button", { name: "查看完整方案", exact: true })
        .click();
      const iframe = page.frameLocator('iframe[title$="完整设计方案正文"]');
      await iframe
        .locator('[data-planning-kind="budget"] input')
        .first()
        .waitFor();
      assert.equal(await iframe.locator(".chapters a").count(), 7);
      assert.equal(
        await iframe.locator("#requirements .brief-text").textContent(),
        legacy.text,
      );
      assert.equal(await iframe.locator("#report-interactive-host").count(), 1);
      assert.equal(
        await page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem("embodex-v8-preview-v1"))
              .projects.find((p) => p.id === id)
              .artifacts.filter((a) => a.mimeType.startsWith("text/html"))
              .at(-1).content,
          projectId,
        ),
        legacy.html,
      );
    },
  );
  await run("No page errors or production/external requests", async () => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.requests, []);
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter((x) => x.status === "passed").length;
  report.failed = report.checks.filter((x) => x.status === "failed").length;
  await save();
  await browser.close();
}
console.log(
  `Design report QA: ${report.passed} passed, ${report.failed} failed. ${join(output, "report.json")}`,
);
if (report.failed) process.exitCode = 1;
