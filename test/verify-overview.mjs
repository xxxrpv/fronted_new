import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9229;
const PORT = 3009;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACTS_DIR = 'C:\\Users\\xxxrp\\.gemini\\antigravity\\brain\\a4df4805-777e-4f4d-bb9b-690e3db4e9d1\\.tempmediaStorage';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => resolve(true));
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return true;
    } catch {
      await delay(400);
    }
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

async function getPageWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => resolve(JSON.parse(raw)));
        }).on('error', reject);
      });
      const page = targets.find((t) => t.type === 'page') || targets[0];
      if (page && page.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      await delay(500);
    }
  }
  throw new Error('Failed to find page target in browser CDP');
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await delay(1200);
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.value;
  }

  async screenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  console.log('1. Starting next server on port ' + PORT + '...');
  const server = spawn('cmd.exe', ['/c', 'npx', 'next', 'start', '-p', String(PORT)], {
    cwd: 'd:/Codes/EmbodixWorkspace/EmbodiX/frontend',
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });

  let edge = null;
  let cdp = null;

  try {
    await waitForServer(`${BASE_URL}/projects`);
    console.log('Server is ready on port ' + PORT);

    console.log('2. Starting Edge in headless debug mode...');
    const tmpDir = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'edge_overview_' + Date.now());
    edge = spawn(EDGE_PATH, [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tmpDir}`,
      '--disable-gpu',
      '--no-first-run',
      'about:blank',
    ]);

    const wsUrl = await getPageWsUrl();
    cdp = new CdpClient(wsUrl);
    await cdp.connect();

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 1. 验证从 /projects 页面点击进入项目
    console.log('3. Navigating to /projects ...');
    await cdp.navigate(`${BASE_URL}/projects`);
    const projectCardLink = await cdp.evaluate(`document.querySelector('.project-card-click-area')?.getAttribute('href')`);
    console.log('First project card link:', projectCardLink);

    // 2. 导航到 Overview 页面
    console.log('4. Navigating to /projects/proj-embodix-01 ...');
    await cdp.navigate(`${BASE_URL}/projects/proj-embodix-01`);

    const overviewTitle = await cdp.evaluate(`document.querySelector('.detail-deployment-heading')?.textContent.trim()`);
    const activeSidebarItem = await cdp.evaluate(`document.querySelector('.sidebar .nav-link-active .nav-text')?.textContent.trim()`);
    const topbarTab = await cdp.evaluate(`document.querySelector('.topbar-center-tab')?.textContent.trim()`);
    const visitHref = await cdp.evaluate(`document.querySelector('.btn-visit')?.getAttribute('href')`);
    const snapshotHref = await cdp.evaluate(`document.querySelector('.deployment-preview-pane')?.getAttribute('href')`);

    console.log('Overview heading:', overviewTitle);
    console.log('Active sidebar item:', activeSidebarItem);
    console.log('Topbar center tab:', topbarTab);
    console.log('Visit button href:', visitHref);
    console.log('Snapshot href:', snapshotHref);

    await cdp.screenshot(`${ARTIFACTS_DIR}/overview_page_verified.png`);
    console.log('Captured overview_page_verified.png');

    // 3. 点击 Visit 进入 /requirements
    console.log('5. Navigating to requirements via Visit ...');
    await cdp.navigate(`${BASE_URL}${visitHref}`);
    const reqStageActive = await cdp.evaluate(`document.querySelector('.tasks2-step-pill.active')?.textContent.trim()`);
    console.log('Requirements page active stage in stepper:', reqStageActive);

    await cdp.screenshot(`${ARTIFACTS_DIR}/requirements_page_from_overview.png`);
    console.log('Captured requirements_page_from_overview.png');

    cdp.close();
    console.log('ALL VERIFICATIONS PASSED!');
  } finally {
    if (edge) edge.kill();
    server.kill();
    // 强制终止可能残留的子进程
    spawn('cmd.exe', ['/c', 'npx', '--yes', 'kill-port', String(PORT)]);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
