// The Paywall Maze, told as ink noir. Night, a city of red "PRO" signs, and
// you in a pool of streetlight with a PDF to sign and a straight line to
// "Done". As you scroll, rain starts, walls rise across the line (account,
// plan, card, Pro) and their signs flicker on, the camera pulls back to the
// whole maze glowing red, and then a searchlight throws the Zero Signal on
// the clouds, the rain stops, Zero steps in, the walls sink and you walk
// straight through.

const TX = 40,
  TY = 20,
  TZ = 40; // iso tile half-width, half-height, unit height
const G = 12; // maze size in cells
const THICK = 0.14,
  WALL_H = 0.85;
const P = (x, y, z = 0) => [(x - y) * TX, (x + y) * TY - z * TZ];
const f = (n) => Math.round(n * 10) / 10;
const pts = (list) => list.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
const poly = (list, fill, extra = '') =>
  `<polygon points="${pts(list)}" fill="${fill}"${extra}/>`;
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const SIGNAL = new URL('./assets/zero-signal-mark.svg', import.meta.url).href;
const ZERO = new URL('./assets/zero-crossed.svg', import.meta.url).href;
// walls are inked like a comic panel: dark edges, halftone on the shaded face
const WALL = { t: '#f5f4f0', l: '#c9c7c0', r: '#e2e0da', ink: true };
const NIGHT = { t: '#141416', l: '#0c0c0d', r: '#101012' };
const LIME = '#C8F53B';

function box(x, y, z, w, d, h, c) {
  const top = [
    P(x, y, z + h),
    P(x + w, y, z + h),
    P(x + w, y + d, z + h),
    P(x, y + d, z + h),
  ];
  const left = [
    P(x, y + d, z + h),
    P(x + w, y + d, z + h),
    P(x + w, y + d, z),
    P(x, y + d, z),
  ];
  const right = [
    P(x + w, y, z + h),
    P(x + w, y + d, z + h),
    P(x + w, y + d, z),
    P(x + w, y, z),
  ];
  if (!c.ink) return poly(left, c.l) + poly(right, c.r) + poly(top, c.t);
  const edge = ' stroke="#0b0b0c" stroke-width="1.1" stroke-linejoin="round"';
  return (
    poly(left, c.l, edge) +
    poly(left, 'url(#ht)') +
    poly(right, c.r, edge) +
    poly(top, c.t, edge)
  );
}

// Deterministic maze (depth-first carve), so every visitor sees the same one.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildWalls(seed) {
  const r = rng(seed);
  const id = (i, j) => `${i},${j}`;
  const edge = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const open = new Set(),
    seen = new Set([id(0, G - 1)]),
    stack = [[0, G - 1]];
  while (stack.length) {
    const [i, j] = stack.at(-1);
    const next = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([di, dj]) => [i + di, j + dj])
      .filter(
        ([a, b]) => a >= 0 && b >= 0 && a < G && b < G && !seen.has(id(a, b))
      );
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [a, b] = next[Math.floor(r() * next.length)];
    open.add(edge(id(i, j), id(a, b)));
    seen.add(id(a, b));
    stack.push([a, b]);
  }
  const walls = [];
  for (let j = 0; j <= G; j++)
    for (let i = 0; i < G; i++) {
      if (j === 0 || j === G || !open.has(edge(id(i, j - 1), id(i, j))))
        walls.push({ x: i, y: j - THICK / 2, w: 1, d: THICK });
    }
  for (let i = 0; i <= G; i++)
    for (let j = 0; j < G; j++) {
      if ((i === 0 && j === G - 1) || (i === G && j === 0)) continue; // way in, way out
      if (i === 0 || i === G || !open.has(edge(id(i - 1, j), id(i, j))))
        walls.push({ x: i - THICK / 2, y: j, w: THICK, d: 1 });
    }
  for (const w of walls) {
    w.cx = w.x + w.w / 2;
    w.cy = w.y + w.d / 2;
    w.u = clamp01((w.cx - w.cy + G) / (2 * G)); // progress along start → done
    w.jit = r();
    w.rise = 0.1 + 0.26 * w.u + 0.03 * w.jit;
    w.sink = 0.6 + 0.14 * w.u + 0.02 * w.jit;
  }
  return walls.sort((a, b) => a.cx + a.cy - (b.cx + b.cy) || a.cx - b.cx);
}

const STEPS = [
  'Create an account',
  'Verify your email',
  'Choose a plan',
  'Free trial — card required',
  'Signing is a Pro feature',
  'Remove watermark: $4.99',
];

const START = [0.5, G - 0.5],
  DONE = [G - 0.5, 0.5];

function label(text, sub = '', tone = 'sign', stem = 0) {
  const w = Math.round(Math.max(text.length * 6.9, sub.length * 5.6) + 30);
  const h = sub ? 42 : 28;
  // a raised label sits on a thin stem, so neighbours along the path don't collide
  return `<g class="label ${tone}">${stem ? `<line class="stem" x1="0" y1="-3" x2="0" y2="${-stem - 3}"/>` : ''}<g class="label-in" transform="translate(0 ${-stem})">
    <rect x="${-w / 2}" y="${-h - 8}" width="${w}" height="${h}" rx="8"/>
    <path d="M-5 -8.5 L0 -2 L5 -8.5z"/>
    ${tone === 'sign' ? `<circle class="dot" cx="${-w / 2 + 12}" cy="${-h - 8 + 14}" r="3"/>` : ''}
    <text x="${tone === 'sign' ? -w / 2 + 21 : 0}" y="${-h - 8 + 18.5}" ${tone === 'sign' ? '' : 'text-anchor="middle"'}>${text}</text>
    ${sub ? `<text class="sub" x="${-w / 2 + 21}" y="${-h - 8 + 33}">${sub}</text>` : ''}
  </g></g>`;
}

// The city behind the maze: dark blocks, a few lit windows, and the
// corporate walls' neon, in red. Drawn in view space, so it stays put while
// the camera moves (apart from a slow parallax).
const HORIZON = 40; // in view space
function skyline() {
  const r = rng(404);
  let s = '',
    signs = '',
    x = -1150;
  const neon = ['PRO', 'SUBSCRIBE', 'UPGRADE', 'PREMIUM', 'PLANS'];
  let k = 0;
  while (x < 1150) {
    const w = 50 + r() * 90,
      top = HORIZON - 70 - r() * 330;
    s += `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(HORIZON - top)}" fill="${k % 2 ? '#131317' : '#17171c'}"/>`;
    for (let wy = top + 16; wy < HORIZON - 20; wy += 22)
      for (let wx = x + 10; wx < x + w - 10; wx += 16)
        if (r() < 0.07)
          s += `<rect x="${f(wx)}" y="${f(wy)}" width="5" height="9" fill="#f5f4f0" opacity="${(0.12 + r() * 0.2).toFixed(2)}"/>`;
    if (k % 3 === 1 && top < -40)
      signs += `<text class="neon" x="${f(x + w / 2)}" y="${f(top - 10)}" text-anchor="middle" style="animation-delay:${(r() * 4).toFixed(2)}s">${neon[Math.floor(r() * neon.length)]}</text>`;
    x += w + 3;
    k++;
  }
  // the city's base dissolves into mist, so the maze sits in front of it
  return (
    s +
    signs +
    `<rect x="-1200" y="${HORIZON - 160}" width="2400" height="700" fill="url(#mist)"/>`
  );
}

export function mountMaze({ svg, story, lines, shade, rain }) {
  const walls = buildWalls(20260927);

  // label the path walls, spaced along the line
  const onPath = walls.filter((w) => Math.abs(w.cx + w.cy - G) < 0.6);
  const labelled = [];
  STEPS.forEach((text, k) => {
    const target = 0.14 + k * 0.14;
    const pick = onPath
      .filter((w) => !labelled.some((l) => l.wall === w))
      .sort((a, b) => Math.abs(a.u - target) - Math.abs(b.u - target))[0];
    if (pick) labelled.push({ wall: pick, text });
  });

  const [sx, sy] = P(...START),
    [dx, dy] = P(...DONE);
  const [mx, my] = P(G / 2, G / 2);
  const [zx, zy] = P(G / 2 - 2.2, G / 2 - 2.2); // just behind the path, not on it
  const [bx, by] = P(G / 2 + 3.4, G / 2 + 3.4); // the searchlight, in front of the path
  const pathLen = Math.hypot(dx - sx, dy - sy);

  let dots = '';
  for (let i = 0; i <= G; i++)
    for (let j = 0; j <= G; j++) {
      const [px, py] = P(i, j);
      dots += `<circle cx="${px}" cy="${py}" r="1.1"/>`;
    }
  const doneTile = [P(G - 1, 0), P(G, 0), P(G, 1), P(G - 1, 1)];
  const cancelAt = P(0.5, 0.5, 1.2);

  svg.innerHTML = `
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="${LIME}" stop-opacity="0.22"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
    <radialGradient id="redGlow"><stop offset="0" stop-color="#e5484d" stop-opacity="0.2"/><stop offset="1" stop-color="#e5484d" stop-opacity="0"/></radialGradient>
    <radialGradient id="lamp"><stop offset="0" stop-color="#f5f4f0" stop-opacity="0.2"/><stop offset="0.6" stop-color="#f5f4f0" stop-opacity="0.06"/><stop offset="1" stop-color="#f5f4f0" stop-opacity="0"/></radialGradient>
    <linearGradient id="beamFade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${LIME}" stop-opacity="0.28"/><stop offset="1" stop-color="${LIME}" stop-opacity="0.08"/></linearGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0b0c" stop-opacity="0"/><stop offset="0.23" stop-color="#0b0b0c" stop-opacity="1"/></linearGradient>
    <pattern id="ht" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="2.5" cy="2.5" r="1" fill="#0b0b0c" opacity="0.35"/></pattern>
  </defs>
  <g id="city">
    <ellipse cx="0" cy="-330" rx="1100" ry="150" fill="#121215"/>
    ${skyline()}
  </g>
  <g id="cam">
    ${box(-0.7, -0.7, -0.35, G + 1.4, G + 1.4, 0.35, NIGHT)}
    <g class="grid-dots">${dots}</g>
    <ellipse id="floorGlow" cx="${mx}" cy="${my}" rx="470" ry="235" fill="url(#glow)" opacity="0"/>
    <ellipse id="floorRed" cx="${mx}" cy="${my}" rx="520" ry="260" fill="url(#redGlow)" opacity="0"/>
    <ellipse id="pool" cx="${sx}" cy="${sy}" rx="90" ry="45" fill="url(#lamp)"/>
    <polygon id="beam" points="${pts([
      [bx - 5, by],
      [bx + 5, by],
      [mx + 150, my - 375],
      [mx - 150, my - 375],
    ])}" fill="url(#beamFade)" opacity="0"/>
    <polygon id="doneTile" points="${pts(doneTile)}"/>
    <line id="hope" x1="${sx}" y1="${sy}" x2="${dx}" y2="${dy}"/>
    <line id="way" x1="${sx}" y1="${sy}" x2="${dx}" y2="${dy}" stroke-dasharray="${pathLen}" stroke-dashoffset="${pathLen}"/>
    <g id="walls"></g>
    <g id="you">
      <ellipse class="ring" rx="17" ry="8.5"/>
      <ellipse rx="9" ry="4.5" fill="#000" opacity="0.5"/>
      <g class="figure">
        <rect x="-5.5" y="-25" width="11" height="17" rx="5.5" fill="#f5f4f0"/>
        <circle cy="-31" r="5.5" fill="#f5f4f0"/>
        <rect x="-3" y="-8.5" width="2.4" height="8.5" rx="1.2" fill="#d9d7d0"/>
        <rect x="0.6" y="-8.5" width="2.4" height="8.5" rx="1.2" fill="#d9d7d0"/>
        <g transform="translate(6 -22) rotate(8)">
          <rect width="9" height="11.5" rx="1.2" fill="#fff" stroke="#bdbab2" stroke-width="0.8"/>
          <path d="M2 4 h5 M2 6.5 h5 M2 9 h3" stroke="#bdbab2" stroke-width="0.8"/>
          <path id="tick" d="M2 6.5 l2 2 l3.4 -4" fill="none" stroke="${LIME}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>
        </g>
      </g>
    </g>
    <g id="searchlight" opacity="0" transform="translate(${f(bx)} ${f(by)})">
      <path d="M-7 0 L7 0 L5 -9 L-5 -9Z" fill="#f5f4f0"/>
      <path d="M-4 0 L-6 7 M4 0 L6 7" stroke="#6c6b66" stroke-width="1.4"/>
    </g>
    <image id="orbit" href="${SIGNAL}" x="${mx - 150}" y="${my - 480}" width="300" height="210" opacity="0"/>
    <image id="zero" href="${ZERO}" x="${zx - 60}" y="${zy - 136}" width="120" height="144" opacity="0"/>
    <g id="labels"></g>
  </g>`;

  const cam = svg.querySelector('#cam');
  const wallsEl = svg.querySelector('#walls');
  const labelsEl = svg.querySelector('#labels');
  const you = svg.querySelector('#you');
  const hope = svg.querySelector('#hope');
  const way = svg.querySelector('#way');
  const tick = svg.querySelector('#tick');
  const orbit = svg.querySelector('#orbit');
  const zero = svg.querySelector('#zero');
  const glow = svg.querySelector('#floorGlow');
  const red = svg.querySelector('#floorRed');
  const pool = svg.querySelector('#pool');
  const beam = svg.querySelector('#beam');
  const searchlight = svg.querySelector('#searchlight');
  const city = svg.querySelector('#city');
  const doneEl = svg.querySelector('#doneTile');

  labelsEl.innerHTML =
    labelled
      .map(
        (l, k) =>
          `<g data-k="${k}">${label(l.text, '', 'sign', k % 2 ? 40 : 0)}</g>`
      )
      .join('') +
    `<g data-cancel>${label('Cancel subscription', 'call us · weekdays, 9–5', 'sign')}</g>` +
    `<g data-you>${label('you', '', 'you')}</g>` +
    `<g data-done>${label('Done', '', 'done')}</g>`;
  const labelEls = [...labelsEl.querySelectorAll('[data-k]')];
  const cancelEl = labelsEl.querySelector('[data-cancel]');
  const youLabel = labelsEl.querySelector('[data-you]');
  const doneLabel = labelsEl.querySelector('[data-done]');
  const doneText = doneLabel.querySelector('text');

  const VIEW = { x: -760, y: -380, w: 1520, h: 1000 };
  svg.setAttribute('viewBox', `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  // camera keyframes: [progress, subject x, subject y, zoom]
  const K = [
    [0.0, sx + 40, sy - 20, 2.3],
    [0.1, sx + 60, sy - 20, 2.2],
    [0.4, -60, my - 10, 1.45],
    [0.52, 0, my - 10, 0.92],
    [0.64, 0, my - 30, 0.92],
    [0.8, 60, my - 20, 1.0],
    [0.95, dx - 20, dy - 20, 2.3],
    [1.0, dx - 20, dy - 20, 2.35],
  ];
  const cameraAt = (p) => {
    for (let k = 1; k < K.length; k++) {
      if (p <= K[k][0]) {
        const [p0, x0, y0, z0] = K[k - 1],
          [p1, x1, y1, z1] = K[k];
        const t = ease((p - p0) / (p1 - p0 || 1));
        return [lerp(x0, x1, t), lerp(y0, y1, t), z0 * Math.pow(z1 / z0, t)];
      }
    }
    return K.at(-1).slice(1);
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let lastWalls = '',
    raf = 0;

  const render = () => {
    raf = 0;
    const W = innerWidth,
      H = innerHeight,
      wide = W > 900;
    const total = story.offsetHeight - H;
    const p = reduce.matches
      ? 0.56
      : clamp01(-story.getBoundingClientRect().top / total);

    // camera: keep the subject clear of the text (left column when wide, bottom panel on phones)
    const unit = Math.max(W / VIEW.w, H / VIEW.h); // screen px per scene unit at zoom 1
    const fit = clamp01(W / H / (VIEW.w / VIEW.h)) * 0.5 + 0.5;
    let [cx, cy, z] = cameraAt(p);
    z *= wide ? 1 : fit;
    if (wide) cx -= (0.19 * W) / (unit * z);
    else cy += (0.13 * H) / (unit * z);
    cam.setAttribute(
      'transform',
      `translate(${f(VIEW.x + VIEW.w / 2)} ${f(VIEW.y + VIEW.h / 2)}) scale(${z.toFixed(4)}) translate(${f(-cx)} ${f(-cy)})`
    );
    const labelScale = (wide ? 1 : 0.86) / (unit * z); // labels stay a steady size on screen
    // on small screens the wall signs only show up close; zoomed out they'd pile up
    const signRoom = wide ? 1 : clamp01((unit * z - 0.62) / 0.12);

    // walls
    let s = '';
    const heights = new Map();
    for (const w of walls) {
      const h =
        WALL_H *
        clamp01((p - w.rise) / 0.04) *
        (1 - clamp01((p - w.sink) / 0.04));
      heights.set(w, h);
      if (h > 0.004) s += box(w.x, w.y, 0, w.w, w.d, h, WALL);
    }
    if (s !== lastWalls) {
      wallsEl.innerHTML = s;
      lastWalls = s;
    }

    // the path: hope fades as walls rise; the lime way draws as they sink
    hope.style.opacity = 1 - clamp01((p - 0.12) / 0.2);
    way.style.strokeDashoffset = f(pathLen * (1 - clamp01((p - 0.66) / 0.12)));
    const lit = clamp01((p - 0.6) / 0.06);
    orbit.style.opacity = lit;
    orbit.style.transform = `translateY(${f((1 - lit) * 40)}px)`;
    const land = clamp01((p - 0.7) / 0.05); // once the walls round it are down
    zero.style.opacity = land;
    zero.style.transform = `translateY(${f(-(1 - ease(land)) * 90)}px)`;
    glow.style.opacity = lit;
    // night: the streetlight pool, rain while the walls stand, the red glow
    // of the maze at its worst, then the searchlight
    const walled = clamp01((p - 0.14) / 0.2);
    pool.style.opacity = 1 - clamp01((p - 0.1) / 0.2);
    red.style.opacity = walled * (1 - lit);
    beam.style.opacity = searchlight.style.opacity = lit;
    if (rain) rain.style.opacity = f(0.25 + 0.75 * walled) * (1 - lit);
    city.setAttribute('transform', `translate(0 ${f(40 - p * 90)})`);

    // you walk to Done once the way is clear
    const walk = ease(clamp01((p - 0.7) / 0.14));
    const [yx, yy] = P(
      lerp(START[0], DONE[0], walk),
      lerp(START[1], DONE[1], walk)
    );
    you.setAttribute('transform', `translate(${f(yx)} ${f(yy)})`);
    you.classList.toggle('walking', walk > 0 && walk < 1);
    const signed = clamp01((p - 0.88) / 0.04);
    tick.style.opacity = signed;
    doneEl.classList.toggle('reached', signed > 0.5);

    // labels
    const place = (el, x, y, o) => {
      el.setAttribute(
        'transform',
        `translate(${f(x)} ${f(y)}) scale(${labelScale.toFixed(4)})`
      );
      el.style.opacity = o;
    };
    labelled.forEach((l, k) => {
      const h = heights.get(l.wall);
      const [lx, ly] = P(l.wall.cx, l.wall.cy, h + 0.1);
      const o =
        signRoom *
        clamp01((h / WALL_H - 0.7) / 0.3) *
        (1 - clamp01((p - 0.58) / 0.03));
      place(labelEls[k], lx, ly, o);
      labelEls[k].classList.toggle('on', o > 0.5); // neon flickers as it comes on
    });
    place(
      cancelEl,
      cancelAt[0],
      cancelAt[1],
      clamp01((p - 0.47) / 0.04) * (1 - clamp01((p - 0.6) / 0.03))
    );
    place(youLabel, yx, yy - 44, 1 - clamp01((p - 0.66) / 0.04));
    const [lx, ly] = P(G - 0.5, 0.5, 0.3);
    place(doneLabel, lx, ly, 1);
    doneText.textContent = signed > 0.5 ? 'Signed ✓' : 'Done';
    doneLabel.classList.toggle('reached', signed > 0.5);

    // copy
    for (const el of lines) {
      const a = +el.dataset.in,
        b = +el.dataset.out;
      const fadeIn = a === 0 ? 1 : (p - a) / 0.035;
      const fadeOut = b >= 1 ? 1 : (b - p) / 0.035;
      const o = clamp01(Math.min(fadeIn, fadeOut));
      el.style.opacity = o;
      el.style.translate = `0 ${f((1 - o) * 12)}px`;
      el.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    }
    shade.style.opacity = 1;
  };
  const request = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  reduce.addEventListener?.('change', request);
  render();
}
