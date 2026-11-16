const backendOrigin = process.env.PLATFORM_BACKEND_ORIGIN?.trim().replace(/\/+$/, '');

// Match the existing Next rewrite's 20-minute inactivity timeout.
const timeoutMs = 1_200_000;
const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

export async function proxyUpload(request: Request): Promise<Response> {
  if (!backendOrigin) return new Response(null, { status: 404 });

  const headers = new Headers(request.headers);
  const host = headers.get('host') ?? '';
  for (const name of (headers.get('connection') ?? '').split(',').map(value => value.trim()).filter(Boolean)) headers.delete(name);
  for (const name of [...hopByHop, 'host']) headers.delete(name);
  headers.set('x-forwarded-host', host);
  // Node fetch transparently decompresses responses; request uncompressed bytes.
  headers.set('accept-encoding', 'identity');
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => timeout.abort(), timeoutMs);
    timer.unref();
  };
  const reader = request.body?.getReader();
  let inputComplete = !reader;
  const cancelInput = () => {
    if (!inputComplete && reader) {
      inputComplete = true;
      void reader.cancel().catch(() => {});
    }
  };
  const input = reader && new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) { inputComplete = true; controller.close(); }
      else { resetTimer(); controller.enqueue(result.value); }
    },
    cancel() { cancelInput(); },
  });
  resetTimer();
  timeout.signal.addEventListener('abort', cancelInput, { once: true });
  request.signal.addEventListener('abort', () => { clearTimeout(timer); cancelInput(); }, { once: true });
  const url = new URL(request.url);
  try {
    const response = await fetch(`${backendOrigin}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: input,
      duplex: 'half',
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, timeout.signal]),
    } as RequestInit & { duplex: 'half' });
    const responseHeaders = new Headers(response.headers);
    for (const name of (responseHeaders.get('connection') ?? '').split(',').map(value => value.trim()).filter(Boolean)) responseHeaders.delete(name);
    for (const name of [...hopByHop, 'content-encoding', 'content-length']) responseHeaders.delete(name);
    const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { resetTimer(); controller.enqueue(chunk); },
      flush() { clearTimeout(timer); cancelInput(); },
    })) ?? null;
    if (!body) { clearTimeout(timer); cancelInput(); }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch {
    clearTimeout(timer);
    cancelInput();
    return new Response(null, { status: timeout.signal.aborted ? 504 : 502 });
  }
}

