import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDist = path.resolve(here, '../tools/dist');
const engines = path.resolve(here, '../../build/engines');

// The WASM tools need cross-origin isolation (SharedArrayBuffer). The native
// shell sends the same headers from tauri.conf.json.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.gz': 'application/gzip',
};

/**
 * In dev, the Studio is served by Vite at /studio/ and everything else comes
 * from the built tool pages and unpacked engines, mirroring the app layout.
 */
function serveAppLayout(): Plugin {
  const resolveFile = (urlPath: string): string | null => {
    const [root, rel] = urlPath.startsWith('/wasm/')
      ? [engines, urlPath.slice('/wasm'.length)]
      : [toolsDist, urlPath];
    const candidates = path.extname(rel)
      ? [rel]
      : [`${rel}.html`, `${rel}/index.html`];
    for (const c of candidates) {
      const full = path.join(root, c);
      if (!full.startsWith(root + path.sep)) return null;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  };
  return {
    name: 'unsold-app-layout',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
        if (
          url.startsWith('/studio/') ||
          url.startsWith('/@') ||
          url.startsWith('/node_modules/')
        ) {
          return next();
        }
        let file = resolveFile(url === '/' ? '/index' : url);
        // Same as the native origin: `x` falls back to `x.gz`, sent with
        // Content-Encoding so the browser inflates it while streaming.
        const gzipped = !file && !!path.extname(url) && !!resolveFile(`${url}.gz`);
        if (gzipped) file = resolveFile(`${url}.gz`);
        if (!file) return next();
        res.setHeader(
          'Content-Type',
          MIME[path.extname(gzipped ? url : file)] ?? 'application/octet-stream'
        );
        if (gzipped) res.setHeader('Content-Encoding', 'gzip');
        for (const [k, v] of Object.entries(isolationHeaders))
          res.setHeader(k, v);
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: '/studio/',
  plugins: [serveAppLayout()],
  server: { port: 5180, strictPort: true, headers: isolationHeaders },
  preview: { port: 5180, strictPort: true, headers: isolationHeaders },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
