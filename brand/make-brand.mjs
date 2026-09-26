// Generates the Unsold logo files in brand/. Run: node brand/make-brand.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const fontkit = require('@pdf-lib/fontkit');
const out = path.join(repo, 'brand');

const LIME = '#C8F53B', LIME_DEEP = '#9CBF22', INK = '#111111', PAPER = '#F4F4EE';

// The brand motif: a shape struck through by one slash. The slash cuts a
// gap through the shape and pokes out past both edges, like a crossed-out
// price. Shape and slash mask each other, so they line up at any angle.
const SLASH_ANGLE = -18;
let uid = 0;
function struck({ shape, cutouts = '', fill, band, extra = '' }) {
  const id = `u${++uid}`;
  const bandRect = (grow = 0) =>
    `<rect x="${band.x - grow}" y="${band.y - band.h / 2 - grow}" width="${band.w + 2 * grow}" height="${band.h + 2 * grow}" rx="${band.h / 2 + grow}" transform="rotate(${SLASH_ANGLE} ${band.cx} ${band.cy})"/>`;
  return `
  <defs>
    <mask id="${id}-shape" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000">
      <rect x="-2000" y="-2000" width="6000" height="6000" fill="#fff"/>
      <g fill="#000">${cutouts}${bandRect(band.gap)}</g>
    </mask>
    <mask id="${id}-band" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000">
      <rect x="-2000" y="-2000" width="6000" height="6000" fill="#fff"/>
      <g fill="#000" stroke="#000" stroke-linejoin="round">${shape.replace(/fill="[^"]*"|stroke="[^"]*"/g, '')}</g>
    </mask>
  </defs>
  <g mask="url(#${id}-shape)">${shape}${extra}</g>
  <g fill="${fill}" mask="url(#${id}-band)">${bandRect()}</g>`;
}

// ---- the mark: a price tag, point up-left, struck through
const TAG = (fill) =>
  `<path d="M104 190 L190 104 L408 104 L408 408 L104 408 Z" transform="rotate(0)" fill="${fill}" stroke="${fill}" stroke-width="56" stroke-linejoin="round"/>`;
const tagMark = (fill) =>
  struck({
    fill,
    shape: `<g transform="rotate(0)">${TAG(fill)}</g>`,
    cutouts: `<circle cx="196" cy="196" r="30"/>`,
    band: { x: 20, y: 292, w: 472, h: 46, gap: 14, cx: 256, cy: 292 },
  });

const mark = (fill = LIME) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Unsold</title>${tagMark(fill)}
</svg>
`;

// ---- the app icon: the page is the tag (clipped corner + hole, folded
// corner opposite), struck through
const icon = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <title>Unsold PDF</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1D1D1B"/>
      <stop offset="1" stop-color="#0A0A0A"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="188" fill="url(#bg)"/>${struck({
    fill: LIME,
    shape: `<path d="M406 250 L584 250 L696 362 L696 774 L328 774 L328 328 Z" fill="${LIME}" stroke="${LIME}" stroke-width="60" stroke-linejoin="round"/>`,
    cutouts: `<circle cx="428" cy="350" r="40"/>`,
    extra: `<path d="M584 250 L584 362 L696 362 Z" fill="${LIME_DEEP}" stroke="${LIME_DEEP}" stroke-width="26" stroke-linejoin="round"/>`,
    band: { x: 196, y: 590, w: 632, h: 62, gap: 18, cx: 512, cy: 590 },
  })}
</svg>
`;

// ---- wordmark: tag + "unsold" (DM Sans ExtraBold, outlined)
const font = fontkit.create(fs.readFileSync(path.join(repo, 'node_modules/@fontsource/dm-sans/files/dm-sans-latin-800-normal.woff')));
function outline(text, size, tracking) {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let x = 0, d = '';
  run.glyphs.forEach((g, i) => {
    const p = g.path.scale(scale, -scale).translate(x, 0);
    d += p.toSVG();
    x += run.positions[i].xAdvance * scale + tracking;
  });
  return { d, width: x - tracking };
}
const word = outline('unsold', 300, -8);
const wordmark = (textFill, markFill = LIME) => {
  const h = 512, gap = 36, markSize = 512;
  const w = Math.ceil(markSize + gap + word.width + 24);
  // baseline so x-height sits visually centred against the tag
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <title>Unsold</title>${tagMark(markFill)}
  <path transform="translate(${markSize + gap} 330)" d="${word.d}" fill="${textFill}"/>
</svg>
`;
};

fs.writeFileSync(path.join(out, 'unsold-mark.svg'), mark());
fs.writeFileSync(path.join(out, 'unsold-pdf-icon.svg'), icon());
fs.writeFileSync(path.join(out, 'unsold-wordmark-on-dark.svg'), wordmark(PAPER));
fs.writeFileSync(path.join(out, 'unsold-wordmark-on-light.svg'), wordmark(INK, INK));
fs.writeFileSync(path.join(out, 'unsold-mark-ink.svg'), mark(INK));
// Full-bleed square (no rounded corners) for platforms that mask icons themselves.
fs.writeFileSync(path.join(out, 'unsold-pdf-icon-square.svg'),
  icon().replace('<rect x="100" y="100" width="824" height="824" rx="188" fill="url(#bg)"/>', '<rect width="1024" height="1024" fill="url(#bg)"/>')
        .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="112 112 800 800"'));
console.log('written', fs.readdirSync(out));
