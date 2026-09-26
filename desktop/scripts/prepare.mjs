// Prepares everything the desktop shell needs from the web project:
//   1. shell/generated/tools.json  – tool catalog parsed from src/js/config/tools.ts
//   2. shell/vendor/phosphor       – icon font used by the tool catalog
//   3. wasm/                       – offline copies of PyMuPDF, Ghostscript and CPDF
// Run from the desktop folder: `npm run prepare-assets`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..');

// 1. Tool catalog ------------------------------------------------------------
const toolsSrc = fs.readFileSync(
  path.join(repo, 'src/js/config/tools.ts'),
  'utf8'
);
const literal = toolsSrc
  .slice(toolsSrc.indexOf('['), toolsSrc.indexOf('const getToolIdFromHref'))
  .trim()
  .replace(/;$/, '')
  .replaceAll('import.meta.env.BASE_URL + ', '');
const categories = new Function(`return ${literal}`)().map((cat) => ({
  name: cat.name,
  tools: cat.tools.map((t) => ({
    id: t.href.replace(/\.html$/, ''),
    name: t.name,
    icon: t.icon,
    subtitle: t.subtitle,
  })),
}));
const generated = path.join(desktop, 'shell/generated');
fs.mkdirSync(generated, { recursive: true });
fs.writeFileSync(
  path.join(generated, 'tools.json'),
  JSON.stringify(categories, null, 2)
);
console.log(
  `tools.json: ${categories.length} categories, ${categories.reduce((n, c) => n + c.tools.length, 0)} tools`
);

// 2. Phosphor icons ------------------------------------------------------------
const phosphorSrc = path.join(repo, 'node_modules/@phosphor-icons/web/src');
const phosphorDst = path.join(desktop, 'shell/vendor/phosphor');
for (const weight of ['regular', 'fill']) {
  fs.cpSync(path.join(phosphorSrc, weight), path.join(phosphorDst, weight), {
    recursive: true,
  });
}
console.log('phosphor icons copied');

// 3. Offline WASM engines --------------------------------------------------------
const wasm = path.join(desktop, 'wasm');
function untar(tgz, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['xzf', tgz, '-C', dest, '--strip-components=1']);
  fs.rmSync(path.join(dest, 'build_scripts'), { recursive: true, force: true });
}
const airgap = path.join(repo, 'airgap-bundle');
if (!fs.existsSync(path.join(wasm, 'pymupdf/package.json'))) {
  untar(path.join(airgap, 'pymupdf-wasm-0.11.16.tgz'), path.join(wasm, 'pymupdf'));
}
if (!fs.existsSync(path.join(wasm, 'gs/package.json'))) {
  untar(path.join(airgap, 'gs-wasm-0.1.1.tgz'), path.join(wasm, 'gs'));
}
if (!fs.existsSync(path.join(wasm, 'cpdf/dist'))) {
  fs.mkdirSync(wasm, { recursive: true });
  execFileSync('npm', ['pack', 'coherentpdf@2.5.5', '--silent'], { cwd: wasm });
  const tgz = path.join(wasm, 'coherentpdf-2.5.5.tgz');
  untar(tgz, path.join(wasm, 'cpdf'));
  fs.rmSync(tgz);
  for (const entry of fs.readdirSync(path.join(wasm, 'cpdf'))) {
    if (!['dist', 'LICENSE.md', 'package.json'].includes(entry)) {
      fs.rmSync(path.join(wasm, 'cpdf', entry), { recursive: true, force: true });
    }
  }
}
console.log('wasm engines ready');
