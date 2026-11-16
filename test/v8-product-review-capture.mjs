import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { enterPreviewDesign } from "./v8-preview-browser.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local preview only");
const output = resolve(
  "test-results/v8-product-review",
  process.env.REVIEW_PHASE || "before",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await enterPreviewDesign(page, base);
  const projects = await page.evaluate(
    () => JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects,
  );
  const library = projects.find((p) => p.id === "demo-example-q4-inspection");
  const custom = projects.find((p) => p.id === "demo-example-ai-review");
  const routes = [
    ["workspace", "/embodex"],
    ["requirements", `/projects/${custom.id}/requirements`],
    ["start", `/projects/${custom.id}/start`],
    ["library", `/projects/${library.id}/library?template=sample-inspection`],
    ["concepts", `/projects/${custom.id}/concepts`],
    ["concept", `/projects/${custom.id}/concepts/${custom.branches[0].id}`],
    ["cad", `/projects/${custom.id}/cad`],
    ["delivery", `/projects/${library.id}/delivery`],
  ].filter(
    ([name]) =>
      !process.env.REVIEW_PAGES ||
      process.env.REVIEW_PAGES.split(",").includes(name),
  );
  const report = [];
  for (const [name, path] of routes) {
    await page.goto(base + path);
    await page.locator("main h1").first().waitFor();
    if (["library", "concept", "cad"].includes(name))
      await page.locator('[data-model-loaded="true"]').first().waitFor();
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    report.push({
      name,
      url: page.url(),
      text: await page.locator("main").innerText(),
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    });
  }
  for (const [name, path] of routes) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + path);
    await page.locator("main h1").first().waitFor();
    if (["library", "concept", "cad"].includes(name))
      await page.locator('[data-model-loaded="true"]').first().waitFor();
    await page.screenshot({
      path: `${output}/${name}-mobile.png`,
      fullPage: true,
    });
    report.push({
      name: `${name}-mobile`,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    });
  }
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ report, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      output,
      pages: report.length,
      errors,
      overflow: report.filter((r) => r.overflow),
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
