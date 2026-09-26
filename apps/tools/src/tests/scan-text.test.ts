import { describe, expect, it } from 'vitest';
import { backgroundAround, eraseWords, inkOf } from '../js/editcore/scan-text.js';

/** A 40x20 cream "page" with a dark 10x6 "word" at (15,7). */
function scanImage() {
  const width = 40,
    height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([250, 248, 240, 255], i);
  for (let y = 7; y < 13; y++)
    for (let x = 15; x < 25; x++) data.set([20, 20, 30, 255], (y * width + x) * 4);
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
      Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
    expect(px(20, 10)).toEqual([250, 248, 240]);
    expect(px(2, 2)).toEqual([250, 248, 240]);
  });
});
