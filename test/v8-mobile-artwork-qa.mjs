import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const output = "test-results/v8-mobile-artwork";
await mkdir(output, { recursive: true });
const bytes = await readFile("public/v8-assets/cinematic/mobile-amr.glb");
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const gltf = JSON.parse(
  bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
);
for (const name of [
  "mobile_drive_left",
  "mobile_drive_right",
  "mobile_caster_0",
  "mobile_caster_3",
  "front_navigation_and_safety",
  "battery_and_service_interfaces",
  "emergency_stop_mushroom",
])
  assert(
    gltf.nodes.some((node) => node.name === name),
    name,
  );
assert.equal(gltf.extras.engineeringValidated, false);
for (const view of gltf.bufferViews)
  assert(view.byteOffset + view.byteLength <= gltf.buffers[0].byteLength);
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = {
  asset: {
    bytes: bytes.length,
    nodes: gltf.nodes.length,
    materials: gltf.materials.length,
  },
  scenes: [],
  errors: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
const requested = [];
page.on("response", (r) => {
  if (r.url().includes("mobile-amr.glb")) requested.push(r.status());
});
try {
  await page.goto("http://127.0.0.1:3108/v8/login");
  await page
    .locator('[data-dynamic-module="journey"][data-preview-ready="true"]')
    .waitFor({ timeout: 60000 });
  assert.deepEqual(requested, [200]);
  for (const [chapter, phase, file] of [
    ["机器人设计", "材质与细节", "design"],
    ["场景仿真", "运动仿真", "simulation"],
    ["真机部署", "执行任务", "deployment"],
  ]) {
    const play = page.getByRole("button", {
      name: "播放动态演示",
      exact: true,
    });
    if (await play.isVisible()) await play.click();
    await page.getByRole("button", { name: chapter, exact: true }).click();
    const scene = page.locator(
      `[data-dynamic-module="journey"][data-scene="mobile"][data-phase="${phase}"]`,
    );
    await scene.waitFor({ timeout: 60000 });
    const canvas = scene.locator("canvas");
    const a = await canvas.screenshot();
    await page.waitForTimeout(350);
    const b = await canvas.screenshot();
    assert(!a.equals(b), `${chapter} is rendered animation`);
    await page
      .getByRole("button", { name: "暂停动态演示", exact: true })
      .click();
    await page.screenshot({
      path: `${output}/login-mobile-${file}.png`,
      fullPage: true,
    });
    report.scenes.push({ chapter, phase, passed: true });
    console.log("PASS", chapter, "new articulated mobile asset and animation");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: `${output}/mobile-viewport.png`,
    fullPage: true,
  });
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
