/** Targeted visual/interaction QA. Local, isolated preview only; never mutates a live backend. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
const origin = new URL(base);
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname),
  "This QA is local-only",
);
assert.equal(
  origin.pathname.replace(/\/$/, ""),
  "/v8",
  "This QA must use isolated preview",
);
const output = resolve("test-results/v8-glass-qa");
await mkdir(output, { recursive: true });
const report = {
  mode: "isolated-local-development-preview",
  material: "CSS glass approximation, not native Apple material",
  url: base,
  browser: "Edge headless",
  startedAt: new Date().toISOString(),
  checks: [],
  screenshots: [],
  pageErrors: [],
  blockedRequests: [],
  limits: [
    "Windows Edge Chromium only; Safari, Firefox and touch hardware were not tested.",
    "Reduced-transparency preference cannot be emulated directly by Playwright; its shared opaque fallback is exercised with prefers-contrast:more.",
    "Only preview data and authored/licensed preview assets; no claim of real backend integration or engineering validation.",
  ],
};
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const sizes = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "laptop", width: 1024, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
  { name: "small-phone", width: 360, height: 800 },
];
const save = () =>
  writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
async function run(name, fn) {
  const at = Date.now();
  try {
    const detail = await fn();
    report.checks.push({
      name,
      status: "passed",
      milliseconds: Date.now() - at,
      ...(detail || {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({
      name,
      status: "failed",
      milliseconds: Date.now() - at,
      error: error.stack || String(error),
    });
    console.error(`FAIL ${name}: ${error.message}`);
  }
  await save();
}
async function screenshot(page, name) {
  const path = join(output, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
  return path;
}
async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({
    inner: innerWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    size.scroll <= size.inner + 1 && size.body <= size.inner + 1,
    `${label} horizontal overflow: ${JSON.stringify(size)}`,
  );
  return size;
}
async function reachable(page, locator) {
  await locator.waitFor({ state: "visible" });
  assert(await locator.isEnabled(), "principal action must be enabled");
  await locator.evaluate((el) =>
    el.scrollIntoView({ block: "center", inline: "center" }),
  );
  const facts = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    const hit = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2,
    );
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      font: parseFloat(s.fontSize),
      hit: !!hit && (hit === el || el.contains(hit)),
    };
  });
  assert(
    facts.x >= -1 && facts.x + facts.width <= facts.viewportWidth + 1,
    `principal action clipped horizontally: ${JSON.stringify(facts)}`,
  );
  assert(
    facts.y >= -1 &&
      facts.y + facts.height <= facts.viewportHeight + 1 &&
      facts.hit,
    `principal action covered/unreachable: ${JSON.stringify(facts)}`,
  );
  assert(
    facts.height >= 40 && facts.font >= 12,
    "principal action text and target must stay readable",
  );
  await page.keyboard.press("Tab");
  await locator.focus();
  const focus = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      visible: el.matches(":focus-visible"),
      style: s.outlineStyle,
      width: parseFloat(s.outlineWidth),
    };
  });
  assert(
    focus.visible && focus.style !== "none" && focus.width >= 2,
    `keyboard focus missing: ${JSON.stringify(focus)}`,
  );
  return { facts, focus };
}
try {
  for (const viewport of sizes) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    await context.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin !== origin.origin
      ) {
        report.blockedRequests.push(`external ${request.url()}`);
        return route.abort();
      }
      if (/\/api\/v1\//.test(url.pathname) && request.method() !== "GET") {
        report.blockedRequests.push(
          `mutation ${request.method()} ${url.pathname}`,
        );
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) =>
      report.pageErrors.push({
        viewport: viewport.name,
        message: error.message,
      }),
    );
    let state;
    await run(
      `${viewport.name}: workspace principal action, glass and focus`,
      async () => {
        await page.goto(base, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("heading", { name: "今天，想设计什么？" })
          .waitFor();
        await page
          .getByLabel("描述你的设计目标")
          .fill("本地响应式检查：查看精细模型与概念版本。");
        const action = await reachable(
          page,
          page
            .locator("main")
            .getByRole("button", { name: "开始设计", exact: true }),
        );
        const surface = await page.locator(".vtopbar").evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            blur: s.backdropFilter,
            background: s.backgroundImage,
            color: s.color,
          };
        });
        assert(
          /blur\(/.test(surface.blur),
          `glass blur absent: ${JSON.stringify(surface)}`,
        );
        const overflow = await noOverflow(page, "workspace");
        await screenshot(page, `${viewport.name}-01-workspace`);
        state = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("embodex-v8-preview-v1") || "{}"),
        );
        assert(
          state.projects?.length >= 2,
          "deterministic preview projects must exist",
        );
        return { action, surface, overflow };
      },
    );
    if (!state) {
      await context.close();
      continue;
    }
    const libraryProject =
      state.projects.find((p) => !p.branches.length) || state.projects[0];
    const conceptProject = state.projects.find((p) => p.branches.length > 0),
      branch = conceptProject?.branches[0];
    await run(
      `${viewport.name}: precise library model, glass controls and principal action`,
      async () => {
        await page.goto(`${base}/projects/${libraryProject.id}/library`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .locator('[data-model-loaded="true"]')
          .first()
          .waitFor({ timeout: 90000 });
        const activeName = await page
          .locator(".vtemplate-picker > button.active strong")
          .innerText();
        assert(
          /Go2/i.test(activeName),
          `expected fine-mesh default, got ${activeName}`,
        );
        const model = await page
          .locator('[data-model-loaded="true"]')
          .first()
          .evaluate((el) => ({
            source: el.dataset.sourceKind,
            assemblies: Number(el.dataset.assemblyCount),
            meshes: Number(el.dataset.meshCount),
          }));
        assert.equal(model.source, "licensed-original-mesh-conversion");
        assert(
          model.assemblies >= 10 && model.meshes >= 10,
          "fine-mesh fixture must contain real parts",
        );
        const action = await reachable(
          page,
          page.getByRole("button", { name: "保存适配并查看成果", exact: true }),
        );
        const overflow = await noOverflow(page, "library");
        await page
          .locator(".vstudio-canvas")
          .evaluate((el) => el.scrollIntoView({ block: "center" }));
        const whole = page.getByRole("button", {
          name: "还原整机",
          exact: true,
        });
        await whole.click();
        await screenshot(page, `${viewport.name}-02-library`);
        await page
          .getByRole("button", { name: "拆解模型", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            Number(
              document.querySelector('[data-model-loaded="true"]')?.dataset
                .explodeLevel,
            ) > 0,
        );
        await noOverflow(page, "exploded library");
        await screenshot(page, `${viewport.name}-03-library-exploded`);
        await whole.click();
        return { activeName, model, action, overflow };
      },
    );
    if (conceptProject && branch) {
      await run(
        `${viewport.name}: concept detail and version principal action`,
        async () => {
          await page.goto(
            `${base}/projects/${conceptProject.id}/concepts/${branch.id}`,
            { waitUntil: "domcontentloaded" },
          );
          await page
            .getByRole("heading", { name: new RegExp(branch.name) })
            .waitFor();
          await page
            .locator('[data-model-loaded="true"]')
            .first()
            .waitFor({ timeout: 45000 });
          const primary = page.getByRole("button", {
            name: /^确认 V01，进入工程阶段$/,
          });
          const action = await reachable(page, primary);
          const overflow = await noOverflow(page, "concept");
          await screenshot(page, `${viewport.name}-04-concept`);
          return { action, overflow };
        },
      );
      await run(
        `${viewport.name}: approval dialog stays usable and traps/restores keyboard focus`,
        async () => {
          const primary = page.getByRole("button", {
            name: /^确认 V01，进入工程阶段$/,
          });
          await primary.click();
          const dialog = page.getByRole("dialog", {
            name: "确认这个具体版本",
            exact: true,
          });
          await dialog.waitFor();
          const bounds = await dialog.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              vw: innerWidth,
              vh: innerHeight,
            };
          });
          assert(
            bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= bounds.vw + 1 &&
              bounds.y + bounds.height <= bounds.vh + 1,
            `dialog clipped: ${JSON.stringify(bounds)}`,
          );
          const confirm = dialog.getByRole("button", {
            name: "确认并创建样例工程任务",
            exact: true,
          });
          const action = await reachable(page, confirm);
          await screenshot(page, `${viewport.name}-05-approval`);
          await confirm.focus();
          await page.keyboard.press("Tab");
          assert.equal(
            await dialog
              .getByRole("button", { name: "关闭", exact: true })
              .evaluate((el) => el === document.activeElement),
            true,
            "Tab from last control should cycle to close",
          );
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
          assert.equal(
            await primary.evaluate((el) => el === document.activeElement),
            true,
            "Escape should restore invoking control focus",
          );
          await noOverflow(page, "closed dialog");
          return { bounds, action };
        },
      );
    }
    await run(
      `${viewport.name}: contrast preference provides opaque readable fallback`,
      async () => {
        await page.emulateMedia({ contrast: "more", reducedMotion: "reduce" });
        const fallback = await page.locator(".vtopbar").evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            matched: matchMedia("(prefers-contrast: more)").matches,
            blur: s.backdropFilter,
            background: s.backgroundColor,
          };
        });
        assert(fallback.matched, "contrast preference must be emulated");
        assert.equal(fallback.blur, "none");
        assert.equal(fallback.background, "rgb(248, 251, 255)");
        await noOverflow(page, "opaque fallback");
        await screenshot(page, `${viewport.name}-06-opaque-fallback`);
        return { fallback };
      },
    );
    await context.close();
  }
  await run(
    "Preview isolation: no live mutations or untrusted remote requests",
    async () => {
      assert.deepEqual(report.blockedRequests, []);
      assert.deepEqual(report.pageErrors, []);
    },
  );
} finally {
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter((x) => x.status === "passed").length;
  report.failed = report.checks.filter((x) => x.status === "failed").length;
  await save();
  await browser.close();
}
console.log(
  `Glass QA: ${report.passed} passed, ${report.failed} failed. Report: ${join(output, "report.json")}`,
);
if (report.failed) process.exitCode = 1;
