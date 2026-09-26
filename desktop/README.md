# UnAcrobat for macOS

The macOS app: an Electron shell around the PDF tools in `../src`, with an
Acrobat-style workspace: Home screen with recent files, an All Tools catalog,
document tabs with a pdf.js viewer (thumbnails, bookmarks, attachments,
properties, find, zoom, print), and a tools pane that runs any of the
~130 tools **on the open document**. Tool results come back into the document
(with undo) or open as a new tab; non-PDF outputs go through a Save dialog.

## Build

```bash
cd ..            # repo root
npm ci
cd desktop
npm install
npm run dist     # web build + assets + icon + DMG  -> release/
npm run dev      # run unpackaged (needs ../dist from `npm run build:web`)
```

PyMuPDF, Ghostscript and CPDF load from copies bundled inside the app
(`wasm/`, produced by `npm run prepare-assets` from `../airgap-bundle`), so
those features work offline. OCR language data and some editor fonts are still
fetched from jsDelivr on first use.

## How it works

- `main.cjs` serves `../dist` (packaged: `Resources/web`), `shell/` and `wasm/`
  over a privileged `app://unacrobat/` scheme with the same COOP/COEP headers as
  the tools need. PDF downloads are intercepted and sent back to the shell.
  `/cors-proxy` lets the digital-signature tools reach certificate and
  timestamp servers.
- `shell/` is the Acrobat-style UI. It is same-origin with the tool pages, so
  it loads them in iframes, hides their site chrome, re-themes their accent
  colour, and injects the current document into their file input.
- `scripts/smoke.cjs` boots the app, runs a compress round-trip and saves
  screenshots: `SMOKE_PDF=file.pdf SMOKE_OUT=/tmp/shots npx electron scripts/smoke.cjs`.

The app is ad-hoc signed, not notarized. On first launch, right-click → Open.

Licensed under the GNU AGPL v3. See `../LICENSE` and `../NOTICE.md`.
