// Builds the Windows x64 installer into release/, from any machine with Docker:
//   Unsold-PDF-<v>-windows-x64-setup.exe   (NSIS)
// Cross-compiles to x86_64-pc-windows-msvc with cargo-xwin inside a Linux
// container (scripts/docker/windows.Dockerfile) that runs natively on the host
// CPU. The MSVC CRT and Windows SDK, the Cargo registry, the target dir and a
// synced copy of native/ live on the `unsold-pdf-windows-cache` volume.
// The .msi needs WiX, which only runs on Windows: build it there (docs/RELEASING.md).
// Expects native/www to be built (`npm run build:web`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'native/tauri.conf.json'), 'utf8'));
const cli = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

if (!fs.existsSync(path.join(root, 'native/www/studio/index.html'))) run('npm', ['run', 'build:web']);

const image = 'unsold-pdf-windows';
run('docker', [
  'build', '-t', image, '--build-arg', `TAURI_CLI_VERSION=${cli.version}`,
  '-f', 'scripts/docker/windows.Dockerfile', 'scripts/docker',
]);

const stage = path.join(root, 'native/target/docker-windows');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const out = '/cache/target/x86_64-pc-windows-msvc/release';
const script = `
set -euo pipefail
mkdir -p /cache/work
rsync -a --delete --exclude /target --exclude /gen/android --exclude /gen/apple --exclude /www-android /src/native/ /cache/work/native/
cp /src/LICENSE /cache/work/LICENSE
cd /cache/work/native
rm -rf ${out}/bundle
tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis --config '{"build":{"beforeBuildCommand":""}}'
cp ${out}/bundle/nsis/*-setup.exe ${out}/unsold-pdf.exe /out/
`;
run('docker', [
  'run', '--rm',
  '-v', `${root}:/src:ro`, '-v', 'unsold-pdf-windows-cache:/cache', '-v', `${stage}:/out`,
  image, 'bash', '-c', script,
]);

const setup = fs.readdirSync(stage).find((f) => f.endsWith('-setup.exe'));
if (!setup) throw new Error('package-windows: no NSIS installer was built');
const release = path.join(root, 'release');
fs.mkdirSync(release, { recursive: true });
const name = `Unsold-PDF-${conf.version}-windows-x64-setup.exe`;
fs.copyFileSync(path.join(stage, setup), path.join(release, name));
console.log(`package-windows: release/${name} (${(fs.statSync(path.join(release, name)).size / 1048576).toFixed(0)} MB)`);

execFileSync('sh', ['-c', 'shasum -a 256 Unsold-PDF-* > SHA256SUMS'], { cwd: release });
console.log('package-windows: release/SHA256SUMS updated');
