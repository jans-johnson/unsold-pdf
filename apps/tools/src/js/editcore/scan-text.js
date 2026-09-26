// Turning a scanned page into editable text.
//
// Pure helpers on image pixels plus the OCR call. The editor (app.js) owns
// the document side: which image is the scan, where text goes, undo.

/** Lines below this OCR confidence (0-100) stay part of the image. */
export const MIN_LINE_CONFIDENCE = 55;

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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);

  // Loaded on demand: no OCR code or data is fetched until the user asks.
  const { createConfiguredTesseractWorker } = await import('../utils/tesseract-runtime.ts');
  const worker = await createConfiguredTesseractWorker(language, 1, (m) =>
    onProgress?.(m.status, m.progress || 0)
  );
  const abort = () => worker.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const { data: result } = await worker.recognize(canvas, {}, { blocks: true });
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const lines = [];
    for (const block of result.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const words = (line.words || [])
            .filter((w) => w.text.trim())
            .map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox }));
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
            bbox: line.bbox,
            baseline,
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
    color: r.length ? [channelMedian(r), channelMedian(g), channelMedian(b)] : [0, 0, 0],
    coverage: total ? ink / total : 0,
  };
}

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
 * body font. Each line votes for the family whose natural width best
 * matches its height; longer lines count more.
 * `lines`: [{ text, widthPt, ascentPt, bold }]
 */
export function pageFamily(lines) {
  const score = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  for (const l of lines) {
    const size = sizeFromAscent(l.ascentPt);
    for (const family of FAMILIES) {
      const perPt = textWidthPerPoint(l.text, family, l.bold);
      if (!perPt) continue;
      score[family] += Math.abs(Math.log(l.widthPt / perPt / size)) * l.text.length;
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
  const size = clamp(widthPt / perPt, sizeFromHeight * 0.85, sizeFromHeight * 1.15);
  const hScale = clamp(widthPt / (perPt * size), 0.8, 1.2);
  return { size: Math.round(size * 10) / 10, hScale };
}
