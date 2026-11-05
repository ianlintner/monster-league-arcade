import { describe, it, expect } from 'vitest';
import { normalizeFrame } from './normalize-art.mjs';
import { PALETTE_SET } from './art-palette.mjs';

const px = (d, w, x, y) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe('normalizeFrame', () => {
  const w = 8;
  const mk = () => {
    const d = new Uint8Array(w * w * 4);
    for (let y = 3; y < 5; y++)
      for (let x = 3; x < 5; x++) d.set([250, 100, 30, 255], (y * w + x) * 4);
    return d;
  };
  it('snaps to palette and adds a 1px VOID outline', () => {
    const out = normalizeFrame(mk(), w, w);
    expect(px(out, w, 2, 3)).toEqual([0x0b, 0x07, 0x11, 255]);
    expect(px(out, w, 2, 2)).toEqual([0x0b, 0x07, 0x11, 255]);
    expect(px(out, w, 1, 3)[3]).toBe(0);
    const [r, g, b] = px(out, w, 3, 3);
    const hex =
      '#' +
      [r, g, b]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    expect(PALETTE_SET.has(hex)).toBe(true);
  });
  it('is deterministic', () => {
    expect(normalizeFrame(mk(), w, w)).toEqual(normalizeFrame(mk(), w, w));
  });
  it('removes an opaque flat background', () => {
    const d = new Uint8Array(w * w * 4);
    for (let i = 0; i < w * w; i++) d.set([255, 0, 255, 255], i * 4);
    d.set([244, 239, 230, 255], (3 * w + 3) * 4);
    const out = normalizeFrame(d, w, w);
    expect(px(out, w, 0, 0)[3]).toBe(0);
    expect(px(out, w, 3, 3)[3]).toBe(255);
  });
});
