import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const out = "test-results/v8-auth-journey";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
const report = { cases: [], errors: [], remoteMutations: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET" && r.url().includes("/api/v1/"))
    report.remoteMutations.push(r.url());
});
const home = () =>
  page
    .getByRole("heading", { name: "让想法，连接起来。", exact: true })
    .waitFor();
const phone = "13800001357",
  oldPassword = "Sample-robot-123",
  newPassword = "Sample-robot-456";
async function challenge() {
  await page.getByLabel("手机号码", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await page.getByText("本地验证码：123456", { exact: true }).waitFor();
  await page.getByLabel("短信验证码", { exact: true }).fill("123456");
}
async function logout() {
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.waitForURL(/\/login$/);
}
try {
  await page.goto("http://127.0.0.1:3108/login");
  await page.waitForURL(/\/v8\/login$/);
  await page
    .locator('[data-dynamic-module="journey"][data-preview-ready="true"]')
    .waitFor();
  for (const name of ["需求输入", "机器人设计", "场景仿真", "真机部署"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(name === "机器人设计" ? 2600 : 1400);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  const surfaces = await page
    .locator(
      ".mx-login-media,.mx-login-media>.mx-art,.mx-three-host,.mx-journey-prompt",
    )
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const s = getComputedStyle(n);
        return {
          background: s.backgroundColor,
          border: s.borderTopWidth,
          shadow: s.boxShadow,
        };
      }),
    );
  assert(
    surfaces.every(
      (s) =>
        s.background === "rgba(0, 0, 0, 0)" &&
        s.border === "0px" &&
        s.shadow === "none",
    ),
  );
  assert.equal(
    await page
      .locator(".mx-login")
      .evaluate((n) => getComputedStyle(n).backgroundColor),
    "rgb(242, 246, 251)",
  );
  report.cases.push({
    name: "Transparent frameless sign-in journey, pale-blue page and four animated chapters",
    passed: true,
    surfaces,
  });
  await page.getByRole("button", { name: "注册账户", exact: true }).click();
  await challenge();
  await page.getByLabel("密码", { exact: true }).fill(oldPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(oldPassword);
  await page.getByLabel("我已阅读并同意", { exact: true }).check();
  await page.getByRole("button", { name: "注册并进入", exact: true }).click();
  await home();
  const accounts = await page.evaluate(() =>
    localStorage.getItem("embomix-v8-preview-accounts-v1"),
  );
  assert(!accounts.includes(oldPassword));
  report.cases.push({
    name: "Registration creates an isolated local account and no plaintext password",
    passed: true,
  });
  await logout();
  await page.getByRole("tab", { name: "短信登录", exact: true }).click();
  await challenge();
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await home();
  report.cases.push({
    name: "SMS demo challenge logs in the registered account",
    passed: true,
  });
  await logout();
  await page.getByRole("button", { name: "忘记密码", exact: true }).click();
  await challenge();
  await page.getByLabel("新密码", { exact: true }).fill(newPassword);
  await page.getByLabel("确认密码", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "更新密码", exact: true }).click();
  await page.getByText("密码已更新，请重新登录。", { exact: true }).waitFor();
  await page.getByLabel("账户", { exact: true }).fill(phone);
  await page.getByLabel("密码", { exact: true }).fill(oldPassword);
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await page.locator("#mx-login-error").waitFor();
  await page.getByLabel("密码", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
  await home();
  report.cases.push({
    name: "Password recovery invalidates the former password and accepts the replacement",
    passed: true,
  });
  await logout();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/mobile-login.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(report.errors.length, 0);
  assert.equal(report.remoteMutations.length, 0);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
console.log(JSON.stringify(report));
