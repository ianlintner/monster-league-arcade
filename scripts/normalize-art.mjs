#!/usr/bin/env node
/**
 * Unified style normalizer. Every generated (fal.ai) or procedural frame goes through:
 *  1. background removal (corner-colour flood fill / existing alpha) -> binary transparency
 *  2. quantisation to the Halloween Midnight Palette (nearest colour, RGB distance)
 *  3. 1px #0B0711 outer silhouette outline (8-neighbour dilation)
 * Deterministic: no randomness, same input -> same bytes.
 *
 * CLI: node scripts/normalize-art.mjs <in.png> <out.png> [--cell WxH] [--no-outline] [--opaque]
 */
import sharp from 'sharp';
import { PALETTE, hexToRgb, VOID_BLACK } from './art-palette.mjs';

const VOID = hexToRgb(VOID_BLACK);

export function nearest([r, g, b]) {
  let best = PALETTE[0];
  let bd = Infinity;
  for (const p of PALETTE) {
    const d = (p.rgb[0] - r) ** 2 + (p.rgb[1] - g) ** 2 + (p.rgb[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best.rgb;
}

/** Flood-fill the frame border colour to transparent when the frame has no alpha. */
function removeBackground(data, w, h) {
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) hasAlpha = true;
  if (hasAlpha) return;
  const o = (x, y) => (y * w + x) * 4;
  const bg = [data[0], data[1], data[2]];
  const near = (i) =>
    Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 48;
  const stack = [];
  for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = o(x, y);
    if (data[i + 3] === 0 || !near(i)) continue;
    data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

/**
 * @param {Uint8Array|Buffer} rgba  w*h*4 pixels (not mutated)
 * @returns {Uint8Array} normalised RGBA
 */
export function normalizeFrame(rgba, w, h, { outline = true, opaque = false } = {}) {
  const src = Uint8Array.from(rgba);
  if (!opaque) removeBackground(src, w, h);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = opaque || src[i * 4 + 3] >= 128;
    if (!a) continue;
    const c = nearest([src[i * 4], src[i * 4 + 1], src[i * 4 + 2]]);
    out.set([c[0], c[1], c[2], 255], i * 4);
  }
  if (opaque || !outline) return out;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && out[(y * w + x) * 4 + 3] === 255;
  const add = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx || dy) && solid(x + dx, y + dy)) {
            add.push((y * w + x) * 4);
            dy = dx = 2;
          }
    }
  for (const i of add) out.set([VOID[0], VOID[1], VOID[2], 255], i);
  return out;
}

export async function normalizeFile(inPath, outPath, opts = {}) {
  const { cellW, cellH } = opts;
  const { data, info } = await sharp(inPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cw = cellW ?? info.width;
  const ch = cellH ?? info.height;
  const out = new Uint8Array(data.length);
  for (let cy = 0; cy < info.height; cy += ch)
    for (let cx = 0; cx < info.width; cx += cw) {
      const cell = new Uint8Array(cw * ch * 4);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++)
          cell.set(
            data.subarray(
              ((cy + y) * info.width + cx + x) * 4,
              ((cy + y) * info.width + cx + x) * 4 + 4,
            ),
            (y * cw + x) * 4,
          );
      const n = normalizeFrame(cell, cw, ch, opts);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++)
          out.set(
            n.subarray((y * cw + x) * 4, (y * cw + x) * 4 + 4),
            ((cy + y) * info.width + cx + x) * 4,
          );
    }
  await sharp(Buffer.from(out), { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inp, outp, ...rest] = process.argv.slice(2);
  if (!inp || !outp) {
    console.error(
      'usage: normalize-art.mjs <in.png> <out.png> [--cell WxH] [--no-outline] [--opaque]',
    );
    process.exit(2);
  }
  const opts = { outline: !rest.includes('--no-outline'), opaque: rest.includes('--opaque') };
  const ci = rest.indexOf('--cell');
  if (ci >= 0) [opts.cellW, opts.cellH] = rest[ci + 1].split('x').map(Number);
  await normalizeFile(inp, outp, opts);
  console.log(`normalized ${inp} -> ${outp}`);
}
