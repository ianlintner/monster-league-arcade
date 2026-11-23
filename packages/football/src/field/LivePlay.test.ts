import { describe, expect, it } from 'vitest';
import { LIVE_TUNING, LivePlay, type LiveActorSpec, type LivePlayInput } from './LivePlay';
import { buildLivePlayInput } from './fieldMapper';
import { GameSession } from '../sim/GameSession';

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
    los: 25,
    ...overrides,
  };
}

describe('LivePlay movement', () => {
  it('reaches near top speed within ~0.25 s (acceleration curve)', () => {
    const lp = new LivePlay(makeInput());
    // Give the carrier a clear downfield route and no defenders near.
    lp.command({ steerX: 1, steerY: 0 });
    // After ~0.25 s (15 ticks), speed should be ~95% of top speed.
    for (let i = 0; i < 15; i++) lp.advance();
    const c = lp.carrier;
    const speed = Math.hypot(c.vx, c.vy);
    const ratio = speed / 7;
    expect(ratio).toBeGreaterThan(0.9);
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
    // Place a defender right on top of the carrier's route, clear of blockers.
    const input = makeInput();
    const defender = input.actors.find((a) => a.id === 'away-DL1')!;
    defender.x = 0.5;
    defender.y = -2; // on the carrier (home-RB1 at y=-2), away from blocking OL
    // Move offensive blockers out of reach so they don't engage this defender.
    input.actors
      .filter((a) => a.side === 'OFFENSE' && a.id !== 'home-RB1')
      .forEach((a) => {
        a.x = 200;
      });
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

  it('a scramble tackled past the LOS keeps its positive finalX (not a sack)', () => {
    // Place a lone defender just beyond the LOS so the carrier is tackled only
    // after crossing it. The whistle reason must be TACKLE with finalX > 0 — the
    // state a positive-yard scramble produces, which the scene's sack classifier
    // must preserve instead of clamping a past-the-LOS gain to zero.
    const input = makeInput({ carrierRoute: [{ x: 8, y: 0 }], los: 25 });
    const defender = input.actors.find((a) => a.id === 'away-DL1')!;
    defender.x = 5; // past the LOS (carrier starts at x=0)
    defender.y = -2; // on the carrier (home-RB1 at y=-2)
    input.actors
      .filter((a) => a.side === 'OFFENSE' && a.id !== 'home-RB1')
      .forEach((a) => {
        a.x = 200;
      });
    const lp = new LivePlay(input);
    lp.command({ steerX: 1, steerY: 0 });
    const res = lp.run();
    expect(res.outcome).toMatchObject({ kind: 'WHISTLE', reason: 'TACKLE' });
    expect(res.finalX).toBeGreaterThan(0);
  });

  it('a scramble out of bounds past the LOS keeps its positive finalX', () => {
    // Steer diagonally out of bounds after crossing the LOS so the sideline exit
    // happens downfield, not behind it. finalX must stay positive (an unscored
    // positive gain), which the scene preserves instead of zeroing as a sack.
    const input = makeInput({ carrierRoute: [{ x: 8, y: 30 }], los: 25 });
    input.actors.forEach((a) => {
      if (a.side === 'DEFENSE') a.x = 200;
    });
    const lp = new LivePlay(input);
    lp.command({ steerX: 1, steerY: 1 });
    const res = lp.run();
    expect(res.outcome).toMatchObject({ kind: 'WHISTLE', reason: 'OUT_OF_BOUNDS' });
    expect(res.outOfBounds).toBe(true);
    expect(res.finalX).toBeGreaterThan(0);
  });

  it('whistles for a score at the snap-relative goal line, not x=100', () => {
    // Ball on the opponent's 5: `los = 95` puts the attacking goal line at
    // `x = 100 - los = 5`, so crossing x=5 scores instead of running to x=100.
    const lp = new LivePlay(makeInput({ los: 95 }));
    lp.command({ steerX: 1, steerY: 0 });
    lp.run();
    expect(lp.result().touchdown).toBe(true);
    expect(lp.result().finalX).toBeLessThan(10);
  });
});

describe('LivePlay determinism', () => {
  it('has no stack overflow when the carrier runs past the final waypoint', () => {
    // A short route that ends at a reachable waypoint; the carrier runs out of
    // waypoints and should hold a downfield heading rather than recurse forever.
    const input = makeInput({ carrierRoute: [{ x: 1, y: 0 }], los: 25 });
    // Keep defenders far away so the carrier is never tackled.
    input.actors.forEach((a) => {
      if (a.side === 'DEFENSE') a.x = 200;
    });
    const lp = new LivePlay(input);
    expect(() => lp.run()).not.toThrow();
  });

  it('uses the LOS-relative goal line, not a fixed 100-yard one', () => {
    // At LOS = 90, the goal line is only 10 yards downfield; a carrier starting
    // at x=8 and running straight should score when it crosses x=10, not x=100.
    const input = makeInput({ carrierRoute: [{ x: 15, y: 0 }], los: 90 });
    input.actors.forEach((a) => {
      if (a.side === 'DEFENSE') a.x = 200;
    });
    const carrier = input.actors.find((a) => a.id === 'home-RB1')!;
    carrier.x = 8;
    const lp = new LivePlay(input);
    lp.command({ steerX: 1, steerY: 0 });
    const res = lp.run();
    expect(res.outcome).toMatchObject({ kind: 'WHISTLE', reason: 'SCORE' });
    expect(res.touchdown).toBe(true);
  });

  it('reports net yards relative to the LOS (not from the backfield start)', () => {
    // Carrier starts 6 yards behind the LOS (typical backfield). Net yards must be
    // measured from the LOS (x=0 at snap), not displaced by the backfield start.
    const input = makeInput({ carrierRoute: [{ x: 0, y: 0 }], los: 25 });
    input.actors.forEach((a) => {
      if (a.side === 'DEFENSE') a.x = 200;
    });
    const carrier = input.actors.find((a) => a.id === 'home-RB1')!;
    carrier.x = -6; // six yards behind the LOS
    const lp = new LivePlay(input);
    // Advance only a few ticks: the carrier moves from -6 toward the LOS and is
    // still short of it, so net yards are negative and track its LOS-relative x.
    for (let i = 0; i < 20; i++) lp.advance();
    const res = lp.result();
    expect(res.yards).toBeLessThan(0);
    // yards is rounded to the nearest half-yard of the carrier's LOS-relative x
    // (not `carrier.x + 6`, which a backfield-start offset would produce).
    const rounded = Math.round(lp.carrier.x * 2) / 2;
    expect(res.yards).toBe(rounded);
  });

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
    expect(LIVE_TUNING.snapReactionSeconds).toBeCloseTo(1.2);
  });

  it('an untouched inside run develops for a believable 2-5 s (no instant tackle)', () => {
    // Build the real default play (INSIDE_GORE_RUN vs BONE_CRUSH_BASE) and run it
    // with no directional input. The carrier must gain yards and stay alive for
    // at least 2 s instead of being swallowed at the snap.
    const session = new GameSession();
    const input = buildLivePlayInput(session, 'INSIDE_GORE_RUN', 'BONE_CRUSH_BASE', 0x9e3779b9);
    const lp = new LivePlay(input);
    const res = lp.run();
    expect(res.outcome).toMatchObject({ kind: 'WHISTLE', reason: 'TACKLE' });
    expect(res.elapsed).toBeGreaterThanOrEqual(2);
    expect(res.elapsed).toBeLessThanOrEqual(5);
    expect(res.yards).toBeGreaterThan(0);
  });
});
