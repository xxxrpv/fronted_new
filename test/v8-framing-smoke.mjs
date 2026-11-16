/** Focused real-browser check after camera framing changed; preserves the full 12-group report. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const bundled = 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright';
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); }
catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || bundled); }
const base = process.env.V8_PREVIEW_URL || 'http://127.0.0.1:3108/v8';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
assert.equal(new URL(base).pathname.replace(/\/$/, ''), '/v8');
const output = resolve('test-results/v8-e2e');
await mkdir(output, { recursive: true });
const report = { mode: 'local-development-preview', scope: 'targeted post-framing smoke; full 12-group report preserved', startedAt: new Date().toISOString(), cases: [], pageErrors: [], productionMutations: [] };
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.V8_BROWSER_CHANNEL || 'msedge', args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) report.productionMutations.push(`${request.method()} ${request.url()}`); });

/** Read the actual WebGL framebuffer, avoiding toolbar pixels overlaying the DOM canvas. */
async function modelPixelBounds() {
  return page.locator('[data-model-loaded="true"] canvas').first().evaluate(canvas => new Promise(resolve => requestAnimationFrame(() => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return resolve({ error: 'No WebGL context' });
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const bytes = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let count = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      // Opaque blue material samples: grid/background are lighter than this threshold.
      if (bytes[index + 3] > 200 && bytes[index] < 180 && bytes[index + 2] > bytes[index] + 12) {
        const imageY = height - y - 1;
        count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, imageY); maxY = Math.max(maxY, imageY);
      }
    }
    resolve({ width, height, count, minX, maxX, minY, maxY, ratios: { left: minX / width, right: (width - maxX - 1) / width, top: minY / height, bottom: (height - maxY - 1) / height } });
  })));
}

try {
  await page.goto(base);
  await page.getByRole('heading', { name: '今天，想设计什么？' }).waitFor();
  await page.getByLabel('描述你的设计目标').fill('四足巡检平台：拆解构图回归');
  await page.locator('main').getByRole('button', { name: '开始设计', exact: true }).click();
  await page.waitForURL(/\/requirements$/);
  await page.getByRole('button', { name: '保存需求，选择路线', exact: true }).click();
  await page.getByRole('button', { name: '浏览样例资源', exact: true }).click();
  await page.locator('[data-model-loaded="true"]').first().waitFor();
  const host = page.locator('[data-model-loaded="true"]').first();
  assert.equal(Number(await host.getAttribute('data-assembly-count')), 7);
  assert.equal(Number(await host.getAttribute('data-mesh-count')), 27);
  for (const [name, viewport, fileName] of [
    ['desktop', { width: 1440, height: 1000 }, '14-template-parts-exploded.png'],
    ['mobile', { width: 390, height: 844 }, '16-mobile-parts-exploded.png'],
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '拆解模型', exact: true }).click();
    const slider = page.getByLabel('拆解程度', { exact: true });
    await slider.focus();
    await slider.press('End');
    await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === 1);
    await delay(300);
    const pixels = await modelPixelBounds();
    assert.equal(pixels.error, undefined);
    assert(pixels.count > 150, 'actual blue model geometry must render');
    for (const [side, margin] of Object.entries(pixels.ratios)) assert(margin > .025, `${name} model touches ${side} viewport edge: ${JSON.stringify(pixels)}`);
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(overflow.scroll <= overflow.width + 1);
    await page.evaluate(() => { window.scrollTo(0, 0); const body = document.querySelector('.vbody'); if (body) body.scrollTop = 0; });
    await page.screenshot({ path: join(output, fileName), fullPage: true });
    await page.locator('[data-model-loaded="true"] canvas').first().screenshot({ path: join(output, `${name}-exploded-canvas.png`) });
    await page.getByRole('button', { name: '还原整机', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === 0);
    report.cases.push({ name: `${name} maximum explosion fits actual framebuffer with margins and restores`, status: 'passed', viewport, pixels });
    console.log(`PASS ${name} 100% explode framing and restore`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await delay(200);
  await page.screenshot({ path: join(output, '14-template-parts-assembled.png'), fullPage: true });
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.productionMutations.length, 0);
} catch (error) {
  report.cases.push({ name: 'framing smoke', status: 'failed', error: error.stack || String(error) });
  process.exitCode = 1;
  console.error(error.message);
  await page.screenshot({ path: join(output, 'framing-smoke-failure.png'), fullPage: true }).catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.cases.filter(item => item.status === 'passed').length, failed: report.cases.filter(item => item.status === 'failed').length };
  await writeFile(join(output, 'framing-smoke.json'), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  console.log(JSON.stringify(report.summary));
}
