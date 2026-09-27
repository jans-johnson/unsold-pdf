// Builds the Mac app and a .dmg for it into release/.
//   node scripts/package-mac.mjs            this Mac's architecture
//   node scripts/package-mac.mjs universal  Apple silicon + Intel in one app
// Expects native/www to be built (`npm run build:web`). The .dmg is made with
// `hdiutil create`: Tauri's own dmg step fails on recent macOS ("hdiutil:
// convert failed - File exists") and leaves a corrupt image.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const universal = process.argv.includes('universal');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'native/tauri.conf.json'), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

if (!fs.existsSync(path.join(root, 'native/www/studio/index.html'))) run('npm', ['run', 'build:web']);

const target = universal ? ['--target', 'universal-apple-darwin'] : [];
run('npx', ['tauri', 'build', '--bundles', 'app', ...target, '--config', '{"build":{"beforeBuildCommand":""}}']);

const bundle = path.join(
  root,
  'native/target',
  universal ? 'universal-apple-darwin/release' : 'release',
  'bundle/macos',
  `${conf.productName}.app`
);
const arch = universal ? 'universal' : process.arch === 'arm64' ? 'arm64' : 'x64';
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const dmg = path.join(outDir, `Unsold-PDF-${conf.version}-mac-${arch}.dmg`);

const stage = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'unsold-dmg-'));
execFileSync('cp', ['-R', bundle, stage]);
fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
fs.rmSync(dmg, { force: true });
run('hdiutil', ['create', '-volname', conf.productName, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', dmg]);
run('hdiutil', ['verify', dmg]);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`package-mac: ${path.relative(root, dmg)}`);
