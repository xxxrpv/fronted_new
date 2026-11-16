/** Real browser checks for the development-only EmboMiX entry and module workspace. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.V8_PREVIEW_URL || "http://127.0.0.1:3108/v8";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = resolve("test-results/v8-module-workspace");
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
page.setDefaultTimeout(20000);
const report = {
  startedAt: new Date().toISOString(),
  cases: [],
  pageErrors: [],
  productionRequests: [],
};
page.on("pageerror", (error) => report.pageErrors.push(error.message));
page.on("request", (request) => {
  if (new URL(request.url()).pathname.startsWith("/api/v1/"))
    report.productionRequests.push(`${request.method()} ${request.url()}`);
});
const projectList = () =>
  page.getByRole("navigation", { name: "项目列表", exact: true });
const projectNames = () =>
  projectList().locator(".mx-project strong").allTextContents();
const moduleLabels = () =>
  projectList().locator(".mx-project").evaluateAll(nodes => nodes.map(n => n.dataset.projectModules.split("+").map(m=>({embodex:"Embodex",simcore:"Simcore",deployx:"Deployx"})[m]).join(" + ")));
const portal = () =>
  page
    .getByRole("heading", { name: "让想法，连接起来。", exact: true })
    .waitFor();
const snapshot = () =>
  page.evaluate(() => ({
    designs: localStorage.getItem("embodex-v8-preview-v1"),
    workspace: localStorage.getItem("embomix-v8-workspace-projects"),
  }));
async function login() {
  await page.getByLabel("账户", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).fill("123");
  await page.getByLabel("密码", { exact: true }).press("Enter");
  await portal();
  await page.locator(".mx-project").first().waitFor();
}
async function chooseAll() {
  await page.getByRole("button", { name: /^全部项目/ }).click();
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "page must fit viewport without horizontal overflow",
  );
}
async function shot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function run(name, fn) {
  try {
    await fn();
    report.cases.push({ name, status: "passed" });
    console.log("PASS", name);
  } catch (error) {
    report.cases.push({ name, status: "failed", error: error.stack });
    console.error("FAIL", name, error.message);
    await shot(`failure-${report.cases.length}`).catch(() => {});
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
let originalCount, createdName, createdDesignId;
try {
  await run(
    "123 / 123 login validates credentials and opens the EmboMiX workspace, with no platform requests",
    async () => {
      await page.goto(base);
      await page.waitForURL(/\/v8\/login$/);
      await page
        .getByRole("heading", { name: "登录工作空间", exact: true })
        .waitFor();
      await shot("01-login-desktop");
      await page.getByLabel("账户", { exact: true }).fill("123");
      await page.getByLabel("密码", { exact: true }).fill("wrong");
      await page
        .getByRole("button", { name: "进入工作空间", exact: true })
        .click();
      assert.match(await page.locator("#mx-login-error").innerText(), /账户|密码/);
      assert.match(page.url(), /\/login$/);
      await login();
      assert.equal(await page.locator("article.mx-module").count(), 3);
      assert.deepEqual(
        await page.locator("article.mx-module h2").allTextContents(),
        ["Embodex", "Simcore", "Deployx"],
      );
      assert.equal(
        await page.getByLabel("描述你的设计目标", { exact: true }).count(),
        0,
      );
      originalCount = (await projectNames()).length;
      assert(originalCount >= 6);
      await noOverflow();
      await shot("02-workspace-desktop");
    },
  );
  await run(
    "Single-module and combination filters show exactly matching projects and survive refresh",
    async () => {
      await page
        .getByRole("button", { name: "进入 Simcore", exact: true })
        .click();
      await page.waitForURL(/\/simcore$/);
      await page.getByRole("heading",{name:"场景库",exact:true}).waitFor();
      assert.equal(await page.getByLabel("仿真项目").locator("option:not([disabled])").count(),1);
      await page.getByRole("button",{name:"返回工作空间",exact:true}).click();
      await portal();
      assert.deepEqual(await moduleLabels(), ["Simcore"]);
      await page
        .getByRole("button", { name: "查看 Deployx 项目", exact: true })
        .click();
      assert.deepEqual(await moduleLabels(), ["Deployx"]);
      await page
        .getByRole("button", { name: "加入Embodex模块", exact: true })
        .click();
      assert.deepEqual(await moduleLabels(), ["Embodex + Deployx"]);
      await page
        .getByRole("button", { name: "加入Simcore模块", exact: true })
        .click();
      assert.deepEqual(await moduleLabels(), ["Embodex + Simcore + Deployx"]);
      await page
        .getByRole("button", { name: "移除Embodex模块", exact: true })
        .click();
      assert.deepEqual(await moduleLabels(), ["Simcore + Deployx"]);
      const before = await projectNames();
      await page.reload();
      await portal();
      await page.locator(".mx-project").first().waitFor();
      assert.deepEqual(await moduleLabels(), ["Simcore + Deployx"]);
      assert.deepEqual(await projectNames(), before);
      assert.equal(
        await page
          .getByRole("button", { name: "移除Simcore模块", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await shot("03-combination-desktop");
      await chooseAll();
      assert.equal((await projectNames()).length, originalCount);
      await page
        .getByLabel("搜索工作空间项目", { exact: true })
        .fill("不存在的项目-unmatched-9182");
      await page.getByText("未找到项目", { exact: true }).waitFor();
      assert.equal((await projectNames()).length, 0);
      await page.getByLabel("搜索工作空间项目", { exact: true }).fill("");
    },
  );
  await run(
    "A composed project creates one actual design and returns to its original module workspace",
    async () => {
      await chooseAll();
      await page
        .getByRole("button", { name: "加入Embodex模块", exact: true })
        .click();
      await page
        .getByRole("button", { name: "加入Simcore模块", exact: true })
        .click();
      await page
        .getByRole("button", { name: "新建组合项目", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新建项目",
        exact: true,
      });
      await dialog.waitFor();
      createdName = "巡检平台组合验证 QA";
      await dialog.getByLabel("项目名称", { exact: true }).fill(createdName);
      await dialog
        .getByRole("button", { name: "创建项目", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert((await projectNames()).includes(createdName));
      assert(
        (await moduleLabels()).every((label) => label === "Embodex + Simcore"),
      );
      await page
        .getByRole("region", { name: "项目概览", exact: true })
        .getByRole("button", { name: "开始设计", exact: true })
        .click();
      await page.waitForURL(/\/v8\/projects\/[^/]+\/requirements$/);
      createdDesignId = page.url().match(/\/projects\/([^/]+)\//)[1];
      await page
        .getByRole("heading", { name: "让设计目标更清晰", exact: true })
        .waitFor();
      const designs = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("embodex-v8-preview-v1")).projects,
      );
      assert.equal(designs.filter((p) => p.id === createdDesignId).length, 1);
      assert.equal(
        designs.find((p) => p.id === createdDesignId).requirements[0].text,
        createdName,
      );
      const before = await snapshot();
      await page
        .getByRole("button", { name: "EmboMiX 工作空间", exact: true })
        .click();
      await portal();
      assert(
        (await moduleLabels()).every((label) => label === "Embodex + Simcore"),
      );
      assert((await projectNames()).includes(createdName));
      assert.deepEqual(await snapshot(), before);
      await shot("04-created-combination-desktop");
    },
  );
  await run(
    "Standalone Embodex keeps an uppercase brand and lists only its own projects",
    async () => {
      await page
        .getByRole("button", { name: "进入 Embodex", exact: true })
        .click();
      await page.waitForURL(/\/v8\/embodex$/);
      await page
        .getByRole("heading", { name: "今天，想设计什么？", exact: true })
        .waitFor();
      assert.match(await page.locator(".vbrand").innerText(), /^Embodex/);
      const standalone = await page
        .locator(".vsidebar .project-nav")
        .allTextContents();
      assert(
        !standalone.join("\n").includes(createdName),
        "combined projects must not leak into the standalone module",
      );
      assert.equal(await page.locator(".vsidebar .project-nav").count(), 3);
      await noOverflow();
      await shot("05-embodex-desktop");
      await page
        .getByRole("button", { name: "EmboMiX 工作空间", exact: true })
        .click();
      await portal();
    },
  );
  await run(
    "Opening a design from all projects restores the exact search and project selection, including after reload",
    async () => {
      await chooseAll();
      const search = page.getByLabel("搜索工作空间项目", { exact: true });
      await search.fill("仓储巡检");
      const before = await snapshot();
      const names = await projectNames();
      await projectList()
        .getByRole("button", { name: /仓储巡检/ })
        .click();
      await page.waitForURL(/\/v8\/projects\/demo-example-q4-inspection\//);
      await page
        .getByRole("button", { name: "EmboMiX 工作空间", exact: true })
        .click();
      await portal();
      assert.equal(await search.inputValue(), "仓储巡检");
      assert.deepEqual(await projectNames(), names);
      assert.equal(await page.locator(".mx-module.selected").count(), 0);
      assert.match(
        await projectList().locator(".mx-project.active").innerText(),
        /仓储巡检/,
      );
      await page.reload();
      await portal();
      await page.locator(".mx-project.active").waitFor();
      assert.equal(await search.inputValue(), "仓储巡检");
      assert.deepEqual(await snapshot(), before);
      await page
        .getByRole("button", { name: "清空项目搜索", exact: true })
        .click();
    },
  );
  await run(
    "Project creation requires explicit modules and cancellation leaves project facts untouched",
    async () => {
      await chooseAll();
      const before = await snapshot();
      await page
        .locator(".mx-sidebar")
        .getByRole("button", { name: "新建项目", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新建项目",
        exact: true,
      });
      await dialog.getByLabel("项目名称", { exact: true }).fill("未创建的项目");
      const bounds = await dialog.boundingBox();
      assert(
        Math.abs(bounds.x + bounds.width / 2 - 720) < 2,
        "project dialog must be horizontally centered",
      );
      assert(
        Math.abs(bounds.y + bounds.height / 2 - 500) < 2,
        "project dialog must be vertically centered",
      );
      await page.mouse.click(bounds.x + 10, bounds.y + bounds.height - 10);
      assert(
        await dialog.isVisible(),
        "clicking the dialog padding must not close it",
      );
      assert.equal(
        await dialog
          .getByRole("button", { name: "创建项目", exact: true })
          .isDisabled(),
        true,
      );
      await dialog
        .getByRole("button", { name: "Simcore", exact: true })
        .click();
      assert.equal(
        await dialog
          .getByRole("button", { name: "创建项目", exact: true })
          .isEnabled(),
        true,
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(await snapshot(), before);
    },
  );
  await run(
    "Dragging modules builds a canonical composition without duplicates; removing a node updates exact project filtering",
    async () => {
      await chooseAll();
      const before = await snapshot();
      const target = page.getByRole("region", {
        name: "模块组合",
        exact: true,
      });
      await page.locator(".mx-deployx .mx-module-surface").dragTo(target);
      await page.locator(".mx-embodex .mx-module-surface").dragTo(target);
      assert.deepEqual(await moduleLabels(), ["Embodex + Deployx"]);
      await page.locator(".mx-embodex .mx-module-surface").dragTo(target);
      assert.equal(await target.locator(".mx-node").count(), 2);
      assert.match(
        await target.locator(".mx-node").first().innerText(),
        /Embodex/,
      );
      await page
        .getByRole("button", { name: "从工作流移除Deployx", exact: true })
        .click();
      assert((await moduleLabels()).every((x) => x === "Embodex"));
      assert.deepEqual(await snapshot(), before);
      await chooseAll();
    },
  );
  await run(
    "Entering a combined project from all projects preserves module ownership through new design, reload, and return",
    async () => {
      await chooseAll();
      const search = page.getByLabel("搜索工作空间项目", { exact: true });
      await search.fill(createdName);
      await projectList()
        .getByRole("button", { name: new RegExp(createdName) })
        .click();
      await page
        .getByRole("region", { name: "项目概览", exact: true })
        .getByRole("button", { name: "继续设计", exact: true })
        .click();
      await page.waitForURL(/\/v8\/projects\/[^/]+\/requirements$/);
      await page
        .getByRole("button", { name: "新建设计项目", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "今天，想设计什么？", exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole("heading", { name: "今天，想设计什么？", exact: true })
        .waitFor();
      assert.match(
        await page.locator(".vsidebar").innerText(),
        /Embodex \+ Simcore/,
      );
      await page.locator(".vprompt textarea").fill("组合内新增的巡检设计 QA");
      await page
        .locator(".vprompt")
        .getByRole("button", { name: "开始设计", exact: true })
        .click();
      await page.waitForURL(/\/v8\/projects\/[^/]+\/requirements$/);
      const newId = page.url().match(/\/projects\/([^/]+)\//)[1];
      assert.notEqual(newId, createdDesignId);
      const locals = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("embomix-v8-workspace-projects")),
      );
      assert.deepEqual(
        locals.find((x) => x.embodexProjectId === newId).modules,
        ["embodex", "simcore"],
      );
      await page
        .getByRole("button", { name: "EmboMiX 工作空间", exact: true })
        .click();
      await portal();
      assert.equal(await search.inputValue(), createdName);
      assert.equal(await page.locator(".mx-module.selected").count(), 0);
      assert.match(
        await page
          .getByRole("region", { name: "项目概览", exact: true })
          .innerText(),
        new RegExp(createdName),
      );
      await page
        .getByRole("button", { name: "清空项目搜索", exact: true })
        .click();
    },
  );
  await run(
    "Logout removes only preview access; direct project links stay gated and saved projects survive relogin",
    async () => {
      const before = await snapshot();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.waitForURL(/\/v8\/login$/);
      assert.deepEqual(await snapshot(), before);
      await page.goto(`${base}/projects/${createdDesignId}/requirements`);
      await page.waitForURL(/\/v8\/login$/);
      assert.equal(
        await page.getByLabel("设计目标", { exact: true }).count(),
        0,
      );
      await login();
      await chooseAll();
      assert((await projectNames()).includes(createdName));
      assert.deepEqual(await snapshot(), before);
    },
  );
  await run(
    "Mobile login and three-module composition remain readable without horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.waitForURL(/\/v8\/login$/);
      await noOverflow();
      await shot("06-login-mobile");
      await login();
      await chooseAll();
      await noOverflow();
      await shot("07-workspace-mobile");
      for (const module of ["Embodex", "Simcore", "Deployx"])
        await page
          .getByRole("button", { name: `加入${module}模块`, exact: true })
          .click();
      assert(
        (await moduleLabels()).every(
          (label) => label === "Embodex + Simcore + Deployx",
        ),
      );
      await noOverflow();
      await shot("08-combination-mobile");
      assert.equal(report.pageErrors.length, 0);
      assert.equal(report.productionRequests.length, 0);
    },
  );
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.cases.filter((item) => item.status === "passed").length,
    failed: report.cases.filter((item) => item.status === "failed").length,
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
console.log(JSON.stringify(report.summary));
if (
  report.summary.failed ||
  report.pageErrors.length ||
  report.productionRequests.length
)
  process.exitCode = 1;
