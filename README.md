# Unsold PDF

A private, offline PDF workbench: view, edit, annotate, sign, convert,
organise, compress, OCR and protect PDFs. Every tool runs on the device.

Unsold PDF is the first app from **Unsold**: free software that isn't for
sale, and neither are you.

- The apps are free, forever. No paid tiers, no ads, no account, no tracking.
- Your files and data stay on your device.
- Optional sync (future apps): bring your own cloud for free, or use ours at
  cost, end-to-end encrypted. Export is always free.
- Open source, so anyone can check the code. Each app picks its own licence;
  Unsold PDF is AGPL-3.0, so nobody can take it and close it.

Unsold is free and always will be. If it helps you, you can
[buy me a coffee ☕](https://buymeacoffee.com/jansjohnson).

Targets Windows, Linux, macOS, Android and iOS from one codebase. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the architecture and migration plan.

## Layout

| Path               | What it is                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `apps/tools/`      | The PDF tools: one page per tool plus the processing logic (Vite + TypeScript)             |
| `apps/studio/`     | The app UI every platform loads: home, document tabs, viewer, tools pane                   |
| `apps/site/`       | The Unsold PDF website: a static landing page (the Paywall Maze story, features, download) |
| `packages/bridge/` | `HostBridge`: the only way UI code reaches the OS (files, dialogs, network)                |
| `native/`          | Tauri 2 shell for desktop and mobile                                                       |
| `scripts/`         | Build orchestration (`engines.mjs` unpacks the WASM engines into `build/engines/`)         |

## Develop

```bash
npm install
npm run test          # all workspaces
npm run build -w @unsold/tools
npm run dev -w @unsold/site    # the website, on http://localhost:5190
```

**Quick reference (addresses, commands, fixes): `docs/CHEATSHEET.md`.**

Building installers for each platform: see `docs/RELEASING.md`.
Deploying the websites (stayunsold.com, pdf.stayunsold.com, pdf.stayunsold.app): see `docs/DEPLOY.md`.

Licensed under the GNU AGPL v3. See `LICENSE`.
