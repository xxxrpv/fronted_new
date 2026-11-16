/** Real detailed-model/Glass/assistant browser checks and honest GLB-rendered thumbnails. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const bundled = 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules';
let playwright, PNG;
try { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); } catch { playwright = require(join(bundled, 'playwright')); }
try { ({ PNG } = require('pngjs')); } catch { ({ PNG } = require(join(bundled, 'pngjs'))); }
const base = process.env.V8_PREVIEW_URL || 'http://127.0.0.1:3108/v8';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
assert.equal(new URL(base).pathname.replace(/\/$/, ''), '/v8');
const output = resolve('test-results/v8-detailed');
const assets = resolve('public/v8-assets');
await mkdir(output, { recursive: true });
const report = { mode: 'isolated-development-preview', startedAt: new Date().toISOString(), cases: [], pageErrors: [], productionMutations: [], thumbnails: [] };
const browser = await playwright.chromium.launch({ channel: process.env.V8_BROWSER_CHANNEL || 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/v1/')) report.productionMutations.push(`${request.method()} ${request.url()}`); });
let projectId;
async function shot(name) { await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
async function run(name, action) {
  try { const evidence = await action(); report.cases.push({ name, status: 'passed', evidence }); console.log(`PASS ${name}`); }
  catch (error) { report.cases.push({ name, status: 'failed', error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`); await shot(`failure-${report.cases.length}`).catch(() => {}); }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
async function facts() { return page.evaluate(id => JSON.parse(localStorage.getItem('embodex-v8-preview-v1')).projects.find(p => p.id === id), projectId); }
async function mode(value) { await page.waitForFunction(mode => document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-inspection-mode') === mode, value); }
async function closeAssistant() { const button = page.getByRole('button', { name: '收起设计助手', exact: true }); if (await button.count()) await button.click(); }
async function closeParameters() { const button = page.getByRole('button', { name: '关闭面板', exact: true }); if (await button.count()) await button.click(); }
async function send(text) {
  if (!(await page.getByRole('dialog', { name: '常驻设计助手', exact: true }).count())) await page.getByRole('button', { name: '设计助手' }).click();
  const log = page.locator('.vassistant-messages');
  const previous = await log.locator('.assistant').count();
  await page.getByRole('textbox', { name: '与设计助手交流', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送设计助手消息', exact: true }).click();
  await page.waitForFunction(count => document.querySelectorAll('.vassistant-messages .assistant').length > count, previous);
  return log.locator('.assistant').last().innerText();
}
async function renderThumbnail(key) {
  const framebuffer = await page.locator('[data-model-loaded="true"] canvas').first().evaluate(canvas => new Promise(resolve => requestAnimationFrame(() => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let binary = '';
    for (let offset = 0; offset < pixels.length; offset += 16384) binary += String.fromCharCode(...pixels.subarray(offset, offset + 16384));
    resolve({ width, height, pixels: btoa(binary) });
  })));
  const bottomUp = Buffer.from(framebuffer.pixels, 'base64'), pixels = Buffer.alloc(bottomUp.length), row = framebuffer.width * 4;
  for (let y = 0; y < framebuffer.height; y++) bottomUp.copy(pixels, y * row, (framebuffer.height - y - 1) * row, (framebuffer.height - y) * row);
  assert(pixels.some((value, i) => i % 4 !== 3 && value > 10), 'renderer returned empty framebuffer');
  const data = PNG.sync.write({ width: framebuffer.width, height: framebuffer.height, data: pixels });
  await writeFile(join(assets, `${key}.png`), data);
  await writeFile(join(output, `${key}-actual-glb.png`), data);
  report.thumbnails.push({ fileName: `${key}.png`, source: 'actual GLB WebGL framebuffer; no DOM controls, no stock photograph', width: framebuffer.width, height: framebuffer.height, bytes: data.length });
}

try {
  await page.goto(base);
  await page.getByRole('heading', { name: '今天，想设计什么？' }).waitFor();
  await page.getByLabel('描述你的设计目标').fill('精细参考模型、结构检查与对话工具回归');
  await page.locator('main').getByRole('button', { name: '开始设计', exact: true }).click();
  await page.waitForURL(/\/requirements$/);
  projectId = page.url().match(/\/projects\/([^/]+)/)[1];
  await page.getByRole('button', { name: '保存需求，选择路线', exact: true }).click();
  await page.getByRole('button', { name: /浏览.*资源/ }).click();

  const cases = [
    { key: 'go2-high-fidelity', label: 'Go2 · 精细结构参考', kind: 'licensed-original-mesh-conversion', part: 'FL_hip.hip_0', offset: null },
    { key: 'inspection-reference', label: 'Q4 · 精细巡检构型', kind: 'licensed-concept-reference', part: 'inspection.camera-assembly', offset: 'inspection.camera-assembly' },
    { key: 'mobile-reference', label: 'C2 · 精细移动平台', kind: 'supplied-concept-reference', part: 'dock-camera', offset: 'dock-camera' },
  ];
  for (const item of cases) await run(`${item.key}: real source, whole/explode/perception/focus, chat and responsive`, async () => {
    await closeAssistant();
    await closeParameters();
    const metadata = JSON.parse(await readFile(join(assets, `${item.key}.json`), 'utf8'));
    const bytes = await readFile(join(assets, `${item.key}.glb`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { window.scrollTo(0, 0); const body = document.querySelector('.vbody'); if (body) body.scrollTop = 0; });
    await page.locator('.vtemplate-picker button').filter({ hasText: item.label }).click();
    await page.waitForFunction(kind => document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-source-kind') === kind, item.kind);
    const host = page.locator('[data-model-loaded="true"]').first();
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const expectedParts = json.nodes.filter(node => node.extras?.explodable === true).length;
    const expectedMeshes = json.nodes.filter(node => Number.isInteger(node.mesh)).reduce((sum, node) => sum + json.meshes[node.mesh].primitives.length, 0);
    assert.equal(Number(await host.getAttribute('data-assembly-count')), expectedParts);
    assert.equal(Number(await host.getAttribute('data-mesh-count')), expectedMeshes);
    await delay(300);
    await renderThumbnail(item.key);
    await shot(`${item.key}-whole`);
    const before = await facts();
    const taskCount = before.tasks.length;

    await page.getByRole('button', { name: '查看感知外观', exact: true }).click();
    await mode('perception');
    await shot(`${item.key}-perception`);
    await page.getByRole('button', { name: '还原整机', exact: true }).click();
    await mode('whole');
    await page.getByLabel('选择模型组件', { exact: true }).selectOption(item.part);
    const parameterPanel = page.getByRole('button', { name: '关闭面板', exact: true });
    if (await parameterPanel.count()) await parameterPanel.click();
    await page.getByRole('button', { name: '聚焦选中部件', exact: true }).click();
    await mode('part');
    await shot(`${item.key}-actual-part`);
    await page.getByRole('button', { name: '显示全部部件', exact: true }).click();
    await mode('whole');
    const closePart = page.getByRole('button', { name: '关闭部件信息', exact: true });
    if (await closePart.count()) await closePart.click();
    await page.getByRole('button', { name: '拆解模型', exact: true }).click();
    const range = page.getByLabel('拆解程度', { exact: true });
    await range.focus(); await range.press('End');
    await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === 1);
    await shot(`${item.key}-exploded`);
    await page.getByRole('button', { name: '还原整机', exact: true }).click();
    await mode('whole');

    assert.match(await send('拆解到70%'), /已执行|70|拆解/);
    await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === .7);
    await send('还原整机');
    await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === 0);
    await send('查看感知结构'); await mode('perception');
    await send('还原整机'); await mode('whole');
    let adjustment;
    if (item.offset) {
      const reply = await send(`将${item.offset}抬高25毫米`);
      assert.match(reply, /已执行/);
      const result = await host.evaluate(el => ({ part: el.dataset.adjustedPart, before: el.dataset.partWorldBefore?.split(',').map(Number), after: el.dataset.partWorldAfter?.split(',').map(Number) }));
      assert.equal(result.part, item.offset);
      assert(Math.abs(result.after[1] - result.before[1] - .025) < 1e-7, 'chat must move the real rendered parent group by 25 mm in world Y');
      adjustment = result;
    } else {
      const reply = await send(`将${item.part}抬高25毫米`);
      assert.match(reply, /没有开放|不支持|不会更改/);
      assert.equal(await host.getAttribute('data-adjusted-part'), null, 'original OEM visual mesh must reject unsupported movement');
    }
    assert.equal((await facts()).tasks.length, taskCount, 'viewer dialogue must not start CAD/refinement tasks');
    assert.equal(createHash('sha256').update(await readFile(join(assets, `${item.key}.glb`))).digest('hex'), metadata.sha256, 'view transforms must not overwrite source assets');
    await shot(`${item.key}-assistant-real-action`);
    await closeAssistant();
    await closeParameters();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '拆解模型', exact: true }).click();
    await page.getByLabel('拆解程度', { exact: true }).focus();
    await page.getByLabel('拆解程度', { exact: true }).press('End');
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(overflow.scroll <= overflow.width + 1);
    await shot(`${item.key}-mobile`);
    await page.getByRole('button', { name: '还原整机', exact: true }).click();
    return { sourceBytes: bytes.length, sourceHash: metadata.sha256, actualParts: expectedParts, actualMeshes: expectedMeshes, actualWorldAdjustment: adjustment, overflow };
  });

  await run('LiquidGlass surfaces, persisted per-project dialogue and genuine thumbnails', async () => {
    await closeAssistant();
    const messages = await page.evaluate(id => JSON.parse(localStorage.getItem(`embodex-v8-chat:preview:${id}`) || '[]'), projectId);
    assert(messages.length >= 6);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.locator('[data-model-loaded="true"]').first().waitFor();
    await page.getByRole('button', { name: '设计助手' }).click();
    assert.equal(await page.locator('.vassistant-message').count(), messages.length);
    const surfaces = await page.locator('.vsidebar,.vtopbar,.vstagebar,.vpanel').evaluateAll(elements => elements.map(el => ({ className: el.className, blur: getComputedStyle(el).backdropFilter, background: getComputedStyle(el).backgroundColor })));
    assert(surfaces.some(surface => surface.blur !== 'none'), 'Glass UI must have actual backdrop filtering');
    const images = await page.locator('.vtemplate-picker img').evaluateAll(elements => elements.map(el => ({ url: el.src, loaded: el.complete && el.naturalWidth > 0 })));
    assert(images.length >= 3 && images.every(image => image.loaded));
    await shot('liquidglass-persistent-dialogue');
    return { messages: messages.length, surfaces, images };
  });
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.productionMutations.length, 0);
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.cases.filter(item => item.status === 'passed').length, failed: report.cases.filter(item => item.status === 'failed').length };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await context.close(); await browser.close();
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed || report.pageErrors.length || report.productionMutations.length) process.exitCode = 1;
}
