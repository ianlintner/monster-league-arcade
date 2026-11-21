import { describe, expect, it } from 'vitest';
import {
  resolvePassAttempt,
  resolveTackleAttempt,
  resolveScrambleOutcome,
} from './PlayOrchestrator';

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
    expect(snap.force?.yards).toBe(12);
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
        // Defense (away) reaches the ball first: a real turnover fumble.
        chasers: [
          { team: 'away', speed: 9, distance: 1 },
          { team: 'home', speed: 7, distance: 1 },
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

  it('an offensive recovery does not force a lost fumble', () => {
    // Offense ('home') is nearest/fastest: recoveredBy = offense, turnover=false.
    // The ball stays with the offense; the sim must NOT be told it was lost.
    const snap = resolveTackleAttempt(
      {
        ...base,
        bigHit: true,
        chasers: [
          { team: 'home', speed: 9, distance: 1 },
          { team: 'away', speed: 7, distance: 5 },
        ],
      },
      'home',
      5,
    );
    expect(snap.force?.fumble).toBeUndefined();
    expect(snap.force?.tackleDamage).toBe(8);
  });

  it('a defensive recovery forces a lost fumble', () => {
    const snap = resolveTackleAttempt(
      {
        ...base,
        bigHit: true,
        chasers: [
          { team: 'away', speed: 9, distance: 1 },
          { team: 'home', speed: 7, distance: 5 },
        ],
      },
      'home',
      5,
    );
    expect(snap.force?.fumble).toBe(true);
  });
});

describe('PlayOrchestrator — scramble resolution', () => {
  const whistle = (reason: 'TACKLE' | 'OUT_OF_BOUNDS' | 'SCORE') => ({
    kind: 'WHISTLE' as const,
    reason,
  });

  it('a QB tackled behind the LOS is a sack preserving the measured loss', () => {
    const r = resolveScrambleOutcome({
      finalX: -3,
      outOfBounds: false,
      outcome: whistle('TACKLE'),
    });
    expect(r.sacked).toBe(true);
    expect(r.qbRun).toBeUndefined();
    expect(r.yards).toBe(-3);
  });

  it('a QB out of bounds behind the LOS preserves the measured loss (not zero)', () => {
    // Exiting three yards behind the line must back the next snap up three yards,
    // not zero — the regression this whole block guards against.
    const r = resolveScrambleOutcome({
      finalX: -3,
      outOfBounds: true,
      outcome: whistle('OUT_OF_BOUNDS'),
    });
    expect(r.sacked).toBe(true);
    expect(r.yards).toBe(-3);
  });

  it('a QB tackled past the LOS is a run with the QB as carrier, keeping the gain', () => {
    const r = resolveScrambleOutcome({ finalX: 6, outOfBounds: false, outcome: whistle('TACKLE') });
    expect(r.qbRun).toBe(true);
    expect(r.sacked).toBeUndefined();
    expect(r.yards).toBe(6);
  });

  it('a QB out of bounds past the LOS keeps the gain as a run', () => {
    const r = resolveScrambleOutcome({
      finalX: 4,
      outOfBounds: true,
      outcome: whistle('OUT_OF_BOUNDS'),
    });
    expect(r.qbRun).toBe(true);
    expect(r.yards).toBe(4);
  });

  it('a zero-yard tackle at the LOS is a zero-yard sack', () => {
    // `behindLos` is `yards <= 0`, so a tackle exactly at the line of scrimmage is
    // still a sack — just with no yardage lost.
    const r = resolveScrambleOutcome({ finalX: 0, outOfBounds: false, outcome: whistle('TACKLE') });
    expect(r.sacked).toBe(true);
    expect(r.qbRun).toBeUndefined();
    expect(r.yards).toBe(0);
  });
});
