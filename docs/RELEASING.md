# Releasing Unsold PDF

Every build ships the same bundle, `native/www`, made by `npm run build:web`.
Build it once. Each platform then wraps it. Finished files go into `release/`,
which git ignores.

| Platform | Command (run on)                        | Output in `release/`                                                           |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| macOS    | `npm run release:mac` (Mac)             | `Unsold-PDF-<v>-mac-universal.dmg`                                             |
| Windows  | `npm run release:windows` (Mac, Docker) | `Unsold-PDF-<v>-windows-x64-setup.exe` (the `.msi` needs a Windows PC, below)  |
| Linux    | `npm run release:linux` (Mac, Docker)   | `Unsold-PDF-<v>-linux-amd64.{deb,AppImage}`, `Unsold-PDF-<v>-linux-x86_64.rpm` |
| Android  | `npm run release:android` (Mac)         | `*-android.aab` (Play) and one APK per CPU                                     |
| iOS      | `npx tauri ios build` (Mac with Xcode)  | `.ipa` (needs signing, below)                                                  |
| Web      | `npm run release:web`                   | `apps/web/dist/`, a static site                                                |
| Website  | `npm run build -w @unsold/site`         | `apps/site/dist/`, a static site                                               |

The `release:*` scripts run `npm run build:web` first if `native/www` is
missing, but they don't rebuild a stale one: run `build:web` yourself after
changing the app. The Windows, Linux and Android scripts rewrite
`release/SHA256SUMS`.

## Windows and Linux from the Mac

Both run in Docker (start Docker Desktop first). The first run builds an image
and compiles everything; later runs reuse the image and the cache volume, so
they only rebuild what changed.

- **Windows** (`scripts/package-windows.mjs`, `scripts/docker/windows.Dockerfile`):
  an Ubuntu container at the Mac's native speed cross-compiles to
  `x86_64-pc-windows-msvc` with `cargo-xwin` (it downloads the MSVC CRT and
  Windows SDK into the cache volume, which accepts Microsoft's licence), then
  Tauri bundles the NSIS installer with Linux `makensis`. About 5 minutes from
  cold. **No `.msi`:** it needs WiX, which only runs on Windows. The setup
  `.exe` covers everyone; build the `.msi` on a PC only if someone needs it
  (e.g. for Group Policy installs).
- **Linux** (`scripts/package-linux.mjs`, `scripts/docker/linux.Dockerfile`):
  an Ubuntu 22.04 `linux/amd64` container (emulated by Rosetta, so slower:
  about 15 minutes from cold, 4 when cached) builds the `.deb`, `.rpm` and
  AppImage. 22.04 keeps the glibc floor low (the binary needs 2.34+), so the
  AppImage runs on older distros too. The `.rpm` is left uncompressed:
  Tauri's rpm compressor takes over half an hour on this binary, and the app
  files are compressed already, so it only saved about 3%.
  `npm run release:linux -- --self-test` also runs the AppImage's self-test in
  the container under Xvfb.

Cache volumes: `unsold-pdf-windows-cache` and `unsold-pdf-linux-cache` (Cargo
registry, target dir, a synced copy of `native/`). Remove one with
`docker volume rm <name>` to start clean. The raw bundles are also left in
`native/target/docker-{windows,linux}/`.

### Fallback: build on a PC

To build natively (for example the `.msi`), copy the repo with `native/www`
across (`COPYFILE_DISABLE=1 tar czf ...` so no `._*` files ship), run `npm ci`,
then `npx tauri build --config '{"build":{"beforeBuildCommand":""}}'`. Rename the
files in `native/target/release/bundle/` to the names above. Linux needs the
Tauri system packages (`libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`,
`xdg-utils`, and so on); WSL Ubuntu works.

## Check every build

Each desktop and mobile build has a built-in self-test. It opens the app,
checks isolation, WASM threads, IPC, the bundled engines, the PDF viewer and a
tool page, then exits 0 on pass and 1 on fail.

```bash
"Unsold PDF.app/Contents/MacOS/unsold-pdf" --self-test         # macOS
& "C:\Program Files\Unsold PDF\unsold-pdf.exe" --self-test     # Windows (check $LASTEXITCODE)
./Unsold-PDF-<v>-linux-amd64.AppImage --self-test              # Linux
# iOS simulator: install the .app, then
SIMCTL_CHILD_UNSOLD_SELF_TEST_REPORT=/tmp/r.json xcrun simctl launch --console booted app.unsold.pdf --self-test
```

Set `UNSOLD_SELF_TEST_REPORT=<file>` to also write the report as JSON. On macOS
the viewer check needs an unlocked screen, because WebKit doesn't paint while
the display is locked.

## Platform notes

- **Android** can't cross-origin isolate its WebView, so tools that need WASM
  threads are hidden there: Office, iWork, Publisher, Visio and WordPerfect →
  PDF, and PDF → TIFF. The Android build also leaves those engines out, which
  saves about 80 MB.
- **Web** needs no special server headers. The service worker (`sw.js`) adds
  COOP/COEP and joins the split engine files (the 19 MB parts fit static hosts
  such as Cloudflare Pages). Serve `dist/` at the root of its own domain or
  subdomain (e.g. `app.example.org`): the pages use root paths, and the
  service worker must cover the whole origin.
- **Linux** turns on SharedArrayBuffer in WebKitGTK itself
  (`JSC_useSharedArrayBuffer`), so no launcher flags are needed.

## Tip link

The "buy me a coffee" link shows on desktop, the web and the directly
downloaded Android APKs. App Store and Play Store rules require tips to go
through in-app purchase, so builds for the stores leave it out: iOS always,
and Android when built with `UNSOLD_STORE_BUILD=1` (`release:android` does
this for the `.aab`).

## Signing (needs the owner's accounts)

| Platform | What                                                | Where it plugs in                                                                                                                                            |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | Developer ID Application certificate + notarization | `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` env vars for `tauri build`; then `xcrun stapler staple` the dmg                      |
| Windows  | Authenticode certificate                            | `bundle.windows.certificateThumbprint` (or `signCommand`) in `native/tauri.conf.json`                                                                        |
| Android  | Upload keystore                                     | `native/gen/android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword` (git ignores it). Without it the outputs are unsigned. |
| iOS      | Apple team + App Store provisioning                 | `bundle.iOS.developmentTeam` in `native/tauri.conf.json`, then `npx tauri ios build --export-method app-store-connect`                                       |

Without signing, macOS Gatekeeper and Windows SmartScreen warn on first launch.
Android won't install an unsigned APK at all.

## Checksums

```bash
cd release && shasum -a 256 Unsold-PDF-* > SHA256SUMS
```

## Website links

Fill in `LINKS` near the end of `apps/site/index.html` with each file's
download URL, and `web` with the web version's address. Any link left empty
shows as "soon".

## Announcing a new version (last step)

The apps learn about new versions from
`apps/site/public/releases/latest.json`, which is served at
https://pdf.stayunsold.com/releases/latest.json. **Update it only once the
new downloads are live**, because direct-download copies will offer them
within a day:

1. Bump `version` in `native/tauri.conf.json` before building. The app reads
   its own version from there, and the release scripts use it for file names.
2. Build, upload and link the installers (the sections above).
3. Edit `releases/latest.json`: `version`, `released` (date), `notes` (one
   line on what's new) and `url` (the download page).
4. `npm run deploy:site`.

Store builds ignore the file, because the stores deliver their updates. The
web version picks up the new build on reload, so deploy it with
`npm run deploy:web` at the same time.
