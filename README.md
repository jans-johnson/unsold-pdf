# UnAcrobat

A private, offline PDF workbench for macOS: view, edit, annotate, sign,
convert, organise, compress, OCR and protect PDFs. Every tool runs locally.

- `src/`, `public/`: the PDF tools (Vite + TypeScript), one page per tool.
- `desktop/`: the macOS app (Electron), with an Acrobat-style workspace. See
  `desktop/README.md`.

```bash
npm ci
cd desktop && npm install && npm run dist   # -> desktop/release/UnAcrobat-*.dmg
```

Licensed under the GNU AGPL v3. See `LICENSE` and `NOTICE.md`.
