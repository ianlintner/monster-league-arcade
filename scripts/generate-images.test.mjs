import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { jawDrop } from './generate-images.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Build an opaque-background 64x64 "portrait bust" with a solid foreground block
// standing in for the face, mirroring the real generated cells (fully opaque, no
// alpha) that the portrait pipeline feeds through the single-cell normalizer.
function opaqueBust(bg = [40, 20, 60, 255]) {
  const d = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) d.set(bg, i * 4);
  // foreground "face" block near the lower-centre, distinct from the background
  for (let y = 30; y < 58; y++)
    for (let x = 20; x < 44; x++) d.set([230, 180, 120, 255], (y * 64 + x) * 4);
  return d;
}

// Single-cell background-removal pass: same invocation the portrait pipeline
// now runs BEFORE deriving the jaw frame (normalize <in> <out> with no --cell).
function stripBackground(inPath, outPath) {
  execFileSync(process.execPath, [join(ROOT, 'scripts/normalize-art.mjs'), inPath, outPath]);
}

describe('portrait jaw frame keeps a clean background (no flashing)', () => {
  it('leaves the jaw-open corners transparent after the pre-removal pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jawdrop-'));
    const raw = join(dir, 'raw.png');
    const clean = join(dir, 'clean.png');
    const jaw = join(dir, 'jaw.png');

    writeFileSync(
      raw,
      await sharp(Buffer.from(opaqueBust()), {
        raw: { width: 64, height: 64, channels: 4 },
      })
        .png()
        .toBuffer(),
    );

    stripBackground(raw, clean); // background removal FIRST (the fix's ordering)
    await jawDrop(clean, jaw); // derive the jaw variant from the clean cell

    const get = async (p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cleanImg = await get(clean);
    const jawImg = await get(jaw);

    const alphaAt = (img, x, y) => img.data[(y * img.info.width + x) * 4 + 3];

    // The pre-removal pass strips the opaque background: the clean cell's border
    // is transparent.
    expect(alphaAt(cleanImg, 0, 0)).toBe(0);

    // Critically: the jaw-open frame must NOT bring the opaque background back.
    // Its corners stay transparent, so it composits cleanly against the closed
    // frame instead of flashing an opaque generated backdrop.
    expect(alphaAt(jawImg, 0, 0)).toBe(0);
    expect(alphaAt(jawImg, 63, 0)).toBe(0);
    expect(alphaAt(jawImg, 0, 63)).toBe(0);
    expect(alphaAt(jawImg, 63, 63)).toBe(0);

    // The mouth gap remains: the vacated band is transparent.
    const MOUTH_TOP = Math.floor(64 * 0.6);
    expect(alphaAt(jawImg, 32, MOUTH_TOP)).toBe(0);
  });
});
