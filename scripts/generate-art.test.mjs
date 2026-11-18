import { describe, it, expect } from 'vitest';
import { RUN_GAIT, DIRS, drawFrame, maskColor } from './generate-art.mjs';
import { MASTER as M, FACTION_COLORS as F, hexToRgb } from './art-palette.mjs';

// Reapers skin/pad used for the run/idle distinctness check.
const ID = 'boneyard_reapers';
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// Count differing RGBA pixels between two 48x48 frames.
function diffPixels(a, b) {
  let n = 0;
  for (let i = 0; i < a.d.length; i += 4) {
    if (
      a.d[i] !== b.d[i] ||
      a.d[i + 1] !== b.d[i + 1] ||
      a.d[i + 2] !== b.d[i + 2] ||
      a.d[i + 3] !== b.d[i + 3]
    )
      n++;
  }
  return n;
}

describe('run gait', () => {
  it('has 6 frames covering a full stride', () => {
    expect(RUN_GAIT).toHaveLength(6);
  });

  it('swings arms contralaterally (left arm tracks right leg, right arm tracks left leg)', () => {
    for (const g of RUN_GAIT) {
      if (g.rx !== 0) expect(sign(g.al[0])).toBe(sign(g.rx));
      if (g.lx !== 0) expect(sign(g.ar[0])).toBe(sign(g.lx));
    }
  });

  it('swings the arms through a real range, not a fixed pose', () => {
    const alx = RUN_GAIT.map((g) => g.al[0]);
    const arx = RUN_GAIT.map((g) => g.ar[0]);
    expect(Math.max(...alx) - Math.min(...alx)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...arx) - Math.min(...arx)).toBeGreaterThanOrEqual(4);
  });

  it('never reuses the idle arm pose (al=-3, ar=+3)', () => {
    for (const g of RUN_GAIT) {
      expect(!(g.al[0] === -3 && g.ar[0] === 3)).toBe(true);
    }
  });
});

describe('run frames are visually distinct from idle', () => {
  it('every run frame differs from every idle frame across all 8 directions', () => {
    const idle = [0, 1, 2, 3].map((f) => drawFrame(ID, 'idle_stance', f, 0, false));
    const MIN_DIFF = 40; // a "near-identical" frame would differ by a handful of px
    for (let d = 0; d < DIRS.length; d++) {
      for (let f = 0; f < 6; f++) {
        const run = drawFrame(ID, 'run_8dir', f, d, false);
        for (const idl of idle) {
          const diff = diffPixels(run, idl);
          expect(diff, `dirIdx=${d} frame=${f}`).toBeGreaterThanOrEqual(MIN_DIFF);
        }
      }
    }
  });
});

describe('facemask paint order', () => {
  it('draws the mask bar ON TOP of the face skin (contrast colour, not skin)', () => {
    // Front-view idle (bob=0): face skin spans cx-4..cx+3 at rows hy+6..hy+8,
    // mask bar spans cx-5..cx+5 at row hy+7 with cx=24, hy=8. The overlapping
    // pixel (24, 15) must be the mask colour, proving the mask is layered after
    // the skin rect rather than hidden beneath it.
    const frame = drawFrame(ID, 'idle_stance', 0, 0, false);
    const i = (15 * 48 + 24) * 4;
    const pxRgb = `${frame.d[i]},${frame.d[i + 1]},${frame.d[i + 2]}`;
    const maskRgb = hexToRgb(maskColor(ID)).join(',');
    const skinRgb = hexToRgb(M.BONE_WHITE).join(',');
    expect(pxRgb).toBe(maskRgb);
    expect(pxRgb).not.toBe(skinRgb);
  });

  it('gives every faction a mask colour distinct from its own skin', () => {
    const skins = {
      boneyard_reapers: M.BONE_WHITE,
      rotting_deadskins: F.PUTRID_OLIVE,
      transylvania_nightstalkers: M.AGED_PARCHMENT,
      salem_bayou_ghouls: F.SWAMP_MOSS,
    };
    for (const [id, skin] of Object.entries(skins)) {
      expect(skin).toBeDefined(); // guard: every entry resolves to a real hex
      expect(maskColor(id)).not.toBe(skin);
    }
  });
});
