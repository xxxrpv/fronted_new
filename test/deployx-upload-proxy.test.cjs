const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const jiti = require('jiti')(__filename);

test('DeployX upload proxy streams and releases completed or cancelled requests', { timeout: 15000 }, async (t) => {
  let resolveFirst;
  let resolveClose;
  let receivedFirst = new Promise(resolve => { resolveFirst = resolve; });
  let upstreamClosed = new Promise(resolve => { resolveClose = resolve; });
  const server = createServer((req, res) => {
    assert.equal(req.headers.cookie, 'session=test');
    assert.equal(req.headers['x-forwarded-host'], 'frontend.test');
    assert.equal(req.headers.origin, 'http://frontend.test');
    assert.equal(req.headers['content-type'], 'application/octet-stream');
    assert.equal(req.headers['x-filename'], 'test.zip');
    assert.equal(req.headers['idempotency-key'], 'key');
    if (req.url.endsWith('/reject')) {
      req.once('data', () => {
        res.writeHead(415, { connection: 'close', 'content-type': 'application/json' });
        res.write('{"error":');
        setTimeout(() => res.end('"unsupported"}'), 30);
      });
      return;
    }
    if (req.url.endsWith('/redirect')) {
      res.writeHead(307, { location: 'http://127.0.0.1:1/never', 'cache-control': 'no-store' }).end();
      return;
    }
    const hash = createHash('sha256');
    let size = 0;
    req.on('data', chunk => { size += chunk.length; hash.update(chunk); resolveFirst(); });
    req.on('close', () => resolveClose());
    req.on('end', () => {
      res.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ size, hash: hash.digest('hex') }));
    });
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.PLATFORM_BACKEND_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  const { proxyUpload } = jiti('../app/api/v1/projects/[projectId]/deployx/proxy-upload.ts');
  const headers = { host: 'frontend.test', connection: 'x-forwarded-host', 'x-forwarded-host': 'attacker.test', cookie: 'session=test', origin: 'http://frontend.test', 'content-type': 'application/octet-stream', 'x-filename': 'test.zip', 'idempotency-key': 'key' };
  const chunk = new Uint8Array(1024 * 1024).fill(42);
  const expected = createHash('sha256');
  for (let i = 0; i < 12; i++) expected.update(chunk);
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; c.enqueue(chunk); } });
  const pending = proxyUpload(new Request('http://frontend.test/api/v1/projects/p/deployx/packages?test=1', { method: 'POST', headers, body, duplex: 'half' }));
  await receivedFirst;
  for (let i = 1; i < 12; i++) controller.enqueue(chunk);
  controller.close();
  const response = await pending;
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { size: 12 * chunk.length, hash: expected.digest('hex') });

  const redirect = await proxyUpload(new Request('http://frontend.test/api/v1/projects/p/deployx/redirect', { method: 'POST', headers, body: 'x', duplex: 'half' }));
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), 'http://127.0.0.1:1/never');

  for (const contentLength of [false, true]) {
    let canceled;
    const cancellation = new Promise(resolve => { canceled = resolve; });
    const slow = new ReadableStream({
      async pull(c) { await new Promise(resolve => setTimeout(resolve, 5)); c.enqueue(chunk.subarray(0, 65536)); },
      cancel() { canceled(); },
    });
    const rejectHeaders = { ...headers, ...(contentLength && { 'content-length': String(12 * chunk.length) }) };
    const rejected = await proxyUpload(new Request('http://frontend.test/api/v1/projects/p/deployx/reject', { method: 'POST', headers: rejectHeaders, body: slow, duplex: 'half' }));
    assert.equal(rejected.status, 415);
    assert.deepEqual(await rejected.json(), { error: 'unsupported' });
    await cancellation;
  }

  receivedFirst = new Promise(resolve => { resolveFirst = resolve; });
  upstreamClosed = new Promise(resolve => { resolveClose = resolve; });
  const abort = new AbortController();
  const openBody = new ReadableStream({ start(c) { c.enqueue(chunk); } });
  const aborted = proxyUpload(new Request('http://frontend.test/api/v1/projects/p/deployx/model-assets', { method: 'POST', headers, body: openBody, duplex: 'half', signal: abort.signal }));
  await receivedFirst;
  abort.abort();
  await aborted;
  await upstreamClosed;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  console.log('DeployX upload proxy: streaming 12 MiB, headers, response, redirect, cancellation PASS');
});



