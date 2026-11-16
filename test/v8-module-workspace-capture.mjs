import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const output = "test-results/v8-module-workspace/silver";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function waitForImages() {
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images, (img) => img.decode().catch(() => {})),
    );
  });
}
try {
  await page.goto("http://127.0.0.1:3108/v8");
  await page.getByRole("heading", { name: "登录工作空间" }).waitFor();
  await waitForImages();
  await page.screenshot({ path: `${output}/login.png`, fullPage: true });
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await page.getByRole("heading", { name: "让想法，连接起来。" }).waitFor();
  await waitForImages();
  await page.screenshot({ path: `${output}/workspace.png`, fullPage: true });
  await page
    .getByRole("button", { name: "加入Embodex模块", exact: true })
    .click();
  await page
    .getByRole("button", { name: "加入Simcore模块", exact: true })
    .click();
  await page.screenshot({ path: `${output}/combination.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${output}/workspace-mobile.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "登录工作空间" }).waitFor();
  await waitForImages();
  await page.screenshot({ path: `${output}/login-mobile.png`, fullPage: true });
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        errors,
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await ctx.close();
  await browser.close();
}
