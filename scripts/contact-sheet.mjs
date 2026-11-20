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

// Which animation rows to show, and how many frames each. `row` overrides the
// first-row of the named animation (run_8dir spans rows 1..8 in S,SE,E,NE,N,NW,W,SW order).
const SHOW = [
  { name: 'idle_stance', frames: 4, row: 0 },
  { name: 'run_SE', frames: 6, row: 2 }, // SE diagonal run
  { name: 'run_side', frames: 6, row: 3 }, // E side-view run
  { name: 'casualty_death', frames: 6, row: 12 },
];

// Each SHOW entry carries an explicit `row`, so the animation-name -> first-row
// map is not needed at runtime.

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
    console.error('usage: node scripts/contact-sheet.mjs <out.png> [sprites-dir] [--home-only]');
    process.exit(2);
  }
  // Optional sprite dir lets callers capture a "before" sheet from a pristine
  // checkout (e.g. git show) without overwriting the regenerated assets.
  const spritesDir = process.argv[3]?.startsWith('--')
    ? join(OUT, 'sprites')
    : (process.argv[3] ?? join(OUT, 'sprites'));
  // --home-only omits the away sheets, which don't exist in a pre-uplift checkout.
  const homeOnly = process.argv.includes('--home-only');
  const sheets = [
    ...S.SPRITE_SHEETS.map((id) => ({ file: id, label: id })),
    ...(homeOnly
      ? []
      : S.AWAY_SHEETS.map((id) => ({ file: `${id}-away`, label: `${id}\n(away)` }))),
  ];
  const rows = [];
  for (const { file, label } of sheets) {
    const path = join(spritesDir, `${file}.png`);
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const s of SHOW) {
      const row = s.row;
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
      rows.push({ id: label, name: s.name, cells });
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
