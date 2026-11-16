import { enterPreviewDesign, viewConceptRevision } from "./v8-preview-browser.mjs";
/** Run against the explicitly enabled local preview only. No production generation calls. */
import assert from 'node:assert/strict';
import * as playwright from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const base = process.env.V8_PREVIEW_URL || 'http://127.0.0.1:3108/v8';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'E2E must use local preview');
assert.equal(new URL(base).pathname.replace(/\/$/, ''), '/v8', 'E2E must use the isolated /v8 preview');
const output = resolve('test-results', 'v8-e2e');
await mkdir(join(output, 'downloads'), { recursive: true });
const report = { mode: 'local-development-preview', url: base, startedAt: new Date().toISOString(), browser: '', cases: [], pageErrors: [], productionMutations: [], externalRequests: [], resourceErrors: [] };
let browser;
const launchErrors = [];
for (const options of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
  try {
    browser = await playwright.chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...options });
    report.browser = options.channel || 'bundled-chromium';
    break;
  } catch (error) { launchErrors.push(String(error.message)); }
}
if (!browser) throw new Error(`No installed browser could launch. ${launchErrors.join('\n')}`);
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
// Package acceptance must not silently fetch assets from another preview or CDN.
await context.route(/^https?:\/\//, async route => {
  if (new URL(route.request().url()).origin !== new URL(base).origin) {
    report.externalRequests.push(route.request().url());
    await route.abort();
  } else await route.continue();
});
await context.addInitScript(() => sessionStorage.setItem('embodex-v8-debug', '1'));
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => report.pageErrors.push(error.message));
page.on('response', response => {
  if (/\/(?:v8-assets|_next\/static)\//.test(response.url()) && response.status() >= 400)
    report.resourceErrors.push(`${response.status()} ${response.url()}`);
});
page.on('request', request => {
  if (request.method() !== 'GET' && /\/api\/v1\//.test(request.url())) report.productionMutations.push(`${request.method()} ${request.url()}`);
});
const storageKey = 'embodex-v8-preview-v1';
let templateId, customId, branchA, branchB, branchC, branchAName, branchBName, branchCName;
async function currentId() { return page.url().match(/\/projects\/([^/?]+)/)?.[1]; }
async function facts(id) {
  return page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || '{}').projects?.find(p => p.id === id), { key: storageKey, id });
}
async function waitFact(id, predicate, label, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const project = await facts(id);
    if (project && predicate(project)) return project;
    await delay(220);
  }
  throw new Error(`Timed out: ${label}; facts=${JSON.stringify(await facts(id)).slice(0, 1600)}`);
}
async function loaded() { await page.locator('[data-model-loaded="true"]').first().waitFor(); }
async function shot(name) { await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
async function selectRenderedPartWithPointer() {
  const canvas = page.locator('[data-model-loaded="true"] canvas').first();
  const bounds = await canvas.boundingBox();
  let selected = false;
  const inspector = page.getByRole('complementary', { name: '模型参数面板', exact: true });
  for (const [x, y] of [[.5,.5],[.45,.45],[.55,.45],[.5,.55],[.4,.55],[.6,.55]]) {
    await canvas.click({ position: { x: bounds.width * x, y: bounds.height * y } });
    if (await page.getByLabel('选中零件详情', { exact: true }).count()) { selected = true; break; }
  }
  assert(selected, 'a real pointer raycast must select a rendered source mesh');
  assert(await inspector.isVisible(), 'selected source detail belongs in the visible right inspector');
  const chosen = inspector.locator('.vpart-catalog button[aria-pressed="true"]');
  assert.equal(await chosen.count(), 1, 'pointer-selected mesh must map to its real source assembly');
  await chosen.click();
  await page.waitForFunction(() => document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-inspection-mode') === 'part');
  await shot('17-pointer-selected-source-part');
  await inspector.getByRole('button', { name: '还原', exact: true }).click();
}
async function explodeViewer(prefix, chooseSensor = false) {
  await loaded();
  const host = page.locator('[data-model-loaded="true"]').first();
  assert(Number(await host.getAttribute('data-assembly-count')) > 1, 'explosion requires real assembly groups');
  assert(Number(await host.getAttribute('data-mesh-count')) > 1, 'explosion requires real meshes');
  if (chooseSensor) {
    const component = page.getByLabel('选择模型组件', { exact: true });
    assert.equal(await component.locator('option[value="sensor"]').count(), 1);
    await component.selectOption('sensor');
    await page.getByRole('dialog', { name: '部件参数', exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  }
  const canvas = host.locator('canvas');
  const assembled = await canvas.screenshot();
  await page.getByRole('button', { name: '拆解模型', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) > 0);
  await page.locator('[data-view-mode="exploded"]').first().waitFor();
  const strength = page.getByLabel('拆解程度', { exact: true });
  await strength.focus();
  await strength.press('End');
  await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === 1);
  await delay(200);
  const exploded = await canvas.screenshot();
  assert.notDeepEqual(exploded, assembled, 'actual rendered mesh layout must change when exploded');
  await shot(`${prefix}-exploded`);
  await page.getByRole('button', { name: '还原整机', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-model-loaded="true"]')?.getAttribute('data-explode-level')) === 0);
  await page.locator('[data-view-mode="assembled"]').first().waitFor();
  await shot(`${prefix}-assembled`);
}
async function run(name, fn) {
  const at = Date.now();
  try { await fn(); assert(!/\bV8\b/i.test(await page.locator('body').innerText()), 'User interface must not display the edition label'); report.cases.push({ name, status: 'passed', milliseconds: Date.now() - at }); console.log(`PASS ${name}`); }
  catch (error) {
    report.cases.push({ name, status: 'failed', milliseconds: Date.now() - at, error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
    await shot(`failure-${report.cases.length}`).catch(() => {});
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
async function home() {
  await enterPreviewDesign(page, base);
  await page.getByRole('heading', { name: '今天，想设计什么？' }).waitFor();
}
async function createProject(text, attachment = false) {
  await home();
  await page.getByLabel('描述你的设计目标').fill(text);
  if (attachment) {
    await page.getByLabel('添加需求文件', { exact: true }).setInputFiles({ name: 'inspection-brief.txt', mimeType: 'text/plain', buffer: Buffer.from('巡检需求来源：仓库；视觉传感器；本地可追溯文本附件。') });
    await page.getByText('inspection-brief.txt · 本地已读取').waitFor();
  }
  await page.locator('main').getByRole('button', { name: '开始设计', exact: true }).click();
  await page.waitForURL(/\/projects\/[^/]+\/requirements/);
  await page.getByRole('heading', { name: '让设计目标更清晰' }).waitFor();
  return currentId();
}
async function saveBrief() {
  await page.getByLabel('任务与对象', { exact: true }).fill('室内巡检与概念比较');
  await page.getByLabel('作业场景', { exact: true }).fill('狭窄通道，传感器保护；尺寸与载荷待工程确认。');
  await page.getByRole('button', { name: '保存需求，设计探索' }).click();
  await page.getByRole('heading', { name: '从哪里开始这项设计？' }).waitFor();
}
async function chooseCustomAndGenerate() {
  await page.getByRole('button', { name: '开始专业定制' }).click();
  await page.getByRole('button', { name: '生成概念方向', exact: true }).click();
}
async function scenario(value) {
  const controls = page.locator('.vpreview-controls');
  if (!(await controls.evaluate(el => el.open))) await controls.locator('summary').click();
  await page.locator('#scenario').selectOption(value);
  await controls.locator('summary').click();
}
async function refine(id, bid, sequence, prompt) {
  await page.getByRole('button', { name: '继续修改这个方向', exact: true }).click();
  await page.getByLabel('修改要求', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: '创建新修订', exact: true }).click();
  await waitFact(id, p => p.branches.find(b => b.id === bid)?.revisions.length === sequence, `revision V${sequence}`);
  await viewConceptRevision(page, `V${String(sequence).padStart(2, '0')}`);
}
async function approval() {
  await page.getByRole('button', { name: /确认 V\d+，开始 CAD 建模/ }).click();
  await page.getByRole('dialog', { name: '确认这个具体版本', exact: true }).waitFor();
  await page.getByRole('button', { name: '确认并创建样例工程任务', exact: true }).click();
  await page.waitForURL(/\/cad(?:\?|$)/);
}
async function downloadAll(prefix, expectedSource = []) {
  const buttons = page.locator('button.vdownload');
  const count = await buttons.count();
  assert(count >= 2, 'both document and model artifacts must be present');
  const saved = [];
  for (let i = 0; i < count; i++) {
    if (!(await buttons.nth(i).isEnabled())) continue;
    // HTML artifacts intentionally open the frozen preview/export modal; its offline download is verified separately.
    if ((await buttons.nth(i).getAttribute('aria-label'))?.startsWith('查看与导出')) continue;
    const pending = page.waitForEvent('download');
    await buttons.nth(i).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const name = download.suggestedFilename();
    const path = join(output, 'downloads', `${prefix}-${name}`);
    await download.saveAs(path);
    const bytes = await readFile(path);
    assert(bytes.length > 100);
    if (name.endsWith('.glb')) { assert.equal(bytes.subarray(0, 4).toString(), 'glTF'); assert.equal(bytes.readUInt32LE(8), bytes.length); }
    else if (name.endsWith('.md')) {
      const text = bytes.toString('utf8');
      assert.match(text, /^# /); assert.match(text, /样例|参考模型|概念参考|开发预览/);
      for (const ref of expectedSource) assert(text.includes(ref), `download document missing source ${ref}`);
    }
    else if (name.endsWith('.html')) {
      const text = bytes.toString('utf8');
      assert.match(text, /^<!doctype html>/i);
      assert.match(text, /embodex-design-report-v1/);
      for (const ref of expectedSource) assert(text.includes(ref), `HTML report missing source ${ref}`);
    }
    else assert.fail(`unexpected delivery format: ${name}`);
    saved.push(name);
  }
  assert(saved.some(name => /\.(md|html)$/.test(name)), 'a real design document must be downloaded');
  assert(saved.some(name => name.endsWith('.glb')));
}
async function verifyReportPreview(prefix, expectedSource = []) {
  const before = await facts(await currentId());
  await page.locator('main').getByRole('button', { name: '查看完整方案', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '完整设计方案', exact: true });
  await dialog.waitFor();
  const iframe = dialog.locator('iframe');
  assert(!(await iframe.getAttribute('sandbox')).includes('allow-scripts'));
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.getByRole('heading', { name: '整体方案', exact: true }).waitFor();
  assert.equal(await frame.locator('script').count(), 0);
  for (const summary of await frame.locator('#solution-delivery details > summary').all()) {
    if (!(await summary.evaluate(el => el.parentElement.open))) await summary.click();
  }
  const content = await frame.locator('body').evaluate(n=>n.outerHTML);
  for (const ref of expectedSource) assert(content.includes(ref));
  await shot(`${prefix}-scheme-preview`);
  const pending = page.waitForEvent('download');
  await frame.getByRole('button', { name: '下载 HTML', exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /\.html$/);
  const file = join(output, 'downloads', `${prefix}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const html = await readFile(file, 'utf8');
  assert.match(html, /src="data:image\/(?:png|svg\+xml);base64,/);
  for (const ref of expectedSource) assert(html.includes(ref));
  const document = await context.newPage();
  try {
    await document.goto(pathToFileURL(file).href);
    await document.getByRole('heading', { name: '整体方案', exact: true }).waitFor();
    assert.equal(await document.locator('script').count(), 0);
    assert.equal(await document.evaluate(() => window.__v8Xss), undefined);
    await document.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await document.screenshot({ path: join(output, `${prefix}-offline-scheme.png`), fullPage: true });
    await document.setViewportSize({ width: 390, height: 844 });
    const dimensions = await document.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert(dimensions.scroll <= dimensions.width + 1, `offline scheme mobile overflow ${JSON.stringify(dimensions)}`);
  } finally { await document.close(); }
  await frame.getByRole('button', { name: '关闭完整设计方案', exact: true }).click();
  const after = await facts(before.id);
  assert.equal(JSON.stringify([after.tasks, after.approvals, after.cadRuns]), JSON.stringify([before.tasks, before.approvals, before.cadRuns]), 'viewing/exporting saved report must not change design facts');
}

try {
  await run('F03/F04 template: upload, requirement revision, licensed detailed source model and real downloads', async () => {
    templateId = await createProject('E2E 四足仓库巡检平台，携带视觉传感器，重点关注狭窄通道。', true);
    const created = await facts(templateId);
    assert.equal(created.requirements[0].sources.find(s => s.kind === 'file').parseStatus, 'ready');
    await saveBrief();
    await page.reload();
    assert.equal((await facts(templateId)).requirements.length, 2);
    await page.getByRole('button', { name: '浏览模板库' }).click();
    await page.getByRole('heading', { name: '模板库', exact: true }).waitFor();
    await page.locator('.vtemplate-card').first().getByRole('button', {name:'查看模型', exact:true}).click();
    await loaded();
    assert.equal(await page.locator('#sensor-offset').count(), 0, 'source Go2 has no invented editable engineering parameters');
    await shot('01-template-model');
    await selectRenderedPartWithPointer();
    await explodeViewer('14-template-parts');
    await page.getByRole('button', { name: /(?:使用此模型|保存适配)并查看成果/ }).click();
    await page.waitForURL(/\/delivery$/);
    await page.getByRole('heading', { name: '方案交付', exact: true }).waitFor();
    const saved = await facts(templateId);
    assert.equal(saved.cadRuns.length, 0, 'visual changes must not create CAD');
    assert.equal(saved.templateId, 'sample-go2');
    assert.deepEqual(saved.parameters, {}, 'read-only source reference must not acquire fabricated parameters');
    assert.equal(saved.artifacts.find(a => a.kind === 'model').source, 'licensed-reference');
    await downloadAll('template');
    await verifyReportPreview('template');
    await shot('02-template-delivery');
  });

  await run('F08/F10/F11/F12/F13/F21 concepts: independent revisions, branch restore, read-only history and deep link', async () => {
    customId = await createProject('E2E 三足室内服务机器人，比较不同支撑结构。<script>window.__v8Xss=1</script>');
    await saveBrief();
    await chooseCustomAndGenerate();
    let p = await waitFact(customId, p => p.branches.length === 3, 'three concepts');
    [branchA, branchB, branchC] = p.branches.map(b => b.id);
    [branchAName, branchBName, branchCName] = p.branches.map(b => b.name);
    assert.equal(await page.evaluate(() => window.__v8Xss), undefined, 'user input must remain text');
    assert.equal(await page.locator('.vconcept-card').count(), 3);
    await shot('03-concept-gallery');
    await page.getByRole('button', { name: '比较方向', exact: true }).click();
    await page.getByRole('dialog', { name: '比较概念方向' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.vconcept-card').first().getByRole('button', { name: '查看并深化' }).click();
    await loaded();
    await explodeViewer('15-concept-parts');
    await refine(customId, branchA, 2, '降低视觉平台，保留来源与初始方案。');
    await refine(customId, branchA, 3, '在描述中增加传感器防护与维护空间。');
    await page.locator('.vbranch-switch button').filter({ hasText: branchBName }).click();
    await page.locator('h1').filter({ hasText: branchBName }).waitFor();
    assert.match(await page.locator('h1').innerText(), /V01/);
    await page.locator('.vbranch-switch button').filter({ hasText: branchAName }).click();
    await page.locator('h1').filter({ hasText: branchAName }).filter({ hasText: 'V03' }).waitFor();
    p = await facts(customId);
    const before = JSON.stringify({ tasks: p.tasks, approvals: p.approvals, runs: p.cadRuns });
    await viewConceptRevision(page, 'V01');
    await page.reload();
    await page.locator('h1').filter({ hasText: branchAName }).filter({ hasText: 'V01' }).waitFor();
    p = await facts(customId);
    assert.equal(JSON.stringify({ tasks: p.tasks, approvals: p.approvals, runs: p.cadRuns }), before, 'viewing history must be read-only');
    await viewConceptRevision(page, 'V03');
    await shot('04-concept-v03');
  });

  await run('F14/F15/F17/F23/F30 confirmation, source-locked CAD, refresh and verified format downloads', async () => {
    assert(customId && branchA, 'concept scenario prerequisite');
    await page.getByRole('button', { name: /确认 V03，开始 CAD 建模/ }).click();
    const dialog = page.getByRole('dialog', { name: '确认这个具体版本', exact: true });
    await dialog.waitFor();
    await page.keyboard.press('Tab');
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'dialog keyboard focus should stay inside');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    await approval();
    await page.reload();
    let p = await waitFact(customId, p => p.cadRuns.at(-1)?.status === 'succeeded', 'CAD completion after reload');
    assert.equal(p.cadRuns.length, 1, 'confirmation must create one CAD run');
    const run = p.cadRuns[0], approved = p.approvals.find(a => a.id === run.sourceApprovalId);
    const source = p.branches.find(b => b.id === approved.branchId).revisions.find(r => r.id === approved.revisionId);
    assert.equal(source.sequence, 3);
    assert.equal(run.sourceDescriptionId, approved.descriptionId);
    assert.equal(approved.description, source.description);
    assert.equal(run.validationStatus, 'not_run');
    await loaded();
    await page.getByRole('button', { name: '查看交付成果' }).click();
    await delay(2100);
    await page.getByRole('button', { name: '刷新文件状态', exact: true }).click();
    p = await waitFact(customId, p => p.artifacts.some(a => a.kind === 'model' && a.status === 'ready'), 'file validation');
    await downloadAll('custom-v03', [approved.id, source.id, source.descriptionId]);
    await verifyReportPreview('custom-v03', [approved.id, source.id, source.descriptionId]);
    await shot('05-custom-delivery');
  });

  await run('F18/F25/F27 new revision preserves historic CAD; image-only controls match media', async () => {
    assert(customId && branchA, 'concept scenario prerequisite');
    await page.goto(`${base}/projects/${customId}/concepts/${branchA}`);
    await page.locator('h1').filter({ hasText: branchAName }).waitFor();
    await refine(customId, branchA, 4, '增加描述版本，不改写旧批准和工程结果。');
    let p = await facts(customId);
    assert.equal(p.cadRuns.length, 1);
    assert.equal(p.approvals.length, 1);
    assert.equal(p.cadRuns[0].revisionId, p.branches[0].revisions[2].id);
    assert.notEqual(p.cadRuns[0].revisionId, p.branches[0].latestRevisionId);
    await page.goto(`${base}/projects/${customId}/cad`);
    await page.getByText('历史成果 · 需求或概念已更新', { exact: true }).waitFor();
    await loaded();
    await shot('06-historical-cad');
    await page.goto(`${base}/projects/${customId}/concepts/${branchC}`);
    await page.locator('h1').filter({ hasText: branchCName }).waitFor();
    assert.equal(await page.locator('.vstudio-canvas canvas').count(), 0);
    assert.equal(await page.getByRole('button', { name: '放大模型' }).count(), 0);
    await page.locator('.vcanvas-caption').filter({ hasText: '概念图片' }).waitFor();
    await shot('07-image-only-concept');
  });

  await run('F22/F26/F28/F29 responsive, keyboard and guarded engineering prerequisites without mutations', async () => {
    assert(customId, 'journey prerequisite');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/projects/${customId}/concepts`);
    await page.getByRole('heading', { name: '专业定制', exact: true }).waitFor();
    let dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert(dimensions.scroll <= dimensions.width + 1, `mobile gallery overflow: ${JSON.stringify(dimensions)}`);
    await shot('08-mobile-gallery');
    await page.locator('.vconcept-card').first().getByRole('button', { name: '查看并深化' }).click();
    await page.locator('h1').filter({ hasText: branchAName }).waitFor();
    await loaded();
    dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert(dimensions.scroll <= dimensions.width + 1, `mobile concept overflow: ${JSON.stringify(dimensions)}`);
    await page.evaluate(() => { window.scrollTo(0, 0); const body = document.querySelector('.vbody'); if (body) body.scrollTop = 0; });
    await shot('09-mobile-detail');
    await page.getByRole('button', { name: /确认 V\d+，开始 CAD 建模/ }).scrollIntoViewIfNeeded();
    await shot('09-mobile-actions');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const fresh = await createProject('E2E 未完成阶段直达测试');
    const before = await facts(fresh);
    await page.goto(`${base}/projects/${fresh}/cad`);
    await page.waitForURL(new RegExp(`/projects/${fresh}/start(?:[?#]|$)`));
    await page.getByText('请先完成前面的设计步骤，再继续此阶段。', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-model-loaded="true"]').count(), 0, 'no engineering result may be invented');
    assert.deepEqual(await facts(fresh), before, 'viewing missing prerequisites must not create design facts');
  });

  for (const [value, count, terminal] of [['partial', 2, 'partial'], ['single', 1, 'succeeded'], ['empty', 0, 'succeeded'], ['failure', 0, 'failed']]) {
    await run(`F08/F09/F24 controlled ${value} concept scenario preserves actual result count`, async () => {
      const id = await createProject(`E2E ${value} 概念状态测试`);
      await saveBrief();
      await scenario(value);
      await chooseCustomAndGenerate();
      const p = await waitFact(id, p => p.tasks.some(t => !['queued', 'running', 'unknown'].includes(t.status)), `${value} terminal status`);
      assert.equal(p.branches.length, count);
      assert.equal(p.tasks.at(-1).status, terminal);
      assert.equal(await page.locator('.vconcept-card').count(), count);
      await shot(`10-scenario-${value}`);
      await scenario('success');
    });
  }

  await run('F23/F24 response loss reconciles original task and offline recovery retains history', async () => {
    const id = await createProject('E2E 提交响应丢失与网络恢复');
    await saveBrief();
    await scenario('response-lost');
    await chooseCustomAndGenerate();
    await page.getByRole('alert').filter({ hasText: '提交响应丢失' }).waitFor();
    assert.equal((await facts(id)).tasks.length, 1);
    await page.getByRole('button', { name: '核实并刷新', exact: true }).click();
    await waitFact(id, p => p.branches.length === 3, 'lost-response reconciliation');
    assert.equal((await facts(id)).tasks.length, 1);
    await scenario('offline');
    await page.getByText('连接已中断。已保存的版本仍可查看，任务未被取消。', { exact: false }).first().waitFor();
    const before = JSON.stringify((await facts(id)).branches);
    await page.getByRole('button', { name: '恢复连接并同步', exact: true }).click();
    assert.equal(JSON.stringify((await facts(id)).branches), before);
    await context.setOffline(true);
    await page.getByRole('button', { name: '恢复连接并同步', exact: true }).waitFor();
    assert.equal(JSON.stringify((await facts(id)).branches), before);
    await context.setOffline(false);
    await page.getByRole('button', { name: '恢复连接并同步', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(JSON.stringify((await facts(id)).branches), before);
    await shot('11-network-recovered');
  });

  await run('F16 failed CAD preserves earlier successful assets without creating downloadable new models', async () => {
    assert(customId && branchA, 'history prerequisite');
    const before = await facts(customId);
    const latest = before.branches.find(b => b.id === branchA).revisions.at(-1);
    const oldModels = before.artifacts.filter(a => a.kind === 'model');
    await page.goto(`${base}/projects/${customId}/concepts/${branchA}?revision=${latest.id}`);
    await page.locator('h1').filter({ hasText: branchAName }).waitFor();
    await scenario('failure');
    await approval();
    const p = await waitFact(customId, p => p.cadRuns.at(-1)?.status === 'failed', 'failed CAD state');
    assert.equal(p.cadRuns.length, before.cadRuns.length + 1);
    assert.deepEqual(p.artifacts.filter(a => a.kind === 'model'), oldModels);
    assert.equal(p.cadRuns[0].status, 'succeeded');
    assert.equal(p.cadRuns.at(-1).artifactIds.length, 0);
    assert.equal(await page.locator('.vstudio-canvas canvas').count(), 0);
    await page.getByRole('button', { name: '重试样例任务', exact: true }).waitFor();
    await shot('12-cad-failed-old-assets-preserved');
    await scenario('success');
  });

  await run('F19/F30 CAD completed while files validating blocks model download until authoritative refresh', async () => {
    const id = await createProject('E2E 计算完成文件待校验');
    await saveBrief();
    await chooseCustomAndGenerate();
    await waitFact(id, p => p.branches.length === 3, 'file-pending concepts');
    await page.locator('.vconcept-card').first().getByRole('button', { name: '查看并深化' }).click();
    await page.waitForURL(new RegExp(`/projects/${id}/concepts/[^/?]+`));
    await loaded();
    await scenario('files-pending');
    await approval();
    await waitFact(id, p => p.cadRuns[0]?.status === 'succeeded', 'file-pending CAD');
    await page.getByRole('button', { name: '查看交付成果' }).click();
    await delay(2100);
    await page.getByRole('button', { name: '刷新文件状态', exact: true }).click();
    let p = await facts(id);
    const artifact = p.artifacts.find(a => a.kind === 'model');
    assert.equal(artifact.status, 'validating');
    assert.equal(await page.getByRole('button', { name: `下载 ${artifact.fileName}`, exact: true }).isEnabled(), false);
    await shot('13-files-validating');
    await scenario('success');
    await page.getByRole('button', { name: '刷新文件状态', exact: true }).click();
    p = await waitFact(id, p => p.artifacts.some(a => a.kind === 'model' && a.status === 'ready'), 'file-ready after recovery');
    await downloadAll('files-recovered');
  });
  assert.equal(report.productionMutations.length, 0, 'preview must never mutate production APIs');
  assert.equal(report.pageErrors.length, 0, 'browser must not report uncaught runtime errors');
  assert.deepEqual(report.externalRequests, [], 'all preview resources must come from the unpacked app');
  assert.deepEqual(report.resourceErrors, [], 'packaged assets and client chunks must load successfully');
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = { passed: report.cases.filter(c => c.status === 'passed').length, failed: report.cases.filter(c => c.status === 'failed').length };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  console.log(JSON.stringify(report.summary));
  if (report.summary.failed || report.productionMutations.length) process.exitCode = 1;
}
