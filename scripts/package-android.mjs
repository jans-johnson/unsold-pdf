// Builds the Android app into release/:
//   Unsold-PDF-<v>-android.aab          for Google Play (one download per device)
//   Unsold-PDF-<v>-android-<abi>.apk    for direct download, one per CPU type
// Android's WebView can't be cross-origin isolated, so the threaded engines
// (LibreOffice for Office files, wasm-vips for TIFF) can't run there; the app
// hides those tools, and this build leaves their ~80 MB out.
// Signing: see native/gen/android/app/build.gradle.kts (keystore.properties).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conf = JSON.parse(fs.readFileSync(path.join(root, 'native/tauri.conf.json'), 'utf8'));
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

const www = path.join(root, 'native/www');
if (!fs.existsSync(path.join(www, 'studio/index.html'))) run('npm', ['run', 'build:web']);

const mobile = path.join(root, 'native/www-android');
fs.rmSync(mobile, { recursive: true, force: true });
fs.cpSync(www, mobile, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(www, src).split(path.sep).join('/');
    return !rel.startsWith('libreoffice-wasm') && !/^assets\/vips-[^/]*\.wasm$/.test(rel);
  },
});

const sdk = process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk');
const ndkDir = path.join(sdk, 'ndk');
const ndk = process.env.NDK_HOME || path.join(ndkDir, fs.readdirSync(ndkDir).sort().at(-1));
const outputs = path.join(root, 'native/gen/android/app/build/outputs');
fs.rmSync(outputs, { recursive: true, force: true });
const tauri = (...flags) =>
  run(
    'npx',
    [
      'tauri', 'android', 'build', ...flags,
      '--target', 'aarch64', 'armv7', 'x86_64',
      '--config', JSON.stringify({ build: { frontendDist: 'www-android', beforeBuildCommand: '' } }),
    ],
    { ANDROID_HOME: sdk, NDK_HOME: ndk }
  );
// One bundle with every CPU type for Play (it serves each device its own),
// and one small APK per CPU type for direct download.
tauri('--aab');
tauri('--apk', '--split-per-abi');

const release = path.join(root, 'release');
fs.mkdirSync(release, { recursive: true });
const found = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((f) => /release.*\.(apk|aab)$/.test(f))
    : [];
for (const file of [...found(path.join(outputs, 'bundle')), ...found(path.join(outputs, 'apk'))]) {
  const abi = { arm64: 'arm64', arm: 'armv7', x86_64: 'x86_64' }[
    /app-(arm64|arm|x86_64|universal)-/.exec(path.basename(file))?.[1]
  ] ?? 'universal';
  const signed = !/unsigned/.test(file);
  const name = file.endsWith('.aab')
    ? `Unsold-PDF-${conf.version}-android.aab`
    : `Unsold-PDF-${conf.version}-android-${abi}${signed ? '' : '-unsigned'}.apk`;
  fs.copyFileSync(file, path.join(release, name));
  console.log(`package-android: release/${name} (${(fs.statSync(file).size / 1048576).toFixed(0)} MB)`);
}
