# UnAcrobat roadmap

Goal: one offline PDF workbench that ships natively on **Windows, Linux, macOS,
Android and iOS** from a single codebase, with the code reorganised around a
small set of clear packages instead of one web app plus an Electron wrapper.

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| Native shell | **Tauri 2** for all five platforms; Electron is retired | One shell covers desktop and mobile. ~10 MB installers instead of ~150 MB. Per-response headers (COOP/COEP) on every platform, which the WASM tools need for `SharedArrayBuffer`. Capability-scoped plugins replace hand-written IPC. |
| Repo layout | npm workspaces monorepo | Each layer builds, tests and versions on its own; the boundary between "PDF logic", "UI" and "host OS" becomes explicit. |
| Host access | Every OS call goes through `@unacrobat/bridge` | UI code never imports Tauri directly, so it runs unchanged in a plain browser for dev/tests, and a platform can be swapped without touching the UI. |
| Network | Only allow-listed hosts via `tauri-plugin-http` | Replaces the Electron `/cors-proxy`, which would fetch any URL, including LAN addresses. Needed only for signature timestamping and certificate-chain lookups. |
| Tool pages | Strangler migration | The ~120 existing tool pages keep working inside the Studio from day one; they move to the new tool format one at a time and each legacy page is deleted once its replacement lands. |
| Mobile | Same Studio UI, adaptive layout, capability tiers | Heavy engines (LibreOffice, Ghostscript) are memory-hungry; tools declare their needs and the Studio hides what a device can't run instead of crashing. |

## Target layout

```
unacrobat/
├─ apps/
│  ├─ studio/       The app UI every platform loads: home, tabs, viewer, tools pane (TypeScript, Vite)
│  └─ tools/        Tool pages + PDF logic (today's web app). Shrinks as tools migrate.
├─ packages/
│  ├─ bridge/       HostBridge interface + Tauri and browser implementations
│  ├─ engine/       (phase 2) DOM-free PDF operations, workers, WASM loaders
│  └─ kit/          (phase 3) tool manifest format + shared UI primitives
├─ native/          Tauri 2 project: Rust entry, capabilities, icons, generated android/ and apple/ projects
├─ scripts/         Build orchestration (assemble web bundle, fetch WASM assets)
└─ docs/
```

Runtime origin inside the app (all platforms): Studio at `/studio/`, tool pages
at `/<tool-id>`, WASM engines at `/wasm/…`. Everything is same-origin, so the
Studio can drive tool pages in frames and exchange blobs without copying.

## Phases

### Phase 0: Cleanup ✅
- Deleted 12 unreachable modules, ~25 dead functions, 15 unused npm packages.
- Collapsed the hard-wired "simple mode": removed 367 always-hidden marketing
  sections (~25k lines of HTML), the full navbar/footer, the FAQ modal.
- Removed the third-party referral badge, Discord invite and hosted-site references.

### Phase 1: Monorepo + Tauri shell ✅
1. Web app in `apps/tools`, workspace UI in `apps/studio`, root is an npm workspace.
2. `@unacrobat/bridge`: typed `HostBridge` with `tauri` and `browser` implementations, plus the `ToolHost` contract tool pages use.
3. Studio ported from untyped JS on `window.desktop` to TypeScript modules on `HostBridge`.
4. Tool results go through `deliverOutput()`; certificate/TSA fetches go through the native `net_fetch`.
5. WASM engines resolve to `/wasm/…` on the app origin.
6. `native/`: Tauri 2 shell. Granted-path file access, SSRF-safe fetch, desktop menus, Open With / single instance, close guard, navigation lock, `--self-test`.
7. Verified on macOS (shipping-mode build, all self-test checks pass); Electron removed.

**Finding:** WebKit (macOS, iOS, Linux) never cross-origin-isolates custom
schemes such as `tauri://`, even with COOP/COEP headers, and the threaded WASM
tools (LibreOffice, wasm-vips) need isolation. On those platforms the app is
served from its own loopback HTTP origin (`native/src/origin.rs`); Windows and
Android use Tauri's `http://tauri.localhost`, which Chromium isolates.

### Phase 2: Engine extraction
- Move DOM-free code (`utils/pdf-operations`, `compare/engine`, `editcore` core, WASM loaders, workers) into `packages/engine` with its own tests.
- Pull pure processing out of each `logic/*-page.ts` (today UI and processing are mixed in one file) into engine functions: `(input bytes, options) → output bytes`.

### Phase 3: Native tool format
- `packages/kit`: a tool is `{ id, category, accepts, options schema, needs: ['libreoffice'|'threads'|…], run() }` plus an optional custom panel.
- Studio renders options panels from the schema, runs tools on the open document, and gets undo and batch processing for free.
- Migrate tools by category (organise → convert → edit → secure); delete each legacy page as it moves. `apps/tools` disappears at the end.

### Next up (before Phase 2)
- Verify Windows, Linux, Android and iOS builds with `--self-test` (needs those machines / simulators, or CI).
- `tauri android init` / `tauri ios init` and wire document-type registration.
- Trim Phosphor icon fonts to woff2 only (~7 MB of unused formats).
- The Compress tool's "Compression Algorithm" selector is read by nothing; decide whether to wire it or remove it.

### Phase 4: Mobile experience
- Adaptive Studio layout: single pane, bottom sheets, touch-sized targets, share-sheet export, Files/SAF open.
- Capability tiers from `needs` + device memory; lazy-load engines; stream large files.
- iOS/Android specifics: app sandbox paths, background-task limits, "Open in UnAcrobat" document types.

### Phase 5: Release engineering
- CI matrix (GitHub Actions): macOS (arm64/x64), Windows (x64/arm64), Linux (AppImage/deb/rpm), Android (AAB/APK), iOS (IPA).
- Signing: Apple Developer ID + notarization, Windows Authenticode, Android keystore, iOS provisioning.
- Desktop auto-update (`tauri-plugin-updater`); store listings for mobile.

### Deferred (by request)
- Bundling the Noto fallback fonts, editor fonts and OCR data locally. Until then
  those three are still fetched from `rawcdn.githack.com` / jsDelivr on first use.

## Licence

UnAcrobat is AGPL-3.0. Keep `LICENSE`, keep the upstream copyright/attribution
notices, and ship the corresponding source with any distributed build.
