import { describe, expect, it } from 'vitest';
import { createPrng } from './prng';
import { DEFAULT_PROJECTION, projectToScreen, unprojectFromScreen } from './projection25d';

describe('SeededRandom', () => {
  it('is deterministic per seed', () => {
    const a = createPrng(1234);
    const b = createPrng(1234);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(createPrng(1235).next()).not.toBe(seqA[0]);
  });

  it('stays within range', () => {
    const r = createPrng(7);
    for (let i = 0; i < 500; i++) {
      const n = r.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const k = r.int(3, 6);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(6);
    }
  });

  it('picks and rejects empty', () => {
    expect(['a', 'b']).toContain(createPrng(1).pick(['a', 'b']));
    expect(() => createPrng(1).pick([])).toThrow();
  });
});

describe('projection25d', () => {
  const c = DEFAULT_PROJECTION;

  it('maps near/far edges with perspective narrowing', () => {
    const farLeft = projectToScreen(0, 0);
    const nearLeft = projectToScreen(0, c.fieldHeight);
    expect(farLeft.y).toBe(0);
    expect(nearLeft.y).toBe(c.screenHeight);
    expect(farLeft.x).toBeGreaterThan(nearLeft.x);
    expect(nearLeft.x).toBeCloseTo(0);
  });

  it('centres the field midline', () => {
    expect(projectToScreen(c.fieldWidth / 2, 10).x).toBeCloseTo(c.screenWidth / 2);
  });

  it('raises screen position with z', () => {
    expect(projectToScreen(10, 20, 5).y).toBeLessThan(projectToScreen(10, 20, 0).y);
  });

  it('round-trips unproject(project(p))', () => {
    const p = projectToScreen(37, 21);
    const back = unprojectFromScreen(p.x, p.y);
    expect(back.x).toBeCloseTo(37);
    expect(back.y).toBeCloseTo(21);
  });
});
