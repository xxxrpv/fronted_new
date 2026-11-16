import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const out = "test-results/v8-report-toolbar";
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const report = { checks: [], errors };
try {
  await page.goto(`${base}/login`);
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await page.goto(`${base}/projects/demo-example-complete-inspection/delivery`);
  await page.getByRole("button", { name: "查看完整方案", exact: true }).click();
  const iframe = page
      .getByRole("dialog", { name: "完整设计方案", exact: true })
      .locator("iframe"),
    f = iframe.contentFrame();
  await f.locator("#solution-title").waitFor();
  const print = f.getByRole("button", {
      name: "打印 / 另存为 PDF",
      exact: true,
    }),
    download = f.getByRole("button", { name: "下载 HTML", exact: true }),
    close = f.getByRole("button", { name: "关闭完整设计方案", exact: true });
  for (const item of [print, download, close]) assert(await item.isEnabled());
  assert.equal(await close.locator("svg").count(), 1);
  assert.equal(
    await print.evaluate((n) => getComputedStyle(n).height),
    await close.evaluate((n) => getComputedStyle(n).height),
  );
  await page.screenshot({ path: `${out}/desktop.png` });
  report.checks.push(
    "Desktop toolbar actions and SVG close share the same height",
  );
  await iframe.evaluate((n) => {
    const w = n.contentWindow;
    w.__printCalls = 0;
    w.print = () => {
      w.__printCalls++;
      w.__detailsBefore = [...w.document.querySelectorAll("details")].map(
        (node) => [node, node.open],
      );
      w.dispatchEvent(new w.Event("beforeprint"));
      w.__detailsDuringPrint = [
        ...w.document.querySelectorAll("details"),
      ].every((d) => d.open);
      w.dispatchEvent(new w.Event("afterprint"));
    };
  });
  await print.click();
  assert.equal(await iframe.evaluate((n) => n.contentWindow.__printCalls), 1);
  assert.equal(
    await iframe.evaluate((n) => n.contentWindow.__detailsDuringPrint),
    true,
  );
  assert(
    await iframe.evaluate((n) =>
      n.contentWindow.__detailsBefore.every(
        ([node, open]) => node.isConnected && node.open === open,
      ),
    ),
  );
  report.checks.push(
    "Print action calls browser print, expands disclosures and restores them",
  );
  const pending = page.waitForEvent("download");
  await download.click();
  const file = await pending;
  await file.saveAs(`${out}/offline.html`);
  const html = await readFile(`${out}/offline.html`, "utf8");
  assert(html.includes("data:image/png;base64,"));
  assert(!html.includes("<script"));
  assert(!html.includes("data-report-export="));
  const offline = await context.newPage();
  await offline.route("http://**/*", (route) => route.abort());
  await offline.route("https://**/*", (route) => route.abort());
  await offline.goto(pathToFileURL(resolve(`${out}/offline.html`)).href);
  await offline.locator("#solution-title").waitFor();
  assert.equal(await offline.locator(".solution-nav a").count(), 7);
  assert(
    await offline
      .locator(".solution-hero-art img")
      .evaluate((n) => n.complete && n.naturalWidth > 0),
  );
  await offline.locator('.solution-nav a[href="#solution-budget"]').click();
  assert.equal(new URL(offline.url()).hash, "#solution-budget");
  const pdf = await offline.pdf({
    path: `${out}/offline.pdf`,
    format: "A4",
    printBackground: true,
  });
  assert(pdf.length > 10000);
  await offline.close();
  report.checks.push(
    "Downloaded HTML reads without network; chapter anchors work and browser PDF output is non-empty",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await f.locator(".case-toolbar").waitFor();
  for (const item of [print, download, close]) {
    assert(await item.isVisible());
    const bounds = await item.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  }
  await page.screenshot({ path: `${out}/mobile.png` });
  await download.focus();
  await page.keyboard.press("Tab");
  assert(await close.evaluate((n) => n === n.ownerDocument.activeElement));
  assert.notEqual(
    await close.evaluate((n) => getComputedStyle(n).outlineStyle),
    "none",
  );
  await close.press("Enter");
  assert.equal(
    await page
      .getByRole("dialog", { name: "完整设计方案", exact: true })
      .count(),
    0,
  );
  report.checks.push(
    "Mobile controls fit, keyboard focus is visible and Enter closes the reader",
  );
  assert.deepEqual(errors, []);
  console.log("PASS", report.checks);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
