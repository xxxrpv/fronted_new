import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = "test-results/portal-blueglass";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await ctx.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const original = DataTransfer.prototype.setDragImage;
  DataTransfer.prototype.setDragImage = function (element, x, y) {
    const canvas = element.querySelector("canvas");
    const pixels = canvas
      ?.getContext("2d")
      ?.getImageData(0, 0, canvas.width, canvas.height).data;
    window.__moduleDrag = {
      fullCard: element.classList.contains("mx-module"),
      title: element.querySelector("h2")?.textContent,
      hasPixels: pixels && Array.from(pixels).some((value) => value > 0),
    };
    return original.call(this, element, x, y);
  };
});
try {
  await page.goto("http://127.0.0.1:3108/v8");
  await page.getByRole("heading", { name: "登录工作空间" }).waitFor();
  await page.screenshot({ path: out + "/login.png", fullPage: true });
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await page.getByRole("heading", { name: "让想法，连接起来。" }).waitFor();
  await page
    .locator('[data-dynamic-module="deployx"][data-preview-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page
    .locator('[data-dynamic-module="embodex"][data-preview-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page
    .locator('[data-dynamic-module="simcore"][data-preview-ready="true"]')
    .waitFor({ timeout: 60000 });
  await page.screenshot({ path: out + "/workspace.png", fullPage: true });
  for (const module of ["embodex", "simcore", "deployx"]) {
    const canvas = page.locator(`[data-dynamic-module="${module}"] canvas`);
    const first = await canvas.screenshot();
    await page.waitForTimeout(900);
    const second = await canvas.screenshot();
    assert(!first.equals(second), `${module} must animate`);
  }
  await page
    .locator(".mx-embodex .mx-module-image")
    .dragTo(page.getByRole("region", { name: "模块组合", exact: true }));
  await page
    .getByRole("button", { name: "移除Embodex模块", exact: true })
    .waitFor();
  const drag = await page.evaluate(() => window.__moduleDrag);
  assert.deepEqual(drag, { fullCard: true, title: "Embodex", hasPixels: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: out + "/workspace-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "登录工作空间" }).waitFor();
  await page.screenshot({ path: out + "/login-mobile.png", fullPage: true });
  await writeFile(
    out + "/report.json",
    JSON.stringify(
      {
        errors,
        animated: true,
        drag,
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      },
      null,
      2,
    ),
  );
  assert.equal(errors.length, 0);
  console.log("PASSED dynamic canvas, full-card drag, login + mobile");
} finally {
  await ctx.close();
  await browser.close();
}
