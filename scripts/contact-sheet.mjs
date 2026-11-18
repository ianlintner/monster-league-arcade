#!/usr/bin/env node
/**
 * Renders a contact sheet of the sprite sheets at 4x nearest-neighbour for the
 * PR body: all factions, idle + one run direction + death. Reads the already
 * normalized PNGs from public/assets/sprites and upscales with sharp (nearest).
 *
 * Usage: node scripts/contact-sheet.mjs <out.png>
 */
import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './asset-spec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets');

// Which animation rows to show, and how many frames each.
const SHOW = [
  { name: 'idle_stance', frames: 4 },
  { name: 'run_8dir', frames: 6, row: 1 }, // row 1 = SE (first non-front run dir)
  { name: 'casualty_death', frames: 6 },
];

// Map animation name -> its first row index in the sheet.
function rowIndex(name) {
  let row = 0;
  for (const a of S.ANIMATIONS) {
    if (a.name === name) return row;
    row += a.rows;
  }
  throw new Error(`unknown animation ${name}`);
}

const CELL = S.SPRITE_CELL; // 48
const SCALE = 4;
const GAP = 8; // px gap between cells in the sheet (at 4x)

async function labelPng(text) {
  const lines = text.split('\n');
  const tspan = lines.map((l, i) => `<tspan x="4" y="${16 + i * 14}">${l}</tspan>`).join('');
  const svg = `<svg width="120" height="${CELL * SCALE}" xmlns="http://www.w3.org/2000/svg">
    <text font-family="monospace" font-size="11" fill="#F4EFE6">${tspan}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('usage: node scripts/contact-sheet.mjs <out.png> [sprites-dir]');
    process.exit(2);
  }
  // Optional sprite dir lets callers capture a "before" sheet from a pristine
  // checkout (e.g. git show) without overwriting the regenerated assets.
  const spritesDir = process.argv[3] ?? join(OUT, 'sprites');
  const sheets = S.SPRITE_SHEETS; // 4 factions + 2 refs
  const rows = [];
  for (const id of sheets) {
    const path = join(spritesDir, `${id}.png`);
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const s of SHOW) {
      const row = s.row ?? rowIndex(s.name);
      const cells = [];
      for (let f = 0; f < s.frames; f++) {
        const cell = new Uint8Array(CELL * CELL * 4);
        for (let y = 0; y < CELL; y++)
          cell.set(
            data.subarray(
              ((row * CELL + y) * info.width + f * CELL) * 4,
              ((row * CELL + y) * info.width + (f + 1) * CELL) * 4,
            ),
            y * CELL * 4,
          );
        cells.push(cell);
      }
      rows.push({ id, name: s.name, cells });
    }
  }

  const labelW = 120;
  const cellW = CELL * SCALE;
  const maxFrames = Math.max(...SHOW.map((s) => s.frames));
  const W = labelW + maxFrames * cellW + (maxFrames - 1) * GAP + 16;
  const H = rows.length * (cellW + GAP) + 16;

  const composites = [];
  let y = 8;
  for (const r of rows) {
    composites.push({ input: await labelPng(`${r.id}\n${r.name}`), left: 8, top: y });
    let x = labelW;
    for (const cell of r.cells) {
      const up = await sharp(Buffer.from(cell), {
        raw: { width: CELL, height: CELL, channels: 4 },
      })
        .resize(CELL * SCALE, CELL * SCALE, { kernel: 'nearest' })
        .png()
        .toBuffer();
      composites.push({ input: up, left: x, top: y });
      x += cellW + GAP;
    }
    y += cellW + GAP;
  }

  await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0x1a, g: 0x14, b: 0x26, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
  console.log(`wrote ${outPath} (${W}x${H})`);
}

await main();
