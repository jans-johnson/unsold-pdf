# UnAcrobat

A private, offline PDF workbench: view, edit, annotate, sign, convert,
organise, compress, OCR and protect PDFs. Every tool runs on the device.

Targets Windows, Linux, macOS, Android and iOS from one codebase. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the architecture and migration plan.

## Layout

| Path | What it is |
| --- | --- |
| `apps/tools/` | The PDF tools: one page per tool plus the processing logic (Vite + TypeScript) |
| `apps/studio/` | The app UI every platform loads: home, document tabs, viewer, tools pane |
| `packages/bridge/` | `HostBridge`: the only way UI code reaches the OS (files, dialogs, network) |
| `native/` | Tauri 2 shell for desktop and mobile |
| `scripts/` | Build orchestration (`engines.mjs` unpacks the WASM engines into `build/engines/`) |

## Develop

```bash
npm install
npm run test          # all workspaces
npm run build -w @unacrobat/tools
```

Licensed under the GNU AGPL v3. See `LICENSE`.
