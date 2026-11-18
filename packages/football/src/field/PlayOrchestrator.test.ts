import { describe, expect, it } from 'vitest';
import { resolvePassAttempt, resolveTackleAttempt } from './PlayOrchestrator';

describe('PlayOrchestrator — pass resolution', () => {
  const attempt = {
    fromX: 0,
    fromY: 0,
    toX: 12,
    toY: 0,
    holdMs: 400, // BULLET
    defenders: [] as { id: string; x: number; y: number }[],
  };

  it('a clean, uncontested throw completes to the target', () => {
    const snap = resolvePassAttempt(attempt, 'A');
    expect(snap.target).toBe('A');
    expect(snap.force?.complete).toBe(true);
    expect(snap.force?.intercepted).toBe(false);
  });

  it('a defender on the flight line intercepts', () => {
    const snap = resolvePassAttempt(
      {
        ...attempt,
        defenders: [{ id: 'd1', x: 6, y: 0 }], // directly under the midpoint
      },
      'B',
    );
    expect(snap.target).toBe('B');
    expect(snap.force?.intercepted).toBe(true);
    expect(snap.force?.complete).toBe(false);
  });

  it('a nearby defender deflects (incomplete, no interception)', () => {
    const snap = resolvePassAttempt(
      {
        ...attempt,
        // ~1.6 yd off the line: inside deflection radius, outside interception.
        defenders: [{ id: 'd2', x: 6, y: 1.5 }],
      },
      'C',
    );
    expect(snap.force?.intercepted).toBe(false);
    expect(snap.force?.complete).toBe(false);
  });
});

describe('PlayOrchestrator — tackle resolution', () => {
  const base = {
    damage: 8,
    chasers: [] as { team: 'home' | 'away'; speed: number; distance: number }[],
    bigHit: false,
    ballX: 30,
    ballY: 0,
  };

  it('a routine tackle deals damage with no fumble', () => {
    const snap = resolveTackleAttempt({ ...base, damage: 8 }, 'home', 1);
    expect(snap.force?.tackleDamage).toBe(8);
    expect(snap.force?.fumble).toBeUndefined();
  });

  it('a big hit with a contest results in a fumble', () => {
    const snap = resolveTackleAttempt(
      {
        ...base,
        bigHit: true,
        chasers: [
          { team: 'home', speed: 9, distance: 1 },
          { team: 'away', speed: 7, distance: 1 },
        ],
      },
      'home',
      5,
    );
    expect(snap.force?.fumble).toBe(true);
    expect(snap.force?.tackleDamage).toBe(8);
  });

  it('a big hit with no chasers does not fumble', () => {
    const snap = resolveTackleAttempt({ ...base, bigHit: true }, 'home', 5);
    expect(snap.force?.fumble).toBeUndefined();
  });
});
