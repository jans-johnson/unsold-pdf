// Feature demos: small looping animations of the app at work, drawn in the
// app's own interface style (dark chrome, white page, blue selection). Each
// loop only advances while its card is on screen.

const CURSOR = `<svg class="cursor" width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M2 2 L2 18 L6.5 14 L9.5 20.5 L12.5 19 L9.6 12.8 L15.5 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const bars = (...widths) =>
  widths.map((w) => `<i class="bar" style="width:${w}%"></i>`).join('');

function frame(tab, stage, tools = '') {
  return `<div class="win">
    <div class="win-bar"><i></i><i></i><i></i><span class="win-tab">${tab}</span></div>
    <div class="win-tools"><b></b><b></b><b></b><span></span>${tools}<b></b><b></b></div>
    <div class="win-stage">${stage}${CURSOR}</div>
  </div>`;
}

// ---- helpers shared by every demo
function kit(root) {
  const stage = root.querySelector('.win-stage');
  const cursor = root.querySelector('.cursor');
  const $ = (s) => root.querySelector(s);
  // put the cursor tip at a point inside the target (fx, fy are fractions of its box)
  const point = (el, fx = 0.5, fy = 0.5) => {
    const s = stage.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    return [r.left - s.left + r.width * fx, r.top - s.top + r.height * fy];
  };
  const moveTo = (el, fx, fy) => {
    const [x, y] = point(el, fx, fy);
    cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
  };
  // rest the cursor at a fraction of the window
  const park = (fx, fy) => {
    cursor.style.transform = `translate(${stage.clientWidth * fx}px, ${stage.clientHeight * fy}px)`;
  };
  const click = () => {
    cursor.classList.remove('click');
    void cursor.getBoundingClientRect();
    cursor.classList.add('click');
  };
  return { stage, cursor, $, moveTo, park, click };
}

async function type(el, text, wait, speed = 55) {
  for (const ch of text) {
    el.textContent += ch;
    await wait(speed);
  }
}
async function erase(el, wait, speed = 40) {
  while (el.textContent.length) {
    el.textContent = el.textContent.slice(0, -1);
    await wait(speed);
  }
}

// ---------------------------------------------------------------- 1. edit text
const edit = {
  html: () =>
    frame(
      'agreement.pdf',
      `<div class="page">
        <h4>Service agreement</h4>
        ${bars(92, 86, 64)}
        <p class="edit-line"><span>Monthly fee:</span> <span class="val">$19.99</span><i class="caret"></i></p>
        ${bars(88, 94, 72, 80, 40)}
      </div>`
    ),
  reset(k) {
    k.$('.val').textContent = '$19.99';
    k.$('.edit-line').classList.remove('editing', 'done');
    k.park(0.85, 0.88);
  },
  still(k) {
    k.$('.val').textContent = '$0, forever';
    k.$('.edit-line').classList.add('done');
  },
  async run(k, wait) {
    this.reset(k);
    await wait(700);
    k.moveTo(k.$('.val'), 1, 0.55);
    await wait(900);
    k.click();
    k.$('.edit-line').classList.add('editing');
    await wait(500);
    await erase(k.$('.val'), wait);
    await wait(250);
    await type(k.$('.val'), '$0, forever', wait, 70);
    await wait(500);
    k.$('.edit-line').classList.replace('editing', 'done');
    await wait(2600);
  },
};

// ---------------------------------------------------------------- 2. fill & sign
const SIGNATURE =
  'M6 34 C 12 12, 22 8, 22 26 C 22 40, 30 40, 34 24 C 36 16, 40 16, 40 28 C 40 36, 46 36, 50 26 C 54 16, 58 18, 58 30 C 60 38, 66 34, 70 24 C 74 14, 80 16, 80 28 C 80 36, 88 34, 94 22 C 98 14, 104 18, 106 26 C 110 34, 118 28, 126 20 M 18 42 C 48 38, 96 36, 150 30';
const sign = {
  html: () =>
    frame(
      'consent-form.pdf',
      `<div class="page">
        <h4>Consent form</h4>
        ${bars(90, 70)}
        <div class="field" data-f="name"><label>Full name</label><span class="val"></span></div>
        <div class="field" data-f="date"><label>Date</label><span class="val"></span></div>
        <div class="sig">
          <label>Signature</label>
          <svg viewBox="0 0 160 48"><path d="${SIGNATURE}" pathLength="1"/></svg>
        </div>
        <span class="chip ok">Signed ✓</span>
      </div>`
    ),
  reset(k) {
    k.root.querySelectorAll('.field .val').forEach((v) => (v.textContent = ''));
    k.root
      .querySelectorAll('.field')
      .forEach((f) => f.classList.remove('active'));
    k.$('.sig').classList.remove('drawn', 'active');
    k.$('.chip').classList.remove('show');
    k.park(0.8, 0.9);
  },
  still(k) {
    k.$('[data-f=name] .val').textContent = 'Alex Rivera';
    k.$('[data-f=date] .val').textContent = '27 Sep 2026';
    k.$('.sig').classList.add('drawn');
    k.$('.chip').classList.add('show');
  },
  async run(k, wait) {
    this.reset(k);
    await wait(600);
    for (const [f, text] of [
      ['name', 'Alex Rivera'],
      ['date', '27 Sep 2026'],
    ]) {
      const field = k.$(`[data-f=${f}]`);
      k.moveTo(field, 0.45, 0.72);
      await wait(800);
      k.click();
      field.classList.add('active');
      await type(field.querySelector('.val'), text, wait);
      await wait(250);
      field.classList.remove('active');
    }
    k.moveTo(k.$('.sig svg'), 0.1, 0.6);
    await wait(800);
    k.click();
    k.$('.sig').classList.add('active', 'drawn');
    k.cursor.style.transform += ' translateX(120px)';
    await wait(1500);
    k.$('.sig').classList.remove('active');
    k.$('.chip').classList.add('show');
    await wait(2600);
  },
};

// ---------------------------------------------------------------- 3. pages
const pages = {
  html: () =>
    frame(
      'report.pdf',
      `<div class="thumbs">
        ${[1, 2, 3, 4, 5].map((n) => `<div class="thumb" data-p="a${n}"><div class="sheet">${n === 4 ? `<i class="chart"></i>${bars(80)}` : bars(70, 90, 80, 60)}</div><span>${n}</span></div>`).join('')}
        ${[1, 2].map((n) => `<div class="thumb other" data-p="b${n}"><div class="sheet"><i class="band"></i>${bars(80, 60)}</div><span></span></div>`).join('')}
      </div>`
    ),
  layout(k, order, incoming = []) {
    const W = k.stage.clientWidth;
    const slot = Math.min(72, (W - 28) / 7);
    k.stage.style.setProperty('--tw', `${slot * 0.78}px`);
    const count = order.length + incoming.length;
    const left = (W - slot * count) / 2;
    order.forEach((id, i) => {
      const t = k.$(`[data-p=${id}]`);
      t.style.transform = `translate(${left + i * slot}px, 0)`;
      t.querySelector('span').textContent = i + 1;
      t.classList.remove('away');
    });
    incoming.forEach((id, i) => {
      const t = k.$(`[data-p=${id}]`);
      t.style.transform = `translate(${left + (order.length + i) * slot}px, 0)`;
    });
    return { slot, left };
  },
  reset(k) {
    k.root
      .querySelectorAll('.thumb')
      .forEach((t) => t.classList.add('instant'));
    this.layout(k, ['a1', 'a2', 'a3', 'a4', 'a5']);
    k.root.querySelectorAll('.thumb.other').forEach((t, i) => {
      t.classList.add('away');
      t.style.transform = `translate(${k.stage.clientWidth + 40 + i * 70}px, 0)`;
    });
    k.$('.win-tab').textContent = 'report.pdf';
    k.park(0.7, 0.9);
    void k.stage.offsetWidth;
    k.root
      .querySelectorAll('.thumb')
      .forEach((t) => t.classList.remove('instant', 'lifted'));
  },
  still(k) {
    this.reset(k);
    const order = ['a1', 'a4', 'a2', 'a3', 'a5', 'b1', 'b2'];
    this.layout(k, order);
    k.$('.win-tab').textContent = 'report.pdf · 7 pages';
  },
  async run(k, wait) {
    this.reset(k);
    await wait(700);
    const p4 = k.$('[data-p=a4]');
    k.moveTo(p4, 0.5, 0.45);
    await wait(900);
    k.click();
    p4.classList.add('lifted');
    await wait(300);
    // drag page 4 into second place; the cursor travels with it
    const { slot } = this.layout(k, ['a1', 'a4', 'a2', 'a3', 'a5']);
    k.cursor.style.transform = k.cursor.style.transform.replace(
      /translate\(([-\d.]+)px/,
      (_, x) => `translate(${+x - slot * 2}px`
    );
    await wait(900);
    p4.classList.remove('lifted');
    await wait(900);
    // a second file slides in and joins
    k.park(0.88, 0.92);
    this.layout(k, ['a1', 'a4', 'a2', 'a3', 'a5'], ['b1', 'b2']);
    k.root
      .querySelectorAll('.thumb.other')
      .forEach((t) => t.classList.remove('away'));
    await wait(900);
    this.layout(k, ['a1', 'a4', 'a2', 'a3', 'a5', 'b1', 'b2']);
    k.$('.win-tab').textContent = 'report.pdf · 7 pages';
    await wait(2800);
  },
};

// ---------------------------------------------------------------- 4. OCR
const ocr = {
  html: () =>
    frame(
      'scan-0412.pdf',
      `<div class="page scan">
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
      <span class="chip ok">Searchable ✓</span>`,
      '<em class="pill">Recognize text</em>'
    ),
  reset(k) {
    k.$('.scan').classList.remove('clean', 'sweeping');
    k.$('.hit').classList.remove('on');
    k.$('.find').classList.remove('show');
    k.$('.find .val').textContent = '';
    k.$('.chip').classList.remove('show');
    k.$('.pill').classList.remove('pressed');
    k.park(0.4, 0.9);
  },
  still(k) {
    k.$('.scan').classList.add('clean');
    k.$('.find').classList.add('show');
    k.$('.find .val').textContent = '2041';
    k.$('.hit').classList.add('on');
    k.$('.chip').classList.add('show');
  },
  async run(k, wait) {
    this.reset(k);
    await wait(700);
    k.moveTo(k.$('.pill'), 0.5, 0.6);
    await wait(1000);
    k.click();
    k.$('.pill').classList.add('pressed');
    k.$('.scan').classList.add('sweeping');
    await wait(700);
    k.$('.scan').classList.add('clean');
    k.park(0.7, 0.92);
    await wait(1400);
    k.$('.pill').classList.remove('pressed');
    k.$('.find').classList.add('show');
    await wait(400);
    await type(k.$('.find .val'), '2041', wait, 110);
    k.$('.hit').classList.add('on');
    await wait(300);
    k.$('.chip').classList.add('show');
    await wait(2800);
  },
};

const DEMOS = { edit, sign, pages, ocr };

export function mountFeatures(root = document) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of root.querySelectorAll('[data-demo]')) {
    const demo = DEMOS[el.dataset.demo];
    if (!demo) continue;
    el.innerHTML = demo.html();
    const k = { ...kit(el), root: el };
    if (reduce) {
      demo.still(k);
      continue;
    }
    let visible = false,
      wake = null;
    new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible && wake) {
          wake();
          wake = null;
        }
      },
      { threshold: 0.35 }
    ).observe(el);
    const wait = (ms) =>
      new Promise((r) => setTimeout(r, ms)).then(() =>
        visible ? null : new Promise((r) => (wake = r))
      );
    demo.reset(k);
    (async () => {
      await wait(0);
      for (;;) await demo.run(k, wait);
    })();
  }
}
