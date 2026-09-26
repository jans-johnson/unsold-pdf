'use strict';
// Generates every UnAcrobat brand asset from one SVG mark:
//   desktop/build/icon.icns            macOS app icon
//   public/images/favicon*.svg|png      web favicons used by the tool pages
//   public/images/apple-touch-icon.png
//   public/favicon.ico
// Run via `npm run icon` (electron scripts/make-brand.cjs).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const desktop = path.join(__dirname, '..');
const repo = path.join(desktop, '..');
const buildDir = path.join(desktop, 'build');
const images = path.join(repo, 'public/images');

// The mark, drawn on a 166×166 grid: a page with a folded corner and a "U".
const MARK = `
  <path d="M47 18H108L136 46V134A14 14 0 0 1 122 148H47A14 14 0 0 1 33 134V32A14 14 0 0 1 47 18Z" fill="#F4F8FF"/>
  <path d="M108 18V38A8 8 0 0 0 116 46H136Z" fill="#A9CBFF"/>
  <path d="M63 70V96A21.5 21.5 0 0 0 106 96V70" fill="none" stroke="#1A6AE0" stroke-width="15" stroke-linecap="round"/>`;

const GRADIENT = `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#4C9BFF"/><stop offset="1" stop-color="#1747C4"/></linearGradient>`;

const markNoBg = `<svg width="166" height="166" viewBox="0 0 166 166" fill="none" xmlns="http://www.w3.org/2000/svg">${MARK}\n</svg>\n`;

// Web favicon: rounded tile, mark scaled to 80%.
const markTile = `<svg width="166" height="166" viewBox="0 0 166 166" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>${GRADIENT}</defs>
  <rect width="166" height="166" rx="36" fill="url(#bg)"/>
  <g transform="translate(16.6 16.6) scale(0.8)">${MARK}</g>
</svg>\n`;

// macOS icon: 1024 canvas, 824 squircle per Apple's grid, soft shadow.
const macIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${GRADIENT}
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/>
    </filter>
    <filter id="ms" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0a2a70" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#sh)"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#fff" stroke-opacity="0.18"/>
  <g transform="translate(512 512) scale(3.6) translate(-84.5 -83)" filter="url(#ms)">${MARK}</g>
</svg>`;

async function render(win, svg, size) {
  const html = `<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 200));
  return win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  // App icon
  const icon = (await render(win, macIcon, 1024)).resize({ width: 1024, height: 1024 });
  const iconset = path.join(buildDir, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
      fs.writeFileSync(path.join(iconset, name), icon.resize({ width: px, height: px, quality: 'best' }).toPNG());
    }
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), icon.toPNG());
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });

  // Web assets
  fs.writeFileSync(path.join(images, 'favicon.svg'), markTile);
  fs.writeFileSync(path.join(images, 'favicon-no-bg.svg'), markNoBg);
  const tile = (await render(win, markTile, 1024)).resize({ width: 1024, height: 1024 });
  const png = (px) => tile.resize({ width: px, height: px, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(images, 'favicon.png'), png(256));
  fs.writeFileSync(path.join(images, 'favicon-192x192.png'), png(192));
  fs.writeFileSync(path.join(images, 'favicon-512x512.png'), png(512));
  fs.writeFileSync(path.join(images, 'apple-touch-icon.png'), png(180));

  // favicon.ico with PNG-encoded 16/32/48 entries.
  const sizes = [16, 32, 48];
  const pngs = sizes.map(png);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(s, e);
    header.writeUInt8(s, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(repo, 'public/favicon.ico'), Buffer.concat([header, ...pngs]));

  console.log('brand assets written');
  app.exit(0);
});
