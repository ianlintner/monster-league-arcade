import { describe, expect, it } from 'vitest';
import { resolveFumble } from './LooseBall';
import type { TeamId } from '../sim/Roster';

describe('LooseBall recovery', () => {
  const base = {
    x: 50,
    y: 0,
    offense: 'home' as TeamId,
    seed: 123,
  };

  it('is recovered by the faster, closer chaser (deterministic)', () => {
    const a = resolveFumble({
      ...base,
      chasers: [
        { team: 'home', speed: 7, distance: 5 },
        { team: 'away', speed: 9, distance: 5 },
      ],
    });
    // Away is faster at equal distance → wins.
    expect(a.recoveredBy).toBe('away');
    expect(a.turnover).toBe(true);
  });

  it('is deterministic across re-runs under the same seed', () => {
    const chasers = [
      { team: 'home' as TeamId, speed: 7, distance: 2 },
      { team: 'away' as TeamId, speed: 8, distance: 4 },
      { team: 'away' as TeamId, speed: 6, distance: 1 },
    ];
    const r1 = resolveFumble({ ...base, chasers });
    const r2 = resolveFumble({ ...base, chasers });
    expect(r1).toEqual(r2);
  });

  it('turns the ball over only when the defense recovers', () => {
    const r = resolveFumble({
      ...base,
      chasers: [{ team: 'home', speed: 20, distance: 0.5 }],
    });
    expect(r.recoveredBy).toBe('home');
    expect(r.turnover).toBe(false);
  });

  it('returns a dead ball (no recovery) when no chasers are present', () => {
    const r = resolveFumble({ ...base, chasers: [] });
    expect(r.recoveredBy).toBeNull();
    expect(r.turnover).toBe(false);
  });
});
