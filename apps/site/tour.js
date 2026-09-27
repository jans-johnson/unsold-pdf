// The feature tour: a pinned, scroll-scrubbed walk through the app. One app
// window rises out of a 3D tilt, then plays four features in turn (edit
// text, fill and sign, arrange pages, OCR) exactly as far as you've
// scrolled. Chips for the other tools drift past at different depths.

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const f1 = (n) => Math.round(n * 10) / 10;
const mix = (a, b, t) => {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',')})`;
};

// [start, end] of each part of the section, as scroll progress
const STEPS = [
  {
    key: 'edit',
    from: 0.1,
    to: 0.3,
    glow: '201, 63, 155',
    tab: 'agreement.pdf',
  },
  {
    key: 'sign',
    from: 0.3,
    to: 0.5,
    glow: '227, 106, 31',
    tab: 'consent-form.pdf',
  },
  { key: 'pages', from: 0.5, to: 0.7, glow: '47, 127, 230', tab: 'report.pdf' },
  {
    key: 'ocr',
    from: 0.7,
    to: 0.9,
    glow: '123, 92, 230',
    tab: 'scan-0412.pdf',
  },
];

const CHIPS = [
  // label, x %, y %, depth (bigger = nearer and faster). Kept clear of the text column.
  ['Compress', 48, 18, 0.5],
  ['Convert to Word', 90, 14, 0.9],
  ['Split', 97, 58, 0.4],
  ['Password protect', 94, 92, 1.1],
  ['Compare', 74, 98, 0.6],
  ['Watermarks', 63, 6, 0.35],
  ['Digital signatures', 88, 80, 1.2],
  ['Page numbers', 46, 72, 0.45],
  ['Excel', 78, 2, 0.8],
  ['Rotate & crop', 97, 34, 0.7],
  ['Create PDF', 41, 10, 1.0],
  ['Bookmarks', 3, 26, 0.3],
];

const SIGNATURE =
  'M6 34 C 12 12, 22 8, 22 26 C 22 40, 30 40, 34 24 C 36 16, 40 16, 40 28 C 40 36, 46 36, 50 26 C 54 16, 58 18, 58 30 C 60 38, 66 34, 70 24 C 74 14, 80 16, 80 28 C 80 36, 88 34, 94 22 C 98 14, 104 18, 106 26 C 110 34, 118 28, 126 20 M 18 42 C 48 38, 96 36, 150 30';

const bars = (...w) =>
  w.map((x) => `<i class="bar" style="width:${x}%"></i>`).join('');

const WINDOW = `
<div class="win">
  <div class="win-bar"><i></i><i></i><i></i><span class="win-tab">agreement.pdf</span></div>
  <div class="win-tools"><b></b><b></b><b></b><span></span><em class="pill">Recognize text</em><b></b><b></b></div>
  <div class="win-stage">
    <div class="layer" data-layer="edit">
      <div class="page">
        <h4>Service agreement</h4>
        ${bars(92, 86, 64)}
        <p class="edit-line"><span>Monthly fee:</span> <span class="val">$19.99</span><i class="caret"></i></p>
        ${bars(88, 94, 72, 80, 40, 86, 66)}
      </div>
    </div>
    <div class="layer" data-layer="sign">
      <div class="page">
        <h4>Consent form</h4>
        ${bars(90, 70)}
        <div class="field" data-f="name"><label>Full name</label><span class="val"></span></div>
        <div class="field" data-f="date"><label>Date</label><span class="val"></span></div>
        <div class="sig"><label>Signature</label><svg viewBox="0 0 160 48"><path d="${SIGNATURE}" pathLength="1"/></svg></div>
        <span class="chip ok">Signed ✓</span>
      </div>
    </div>
    <div class="layer" data-layer="pages">
      <div class="thumbs">
        ${[1, 2, 3, 4, 5].map((n) => `<div class="thumb" data-p="a${n}"><div class="sheet">${n === 4 ? `<i class="chart"></i>${bars(80)}` : bars(70, 90, 80, 60)}</div><span>${n}</span></div>`).join('')}
        ${[6, 7].map((n) => `<div class="thumb other" data-p="b${n}"><div class="sheet"><i class="band"></i>${bars(80, 60)}</div><span>${n}</span></div>`).join('')}
      </div>
    </div>
    <div class="layer" data-layer="ocr">
      <div class="page scan">
        <h4>INVOICE</h4>
        <p>Invoice no. <span class="hit">2041</span></p>
        <p>Date: 12 March 2026</p>
        <p>Bill to: Alex Rivera</p>
        <p class="row"><span>Design work</span><span>1,200.00</span></p>
        <p class="row"><span>Printing</span><span>86.50</span></p>
        <p class="row total"><span>Total due</span><span>1,286.50</span></p>
        <i class="sweep"></i>
      </div>
      <div class="find"><span class="find-label">Find</span><span class="val"></span></div>
      <span class="chip ok">Searchable ✓</span>
    </div>
    <svg class="cursor" width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M2 2 L2 18 L6.5 14 L9.5 20.5 L12.5 19 L9.6 12.8 L15.5 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
  </div>
</div>`;

export function mountTour(section) {
  const q = (s) => section.querySelector(s);
  const qa = (s) => [...section.querySelectorAll(s)];
  q('.tour-win').innerHTML = WINDOW;
  q('.tour-float').innerHTML = CHIPS.map(
    ([label, x, y, d]) =>
      `<span class="float${d < 0.5 ? ' far' : ''}${d > 0.95 ? ' near' : ''}" style="left:${x}%;top:${y}%" data-d="${d}">${label}</span>`
  ).join('');

  const win = q('.tour-win');
  const stage = q('.win-stage');
  const tab = q('.win-tab');
  const cursor = q('.cursor');
  const pill = q('.pill');
  const head = q('.tour-head');
  const glows = qa('.tour-glows i');
  const more = q('.tour-more');
  const caps = qa('.tour-steps li');
  const floats = qa('.float');
  const layers = Object.fromEntries(
    qa('.layer').map((l) => [l.dataset.layer, l])
  );
  const E = {
    line: q('.edit-line'),
    fee: q('.edit-line .val'),
    name: q('[data-f=name]'),
    date: q('[data-f=date]'),
    sig: q('.sig path'),
    sigBox: q('.sig svg'),
    signed: q('[data-layer=sign] .chip'),
    thumbs: Object.fromEntries(qa('.thumb').map((t) => [t.dataset.p, t])),
    scan: q('.scan'),
    sweep: q('.sweep'),
    find: q('.find'),
    findVal: q('.find .val'),
    hit: q('.hit'),
    searchable: q('[data-layer=ocr] > .chip'),
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let geo = null;

  // positions measured without transforms, cached until resize
  const measure = () => {
    const W = stage.clientWidth,
      H = stage.clientHeight;
    const rel = (el, fx = 0.5, fy = 0.5) => {
      let x = 0,
        y = 0,
        n = el;
      while (n && n !== stage) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent;
      }
      return [x + el.offsetWidth * fx, y + el.offsetHeight * fy];
    };
    const slot = Math.min(76, (W - 28) / 7);
    stage.style.setProperty('--tw', `${slot * 0.78}px`);
    const centreShift =
      innerWidth > 900
        ? section.clientWidth / 2 - (win.offsetLeft + win.offsetWidth / 2)
        : 0;
    geo = {
      W,
      H,
      slot,
      centreShift,
      rest: [W * 0.78, H * 0.9],
      fee: rel(E.fee, 1, 0.6),
      name: rel(E.name, 0.4, 0.7),
      date: rel(E.date, 0.4, 0.7),
      sigA: rel(E.sigBox, 0.06, 0.6),
      sigB: rel(E.sigBox, 0.9, 0.6),
      pill: [
        pill.offsetLeft + pill.offsetWidth / 2 - stage.offsetLeft,
        pill.offsetTop + pill.offsetHeight * 0.6 - stage.offsetTop,
      ],
    };
  };

  const put = (el, x, y, extra = '') =>
    (el.style.transform = `translate(${f1(x)}px, ${f1(y)}px) ${extra}`);
  const typed = (full, t) =>
    full.slice(0, Math.round(full.length * clamp01(t)));
  let cur = [0, 0];
  const aim = (from, to, t) => {
    const e = ease(clamp01(t));
    cur = [lerp(from[0], to[0], e), lerp(from[1], to[1], e)];
  };

  // ---- each feature, as a function of its local progress t (0..1)
  const play = {
    edit(t) {
      const g = geo;
      aim(g.rest, g.fee, seg(t, 0.06, 0.24));
      const editing = t > 0.27 && t < 0.78;
      E.line.classList.toggle('editing', editing);
      E.line.classList.toggle('done', t >= 0.78);
      E.fee.textContent =
        t < 0.46
          ? '$19.99'.slice(0, 6 - Math.round(6 * seg(t, 0.3, 0.45)))
          : typed('$0, forever', seg(t, 0.48, 0.74));
    },
    sign(t) {
      const g = geo;
      if (t < 0.32) aim(g.rest, g.name, seg(t, 0.04, 0.14));
      else if (t < 0.58) aim(g.name, g.date, seg(t, 0.33, 0.41));
      else if (t < 0.64) aim(g.date, g.sigA, seg(t, 0.58, 0.64));
      else aim(g.sigA, g.sigB, seg(t, 0.64, 0.84));
      E.name.classList.toggle('active', t > 0.14 && t < 0.33);
      E.date.classList.toggle('active', t > 0.41 && t < 0.57);
      E.name.querySelector('.val').textContent = typed(
        'Alex Rivera',
        seg(t, 0.15, 0.31)
      );
      E.date.querySelector('.val').textContent = typed(
        '27 Sep 2026',
        seg(t, 0.42, 0.56)
      );
      E.sig.style.strokeDashoffset = 1 - seg(t, 0.64, 0.84);
      E.signed.classList.toggle('show', t > 0.87);
    },
    pages(t) {
      const { W, slot } = geo;
      const join = ease(seg(t, 0.58, 0.8));
      const left = lerp((W - 5 * slot) / 2, (W - 7 * slot) / 2, join);
      const move = ease(seg(t, 0.32, 0.52));
      // page 4 travels from slot 3 to slot 1; pages 2 and 3 step right to make room
      const slots = {
        a1: 0,
        a2: lerp(1, 2, move),
        a3: lerp(2, 3, move),
        a4: lerp(3, 1, move),
        a5: 4,
      };
      Object.entries(slots).forEach(([id, s], i) => {
        const th = E.thumbs[id];
        const appear = ease(seg(t, 0.02 + i * 0.03, 0.14 + i * 0.03));
        put(th, left + s * slot, (1 - appear) * 30);
        th.style.opacity = appear;
      });
      const lifted = t > 0.28 && t < 0.54;
      E.thumbs.a4.classList.toggle('lifted', lifted);
      ['b6', 'b7'].forEach((id, i) => {
        const th = E.thumbs[id];
        const come = ease(seg(t, 0.58 + i * 0.05, 0.78 + i * 0.05));
        put(
          th,
          lerp(W + 40 + i * 60, left + (5 + i) * slot, come),
          0,
          `rotate(${f1((1 - come) * 12)}deg)`
        );
        th.style.opacity = come;
      });
      const [ax, ay] = [left + 3 * slot + slot * 0.35, geo.H * 0.34 + 30];
      if (t < 0.3) aim(geo.rest, [ax, ay], seg(t, 0.12, 0.28));
      else if (t < 0.56) cur = [left + slots.a4 * slot + slot * 0.35, ay];
      else aim([left + slot * 1.35, ay], geo.rest, seg(t, 0.56, 0.7));
      tab.textContent = t > 0.8 ? 'report.pdf · 7 pages' : 'report.pdf';
    },
    ocr(t) {
      const g = geo;
      aim(g.rest, g.pill, seg(t, 0.05, 0.18));
      if (t > 0.3) aim(g.pill, g.rest, seg(t, 0.3, 0.45));
      pill.classList.toggle('pressed', t > 0.19 && t < 0.28);
      const clean = ease(seg(t, 0.3, 0.62));
      E.scan.style.transform = `rotate(${f1(lerp(-3.5, 0, clean) * 10) / 10}deg) translateY(${f1(lerp(4, 0, clean))}px)`;
      E.scan.style.filter = `blur(${(0.7 * (1 - clean)).toFixed(2)}px) contrast(${lerp(0.88, 1, clean).toFixed(2)})`;
      E.scan.style.background = mix('e9e3d3', 'ffffff', clean);
      E.scan.style.color = mix('3b3934', '1c1c1c', clean);
      const sweep = seg(t, 0.26, 0.62);
      E.sweep.style.opacity = sweep > 0 && sweep < 1 ? 1 : 0;
      E.sweep.style.top = `${f1(lerp(-30, E.scan.offsetHeight, sweep))}px`;
      E.find.classList.toggle('show', t > 0.66);
      E.findVal.textContent = typed('2041', seg(t, 0.68, 0.8));
      E.hit.classList.toggle('on', t > 0.81);
      E.searchable.classList.toggle('show', t > 0.86);
    },
  };

  let raf = 0;
  const render = () => {
    raf = 0;
    if (!geo) measure();
    const r = section.getBoundingClientRect();
    const total = section.offsetHeight - innerHeight;
    const p = clamp01(-r.top / total);
    const calm = reduce.matches;

    // intro: the headline lifts away as the window swings up into place
    const rise = calm ? 1 : ease(seg(p, 0.0, 0.1));
    head.style.opacity = 1 - seg(p, 0.03, 0.08);
    head.style.transform = `translateY(${f1(-40 * seg(p, 0.02, 0.09))}px)`;
    win.style.transform = calm
      ? 'none'
      : `translateX(${f1(geo.centreShift * (1 - rise))}px) translateY(${f1(90 * (1 - rise))}px) perspective(1600px) rotateX(${f1(30 * (1 - rise))}deg) scale(${lerp(0.84, 1, rise).toFixed(3)})`;
    q('.tour-steps').style.opacity =
      seg(p, 0.07, 0.11) * (1 - seg(p, 0.9, 0.94));
    more.style.opacity = seg(p, 0.91, 0.95);
    more.style.transform = `translateY(${f1(20 * (1 - seg(p, 0.91, 0.95)))}px)`;

    // which feature is showing, and how far into it we are
    let active = 0;
    STEPS.forEach((s, i) => {
      if (p >= s.from) active = i;
    });
    STEPS.forEach((s, i) => {
      const t = seg(p, s.from, s.to);
      const layer = layers[s.key];
      const enter = i === 0 ? 1 : ease(seg(t, 0, 0.1));
      const leave = i === STEPS.length - 1 ? 0 : ease(seg(t, 0.92, 1));
      const shown = i === active || (i === active - 1 && leave < 1);
      layer.style.visibility = shown ? 'visible' : 'hidden';
      layer.style.opacity = Math.min(enter, 1 - leave);
      glows[i].style.opacity = shown
        ? Math.min(enter, 1 - leave) * seg(p, 0.06, 0.12)
        : 0;
      layer.style.transform = `translateX(${f1((1 - enter) * 70 - leave * 70)}px) scale(${(1 - 0.04 * (1 - enter) - 0.04 * leave).toFixed(3)})`;
      if (i === active) play[s.key](t);
      const cap = caps[i];
      cap.classList.toggle('on', i === active);
      cap.style.setProperty(
        '--fill',
        i < active ? 1 : i === active ? t.toFixed(3) : 0
      );
    });
    const step = STEPS[active];
    if (step.key !== 'pages') tab.textContent = step.tab;
    pill.style.visibility = step.key === 'ocr' ? 'visible' : 'hidden';
    put(cursor, cur[0] - 2, cur[1] - 2);

    // other tools drift past at their own depth
    if (!calm) {
      for (const el of floats) {
        const d = +el.dataset.d;
        const dy = (0.5 - p) * innerHeight * 1.4 * d;
        el.style.transform = `translate(-50%, -50%) translateY(${f1(dy)}px)`;
        // fade out near the top and bottom edges, so nothing slides under the header
        const y = (parseFloat(el.style.top) / 100) * innerHeight + dy;
        el.style.opacity = Math.min(
          seg(y, 70, 150),
          seg(innerHeight - y, 20, 90)
        );
      }
    }
  };
  const request = () => {
    if (!raf) raf = requestAnimationFrame(render);
  };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', () => {
    geo = null;
    request();
  });
  reduce.addEventListener?.('change', request);
  document.fonts?.ready.then(() => {
    geo = null;
    request();
  });
  render();
}
