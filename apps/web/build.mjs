// Builds the web version of Unsold PDF into apps/web/dist, from the same
// bundle the native apps ship (native/www, made by `npm run build:web`).
// Deploy dist/ at the root of a domain (e.g. https://pdf.example.com/): the
// app uses root paths (/studio/, /wasm/, /<tool>.html).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const www = path.resolve(here, '../../native/www');
const out = path.join(here, 'dist');
const PART = 19 * 1024 * 1024; // under common per-file limits (e.g. 25 MiB)

if (!fs.existsSync(path.join(www, 'studio/index.html'))) {
  console.error('web: native/www is missing; run `npm run build:web` first');
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(www, out, { recursive: true });

// Start page (installs the service worker, then opens /studio/).
fs.copyFileSync(path.join(here, 'start.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(here, 'sw.js'), path.join(out, 'sw.js'));

// Split big gzipped engines into parts the service worker reassembles.
const parts = {};
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.gz') && fs.statSync(p).size > PART) {
      const bytes = fs.readFileSync(p);
      const names = [];
      for (let i = 0; i * PART < bytes.length; i++) {
        const name = `${e.name}.part${i}`;
        fs.writeFileSync(
          path.join(dir, name),
          bytes.subarray(i * PART, (i + 1) * PART)
        );
        names.push(name);
      }
      fs.rmSync(p);
      const rel = path
        .relative(out, p)
        .split(path.sep)
        .join('/')
        .replace(/\.gz$/, '');
      parts[rel] = names;
    }
  }
};
walk(out);
fs.writeFileSync(
  path.join(out, 'engine-parts.json'),
  JSON.stringify(parts, null, 2)
);

// Hosts that read header files (Netlify, Cloudflare Pages) isolate from the
// first request; elsewhere the service worker adds the same headers.
fs.writeFileSync(
  path.join(out, '_headers'),
  `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
`
);

let bytes = 0,
  largest = 0;
const size = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) size(p);
    else {
      const s = fs.statSync(p).size;
      bytes += s;
      largest = Math.max(largest, s);
    }
  }
};
size(out);
console.log(
  `web: apps/web/dist ready (${(bytes / 1048576).toFixed(0)} MB, largest file ${(largest / 1048576).toFixed(1)} MB, ${Object.keys(parts).length} split engines)`
);
