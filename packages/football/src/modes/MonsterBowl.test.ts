import { describe, expect, it } from 'vitest';
import { FACTIONS } from '@monster-league/shared-core';
import {
  bracketRows,
  championshipMatchup,
  createMonsterBowl,
  crownChampion,
  isComplete,
  recordSemifinal,
  tentMvp,
} from './MonsterBowl';
import type { TeamSeed } from './MonsterBowl';

function seeds(): TeamSeed[] {
  return FACTIONS.slice(0, 4).map((faction, i) => ({ faction, seed: i + 1 }));
}

describe('MonsterBowl bracket progression', () => {
  it('builds a 4-team bracket with seed-correct semifinal pairings', () => {
    const bowl = createMonsterBowl(seeds());
    expect(bowl.teams).toHaveLength(4);
    expect(bowl.semifinals).toHaveLength(2);
    // #1 vs #4 and #2 vs #3.
    expect(bowl.semifinals[0]![0].seed).toBe(1);
    expect(bowl.semifinals[0]![1].seed).toBe(4);
    expect(bowl.semifinals[1]![0].seed).toBe(2);
    expect(bowl.semifinals[1]![1].seed).toBe(3);
  });

  it('rejects a non-4-team bracket', () => {
    expect(() => createMonsterBowl(seeds().slice(0, 3))).toThrow(/4 teams/);
  });

  it('places semifinal winners into the championship and crowns the higher score', () => {
    const bowl = createMonsterBowl(seeds());
    expect(championshipMatchup(bowl)).toBeNull();

    const w1 = recordSemifinal(bowl, 'semi-1', 28, 10);
    expect(championshipMatchup(bowl)).toBeNull(); // second semi unresolved
    const w2 = recordSemifinal(bowl, 'semi-2', 7, 14);

    const matchup = championshipMatchup(bowl);
    expect(matchup).not.toBeNull();
    expect(matchup![0]).toBe(w1);
    expect(matchup![1]).toBe(w2);

    const crown = crownChampion(bowl, 21, 24); // away (w2) wins
    expect(crown?.champion).toBe(w2);
    expect(crown?.runnerUp).toBe(w1);
    expect(isComplete(bowl)).toBe(true);
  });

  it('triggers the Hole of Flame MVP ceremony exactly once after a champion', () => {
    const bowl = createMonsterBowl(seeds());
    // MVP cannot be awarded before a champion.
    expect(tentMvp(bowl, { playerName: 'X', factionId: 'x', stat: 3 })).toBe(false);

    recordSemifinal(bowl, 'semi-1', 10, 7);
    recordSemifinal(bowl, 'semi-2', 3, 3);
    crownChampion(bowl, 20, 19);

    const award = { playerName: 'Ribs McGraw', factionId: 'reapers', stat: 6 };
    expect(tentMvp(bowl, award)).toBe(true);
    // Second ceremony is refused.
    expect(tentMvp(bowl, award)).toBe(false);
    expect(bowl.mvp).toEqual(award);
    expect(bowl.ceremonyTriggered).toBe(true);
  });

  it('renders bracket rows ending in a resolved championship line', () => {
    const bowl = createMonsterBowl(seeds());
    recordSemifinal(bowl, 'semi-1', 10, 7);
    recordSemifinal(bowl, 'semi-2', 14, 13);
    const rows = bracketRows(bowl);
    expect(rows).toHaveLength(3);
    expect(rows[2]!.slot).toBe('championship');
    expect(rows[2]!.text).not.toContain('TBD');
  });
});