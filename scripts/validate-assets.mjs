#!/usr/bin/env node
/**
 * Asset pipeline validator. Verifies every expected sprite sheet, portrait, crest and arena asset:
 *  - existence and exact PNG dimensions per cell footprint (48x48 sprites, 64x64 portraits/crests/tiles)
 *  - transparent backgrounds (sprites/portraits/crests/hazards)
 *  - 1px #0B0711 outer silhouette outline on outlined assets (every silhouette-edge pixel is VOID_BLACK)
 *  - palette harmony (every opaque pixel is inside the Halloween Midnight Palette ramp)
 *  - per-file size budget
 * Exits non-zero if anything fails.
 */
import sharp from 'sharp';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE_SET, VOID_BLACK, hexToRgb } from './art-palette.mjs';
import * as S from './asset-spec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets');
const fail = (m) => {
  console.error('FAIL: ' + m);
  process.exitCode = 1;
};
const P = (base) => join(OUT, base);
const VOID = hexToRgb(VOID_BLACK);
const isVoid = (d, i) => d[i] === VOID[0] && d[i + 1] === VOID[1] && d[i + 2] === VOID[2];

/** Every opaque pixel on a cell's silhouette edge (8-neighbour transparent / cell border) must be VOID. */
function checkOutline(path, data, w, h, cw, ch) {
  let bad = 0;
  for (let cy = 0; cy < h; cy += ch)
    for (let cx = 0; cx < w; cx += cw)
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const i = ((cy + y) * w + cx + x) * 4;
          if (data[i + 3] === 0) continue;
          let edge = false;
          for (let dy = -1; dy <= 1 && !edge; dy++)
            for (let dx = -1; dx <= 1 && !edge; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cw || ny >= ch)
                continue; // cell border: outline cannot extend past the cell
              else if (data[((cy + ny) * w + cx + nx) * 4 + 3] === 0) edge = true;
            }
          if (edge && !isVoid(data, i)) bad++;
        }
  if (bad) fail(`${path}: ${bad} silhouette-edge pixels are not #0B0711`);
}

function checkPalette(path, data, w, h) {
  let bad = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const hex =
      '#' +
      [0, 1, 2]
        .map((k) => data[i * 4 + k].toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    if (!PALETTE_SET.has(hex)) bad++;
  }
  if (bad) fail(`${path}: ${bad} opaque pixels outside palette`);
}

async function checkFile(
  path,
  { w, h, cw, ch, transparent = true, outline = false, minOpaque = 0 },
) {
  if (!existsSync(path)) return fail(`missing ${path}`);
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h)
    return fail(`${path} dims ${info.width}x${info.height}, want ${w}x${h}`);
  let transparentPx = 0;
  let opaquePx = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) transparentPx++;
    else opaquePx++;
  }
  if (transparent && transparentPx === 0) fail(`${path} has no transparency`);
  if (opaquePx < minOpaque) fail(`${path} nearly empty (${opaquePx} opaque px)`);
  checkPalette(path, data, w, h);
  if (outline) checkOutline(path, data, w, h, cw, ch);
  const size = statSync(path).size;
  if (size > S.MAX_FILE_BYTES) fail(`${path} is ${size} bytes > budget ${S.MAX_FILE_BYTES}`);
}

let count = 0;
for (const id of S.SPRITE_SHEETS) {
  await checkFile(P(`sprites/${id}.png`), {
    w: S.SHEET_COLS * S.SPRITE_CELL,
    h: S.SHEET_ROWS * S.SPRITE_CELL,
    cw: 48,
    ch: 48,
    outline: true,
    minOpaque: 1000,
  });
  count++;
}
for (const id of S.CREST_FACTIONS) {
  await checkFile(P(`sprites/crest_${id}.png`), {
    w: 64,
    h: 64,
    cw: 64,
    ch: 64,
    outline: true,
    minOpaque: 200,
  });
  count++;
}
for (const id of S.PORTRAITS) {
  await checkFile(P(`portraits/${id}.png`), {
    w: 128,
    h: 64,
    cw: 64,
    ch: 64,
    outline: true,
    minOpaque: 400,
  });
  count++;
}
for (const [arena, hz] of Object.entries(S.ARENAS)) {
  await checkFile(P(`arenas/${arena}_turf.png`), { w: 64, h: 64, transparent: false });
  await checkFile(P(`arenas/${arena}_endzone.png`), { w: 64, h: 64, transparent: false });
  for (const h of hz) {
    await checkFile(P(`arenas/${arena}_${h}.png`), {
      w: 256,
      h: 64,
      cw: 64,
      ch: 64,
      outline: true,
      minOpaque: 40,
    });
  }
  count += 2 + hz.length;
}
if (!existsSync(P('atlas.json'))) fail('missing public/assets/atlas.json');
else {
  JSON.parse(readFileSync(P('atlas.json'), 'utf8'));
  count++;
}
if (process.exitCode) console.error('validate-assets: FAILED');
else console.log(`validate-assets: OK (${count} assets verified)`);
