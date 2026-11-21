import { describe, expect, it } from 'vitest';
import { computePassTargets, sampleRoute, routeLength } from './PassWindows';
import type { OffenseSlot, Waypoint } from '../sim';

const slot: OffenseSlot = 'WR/TE';
const route: Waypoint[] = [
  { x: 0, y: 0 },
  { x: 0, y: 10 },
  { x: 0, y: 20 },
];

describe('PassWindows — route sampling', () => {
  it('measures polyline length', () => {
    expect(routeLength(route)).toBe(20);
  });

  it('samples the midpoint of a straight route', () => {
    const mid = sampleRoute(route, 0.5);
    expect(mid.x).toBe(0);
    expect(mid.y).toBe(10);
  });

  it('extrapolates linearly beyond the route span (no implicit clamp)', () => {
    expect(sampleRoute(route, 1).y).toBe(20);
    expect(sampleRoute(route, -0.5).y).toBe(-10);
  });
});

describe('PassWindows — target computation', () => {
  it('emits one target per assigned receiver, with a lead point ahead of the receiver', () => {
    const targets = computePassTargets(
      { A: slot },
      () => route,
      { [slot]: 0.25 } as Record<OffenseSlot, number>,
      1,
    );
    expect(targets).toHaveLength(1);
    const t = targets[0]!;
    expect(t.key).toBe('A');
    expect(t.slot).toBe(slot);
    // Receiver is at route progress 0.25 → y=5. Lead point must be further along.
    expect(t.leadY).toBeGreaterThan(t.y);
  });

  it('skips unassigned receiver keys', () => {
    const targets = computePassTargets(
      { B: slot },
      () => route,
      { [slot]: 0 } as Record<OffenseSlot, number>,
      1,
    );
    expect(targets.map((t) => t.key)).toEqual(['B']);
  });
});
