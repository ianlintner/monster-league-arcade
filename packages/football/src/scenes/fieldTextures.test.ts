import { describe, expect, it } from 'vitest';
import {
  LEFT_GOAL_X,
  RIGHT_GOAL_X,
  regionBandXRange,
  regionCorners,
  yardNumberCells,
  yardNumberLabel,
} from './fieldTextures';

describe('yardNumberLabel', () => {
  it('reads the correct label on every 10-yard line, both halves mirrored', () => {
    const expected: Array<[number, string]> = [
      [20, '10'],
      [30, '20'],
      [40, '30'],
      [50, '40'],
      [60, '50'],
      [70, '40'],
      [80, '30'],
      [90, '20'],
      [100, '10'],
    ];
    for (const [x, label] of expected) {
      expect(yardNumberLabel(x)).toBe(label);
    }
  });

  it('reads 10..50..10 exactly once each across the nine yard lines', () => {
    const labels = [];
    for (let x = 20; x <= 100; x += 10) labels.push(yardNumberLabel(x));
    expect(labels).toEqual(['10', '20', '30', '40', '50', '40', '30', '20', '10']);
  });

  it('labels the band nearest each goal "10" (never "0")', () => {
    expect(yardNumberLabel(20)).toBe('10'); // 10 yd inside the left goal
    expect(yardNumberLabel(100)).toBe('10'); // 10 yd inside the right goal
  });

  it('treats the goal lines themselves as zero distance', () => {
    // Distance to the nearer goal line is exactly "0" at the goal — the label
    // mapping is only ever called on yard lines (20..100), but it should still
    // round a hypothetical goal-line call to "0" rather than fold into "10".
    expect(yardNumberLabel(LEFT_GOAL_X)).toBe('0');
    expect(yardNumberLabel(RIGHT_GOAL_X)).toBe('0');
  });
});

describe('yardNumberCells', () => {
  function matrix(label: string, side: 'near' | 'far'): string[] {
    const grid = Array.from({ length: 5 }, () => ['.', '.', '.']);
    for (const c of yardNumberCells(label, side)) {
      grid[c.row]![c.digit * 4 + c.col] = '#';
    }
    return grid.map((row) => Array.from({ length: row.length }, (_, i) => row[i] ?? '.').join(''));
  }

  it('draws upright glyphs on both sidelines (no mirrored E/h digits)', () => {
    for (const side of ['near', 'far'] as const) {
      expect(matrix('3', side)).toEqual(['###', '..#', '###', '..#', '###']);
      expect(matrix('6', side)).toEqual(['###', '#..', '###', '#.#', '###']);
      expect(matrix('9', side)).toEqual(['###', '#.#', '###', '..#', '###']);
      expect(matrix('2', side)).toEqual(['###', '..#', '###', '#..', '###']);
    }
  });

  it('keeps both digits of a two-character label and identical side orientation', () => {
    const near = matrix('30', 'near');
    expect(near).toEqual(matrix('30', 'far'));
    // digit 0 ("3") occupies cols 0..2, digit 1 ("0") starts at col 3.
    expect(near[0]).toBe('###.###');
    expect(near[4]).toBe('###.###');
    expect(yardNumberCells('30', 'far').every((c) => c.digit === 0 || c.digit === 1)).toBe(true);
  });
});

describe('regionCorners', () => {
  it('projects the field of play to a trapezoid narrower at the far edge', () => {
    const c = regionCorners(10, 110);
    const farWidth = c.farR.x - c.farL.x;
    const nearWidth = c.nearR.x - c.nearL.x;
    // farScale 0.7 → the far edge is 70% the width of the near edge.
    expect(nearWidth).toBeGreaterThan(farWidth);
    expect(farWidth / nearWidth).toBeCloseTo(0.7, 1);
  });

  it('keeps the left and right end zones abutting the goal lines without overlap', () => {
    const field = regionCorners(10, 110);
    const left = regionCorners(0, 10);
    const right = regionCorners(110, 120);
    // The end-zone near/right lands exactly on the field's near/left at x=10 and
    // x=110, so the three regions tile side-by-side with no gap or overlap.
    expect(left.nearR.x).toBeCloseTo(field.nearL.x, 6);
    expect(left.farR.x).toBeCloseTo(field.farL.x, 6);
    expect(field.nearR.x).toBeCloseTo(right.nearL.x, 6);
    expect(field.farR.x).toBeCloseTo(right.farL.x, 6);
  });
});

describe('regionBandXRange', () => {
  it('tapers the band width from far (narrow) to near (wide)', () => {
    const far = regionBandXRange(10, 110, 0);
    const mid = regionBandXRange(10, 110, 26.5);
    const near = regionBandXRange(10, 110, 53);
    expect(near.right - near.left).toBeGreaterThan(mid.right - mid.left);
    expect(mid.right - mid.left).toBeGreaterThan(far.right - far.left);
  });

  it('keeps the field-of-play band inside the arena span at every row', () => {
    for (let y = 0; y <= 53; y += 0.5) {
      const b = regionBandXRange(10, 110, y);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(640);
    }
  });
});
