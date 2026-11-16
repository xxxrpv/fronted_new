/** Visual evidence for the shared material on overlays and interactive controls. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { enterPreviewDesign } from "./v8-preview-browser.mjs";
const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local preview only");
const output = "test-results/v8-official-surfaces";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [],
  screens = [];
page.on("pageerror", (error) => errors.push(error.message));
async function shot(name) {
  await page.screenshot({
    path: `${output}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  screens.push({
    name,
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  });
}
async function loaded() {
  await page.locator('[data-model-loaded="true"]').first().waitFor();
}
try {
  await enterPreviewDesign(page, base);
  await page.locator(".ventry-options button").first().click();
  await page.getByRole("dialog", { name: "模板库", exact: true }).waitFor();
  await shot("01-catalog");
  await page.goto(
    `${base}/projects/demo-example-q4-inspection/library?template=sample-inspection`,
  );
  await loaded();
  const rail = page.getByRole("complementary", {
    name: "模型参数面板",
    exact: true,
  });
  await rail
    .getByLabel("搜索零件", { exact: true })
    .fill("inspection.camera-assembly");
  await rail.locator(".vpart-catalog button").first().click();
  await shot("02-part-details");
  await page.getByRole("button", { name: "拆解模型", exact: true }).click();
  const range = page.getByLabel("拆解程度", { exact: true });
  await range.focus();
  await range.press("Home");
  for (let i = 0; i < 40; i++) await range.press("ArrowRight");
  await shot("03-disassembly");
  await page.getByRole("button", { name: "查看感知外观", exact: true }).click();
  await shot("04-perception");
  await page.getByRole("button", { name: "设计助手", exact: true }).click();
  await page
    .getByRole("dialog", { name: "常驻设计助手", exact: true })
    .waitFor();
  await shot("05-assistant");
  await page.getByRole("button", { name: "收起设计助手", exact: true }).click();
  await page.goto(`${base}/projects/demo-example-q4-inspection/requirements`);
  await page
    .getByLabel("设计目标", { exact: true })
    .fill("用于检查未保存提示的需求");
  await page
    .getByRole("button", { name: "EmboMiX 工作空间", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "还有未保存的需求修改", exact: true })
    .waitFor();
  await shot("06-unsaved-confirmation");
  await page.goto(`${base}/projects/demo-example-q4-inspection/delivery`);
  await page.getByRole("button", { name: "在线查看", exact: true }).click();
  await loaded();
  await shot("07-artifact-model");
  await page.getByRole("button", { name: "关闭文件预览", exact: true }).click();
  await page.getByRole("button", { name: "查看文本", exact: true }).click();
  await page
    .getByRole("article", { name: "Markdown 方案正文", exact: true })
    .waitFor();
  await shot("08-artifact-text");
  await page.goto(base);
  await page
    .getByRole("heading", { name: "让想法，连接起来。", exact: true })
    .waitFor();
  await page
    .locator(".mx-sidebar")
    .getByRole("button", { name: "新建项目", exact: true })
    .click();
  await page.getByRole("dialog", { name: "新建项目", exact: true }).waitFor();
  await shot("09-workspace-dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("09-workspace-dialog-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "关闭新建项目", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page
    .getByRole("heading", { name: "登录工作空间", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      (document.querySelector(".mx-login-media video")?.readyState || 0) >= 2,
  );
  await shot("10-login-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("11-login-mobile");
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ screens, errors }, null, 2),
  );
  await context.close();
  await browser.close();
}
console.log(
  JSON.stringify({
    screens: screens.length,
    errors,
    overflow: screens.filter((s) => s.overflow),
  }),
);
if (errors.length || screens.some((s) => s.overflow)) process.exitCode = 1;
