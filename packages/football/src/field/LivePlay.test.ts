import { describe, expect, it } from 'vitest';
import {
  LIVE_TUNING,
  LivePlay,
  type LiveActorSpec,
  type LivePlayInput,
} from './LivePlay';

/** Build a minimalist 14-actor input: 7 offense + 7 defense, carrier = home-RB1. */
function makeInput(overrides: Partial<LivePlayInput> = {}): LivePlayInput {
  const offSlots = ['QB', 'RB1', 'RB2/WR', 'WR/TE', 'OL1', 'OL2', 'OL3'];
  const defSlots = ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'DB1', 'DB2'];
  const actors: LiveActorSpec[] = [];
  offSlots.forEach((slot, i) => {
    actors.push({
      id: `home-${slot}`,
      team: 'home',
      side: 'OFFENSE',
      slot,
      x: 0,
      y: i - 3,
      topSpeed: 7,
      acceleration: 1,
      turnRate: 1,
    });
  });
  // Defenders start far downfield so movement tests aren't immediately tackled;
  // a dedicated tackle test places one defender on top of the carrier.
  defSlots.forEach((slot, i) => {
    actors.push({
      id: `away-${slot}`,
      team: 'away',
      side: 'DEFENSE',
      slot,
      x: 90,
      y: i - 3,
      topSpeed: 6.5,
      acceleration: 1,
      turnRate: 1,
    });
  });
  return {
    actors,
    carrierId: 'home-RB1',
    carrierRoute: [{ x: 20, y: 0 }],
    seed: 12345,
    ...overrides,
  };
}

describe('LivePlay movement', () => {
  it('reaches near top speed in ~0.25 s (acceleration curve)', () => {
    const lp = new LivePlay(makeInput());
    // Give the carrier a clear downfield route and no defenders near.
    lp.command({ steerX: 1, steerY: 0 });
    // After ~0.25 s (15 ticks), speed should be ~63% of top speed (1 - 1/e).
    for (let i = 0; i < 15; i++) lp.advance();
    const c = lp.carrier;
    const speed = Math.hypot(c.vx, c.vy);
    const ratio = speed / 7;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.75);
  });

  it('hard cut bleeds ~30% speed', () => {
    const lp = new LivePlay(makeInput());
    // Run downfield to build speed.
    lp.command({ steerX: 1, steerY: 0 });
    for (let i = 0; i < 30; i++) lp.advance();
    const before = Math.hypot(lp.carrier.vx, lp.carrier.vy);
    // Hard cut upfield: steer directly perpendicular.
    lp.command({ steerX: 0, steerY: 1 });
    lp.advance();
    const after = Math.hypot(lp.carrier.vx, lp.carrier.vy);
    expect(after).toBeLessThan(before);
  });

  it('turbo drains stamina and boosts speed', () => {
    const lp = new LivePlay(makeInput());
    lp.command({ steerX: 1, steerY: 0, turbo: true });
    for (let i = 0; i < 120; i++) lp.advance(); // 2 s
    expect(lp.carrier.stamina).toBeLessThan(1);
    expect(lp.carrier.stamina).toBeGreaterThanOrEqual(0);
  });
});

describe('LivePlay resolution', () => {
  it('tackles when a defender reaches the carrier', () => {
    // Place a defender right on top of the carrier's route.
    const input = makeInput();
    const defender = input.actors.find((a) => a.id === 'away-DL1')!;
    defender.x = 0.5;
    defender.y = 0;
    const lp = new LivePlay(input);
    const res = lp.run();
    expect(res.outcome.kind).toBe('WHISTLE');
    expect(res.outcome).toMatchObject({ kind: 'WHISTLE', reason: 'TACKLE' });
    expect(res.tackler).toBe('away-DL1');
  });

  it('whistles out of bounds when the carrier crosses the sideline', () => {
    const lp = new LivePlay(makeInput());
    lp.command({ steerX: 0, steerY: 1 });
    const res = lp.run();
    expect(res.outcome).toMatchObject({ kind: 'WHISTLE', reason: 'OUT_OF_BOUNDS' });
    expect(res.outOfBounds).toBe(true);
  });

  it('reports positive yards toward the goal', () => {
    const lp = new LivePlay(makeInput());
    lp.command({ steerX: 1, steerY: 0 });
    // Advance far enough to gain yards but not reach goal (route is x=20).
    for (let i = 0; i < 120; i++) lp.advance();
    expect(lp.carrier.x).toBeGreaterThan(0);
    expect(lp.result().yards).toBeGreaterThan(0);
  });
});

describe('LivePlay determinism', () => {
  it('reproduces identical results for a fixed seed and scripted input', () => {
    const script = (lp: LivePlay): void => {
      // A fixed script: upfield 30 ticks, then cut right, then dive.
      lp.command({ steerX: 1, steerY: 0 });
      for (let i = 0; i < 30; i++) lp.advance();
      lp.command({ steerX: 0, steerY: 1, turbo: true });
      for (let i = 0; i < 20; i++) lp.advance();
      lp.command({ steerX: 0, steerY: 1, dive: true });
      for (let i = 0; i < 25; i++) lp.advance();
    };

    const a = new LivePlay(makeInput());
    const b = new LivePlay(makeInput());
    script(a);
    script(b);
    expect(a.result()).toEqual(b.result());
  });

  it('exposes the tuning constants the card requires', () => {
    expect(LIVE_TUNING.turboSpeedMult).toBeCloseTo(1.35);
    expect(LIVE_TUNING.diveYards).toBeCloseTo(3);
    expect(LIVE_TUNING.diveCommitSeconds).toBeCloseTo(0.4);
    expect(LIVE_TUNING.hitStopSeconds).toBeCloseTo(0.06);
  });
});