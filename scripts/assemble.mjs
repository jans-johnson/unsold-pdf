// Assembles the web bundle the native shell serves (native/www):
//   /            tool pages      (apps/tools/dist)
//   /studio/     the app UI      (apps/studio/dist)
//   /wasm/       WASM engines    (build/engines)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'native/www');

const parts = [
  ['apps/tools/dist', '.'],
  ['apps/studio/dist', 'studio'],
  ['build/engines', 'wasm'],
];

fs.rmSync(out, { recursive: true, force: true });
for (const [from, to] of parts) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.error(`assemble: missing ${from}; build it first`);
    process.exit(1);
  }
  fs.cpSync(src, path.join(out, to), { recursive: true });
}

// Web-hosting leftovers the app never serves, and source maps.
for (const f of ['sw.js', 'robots.txt', 'site.webmanifest', '404.html']) {
  fs.rmSync(path.join(out, f), { force: true });
}
const dropMaps = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) dropMaps(p);
    else if (e.name.endsWith('.map')) fs.rmSync(p);
  }
};
dropMaps(out);

let bytes = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else bytes += fs.statSync(p).size;
  }
};
walk(out);
console.log(`assemble: native/www ready (${(bytes / 1024 / 1024).toFixed(0)} MB)`);
