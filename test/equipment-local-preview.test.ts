/**
 * 验证浏览器模型请求复用正式 SDK，并在渲染或下载前校验完整文件哈希。
 * 使用本地 HTTP 返回二进制，不依赖 Workspace、Three.js 或实际 Windows 服务。
 * 错版文件必须报错，避免文件代理完成后页面仍展示不匹配的方案。
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { client } from '../lib/api';
import { fetchLocalPreview } from '../lib/equipment/equipment-service';

async function main() {
  const bytes = Buffer.from('local GLB response fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/v1/projects/project/equipment/batches/batch/alternatives/option/preview');
    res.writeHead(200, {'Content-Type': 'model/gltf-binary'});
    res.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = client.getConfig();
  try {
    client.setConfig({baseUrl: `http://127.0.0.1:${(server.address() as any).port}`});
    const result = await fetchLocalPreview('project', 'batch', 'option', 'arrayBuffer', undefined, hash);
    assert.deepEqual(Buffer.from(result as ArrayBuffer), bytes);
    const blob = await fetchLocalPreview('project', 'batch', 'option', 'blob', undefined, hash) as Blob;
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
    await assert.rejects(fetchLocalPreview('project', 'batch', 'option', 'arrayBuffer', undefined, '0'.repeat(64)), /不一致/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchLocalPreview('project', 'batch', 'option', 'arrayBuffer', controller.signal, hash));
    console.log('PASS: browser GLB SDK request, binary/blob, SHA256 and abort');
  } finally {
    client.setConfig(original);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
