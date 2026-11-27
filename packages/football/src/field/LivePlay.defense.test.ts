import { describe, expect, it } from 'vitest';
import { LIVE_TUNING, LivePlay, type LiveActorSpec, type LivePlayInput } from './LivePlay';

/** 7 offense at the LOS (carrier home-RB1 at y=0) + 7 defenders far downfield. */
function makeInput(): LivePlayInput {
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
      y: (i - 3) * 6,
      topSpeed: 7,
      acceleration: 1,
      turnRate: 1,
    });
  });
  defSlots.forEach((slot, i) => {
    actors.push({
      id: `away-${slot}`,
      team: 'away',
      side: 'DEFENSE',
      slot,
      x: 40,
      y: (i - 3) * 6,
      topSpeed: 6.5,
      acceleration: 1,
      turnRate: 1,
    });
  });
  return { actors, carrierId: 'home-RB1', carrierRoute: [{ x: 0, y: 0 }], seed: 7, los: 25 };
}

const ticks = (lp: LivePlay, n: number): void => {
  for (let i = 0; i < n; i++) lp.advance();
};
const find = (lp: LivePlay, id: string) => lp.actors.find((a) => a.id === id)!;

describe('LivePlay controlled defender', () => {
  it('only defenders can be controlled', () => {
    const lp = new LivePlay(makeInput());
    lp.setControlledDefender('home-QB');
    expect(lp.controlledDefenderId).toBeNull();
    lp.setControlledDefender('away-LB1');
    expect(lp.controlledDefenderId).toBe('away-LB1');
    lp.setControlledDefender(null);
    expect(lp.controlledDefenderId).toBeNull();
  });

  it('steers the controlled defender with the stick, immediately (no read window)', () => {
    const lp = new LivePlay(makeInput());
    lp.setControlledDefender('away-LB1'); // y = 0
    const d = find(lp, 'away-LB1');
    const x0 = d.x;
    lp.command({ steerX: 0, steerY: 0, defenderSteerX: -1, defenderSteerY: 0 });
    ticks(lp, 30);
    expect(d.x).toBeLessThan(x0 - 1.5);
    expect(Math.abs(d.y)).toBeLessThan(0.5);

    const y0 = d.y;
    lp.command({ steerX: 0, steerY: 0, defenderSteerX: 0, defenderSteerY: 1 });
    ticks(lp, 30);
    expect(d.y).toBeGreaterThan(y0 + 1.5);
  });

  it('leaves the other defenders on pursuit AI', () => {
    const lp = new LivePlay(makeInput());
    lp.setControlledDefender('away-LB1');
    const other = find(lp, 'away-DL1');
    const x0 = other.x;
    lp.command({ steerX: 0, steerY: 0, defenderSteerX: 0, defenderSteerY: 1 });
    // Past the 1.2 s snap-read window the AI defenders run at the carrier.
    ticks(lp, 120);
    expect(other.x).toBeLessThan(x0);
  });

  it('an idle stick on the controlled defender falls back to pursuit', () => {
    const lp = new LivePlay(makeInput());
    lp.setControlledDefender('away-LB1');
    const d = find(lp, 'away-LB1');
    const x0 = d.x;
    lp.command({ steerX: 0, steerY: 0 });
    ticks(lp, 120);
    expect(d.x).toBeLessThan(x0);
  });

  it('dive tackle on contact ends the down with the diver as tackler', () => {
    const input = makeInput();
    // Put the controlled defender ~2.4 yards off the carrier; a 3-yd lunge covers it.
    const lb = input.actors.find((a) => a.id === 'away-LB1')!;
    lb.x = 2.4;
    lb.y = input.actors.find((a) => a.id === input.carrierId)!.y;
    const lp = new LivePlay(input);
    lp.setControlledDefender('away-LB1');
    lp.command({ steerX: 0, steerY: 0 });
    lp.defenderDive();
    ticks(lp, 1);
    expect(find(lp, 'away-LB1').diving).toBe(true);
    for (let i = 0; i < 60 && lp.snapshot().outcome.kind === 'RUNNING'; i++) lp.advance();
    const res = lp.result();
    expect(res.outcome).toEqual({ kind: 'WHISTLE', reason: 'TACKLE' });
    expect(res.tackler).toBe('away-LB1');
  });

  it('a missed dive leaves the defender down briefly, then he gets up', () => {
    const lp = new LivePlay(makeInput());
    lp.setControlledDefender('away-LB1'); // 40 yards away: guaranteed whiff
    const d = find(lp, 'away-LB1');
    lp.command({ steerX: 0, steerY: 0, defenderSteerX: -1, defenderSteerY: 0 });
    lp.defenderDive();
    ticks(lp, 1);
    expect(d.diving).toBe(true);
    // Lunge ends after diveCommitSeconds → down.
    ticks(lp, Math.ceil(LIVE_TUNING.diveCommitSeconds * 60) + 1);
    expect(d.diving).toBe(false);
    expect(d.downed).toBe(true);
    // While down he does not move even with the stick held.
    const x = d.x;
    ticks(lp, 10);
    expect(d.x).toBe(x);
    // ...then recovers and can steer again.
    ticks(lp, Math.ceil(LIVE_TUNING.defenderRecoverySeconds * 60));
    expect(d.downed).toBe(false);
    ticks(lp, 20);
    expect(d.x).toBeLessThan(x);
  });

  it('a dive in progress cannot be re-triggered or steered', () => {
    const lp = new LivePlay(makeInput());
    lp.setControlledDefender('away-LB1');
    const d = find(lp, 'away-LB1');
    lp.command({ steerX: 0, steerY: 0, defenderSteerX: -1, defenderSteerY: 0 });
    lp.defenderDive();
    ticks(lp, 1);
    const vx = d.vx;
    lp.command({ steerX: 0, steerY: 0, defenderSteerX: 0, defenderSteerY: 1 });
    lp.defenderDive();
    ticks(lp, 5);
    expect(d.vx).toBe(vx);
    expect(d.vy).toBe(0);
  });
});
