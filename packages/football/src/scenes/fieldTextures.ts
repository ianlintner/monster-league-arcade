/**
 * Pure helper math for the gridiron markings + projected arena tiles, split out
 * of `MatchScene` so the label mapping and the trapezoid band geometry are
 * unit-testable without booting Phaser. No Phaser imports here.
 */

import { DEFAULT_PROJECTION, projectToScreen } from '@monster-league/shared-core';

/** Goal lines, in projection field-x (the field spans x ∈ [0,120]). */
export const LEFT_GOAL_X = 10;
export const RIGHT_GOAL_X = 110;

/**
 * Yard-number label for a given field-x. Numbers are placed **on** the 10-yard
 * lines (x = 20, 30, …, 100) and read the distance from the *nearer* goal line,
 * so the two halves mirror exactly: 10 20 30 40 50 40 30 20 10. The 10-yard
 * markers sit on the yard lines themselves (not between them), and the band just
 * inside each goal line reads "10" (10 yards from the goal), never "0".
 */
export function yardNumberLabel(fieldX: number): string {
  const d = Math.min(fieldX - LEFT_GOAL_X, RIGHT_GOAL_X - fieldX);
  // Distance to the nearer goal line is exactly the yard-line number: on a yard
  // line d ∈ {10,20,…,50}, so round down/up to the nearest 10-yard marker (the
  // yard lines land exactly on multiples of 10).
  return String(Math.round(d / 10) * 10);
}

/**
 * Lit cells of the 3×5 pixel font used for yard numbers. The original bitmask
 * was written row-major from the top-left, but the renderer read bit 0 as the
 * top-left cell — a 180° flip that turned `3` into a mirrored "E" and `6`/`9`
 * into "h"-like shapes on the far sideline. The cell mapping below restores the
 * intended upright glyph; both sidelines read correctly from the camera.
 */
export const YARD_NUMBER_GLYPHS: Record<string, number> = {
  '0': 0x7b6f,
  '1': 0x1249,
  '2': 0x73e7,
  '3': 0x73cf,
  '4': 0x5bc9,
  '5': 0x79cf,
  '6': 0x79ef,
  '7': 0x7249,
  '8': 0x7bef,
  '9': 0x7bcf,
};

export type YardNumberSide = 'near' | 'far';

export interface YardNumberCell {
  /** Index of the digit within the label (0 for "10"'s leading "1"). */
  digit: number;
  /** Glyph column, 0 = left, 2 = right. */
  col: number;
  /** Glyph row, 0 = top, 4 = bottom. */
  row: number;
}

/** Upright 3×5 cells for a label; `side` is accepted so both sidelines share
 *  the same tested orientation helper (no mirrored far-side numerals). */
export function yardNumberCells(label: string, _side: YardNumberSide = 'near'): YardNumberCell[] {
  const cells: YardNumberCell[] = [];
  for (let digit = 0; digit < label.length; digit++) {
    const bits = YARD_NUMBER_GLYPHS[label[digit] ?? '0'] ?? 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (bits & (1 << ((4 - row) * 3 + (2 - col)))) cells.push({ digit, col, row });
      }
    }
  }
  return cells;
}

/**
 * Screen-space corners of one rectangular field region [x0, x1] × [0, fieldHeight]
 * under the 2.5D projection. Returns `farL, farR, nearR, nearL` mapped to screen
 * pixels (the far edge is narrowed by `farScale`), so callers can draw the region
 * as a perspective trapezoid rather than a full-height rectangle that overlaps
 * its neighbours.
 */
export function regionCorners(
  x0: number,
  x1: number,
): {
  farL: { x: number; y: number };
  farR: { x: number; y: number };
  nearR: { x: number; y: number };
  nearL: { x: number; y: number };
} {
  const h = DEFAULT_PROJECTION.fieldHeight;
  return {
    farL: projectToScreen(x0, 0),
    farR: projectToScreen(x1, 0),
    nearR: projectToScreen(x1, h),
    nearL: projectToScreen(x0, h),
  };
}

/**
 * The screen-x range occupied by a field region at a given field-y row. Used to
 * slice a region into thin horizontal tileSprite bands that follow the
 * perspective taper — every band is a plain rectangle (no geometry mask, which
 * the Phaser canvas renderer clamps to a near-point triangle), so the three
 * regions render side-by-side without overlapping.
 */
export function regionBandXRange(
  x0: number,
  x1: number,
  fieldY: number,
): { left: number; right: number; y: number } {
  const l = projectToScreen(x0, fieldY);
  const r = projectToScreen(x1, fieldY);
  return { left: l.x, right: r.x, y: l.y };
}
