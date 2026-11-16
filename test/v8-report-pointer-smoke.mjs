import assert from "node:assert/strict";
import { chromium } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const output = resolve("test-results/v8-report-pointer");
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
page.setDefaultTimeout(20000);
const result = { startedAt: new Date().toISOString(), passed: false };
try {
  await page.goto(
    "http://127.0.0.1:3108/v8/projects/demo-example-q4-inspection/delivery",
  );
  await page.getByRole("heading", { name: "设计成果", exact: true }).waitFor();
  await page.getByRole("button", { name: "查看完整方案", exact: true }).click();
  const iframe = page
    .getByRole("dialog", { name: "完整设计方案", exact: true })
    .locator("iframe");
  const frame = iframe.contentFrame();
  await frame.locator('.chapters a[href="#interactive"]').click();
  const model = frame.locator(
    '#report-interactive-host [data-model-loaded="true"]',
  );
  await model.waitFor();
  await delay(250);
  const local = await model.evaluate((el) => {
      const r = el.querySelector("canvas").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
    outer = await iframe.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + el.clientLeft, y: r.y + el.clientTop };
    }),
    b = { ...local, x: local.x + outer.x, y: local.y + outer.y };
  result.before = await model.getAttribute("data-camera-position");
  const before = await page.screenshot({ path: join(output, "before.png") });
  console.log("ready");
  await page.mouse.move(b.x + b.width * 0.52, b.y + b.height * 0.45);
  await page.mouse.down();
  console.log("down");
  const move = page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.39, {
    steps: 1,
  });
  await delay(120);
  console.log("sending up before waiting for coalesced move acknowledgement");
  await Promise.race([
    page.mouse.up(),
    delay(5000).then(() => {
      throw Error("mouseup acknowledgement timeout");
    }),
  ]);
  result.moveAcknowledged = await Promise.race([
    move.then(() => true),
    delay(1000).then(() => false),
  ]);
  console.log(
    `native sequence delivered; move acknowledged=${result.moveAcknowledged}`,
  );
  await delay(300);
  result.after = await model.getAttribute("data-camera-position");
  const after = await page.screenshot({ path: join(output, "after.png") });
  assert.notEqual(result.after, result.before);
  assert.notDeepEqual(after, before);
  result.passed = true;
  console.log(
    "PASS real camera and composite changed after native pointer sequence",
  );
} catch (e) {
  result.error = e.stack || String(e);
  console.error(result.error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(join(output, "report.json"), JSON.stringify(result, null, 2));
  await context.close();
  await browser.close();
}
