# Releasing Unsold PDF

Every build ships the same bundle, `native/www`, made by `npm run build:web`.
Build it once. Each platform then wraps it. Finished files go into `release/`,
which git ignores.

| Platform | Command (run on)                               | Output in `release/`                                                                                      |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| macOS    | `npm run release:mac` (Mac)                    | `Unsold-PDF-<v>-mac-universal.dmg`                                                                        |
| Windows  | `npx tauri build` (Windows)                    | `bundle/nsis/*-setup.exe`, `bundle/msi/*.msi` → rename to `Unsold-PDF-<v>-windows-x64-setup.exe` / `.msi` |
| Linux    | `npx tauri build` (Linux, or WSL Ubuntu 24.04) | `bundle/{deb,rpm,appimage}` → `Unsold-PDF-<v>-linux-*.{deb,rpm,AppImage}`                                 |
| Android  | `npm run release:android` (Mac)                | `*-android.aab` (Play) and one APK per CPU                                                                |
| iOS      | `npx tauri ios build` (Mac with Xcode)         | `.ipa` (needs signing, below)                                                                             |
| Web      | `npm run release:web`                          | `apps/web/dist/`, a static site                                                                           |
| Website  | `npm run build -w @unsold/site`                | `apps/site/dist/`, a static site                                                                          |

On Windows and Linux, copy the repo across along with `native/www`, then run
`npm ci` and the build there. A Linux build needs the Tauri system packages
(`libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`, `xdg-utils`, and so on).

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
