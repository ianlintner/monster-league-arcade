import { describe, expect, it } from 'vitest';
import {
  ANIMATION_SPEC,
  FACTION_SHEET,
  baseAnimation,
  resolveActorCell,
  runFacingFromVelocity,
  runFrameIndex,
  sheetKey,
} from './spriteRenderer';
import type { LiveActorState } from '../field/LivePlay';

const actor = (partial: Partial<LiveActorState> = {}): LiveActorState =>
  ({
    id: 'home-QB',
    team: 'home',
    side: 'OFFENSE',
    slot: 'QB',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    stamina: 1,
    diving: false,
    diveTimer: 0,
    downed: false,
    engaged: false,
    hitStop: 0,
    ...partial,
  }) as LiveActorState;

describe('FACTION_SHEET mapping', () => {
  it('maps every sim Faction to its lowercase sheet id', () => {
    expect(FACTION_SHEET.REAPERS).toBe('boneyard_reapers');
    expect(FACTION_SHEET.DEADSKINS).toBe('rotting_deadskins');
    expect(FACTION_SHEET.NIGHTSTALKERS).toBe('transylvania_nightstalkers');
    expect(FACTION_SHEET.GHOULS).toBe('salem_bayou_ghouls');
  });

  it('home/away sheet keys differ only by the -away suffix', () => {
    expect(sheetKey('boneyard_reapers', false)).toBe('boneyard_reapers');
    expect(sheetKey('boneyard_reapers', true)).toBe('boneyard_reapers-away');
  });
});

describe('runFacingFromVelocity', () => {
  it('resolves the 8 ordinal directions', () => {
    expect(runFacingFromVelocity(1, 0)).toBe('E');
    expect(runFacingFromVelocity(-1, 0)).toBe('W');
    expect(runFacingFromVelocity(0, 1)).toBe('S');
    expect(runFacingFromVelocity(0, -1)).toBe('N');
    expect(runFacingFromVelocity(1, 1)).toBe('SE');
    expect(runFacingFromVelocity(-1, 1)).toBe('SW');
    expect(runFacingFromVelocity(-1, -1)).toBe('NW');
    expect(runFacingFromVelocity(1, -1)).toBe('NE');
  });

  it('defaults to S for a near-zero velocity', () => {
    expect(runFacingFromVelocity(0, 0)).toBe('S');
  });
});

describe('baseAnimation', () => {
  it('knockdown wins over everything', () => {
    expect(baseAnimation(actor({ downed: true, diving: true }))).toBe('hit_stagger_knockdown');
  });

  it('dive beats run', () => {
    expect(baseAnimation(actor({ diving: true, vx: 3 }))).toBe('dive_tackle_lunge');
  });

  it('stationary actors idle', () => {
    expect(baseAnimation(actor())).toBe('idle_stance');
  });

  it('moving actors run', () => {
    expect(baseAnimation(actor({ vx: 2, vy: 0 }))).toBe('run_8dir');
  });

  it('a passing QB winds up even while moving', () => {
    expect(baseAnimation(actor({ vx: 2 }), true)).toBe('pass_windup_throw');
  });
});

describe('runFrameIndex', () => {
  it('cycles by distance and returns an in-range frame', () => {
    const frames = ANIMATION_SPEC.run_8dir.frames;
    for (let d = 0; d < 8; d += 0.13) {
      const col = runFrameIndex(d, 1.6);
      expect(Number.isInteger(col)).toBe(true);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(frames);
    }
  });

  it('advances monotonically with distance (no sliding feet)', () => {
    const a = runFrameIndex(0.0, 1.6);
    const b = runFrameIndex(0.4, 1.6);
    const c = runFrameIndex(0.8, 1.6);
    expect(b).not.toBe(a);
    expect(c).not.toBe(b);
  });
});

describe('resolveActorCell', () => {
  it('resolves a run to the correct run_8dir row and facing', () => {
    const cell = resolveActorCell(actor({ vx: 1, vy: 0 }), FACTION_SHEET.REAPERS, 0, 0);
    expect(cell.animation).toBe('run_8dir');
    expect(cell.facing).toBe('E');
    expect(cell.row).toBe(ANIMATION_SPEC.run_8dir.firstRow + 2); // E is index 2
    expect(cell.sheet).toBe('boneyard_reapers');
  });

  it('resolves idle to row 0', () => {
    const cell = resolveActorCell(actor(), FACTION_SHEET.GHOULS, 0, 0);
    expect(cell.animation).toBe('idle_stance');
    expect(cell.row).toBe(0);
  });

  it('holds the last frame for knockdown rather than looping', () => {
    const cell = resolveActorCell(
      actor({ downed: true }),
      FACTION_SHEET.DEADSKINS,
      0,
      10, // far past the animation
    );
    expect(cell.animation).toBe('hit_stagger_knockdown');
    expect(cell.col).toBe(ANIMATION_SPEC.hit_stagger_knockdown.frames - 1);
  });
});
