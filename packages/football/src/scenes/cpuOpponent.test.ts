import { describe, expect, it } from 'vitest';
import { GameSession } from '../sim/GameSession';
import { getOffensePlay } from '../sim/Playbook';
import { cpuCallOffense, cpuOnOffense, cpuSituation } from './cpuOpponent';

/** A live session where the CPU (away) has the ball at a chosen field position. */
function awaySession(los: number, down = 1, yardsToGo = 10): GameSession {
  const g = new GameSession({ seed: 7 });
  g.possession = 'away';
  g.los = los;
  g.down = down;
  g.yardsToGo = yardsToGo;
  return g;
}

describe('CPU play-call adapter (cpuOpponent)', () => {
  it('reports CPU on offense only when away has possession', () => {
    const g = awaySession(30);
    expect(cpuOnOffense(g)).toBe(true);
    g.possession = 'home';
    expect(cpuOnOffense(g)).toBe(false);
  });

  it('builds a coach situation from the away team perspective', () => {
    const g = awaySession(30);
    const sit = cpuSituation(g);
    expect(sit.team).toBe('away');
    expect(sit.aiIsOffense).toBe(true);
    expect(sit.down).toBe(1);
    expect(sit.los).toBe(30);
  });

  it('passes on 1st & 10 in open field (long yardage)', () => {
    const g = awaySession(30, 1, 10);
    const d = cpuCallOffense(g);
    expect(d.offensePlayId).toBe('POST_CORNER');
    expect(getOffensePlay(d.offensePlayId).kind).toBe('PASS');
  });

  it('calls a run on mid yardage where the mix lands on the ground game', () => {
    const g = awaySession(30, 1, 6);
    const d = cpuCallOffense(g);
    expect(d.offensePlayId).toBe('DRAW_OF_DOOM');
    expect(getOffensePlay(d.offensePlayId).kind).toBe('RUN');
  });

  it('calls a pass on 3rd & long', () => {
    const g = awaySession(30, 3, 12);
    const d = cpuCallOffense(g);
    expect(getOffensePlay(d.offensePlayId).kind).toBe('PASS');
  });

  it('punts on 4th down outside field-goal range', () => {
    const g = awaySession(20, 4, 5);
    expect(cpuCallOffense(g).offensePlayId).toBe('PUNT');
  });

  it('kicks a field goal on 4th down in range', () => {
    const g = awaySession(85, 4, 5);
    expect(cpuCallOffense(g).offensePlayId).toBe('FIELD_GOAL');
  });
});
