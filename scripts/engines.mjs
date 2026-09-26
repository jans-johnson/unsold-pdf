// Unpacks the WebAssembly engines (PyMuPDF, Ghostscript, CPDF) into
// build/engines/, which is served at /wasm/ in dev and bundled into the app.
// Idempotent: engines that are already unpacked are left alone.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = path.join(root, 'apps/tools/vendor/engines');
const out = path.join(root, 'build/engines');

function untar(tgz, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['xzf', tgz, '-C', dest, '--strip-components=1']);
  fs.rmSync(path.join(dest, 'build_scripts'), { recursive: true, force: true });
}

const engines = [
  {
    name: 'pymupdf',
    ready: 'pymupdf/package.json',
    unpack: (dest) =>
      untar(path.join(bundled, 'pymupdf-wasm-0.11.16.tgz'), dest),
  },
  {
    name: 'gs',
    ready: 'gs/package.json',
    unpack: (dest) => untar(path.join(bundled, 'gs-wasm-0.1.1.tgz'), dest),
  },
  {
    name: 'cpdf',
    ready: 'cpdf/dist',
    unpack: (dest) => {
      const require = createRequire(path.join(root, 'apps/tools/package.json'));
      const pkgDir = path.dirname(require.resolve('coherentpdf/package.json'));
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of ['dist', 'LICENSE.md', 'package.json']) {
        const from = path.join(pkgDir, entry);
        if (fs.existsSync(from)) {
          fs.cpSync(from, path.join(dest, entry), { recursive: true });
        }
      }
    },
  },
];

for (const engine of engines) {
  if (fs.existsSync(path.join(out, engine.ready))) continue;
  engine.unpack(path.join(out, engine.name));
  console.log(`engines: unpacked ${engine.name}`);
}
