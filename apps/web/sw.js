/* Unsold PDF on the web: a service worker that makes the app work on any
 * static host.
 *
 * 1. Cross-origin isolation. The WASM tools need SharedArrayBuffer, which
 *    needs COOP/COEP headers. Many hosts can't set headers, so every
 *    same-origin response gets them here.
 * 2. Big engines. The office engine is ~150 MB unpacked. It ships gzipped
 *    and split into parts under 20 MB (host file-size limits); requests for
 *    the original name are answered by streaming the parts through a gzip
 *    decoder. That is a normal streamed response, which Safari handles (it
 *    can't load blob: URLs that large).
 */
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const TYPES = {
  wasm: 'application/wasm',
  js: 'text/javascript',
  data: 'application/octet-stream',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

let parts = null;
const loadParts = () =>
  (parts ??= fetch(new URL('engine-parts.json', self.registration.scope))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})));

function isolated(response) {
  if (response.status === 0 || response.type === 'opaque') return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function inflateParts(base, names) {
  let i = 0;
  const joined = new ReadableStream({
    async pull(controller) {
      if (i >= names.length) return controller.close();
      const res = await fetch(new URL(names[i++], base));
      if (!res.ok)
        return controller.error(new Error(`missing ${names[i - 1]}`));
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
    },
  });
  return joined.pipeThrough(new DecompressionStream('gzip'));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const path = url.pathname.slice(
        new URL(self.registration.scope).pathname.length
      );
      const list = (await loadParts())[path];
      if (list) {
        const ext = path.split('.').pop();
        const headers = {
          'Content-Type': TYPES[ext] ?? 'application/octet-stream',
          ...ISOLATION,
        };
        if (event.request.method === 'HEAD')
          return new Response(null, { headers });
        return new Response(inflateParts(url, list), { headers });
      }
      return isolated(await fetch(event.request));
    })()
  );
});
