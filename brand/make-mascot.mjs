// Generates Zero, the Unsold mascot, into brand/mascot/. Run: node brand/make-mascot.mjs
//
// Zero is the 0 from the Zero Orbit mark, drawn as a comic-noir vigilante:
// heavy steady ink, a mask band tied round the counter with slit eyes, tube
// limbs with fists and boots, the orbit worn low like a belt, halftone shadow,
// and a paper die-cut outline so it reads on night. The Zero Signal is the
// Zero Orbit mark lit on the clouds. No bat shapes, cowls or other borrowed
// marks (see DESIGN.md). Lines use a seeded wobble, so every run is identical,
// and text is outlined (DM Sans), so no file depends on an installed font.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const fontkit = require('@pdf-lib/fontkit');
const out = path.join(repo, 'brand', 'mascot');
fs.mkdirSync(out, { recursive: true });

const INK = '#111111', LIME = '#C8F53B', PAPER = '#F4F4EE', RED = '#E5484D';
const NIGHT = '#0D0D10', DUSK = '#1A1A20', STONE = '#26262D';
const W = 9; // heavier than the friendly Zero's 7

// ---- text, outlined
const fonts = Object.fromEntries([500, 800].map((w) => [w, fontkit.create(fs.readFileSync(
  path.join(repo, `node_modules/@fontsource/dm-sans/files/dm-sans-latin-${w}-normal.woff`)))]));
function text(str, x, y, size, { weight = 800, tracking = 0, fill = PAPER, anchor = 'start' } = {}) {
  const font = fonts[weight], run = font.layout(str), s = size / font.unitsPerEm;
  let adv = 0, d = '';
  run.glyphs.forEach((g, i) => {
    d += g.path.scale(s, -s).translate(adv, 0).toSVG();
    adv += run.positions[i].xAdvance * s + tracking;
  });
  const dx = anchor === 'middle' ? -(adv - tracking) / 2 : 0;
  return `<path transform="translate(${(x + dx).toFixed(1)} ${y})" d="${d}" fill="${fill}"/>`;
}

// ---- line helpers (steadier wobble than the friendly set)
let seed = 5;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noise = (amp) => {
  const p = [rnd() * 6.28, rnd() * 6.28];
  return (t) => amp * (0.7 * Math.sin(t * 2 + p[0]) + 0.3 * Math.sin(t * 5 + p[1]));
};
const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
function smooth(pts, closed = false) {
  const n = pts.length;
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    d += `C${f([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${f([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${f(p2)}`;
  }
  return d + (closed ? 'Z' : '');
}
function capsule(cx, cy, w, h, amp = 0.8, N = 60) {
  const r = w / 2, L = h - w, arc = Math.PI * r, per = 2 * L + 2 * arc, nz = noise(amp), pts = [];
  for (let k = 0; k < N; k++) {
    const s = (k / N) * per;
    let x, y, nx, ny;
    if (s < L) { x = cx + r; y = cy - L / 2 + s; nx = 1; ny = 0; }
    else if (s < L + arc) { const a = (s - L) / r; x = cx + r * Math.cos(a); y = cy + L / 2 + r * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
    else if (s < 2 * L + arc) { x = cx - r; y = cy + L / 2 - (s - L - arc); nx = -1; ny = 0; }
    else { const a = Math.PI + (s - 2 * L - arc) / r; x = cx + r * Math.cos(a); y = cy - L / 2 + r * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
    const o = nz((k / N) * 2 * Math.PI);
    pts.push([x + nx * o, y + ny * o]);
  }
  return smooth(pts, true);
}
function ellipseFn(cx, cy, rx, ry, rotDeg, amp = 0.8) {
  const nz = noise(amp), c = Math.cos((rotDeg * Math.PI) / 180), s = Math.sin((rotDeg * Math.PI) / 180);
  return (t) => {
    const o = nz(t), x = (rx + o) * Math.cos(t), y = (ry + o * 0.5) * Math.sin(t);
    return [cx + x * c - y * s, cy + x * s + y * c];
  };
}
const ellipse = (cx, cy, rx, ry, rot = 0, amp = 0.6, N = 36) => {
  const fn = ellipseFn(cx, cy, rx, ry, rot, amp);
  return smooth(Array.from({ length: N }, (_, k) => fn((k / N) * 2 * Math.PI)), true);
};
function line(pts, amp = 0.6) {
  const res = [];
  pts.forEach((p, i) => {
    res.push(i === 0 || i === pts.length - 1 ? p : [p[0] + (rnd() - 0.5) * amp, p[1] + (rnd() - 0.5) * amp]);
    if (i < pts.length - 1) {
      const q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1, j = (rnd() - 0.5) * amp * 2;
      res.push([(p[0] + q[0]) / 2 - (dy / len) * j, (p[1] + q[1]) / 2 + (dx / len) * j]);
    }
  });
  return smooth(res);
}
const stroke = (d, w = W, color = INK, cap = 'round') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="${cap}" stroke-linejoin="round"/>`;
// Straight-edged shapes (walls, folders, cups): corners nudged, edges kept straight.
const poly = (pts) => 'M' + pts.map(([x, y]) => f([x + (rnd() - 0.5) * 1.2, y + (rnd() - 0.5) * 1.2])).join('L') + 'Z';
// Limbs are tubes (ink outline, paper inside): heavier than stick lines.
const tube = (d, w = 20) => stroke(d, w) + stroke(d, w - 10, PAPER);
const shape = (d, fill, w = W) => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;

// Shared defs: a paper die-cut outline around the whole figure (so ink reads on
// night), a halftone for shadows, and film grain for backgrounds.
const DEFS = `<defs>
  <filter id="cut" x="-10%" y="-10%" width="120%" height="120%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="4" result="grow"/>
    <feFlood flood-color="${PAPER}"/><feComposite in2="grow" operator="in" result="rim"/>
    <feMerge><feMergeNode in="rim"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
    <circle cx="3.5" cy="3.5" r="1.7" fill="${INK}"/>
  </pattern>
  <pattern id="dots-lite" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
    <circle cx="4.5" cy="4.5" r="1.2" fill="${PAPER}" opacity="0.08"/>
  </pattern>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0"/></filter>
</defs>`;

// ---- the character
let uid = 0;
function zero(o) {
  const id = `n${uid++}`;
  const cx = 200, cy = 225, rot = o.ringRot ?? -7, ry = cy + 70;
  const body = capsule(cx, cy, 150, 250);
  const counter = capsule(cx, cy - 2, 60, 148, 0.5);
  const ring = ellipseFn(cx, ry, 112, 20, rot, 0.8);
  const back = smooth(Array.from({ length: 64 }, (_, k) => ring((k / 64) * 2 * Math.PI)), true);
  const belt = stroke(back, 23) + stroke(back, 10, LIME);

  const g = [o.behind ?? ''];
  const backdrop = o.backdrop ?? '';
  for (const leg of o.legs) g.push(tube(line(leg), 22));
  for (const leg of o.legs) { // boots
    const [x, y] = leg.at(-1), dir = x < cx ? -1 : 1;
    g.push(shape(smooth([[x - 16 * (dir < 0 ? 1.6 : 1), y + 12], [x - 14, y - 6], [x + 14, y - 6], [x + 16 * (dir > 0 ? 1.6 : 1), y + 12]], true), INK, 4));
  }
  g.push(belt);
  g.push(`<clipPath id="${id}b"><path d="${body}"/></clipPath>`);
  g.push(`<clipPath id="${id}f"><rect x="-200" y="${ry}" width="800" height="200" transform="rotate(${rot} ${cx} ${ry})"/></clipPath>`);
  g.push(shape(body, LIME));
  // halftone shadow down the right side of the body
  g.push(`<g clip-path="url(#${id}b)"><path d="${ellipse(cx + 150, cy + 20, 110, 170, 0)}" fill="url(#dots)" opacity="0.55"/></g>`);
  g.push(shape(counter, PAPER, 7));
  g.push(`<g clip-path="url(#${id}b)">${mask(cx, cy, o.face)}</g>`);
  g.push(tails(o.tails ?? 'right'));
  g.push(mouth(o.face, cx, cy));
  g.push(`<g clip-path="url(#${id}f)">${belt}</g>`);
  g.push(o.midFront ?? '');
  for (const arm of o.arms ?? []) {
    g.push(tube(line(arm)));
    const [x, y] = arm.at(-1);
    g.push(fist(x, y));
  }
  g.push(o.front ?? '');
  return `${backdrop}<g filter="url(#cut)">${g.join('\n')}</g>${o.after ?? ''}`;
}

// The mask: an ink band tied round the 0 at eye level, with slit eyes.
function mask(cx, cy, face) {
  const y = cy - 38;
  const band = shape(smooth([[cx - 90, y - 12], [cx, y - 20], [cx + 90, y - 14], [cx + 90, y + 16], [cx, y + 12], [cx - 90, y + 18]], true), INK, 3);
  const up = { up: -5, down: 4 }[face] ?? 0, squeeze = face === 'grit' ? 3 : 0;
  if (face === 'side') cx -= 6;
  // slits angle down toward the middle: a frown without a brow
  const slit = (s) => `<path d="M${cx + s * 25},${y - 5 + up + squeeze} L${cx + s * 7},${y + 1 + up + squeeze} L${cx + s * 8},${y + 7 + up - squeeze} L${cx + s * 24},${y + 4 + up - squeeze}Z" fill="${PAPER}"/>`;
  return band + slit(-1) + slit(1);
}
function tails(side) {
  if (side === 'none') return '';
  const s = side === 'right' ? 1 : -1, x = 200 + s * 72, y = 188;
  return shape(smooth([[x, y - 6], [x + s * 34, y - 22], [x + s * 64, y - 16], [x + s * 40, y - 6], [x, y + 6]], true), INK, 3) +
    shape(smooth([[x, y + 2], [x + s * 30, y + 6], [x + s * 56, y + 22], [x + s * 26, y + 16], [x, y + 12]], true), INK, 3);
}
function mouth(face, cx, cy) {
  if (face === 'grit') // gritted teeth
    return shape(smooth([[cx - 14, cy - 4], [cx + 14, cy - 4], [cx + 13, cy + 8], [cx - 13, cy + 8]], true), '#FFFFFF', 4) +
      stroke(`M${cx - 14},${cy + 2} H${cx + 14} M${cx - 5},${cy - 4} V${cy + 8} M${cx + 5},${cy - 4} V${cy + 8}`, 2.5);
  if (face === 'up' || face === 'side') return '';
  return stroke(line([[cx - 9, cy - 2], [cx + 9, cy - 4]], 0.2), 5); // flat, unimpressed
}
const fist = (x, y) => shape(ellipse(x, y, 14, 13, 0, 0.4), PAPER, 5) + stroke(`M${x - 7},${y - 3} q7,-4 14,0`, 3);

// ---- scenery
function city(w, h, base, { signs = true } = {}) {
  let s = '', x = -10, k = 0;
  while (x < w + 10) {
    const bw = 40 + ((k * 37) % 50), bh = 70 + ((k * 53) % 150);
    s += `<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh + 400}" fill="${k % 2 ? DUSK : STONE}"/>`;
    for (let wy = base - bh + 14; wy < base - 10; wy += 18)
      for (let wx = x + 8; wx < x + bw - 10; wx += 14)
        if (((wx * 7 + wy * 3 + k) % 11) === 0) s += `<rect x="${wx}" y="${wy}" width="5" height="8" fill="${PAPER}" opacity="0.35"/>`;
    x += bw + 2; k++;
  }
  if (signs) // the corporate walls, lit up in red
    s += `<g opacity="0.9">${text('PRO', w * 0.12, base - 140, 22, { fill: RED })}${text('SUBSCRIBE', w * 0.62, base - 170, 18, { fill: RED })}</g>`;
  return s;
}
// The Zero Orbit mark, in night ink, lit on the cloud base.
function signal(cx, cy, r) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.45}" ry="${r}" fill="${LIME}" opacity="0.94"/>` +
    `<g transform="rotate(-8 ${cx} ${cy})">` +
    `<path d="${capsule(cx, cy, r * 0.62, r * 1.3, 0.3)}" fill="none" stroke="${NIGHT}" stroke-width="${r * 0.2}"/>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.1}" ry="${r * 0.26}" transform="rotate(-18 ${cx} ${cy})" fill="none" stroke="${NIGHT}" stroke-width="${r * 0.09}"/></g>`;
}
function night(w, h) {
  return `<rect width="${w}" height="${h}" fill="${NIGHT}"/>` +
    `<ellipse cx="${w * 0.4}" cy="${h * 0.16}" rx="${w * 0.7}" ry="${h * 0.14}" fill="${DUSK}"/>` +
    `<rect width="${w}" height="${h}" fill="url(#dots-lite)"/>`;
}
const grain = (w, h) => `<rect width="${w}" height="${h}" filter="url(#grain)"/>`;
const floor = (x1 = 96, x2 = 304) => stroke(line([[x1, 452], [x2, 452]], 1), 6);
const tick = (a, b, w = 5) => stroke(line([a, b], 0.3), w);
const spotlight = `<path d="M150,-20 L250,-20 L340,452 L60,452Z" fill="${LIME}" opacity="0.13"/>` +
  `<ellipse cx="200" cy="452" rx="140" ry="16" fill="${LIME}" opacity="0.22"/>`;
const LEGS = [[[172, 338], [156, 384], [148, 428]], [[228, 338], [244, 384], [252, 428]]];

// ---- poses (400 × 480 frame; ground at y ≈ 452). Everything except the
// signal scene is transparent, so a pose sits on any surface.
const POSES = {
  crossed: {
    caption: 'ARMS CROSSED', note: 'The default. Unbothered, not for sale.',
    draw: () => zero({
      face: 'stoic', legs: LEGS,
      arms: [[[128, 222], [122, 262], [142, 282], [236, 262]], [[272, 222], [278, 262], [258, 284], [164, 270]]],
      front: floor(),
    }),
  },
  signal: {
    caption: 'THE ZERO SIGNAL', note: 'Somebody out there is being asked for a card.', scene: true,
    draw: () => {
      const beam = `<path d="M318,368 L334,368 L236,86 L96,112Z" fill="${LIME}" opacity="0.16"/>`;
      const lamp = shape(poly([[304, 352], [340, 340], [348, 372], [312, 384]]), PAPER, 5) + stroke('M326,380 L326,410 M312,410 H340', 6);
      const roof = `<rect x="-20" y="410" width="440" height="120" fill="${STONE}"/>` + stroke('M-20,410 H420', 5);
      return night(400, 480) + city(400, 480, 360) + signal(160, 104, 46) + beam + roof + lamp +
        `<g transform="translate(40,158) scale(0.62)">${zero({
          face: 'up', tails: 'left', legs: [[[176, 338], [160, 380], [150, 418]], [[224, 338], [240, 380], [250, 418]]],
          arms: [[[126, 230], [118, 272], [128, 300]], [[274, 230], [282, 272], [272, 300]]],
        })}</g>` + grain(400, 480);
    },
  },
  pdf: {
    caption: 'UNSOLD PDF', note: 'Reading the fine print, so you never have to.',
    draw: () => {
      const sheet = [[140, 258], [260, 256], [262, 330], [266, 410], [300, 432], [342, 438], [344, 452], [262, 452], [146, 450], [144, 350]];
      const txt = [276, 290, 304, 326, 340, 354, 376, 390, 412].map((y, i) =>
        stroke(line([[158, y], [i % 3 === 2 ? 204 : 244, y]], 0.8), 4)).join('');
      return zero({
        face: 'down', backdrop: spotlight, legs: LEGS,
        midFront: shape(smooth(sheet, true), '#FFFFFF', 7) + txt,
        arms: [[[128, 222], [118, 250], [146, 262]], [[272, 222], [282, 250], [254, 262]]],
        front: floor(90, 350),
      });
    },
  },
  gym: {
    caption: 'UNSOLD GYM', note: 'Deadlifting two more zeros. Chalk, not hype.',
    draw: () => {
      const plate = (x) => shape(capsule(x, 400, 44, 104, 0.4), LIME, 6) + shape(capsule(x, 400, 16, 56, 0.3), INK, 4);
      const chalk = [[150, 360], [162, 372], [140, 378], [258, 364], [246, 376], [262, 382], [154, 350], [248, 352]]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="${PAPER}" opacity="0.8"/>`).join('');
      return zero({
        face: 'grit', tails: 'right',
        legs: [[[174, 338], [132, 376], [146, 436]], [[226, 338], [268, 376], [254, 436]]],
        arms: [[[128, 244], [138, 330], [160, 398]], [[272, 244], [262, 330], [240, 398]]],
        behind: stroke(line([[50, 400], [350, 400]], 0.6), 10),
        front: plate(70) + plate(330) + stroke('M60,400 H340', 10) + fist(160, 398) + fist(240, 398) + chalk +
          stroke(line([[40, 454], [360, 454]], 1), 6),
      });
    },
  },
  punch: {
    caption: 'THROUGH THE PAYWALL', note: 'The only wall Zero builds is none.',
    draw: () => {
      const wall = shape(poly([[318, 150], [390, 150], [390, 452], [318, 452]]), RED, 7) +
        [196, 242, 334, 380, 426].map((y, i) => stroke(`M318,${y} H390 M${i % 2 ? 342 : 366},${y - 46} V${y}`, 3.5)).join('') +
        shape(poly([[326, 272], [382, 272], [382, 318], [326, 318]]), INK, 4) +
        text('PAY', 354, 292, 15, { anchor: 'middle' }) + text('WALL', 354, 311, 15, { anchor: 'middle' });
      const cracks = stroke('M322,246 L346,232 L360,240 M322,246 L344,262 L352,284 M322,246 L340,212', 4);
      const debris = [[292, 206, 10], [276, 228, 7], [300, 186, 6], [286, 262, 8]]
        .map(([x, y, r]) => shape(smooth([[x - r, y - r / 2], [x + r / 2, y - r], [x + r, y + r / 2], [x - r / 3, y + r]], true), RED, 3.5)).join('');
      return zero({
        face: 'grit', tails: 'left',
        legs: [[[176, 338], [148, 386], [124, 430]], [[224, 338], [254, 382], [266, 430]]],
        behind: wall + cracks,
        arms: [[[126, 236], [104, 262], [116, 292]], [[274, 236], [296, 242], [318, 246]]],
        front: debris + tick([60, 210], [92, 210]) + tick([52, 236], [90, 236]) + tick([66, 262], [94, 262]) + floor(80, 312),
      });
    },
  },
  private: {
    caption: 'PRIVATE', note: 'Your files stay between you and your computer.',
    draw: () => zero({
      face: 'side', legs: LEGS,
      arms: [[[126, 222], [108, 262], [110, 298]], [[274, 240], [250, 258], [214, 232]]],
      front: tick([214, 222], [214, 202], 7) + floor(),
      after: `<g transform="rotate(-10 320 150)">${text('shh', 292, 162, 30)}</g>`,
    }),
  },
  yours: {
    caption: 'YOURS', note: 'Taking everything with it, whenever it likes.',
    draw: () => {
      const folder =
        shape(poly([[150, 256], [250, 250], [252, 290], [152, 292]]), PAPER, 5) +
        shape(poly([[132, 264], [136, 248], [182, 248], [190, 264]]), LIME, 6) +
        shape(poly([[132, 264], [268, 264], [264, 350], [136, 350]]), '#FFFFFF', 7) +
        text('YOUR FILES', 200, 316, 17, { anchor: 'middle', fill: INK });
      return zero({
        face: 'stoic', tails: 'left',
        legs: [[[176, 338], [150, 382], [136, 428]], [[224, 338], [244, 380], [266, 424]]],
        midFront: folder,
        arms: [[[126, 232], [112, 266], [136, 300]], [[274, 232], [288, 266], [264, 300]]],
        front: tick([56, 318], [92, 318]) + tick([44, 344], [86, 344]) + tick([60, 370], [90, 370]) + floor(90, 310),
      });
    },
  },
  coffee: {
    caption: 'OFF DUTY', note: 'Free software, and not making a big deal of it.',
    draw: () => {
      const cup = shape(poly([[252, 218], [290, 218], [285, 262], [257, 262]]), '#FFFFFF', 6) +
        `<path d="M254,232 H288 L286,246 H256Z" fill="${LIME}" stroke="${INK}" stroke-width="4"/>` +
        shape(poly([[248, 206], [294, 206], [294, 218], [248, 218]]), INK, 4) +
        stroke(line([[262, 196], [268, 184], [262, 172], [268, 160]], 0.3), 4, PAPER) +
        stroke(line([[278, 196], [284, 184], [278, 172], [284, 160]], 0.3), 4, PAPER);
      return zero({
        face: 'stoic', legs: [[[180, 338], [206, 382], [224, 428]], [[222, 338], [196, 382], [178, 428]]],
        arms: [[[126, 232], [98, 262], [128, 288]], [[274, 236], [300, 270], [272, 266]]],
        front: cup + fist(272, 266) + floor(),
      });
    },
  },
};

// ---- output
const doc = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${DEFS}${body}</svg>\n`;
for (const f of fs.readdirSync(out)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(out, f));
const drawn = Object.fromEntries(Object.entries(POSES).map(([k, p], i) => { seed = 5 + i * 97; return [k, p.draw()]; }));
for (const [key, art] of Object.entries(drawn)) fs.writeFileSync(path.join(out, `zero-${key}.svg`), doc(400, 480, art));
// The signal on its own, for layouts that bring their own night sky.
fs.writeFileSync(path.join(out, 'zero-signal-mark.svg'), doc(300, 210, signal(150, 105, 70)));

// The character sheet: four across, on night.
const keys = Object.keys(POSES);
const cards = keys.map((key, i) => `<g transform="translate(${40 + (i % 4) * 430},${130 + Math.floor(i / 4) * 600})">` +
  `<rect width="400" height="560" rx="18" fill="${DUSK}"/><clipPath id="card${i}"><rect width="400" height="480" rx="18"/></clipPath>` +
  `<g clip-path="url(#card${i})">${drawn[key]}</g>` +
  text(POSES[key].caption, 28, 516, 22) + text(POSES[key].note, 28, 540, 14, { weight: 500, fill: '#9A9A96' }) + '</g>');
fs.writeFileSync(path.join(out, 'zero-sheet.svg'), doc(1760, 1330,
  `<rect width="1760" height="1330" fill="${NIGHT}"/>` +
  text('ZERO, THE UNSOLD MASCOT', 40, 70, 36) +
  text("The logo's 0 as a comic-noir vigilante: mask band, slit eyes, fists, the orbit worn low like a belt.", 40, 104, 17, { weight: 500, fill: '#9A9A96' }) +
  cards.join('\n') + grain(1760, 1330)));

// Posters: a stacked all-caps headline, Zero, and a quiet sign-off.
const headline = (lines, fill, accent) => lines.map((l, i) =>
  text(l, 46, 196 + i * 60, 56, { tracking: -1, fill: i === lines.length - 1 ? accent : fill })).join('');
const place = (art) => `<g transform="translate(40,430) scale(0.62)">${art}</g>`;
const POSTERS = {
  'poster-walls': night(600, 800) + city(600, 800, 600) + signal(420, 250, 64) +
    `<path d="M470,700 L490,700 L470,240 L330,300Z" fill="${LIME}" opacity="0.14"/>` +
    `<rect x="-20" y="690" width="640" height="140" fill="${STONE}"/>` + stroke('M-20,690 H620', 5) +
    text('Unsold', 48, 76, 24) + text('free forever', 48, 104, 20, { weight: 500, fill: '#9A9A96' }) +
    headline(['THEY BUILT', 'WALLS.', "WE DIDN'T."], PAPER, LIME) + place(drawn.crossed) +
    text('STAY UNSOLD', 300, 770, 20, { tracking: 3, anchor: 'middle' }) + grain(600, 800),
  'poster-no-catch': `<rect width="600" height="800" fill="${LIME}"/><rect width="600" height="800" fill="url(#dots)" opacity="0.08"/>` +
    text('Unsold PDF', 48, 76, 24, { fill: INK }) + text('free forever', 48, 104, 20, { weight: 500, fill: INK }) +
    headline(['NO ACCOUNT.', 'NO ADS.', 'NO CATCH.'], INK, INK) +
    `<g transform="translate(150,330) scale(0.9)">${drawn.punch}</g>` +
    text('STAY UNSOLD', 300, 770, 20, { tracking: 3, anchor: 'middle', fill: INK }) + grain(600, 800),
  'poster-gym': night(600, 800) + `<path d="M230,-20 L370,-20 L520,800 L80,800Z" fill="${LIME}" opacity="0.1"/>` +
    `<g transform="rotate(-4 150 70)"><rect x="40" y="46" width="210" height="40" fill="${LIME}"/>${text('UNSOLD GYM', 145, 76, 22, { anchor: 'middle', fill: INK })}</g>` +
    headline(['LIFT MORE.', 'PAY NOTHING.'], PAPER, LIME) +
    `<g transform="translate(110,300) scale(0.95)">${drawn.gym}</g>` +
    text('COMING NEXT', 300, 770, 20, { tracking: 3, anchor: 'middle' }) + grain(600, 800),
};
for (const [name, body] of Object.entries(POSTERS)) fs.writeFileSync(path.join(out, `${name}.svg`), doc(600, 800, body));

// Social preview cards (1200 × 630). Link previews need PNG, so render these
// with any browser at 1200 × 630 and save as og-*.png (see brand/README.md).
const og = (lines, accent, app, art) =>
  night(1200, 630) + city(1200, 630, 560, { signs: false }) +
  `<rect x="-20" y="556" width="1240" height="100" fill="${STONE}"/>` + stroke('M-20,556 H1220', 5) +
  text(app, 72, 96, 30) + text('free forever', 72, 132, 24, { weight: 500, fill: '#9A9A96' }) +
  lines.map((l, i) => text(l, 70, 250 + i * 74, 70, { tracking: -1.5, fill: i === lines.length - 1 ? accent : PAPER })).join('') +
  art + grain(1200, 630);
fs.writeFileSync(path.join(out, 'og-unsold.svg'), doc(1200, 630, og(
  ['FREE SOFTWARE.', 'NOT FOR SALE.', 'NEITHER ARE YOU.'], LIME, 'Unsold',
  signal(1000, 120, 62) + `<path d="M905,556 L925,556 L1050,150 L950,150Z" fill="${LIME}" opacity="0.16"/>` +
  `<g transform="translate(830,236) scale(0.7)">${drawn.crossed}</g>`)));
fs.writeFileSync(path.join(out, 'og-pdf.svg'), doc(1200, 630, og(
  ['THE PDF EDITOR', "THAT ISN'T", 'FOR SALE.'], LIME, 'Unsold PDF',
  `<g transform="translate(800,226) scale(0.72)">${drawn.pdf}</g>`)));
console.log(`wrote ${fs.readdirSync(out).filter((f) => f.endsWith('.svg')).length} files to brand/mascot/`);
