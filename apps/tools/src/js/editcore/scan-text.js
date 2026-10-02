// Turning a scanned page into editable text.
//
// Pure helpers on image pixels plus the OCR call. The editor (app.js) owns
// the document side: which image is the scan, where text goes, undo.

/** Lines below this OCR confidence (0-100) stay part of the image. */
export const MIN_LINE_CONFIDENCE = 55;

/**
 * Words below this confidence stay part of the image. Judging words, not just
 * lines, stops a confident half-line ("/ Your Aadhaar No.") from carrying a
 * misread half (Hindi read as English) into editable text.
 */
export const MIN_WORD_CONFIDENCE = 75;

/** A lone character needs this much more: stray marks and fragments of
 * sideways text (dates printed vertically) read as "i", "S", "&", "o". */
const MIN_SINGLE_CHAR_CONFIDENCE = 92;
const MIN_SINGLE_PUNCT_CONFIDENCE = 85;

/** A word is plausible text: mostly letters and digits, not punctuation soup
 * like "sh&ATH" (a sign the script wasn't one the OCR knows). */
function plausibleWord(text) {
  const t = text.trim();
  if (!t) return false;
  const alnum = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  if (!alnum) return /^[-–—/:.,()]+$/.test(t) && t.length <= 3;
  // A symbol wedged between letters (sh&ATH, wo|rd) is a misread.
  if (/[\p{L}][^\p{L}\p{N}\s.'’,:;\-/]+[\p{L}]/u.test(t)) return false;
  return alnum / t.length >= 0.5;
}

/**
 * Splits OCR lines into the runs of words that are safe to turn into text.
 * Untrusted words are left out (they stay as pixels in the scan), and a line
 * breaks wherever a word is left out or a wide gap separates two words, so
 * kept words never get pulled across a hole. Each run keeps its line's
 * baseline and height.
 */
export function trustedRuns(
  lines,
  { minLineConfidence = MIN_LINE_CONFIDENCE } = {}
) {
  const runs = [];
  for (const line of lines) {
    const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
    let run = [];
    const flush = () => {
      if (run.length) {
        const confidence =
          run.reduce((n, w) => n + w.confidence, 0) / run.length;
        if (confidence >= minLineConfidence) {
          runs.push({
            text: run.map((w) => w.text).join(' '),
            confidence,
            bbox: {
              x0: Math.min(...run.map((w) => w.bbox.x0)),
              x1: Math.max(...run.map((w) => w.bbox.x1)),
              y0: line.bbox.y0,
              y1: line.bbox.y1,
            },
            baseline: line.baseline,
            words: run,
            // Style (bold, ink) is judged on the whole scanned line: a short
            // run reads too little ink to tell bold from regular.
            styleBox: line.bbox,
          });
        }
      }
      run = [];
    };
    for (const w of line.words) {
      const t = w.text.trim();
      // A lone letter or digit is the usual fragment of sideways text; lone
      // punctuation (a "/" between two labels) is common and safer.
      const need =
        t.length !== 1
          ? MIN_WORD_CONFIDENCE
          : /[\p{L}\p{N}]/u.test(t)
            ? MIN_SINGLE_CHAR_CONFIDENCE
            : MIN_SINGLE_PUNCT_CONFIDENCE;
      const trusted = plausibleWord(t) && w.confidence >= need;
      if (!trusted) {
        flush();
        continue;
      }
      const prev = run.at(-1);
      if (prev && w.bbox.x0 - prev.bbox.x1 > height * 1.5) flush();
      run.push(w);
    }
    flush();
  }
  return runs;
}

/** Images smaller than this (longest side, px) are enlarged before OCR. */
const UPSCALE_TARGET = 1600;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Recognises text in an RGBA image. Resolves to lines in image pixels:
 * { text, confidence, bbox:{x0,y0,x1,y1}, baseline (y at the line's middle),
 *   words:[{ text, confidence, bbox }] }
 */
export async function recognizeLines(
  { data, width, height },
  { language = 'eng', onProgress, signal } = {}
) {
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  source
    .getContext('2d')
    .putImageData(new ImageData(data, width, height), 0, 0);
  // Small images (logos, screenshots, stamps) read far better enlarged.
  const k = clamp(UPSCALE_TARGET / Math.max(width, height), 1, 3);
  let canvas = source;
  if (k > 1) {
    canvas = document.createElement('canvas');
    canvas.width = Math.round(width * k);
    canvas.height = Math.round(height * k);
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  const back = (b) => ({
    x0: b.x0 / k,
    y0: b.y0 / k,
    x1: b.x1 / k,
    y1: b.y1 / k,
  });

  // Loaded on demand: no OCR code or data is fetched until the user asks.
  const { createConfiguredTesseractWorker } =
    await import('../utils/tesseract-runtime.ts');
  const worker = await createConfiguredTesseractWorker(language, 1, (m) =>
    onProgress?.(m.status, m.progress || 0)
  );
  const abort = () => worker.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const { data: result } = await worker.recognize(
      canvas,
      {},
      { blocks: true }
    );
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const lines = [];
    for (const block of result.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const words = (line.words || [])
            .filter((w) => w.text.trim())
            .map((w) => ({
              text: w.text,
              confidence: w.confidence,
              bbox: back(w.bbox),
            }));
          const text = words.map((w) => w.text).join(' ');
          if (!text) continue;
          const b = line.baseline;
          const mid = (line.bbox.x0 + line.bbox.x1) / 2;
          const baseline =
            b && b.has_baseline !== false && b.x1 !== b.x0
              ? b.y0 + ((b.y1 - b.y0) * (mid - b.x0)) / (b.x1 - b.x0)
              : line.bbox.y1;
          lines.push({
            text,
            confidence: line.confidence,
            bbox: back(line.bbox),
            baseline: baseline / k,
            words,
          });
        }
      }
    }
    return lines;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!signal?.aborted) await worker.terminate();
  }
}

function channelMedian(values) {
  if (!values.length) return 255;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** Median colour of a ring of pixels just outside a box: the local paper colour. */
export function backgroundAround({ data, width, height }, box, pad = 6) {
  const r = [],
    g = [],
    b = [];
  const x0 = clamp(Math.floor(box.x0) - pad, 0, width - 1);
  const y0 = clamp(Math.floor(box.y0) - pad, 0, height - 1);
  const x1 = clamp(Math.ceil(box.x1) + pad, 0, width - 1);
  const y1 = clamp(Math.ceil(box.y1) + pad, 0, height - 1);
  const take = (x, y) => {
    const i = (y * width + x) * 4;
    r.push(data[i]);
    g.push(data[i + 1]);
    b.push(data[i + 2]);
  };
  for (let x = x0; x <= x1; x += 2) {
    take(x, y0);
    take(x, y1);
  }
  for (let y = y0; y <= y1; y += 2) {
    take(x0, y);
    take(x1, y);
  }
  return [channelMedian(r), channelMedian(g), channelMedian(b)];
}

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Ink colour and weight of a line: the median colour of pixels clearly darker
 * than the background, and how much of the box is ink (bold text inks more).
 */
export function inkOf(img, box, background) {
  const { data, width } = img;
  const bgLum = luminance(...background);
  const r = [],
    g = [],
    b = [];
  let ink = 0,
    total = 0;
  for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++) {
    for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x++) {
      const i = (y * width + x) * 4;
      total++;
      if (bgLum - luminance(data[i], data[i + 1], data[i + 2]) > 60) {
        ink++;
        r.push(data[i]);
        g.push(data[i + 1]);
        b.push(data[i + 2]);
      }
    }
  }
  return {
    color: r.length
      ? [channelMedian(r), channelMedian(g), channelMedian(b)]
      : [0, 0, 0],
    coverage: total ? ink / total : 0,
  };
}

/**
 * Typical stroke thickness of the text in a box, in pixels: the median
 * length of horizontal runs of ink (mostly vertical stems).
 */
export function strokeWidth(img, box, background) {
  const { data, width } = img;
  const bgLum = luminance(...background);
  const runs = [];
  for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++) {
    let run = 0;
    for (let x = Math.floor(box.x0); x <= Math.ceil(box.x1); x++) {
      const i = (y * width + x) * 4;
      const ink =
        x < Math.ceil(box.x1) &&
        bgLum - luminance(data[i], data[i + 1], data[i + 2]) > 60;
      if (ink) run++;
      else if (run) {
        runs.push(run);
        run = 0;
      }
    }
  }
  return runs.length ? channelMedian(runs) : 0;
}

/**
 * Thin-to-thick stroke ratio: thickness of horizontal strokes (short
 * vertical ink runs) over thickness of vertical stems (horizontal runs).
 * Serif faces like Times have strong contrast, sans faces like Helvetica
 * almost none. Thickness is measured with sub-pixel precision (partly inked
 * pixels count partly), since thin strokes are only a few pixels wide.
 * `sizePx` filters out runs along stems.
 */
export function strokeContrast(img, box, background, ink, sizePx) {
  const { data, width } = img;
  const bgLum = luminance(...background);
  const span = Math.max(40, bgLum - luminance(...ink));
  const inkAt = (x, y) => {
    const i = (y * width + x) * 4;
    return clamp(
      (bgLum - luminance(data[i], data[i + 1], data[i + 2])) / span,
      0,
      1
    );
  };
  const x0 = Math.floor(box.x0),
    x1 = Math.ceil(box.x1),
    y0 = Math.floor(box.y0),
    y1 = Math.ceil(box.y1);
  const collect = (outer0, outer1, inner0, inner1, at, maxRun) => {
    const runs = [];
    for (let o = outer0; o < outer1; o++) {
      let mass = 0,
        len = 0;
      for (let i = inner0; i <= inner1; i++) {
        const d = i < inner1 ? at(o, i) : 0;
        if (d > 0.15) {
          mass += d;
          len++;
        } else if (len) {
          if (len <= maxRun) runs.push(mass);
          mass = 0;
          len = 0;
        }
      }
    }
    return runs;
  };
  const across = collect(y0, y1, x0, x1, (y, x) => inkAt(x, y), Infinity);
  // Longer vertical runs go along stems rather than across bars.
  const down = collect(x0, x1, y0, y1, (x, y) => inkAt(x, y), sizePx * 0.3);
  if (across.length < 8 || down.length < 8) return null;
  return middleMean(down) / middleMean(across);
}

/** Mean of the middle half: steadier than a median on few-pixel values. */
function middleMean(values) {
  const s = [...values].sort((a, b) => a - b);
  const part = s.slice(Math.floor(s.length / 4), Math.ceil((s.length * 3) / 4));
  return part.reduce((a, b) => a + b, 0) / part.length;
}

/** Below this stroke contrast a page reads as a serif face. */
export const SERIF_CONTRAST = 0.75;

/** Stems thicker than this share of the font size read as bold. */
export const BOLD_STEM_RATIO = 0.135;

/** Paints each word's box (slightly padded) in the surrounding paper colour. */
export function eraseWords(img, words, pad = 2) {
  const { data, width, height } = img;
  for (const w of words) {
    const [br, bg, bb] = backgroundAround(img, w.bbox, pad + 3);
    const x0 = clamp(Math.floor(w.bbox.x0) - pad, 0, width);
    const y0 = clamp(Math.floor(w.bbox.y0) - pad, 0, height);
    const x1 = clamp(Math.ceil(w.bbox.x1) + pad, 0, width);
    const y1 = clamp(Math.ceil(w.bbox.y1) + pad, 0, height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        data[i] = br;
        data[i + 1] = bg;
        data[i + 2] = bb;
        data[i + 3] = 255;
      }
    }
  }
}

let measureCtx = null;
const CSS_FAMILY = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
};

/** Width of `text` at 1pt in the given family, for fitting. */
export function textWidthPerPoint(text, family, bold) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${bold ? 'bold ' : ''}100px ${CSS_FAMILY[family] || CSS_FAMILY.Helvetica}`;
  return measureCtx.measureText(text).width / 100;
}

const FAMILIES = ['Helvetica', 'Times'];
// Tallest glyphs (capitals/ascenders) reach ~0.72em above the baseline.
const sizeFromAscent = (ascentPt) => clamp(ascentPt / 0.72, 4, 144);

/**
 * Picks one family for the whole page: a scan almost always uses a single
 * body font. Stroke contrast decides (length-weighted median over lines);
 * if there's too little ink to measure, each line votes for the family whose
 * natural width best matches its height.
 * `lines`: [{ text, widthPt, ascentPt, bold, contrast }]
 */
export function pageFamily(lines) {
  const measured = lines.filter((l) => l.contrast != null);
  if (measured.length) {
    const weights = measured
      .map((l) => ({ c: l.contrast, w: l.text.length }))
      .sort((a, b) => a.c - b.c);
    const half = weights.reduce((s, x) => s + x.w, 0) / 2;
    let acc = 0;
    for (const { c, w } of weights) {
      acc += w;
      if (acc >= half) return c < SERIF_CONTRAST ? 'Times' : 'Helvetica';
    }
  }
  const score = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  for (const l of lines) {
    const size = sizeFromAscent(l.ascentPt);
    for (const family of FAMILIES) {
      const perPt = textWidthPerPoint(l.text, family, l.bold);
      if (!perPt) continue;
      score[family] +=
        Math.abs(Math.log(l.widthPt / perPt / size)) * l.text.length;
    }
  }
  return FAMILIES.reduce((a, b) => (score[b] < score[a] ? b : a));
}

/**
 * Size and horizontal scale so the replacement text covers the same width
 * as the scanned line, staying close to the size its height suggests.
 */
export function fitLine(text, { widthPt, ascentPt }, bold, family) {
  const sizeFromHeight = sizeFromAscent(ascentPt);
  const perPt = textWidthPerPoint(text, family, bold);
  if (!perPt) return { size: sizeFromHeight, hScale: 1 };
  const size = clamp(
    widthPt / perPt,
    sizeFromHeight * 0.85,
    sizeFromHeight * 1.15
  );
  const hScale = clamp(widthPt / (perPt * size), 0.8, 1.2);
  return { size: Math.round(size * 10) / 10, hScale };
}
