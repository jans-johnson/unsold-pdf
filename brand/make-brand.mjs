// Generates the Unsold logo files in brand/. Run: node brand/make-brand.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const fontkit = require('@pdf-lib/fontkit');
const out = path.join(repo, 'brand');

const LIME = '#C8F53B', LIME_DEEP = '#9CBF22', INK = '#111111', TILE = '#1D1D1B', PAPER = '#F4F4EE';

// ---- text, outlined so no file depends on a font (DM Sans ExtraBold)
const font = fontkit.create(fs.readFileSync(path.join(repo, 'node_modules/@fontsource/dm-sans/files/dm-sans-latin-800-normal.woff')));
function outline(text, size, tracking = 0) {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  let x = 0, d = '', minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  run.glyphs.forEach((g, i) => {
    const p = g.path.scale(s, -s).translate(x, 0);
    d += p.toSVG();
    const b = p.bbox;
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    x += run.positions[i].xAdvance * s + tracking;
  });
  return { d, minX, minY, w: maxX - minX, h: maxY - minY };
}
// Transform that puts a text's ink box centred on (cx, cy).
const centre = (t, cx, cy) => `translate(${cx - t.minX - t.w / 2} ${cy - t.minY - t.h / 2})`;

// ---- the mark: Zero Orbit. A tall 0 ($0, free forever) with a ring around
// it, a world of its own. The ring passes behind the 0 at the top right and
// in front at the bottom left, with a small gap wherever the two cross.
let uid = 0;
function orbit(cx, cy, s, fill) {
  const id = `o${++uid}`;
  const W = 370 * s, H = 570 * s, T = 92 * s; // the 0
  const RX = 360 * s, RY = 82 * s, RT = 40 * s, ANGLE = -20; // the ring
  const gap = 24 * s;
  const zero = `<rect x="${cx - W / 2 + T / 2}" y="${cy - H / 2 + T / 2}" width="${W - T}" height="${H - T}" rx="${(W - T) / 2}" fill="none" stroke-width="${T}"/>`;
  const ring = (sw) => `<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="none" stroke-width="${sw}" transform="rotate(${ANGLE} ${cx} ${cy})"/>`;
  const all = `<rect x="-2000" y="-2000" width="6000" height="6000" fill="#fff"/>`;
  return `
  <defs>
    <clipPath id="${id}-front"><rect x="${cx - 2 * RX}" y="${cy}" width="${4 * RX}" height="${2 * RY + RT}" transform="rotate(${ANGLE} ${cx} ${cy})"/></clipPath>
    <mask id="${id}-behind" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000">${all}<rect x="${cx - W / 2 - gap}" y="${cy - H / 2 - gap}" width="${W + 2 * gap}" height="${H + 2 * gap}" rx="${W / 2 + gap}" fill="#000"/></mask>
    <mask id="${id}-under" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000">${all}<g stroke="#000" clip-path="url(#${id}-front)">${ring(RT + 2 * gap)}</g></mask>
  </defs>
  <g stroke="${fill}" mask="url(#${id}-behind)">${ring(RT)}</g>
  <g stroke="${fill}" mask="url(#${id}-under)">${zero}</g>
  <g stroke="${fill}" clip-path="url(#${id}-front)">${ring(RT)}</g>`;
}

const svg = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <title>${title}</title>${body}
</svg>
`;

// The mark on its own, transparent.
const mark = (fill) => svg(512, 512, 'Unsold', orbit(256, 256, 0.62, fill));

// Stacked logo: mark over "Unsold".
const word = outline('Unsold', 170, -4);
const stacked = (fill) => svg(720, 820, 'Unsold', orbit(360, 300, 0.8, fill) + `
  <path transform="${centre(word, 360, 700)}" d="${word.d}" fill="${fill}"/>`);

// Horizontal wordmark: mark beside "Unsold".
const wordmark = (fill) => {
  const w = Math.ceil(512 + 20 + word.w + 30);
  return svg(w, 512, 'Unsold', orbit(256, 256, 0.62, fill) + `
  <path transform="${centre(word, 512 + 20 + word.w / 2, 262)}" d="${word.d}" fill="${fill}"/>`);
};

// App tiles (1024 grid, macOS safe area 100..924). Every Unsold app is a dark
// tile with the orbit; the tile's top-right corner and the label below say
// which app it is. Unsold PDF's corner is folded like a page.
const TILE_RECT = `<rect x="100" y="100" width="824" height="824" rx="188"`;
const pdfLabel = outline('PDF', 150, 6);
const pdfBody = (cy = 424) => orbit(512, cy, 0.66, LIME) + `
  <path transform="${centre(pdfLabel, 512, 792)}" d="${pdfLabel.d}" fill="${PAPER}"/>`;

const brandTile = () => svg(1024, 1024, 'Unsold', `
  ${TILE_RECT} fill="${TILE}"/>` + orbit(512, 512, 0.95, LIME));

const pdfIcon = () => svg(1024, 1024, 'Unsold PDF', `
  <defs><clipPath id="page"><path d="M100 100 H704 L924 320 V924 H100 Z"/></clipPath></defs>
  ${TILE_RECT} fill="${TILE}" clip-path="url(#page)"/>
  <path d="M704 100 L924 320 H742 Q704 320 704 282 Z" fill="${LIME_DEEP}"/>` + pdfBody());

// Full-bleed square for platforms that round icons themselves (iOS, Android,
// PWA). Their mask would cut the folded corner, so it's left off here.
const pdfIconSquare = () => svg(1024, 1024, 'Unsold PDF', `
  <rect width="1024" height="1024" fill="${TILE}"/>` + pdfBody(430));

const files = {
  'unsold-mark.svg': mark(LIME),
  'unsold-mark-ink.svg': mark(INK),
  'unsold-logo-stacked-on-dark.svg': stacked(LIME),
  'unsold-logo-stacked-on-light.svg': stacked(INK),
  'unsold-wordmark-on-dark.svg': wordmark(LIME),
  'unsold-wordmark-on-light.svg': wordmark(INK),
  'unsold-tile.svg': brandTile(),
  'unsold-pdf-icon.svg': pdfIcon(),
  'unsold-pdf-icon-square.svg': pdfIconSquare(),
};
for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(out, name), body);
console.log('written', Object.keys(files));
