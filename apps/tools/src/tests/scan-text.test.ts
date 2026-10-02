import { describe, expect, it } from 'vitest';
import {
  backgroundAround,
  eraseWords,
  inkOf,
  SERIF_CONTRAST,
  strokeContrast,
  strokeWidth,
  trustedRuns,
} from '../js/editcore/scan-text.js';

/** A 40x20 cream "page" with a dark 10x6 "word" at (15,7). */
function scanImage() {
  const width = 40,
    height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([250, 248, 240, 255], i);
  for (let y = 7; y < 13; y++)
    for (let x = 15; x < 25; x++)
      data.set([20, 20, 30, 255], (y * width + x) * 4);
  return { data, width, height };
}
const word = { bbox: { x0: 15, y0: 7, x1: 25, y1: 13 } };

describe('scanned text helpers', () => {
  it('samples the paper colour around a word', () => {
    expect(backgroundAround(scanImage(), word.bbox)).toEqual([250, 248, 240]);
  });

  it('finds the ink colour and how much of the box is ink', () => {
    const img = scanImage();
    const ink = inkOf(img, word.bbox, backgroundAround(img, word.bbox));
    expect(ink.color).toEqual([20, 20, 30]);
    expect(ink.coverage).toBe(1);
  });

  it('erases a word into the surrounding paper colour', () => {
    const img = scanImage();
    eraseWords(img, [word]);
    const px = (x: number, y: number) =>
      Array.from(
        img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)
      );
    expect(px(20, 10)).toEqual([250, 248, 240]);
    expect(px(2, 2)).toEqual([250, 248, 240]);
  });
});

/** Letter-like marks: vertical stems `stem` px wide joined by bars `bar` px tall. */
function glyphs(stem: number, bar: number) {
  const width = 200,
    height = 60;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 255], i);
  const ink = (x: number, y: number) =>
    data.set([0, 0, 0, 255], (y * width + x) * 4);
  for (let g = 0; g < 8; g++) {
    const left = 10 + g * 22;
    for (let y = 10; y < 50; y++)
      for (let x = left; x < left + stem; x++) ink(x, y);
    for (let y = 28; y < 28 + bar; y++)
      for (let x = left; x < left + 16; x++) ink(x, y);
  }
  return { data, width, height };
}
const box = { x0: 5, y0: 5, x1: 195, y1: 55 };

describe('font weight and style from strokes', () => {
  it('measures stem thickness', () => {
    expect(strokeWidth(glyphs(6, 6), box, [255, 255, 255])).toBe(6);
  });

  it('tells high-contrast (serif-like) from even (sans-like) strokes', () => {
    const serif = strokeContrast(
      glyphs(6, 2),
      box,
      [255, 255, 255],
      [0, 0, 0],
      40
    );
    const sans = strokeContrast(
      glyphs(6, 6),
      box,
      [255, 255, 255],
      [0, 0, 0],
      40
    );
    expect(serif).toBeLessThan(SERIF_CONTRAST);
    expect(sans).toBeGreaterThan(SERIF_CONTRAST);
  });
});

describe('trustedRuns', () => {
  const word = (text: string, confidence: number, x0: number, x1: number) => ({
    text,
    confidence,
    bbox: { x0, x1, y0: 100, y1: 120 },
  });
  const line = (...words: ReturnType<typeof word>[]) => ({
    text: words.map((w) => w.text).join(' '),
    confidence: words.reduce((n, w) => n + w.confidence, 0) / words.length,
    bbox: { x0: words[0].bbox.x0, x1: words.at(-1)!.bbox.x1, y0: 100, y1: 120 },
    baseline: 116,
    words,
  });

  it('keeps a confident line whole', () => {
    const runs = trustedRuns([
      line(
        word('Enrollment', 93, 0, 90),
        word('No.:', 91, 95, 130),
        word('2003/35075/18482', 90, 135, 300)
      ),
    ]);
    expect(runs.map((r) => r.text)).toEqual([
      'Enrollment No.: 2003/35075/18482',
    ]);
  });

  it('leaves a misread script in the image but keeps the confident part', () => {
    // Hindi read as English, then the real English half of the line.
    const runs = trustedRuns([
      line(
        word('HIRT', 62, 0, 50),
        word('TUR', 58, 55, 90),
        word('sh&ATH', 80, 95, 160),
        word('/', 88, 165, 170),
        word('Your', 94, 175, 215),
        word('Aadhaar', 93, 220, 300),
        word('No.', 92, 305, 335)
      ),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['/ Your Aadhaar No.']);
    expect(runs[0].bbox.x0).toBe(165);
  });

  it('drops stray single characters from sideways text', () => {
    const runs = trustedRuns([
      line(
        word('i', 70, 0, 5),
        word('Jans', 95, 40, 80),
        word('Johnson', 95, 85, 160)
      ),
      line(word('&', 60, 0, 6), word('Kidangoor', 94, 40, 130)),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['Jans Johnson', 'Kidangoor']);
  });

  it('splits across wide gaps instead of joining far-apart words', () => {
    const runs = trustedRuns([
      line(word('To', 95, 0, 20), word('Kerala', 95, 200, 260)),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['To', 'Kerala']);
  });

  it('drops a run that is all doubtful', () => {
    expect(
      trustedRuns([line(word('we', 60, 0, 20), word('vem', 50, 25, 60))])
    ).toEqual([]);
  });
});
