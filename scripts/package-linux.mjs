// Builds the Linux x86_64 app into release/, from any machine with Docker:
//   Unsold-PDF-<v>-linux-amd64.deb, -linux-x86_64.rpm, -linux-amd64.AppImage
//   node scripts/package-linux.mjs              build
//   node scripts/package-linux.mjs --self-test  build, then run the AppImage's
//                                               self-test in the container (Xvfb)
// Runs in an Ubuntu 22.04 linux/amd64 container (scripts/docker/linux.Dockerfile),
// emulated on Apple silicon. The Cargo registry, target dir and a synced copy of
// native/ live on the `unsold-pdf-linux-cache` volume, so reruns only rebuild what
// changed. Expects native/www to be built (`npm run build:web`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'native/tauri.conf.json'), 'utf8'));
const cli = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const selfTest = process.argv.includes('--self-test');

if (!fs.existsSync(path.join(root, 'native/www/studio/index.html'))) run('npm', ['run', 'build:web']);

const image = 'unsold-pdf-linux';
const platform = ['--platform', 'linux/amd64'];
run('docker', [
  'build', ...platform, '-t', image, '--build-arg', `TAURI_CLI_VERSION=${cli.version}`,
  '-f', 'scripts/docker/linux.Dockerfile', 'scripts/docker',
]);

const stage = path.join(root, 'native/target/docker-linux');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const bundle = '/cache/target/release/bundle';
const script = `
set -euo pipefail
mkdir -p /cache/work
rsync -a --delete --exclude /target --exclude /gen/android --exclude /gen/apple --exclude /www-android /src/native/ /cache/work/native/
cp /src/LICENSE /cache/work/LICENSE
cd /cache/work/native
rm -rf ${bundle}
tauri build --bundles deb,rpm,appimage --config '{"build":{"beforeBuildCommand":""}}'
cp ${bundle}/deb/*.deb ${bundle}/rpm/*.rpm ${bundle}/appimage/*.AppImage /out/
`;
run('docker', [
  'run', '--rm', ...platform,
  '-v', `${root}:/src:ro`, '-v', 'unsold-pdf-linux-cache:/cache', '-v', `${stage}:/out`,
  image, 'bash', '-c', script,
]);

const release = path.join(root, 'release');
fs.mkdirSync(release, { recursive: true });
const names = { deb: 'linux-amd64.deb', rpm: 'linux-x86_64.rpm', AppImage: 'linux-amd64.AppImage' };
for (const file of fs.readdirSync(stage)) {
  const suffix = names[path.extname(file).slice(1)];
  if (!suffix) continue;
  const name = `Unsold-PDF-${conf.version}-${suffix}`;
  fs.copyFileSync(path.join(stage, file), path.join(release, name));
  if (name.endsWith('.AppImage')) fs.chmodSync(path.join(release, name), 0o755);
  console.log(`package-linux: release/${name} (${(fs.statSync(path.join(release, name)).size / 1048576).toFixed(0)} MB)`);
}

if (selfTest) {
  // Software rendering: the container has no GPU. Exit code 0 = all checks passed.
  run('docker', [
    'run', '--rm', ...platform, '-v', `${release}:/release:ro`,
    '-e', 'APPIMAGE_EXTRACT_AND_RUN=1', '-e', 'LIBGL_ALWAYS_SOFTWARE=1', '-e', 'WEBKIT_DISABLE_COMPOSITING_MODE=1',
    '-e', 'WEBKIT_DISABLE_DMABUF_RENDERER=1', '-w', '/tmp',
    image, 'xvfb-run', '-a', '-s', '-screen 0 1600x1000x24',
    `/release/Unsold-PDF-${conf.version}-linux-amd64.AppImage`, '--self-test',
  ]);
  console.log('package-linux: self-test passed');
}

execFileSync('sh', ['-c', 'shasum -a 256 Unsold-PDF-* > SHA256SUMS'], { cwd: release });
console.log('package-linux: release/SHA256SUMS updated');
