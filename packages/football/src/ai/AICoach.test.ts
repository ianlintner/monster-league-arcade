import { describe, expect, it } from 'vitest';
import { decideCoachPlay, aiPlaybookSize } from './AICoach';
import type { CoachSituation } from './AICoach';
import { getOffensePlay } from '../sim/Playbook';
import { ALL_NASTIES } from '../sim/DirtyTricks';

function sit(over: Partial<CoachSituation> = {}): CoachSituation {
  return {
    down: 2,
    yardsToGo: 7,
    los: 25,
    quarter: 1,
    clockSeconds: 120,
    score: { home: 0, away: 0 },
    team: 'away',
    aiIsOffense: true,
    ownCasualties: 0,
    refBribedAgainst: false,
    demonRefActive: false,
    availableNasties: [...ALL_NASTIES],
    ...over,
  };
}

describe('AICoach situational playcalling', () => {
  it('always punts or kicks on 4th down, never goes for it', () => {
    const punt = decideCoachPlay(sit({ down: 4, los: 20 })).offensePlayId;
    expect(punt).toBe('PUNT');
    const fg = decideCoachPlay(sit({ down: 4, los: 85 })).offensePlayId;
    expect(fg).toBe('FIELD_GOAL');
  });

  it('calls a short-yardage run (sneak/plunge) inside the goal line', () => {
    const d = decideCoachPlay(sit({ down: 1, yardsToGo: 2, los: 98 }));
    expect(['SPECTER_SNEAK', 'TOMBSTONE_PLUNGE']).toContain(d.offensePlayId);
    expect(getKind(d.offensePlayId)).toBe('RUN');
  });

  it('never returns undefined for a real session’s fractional yardage', () => {
    for (const over of [
      { down: 3, yardsToGo: 2.086907670060389, los: 97.91309232993962 },
      { down: 2, yardsToGo: 5.37, los: 63.42 },
      { down: 4, yardsToGo: 1.5, los: 97.91309232993962 },
    ]) {
      const d = decideCoachPlay(sit(over));
      expect(() => getOffensePlay(d.offensePlayId)).not.toThrow();
      expect(d.offensePlayId).not.toBe('');
    }
  });

  it('passes on 3rd & long and prefers a deep route when trailing', () => {
    const base = decideCoachPlay(sit({ down: 3, yardsToGo: 12 }));
    expect(getKind(base.offensePlayId)).toBe('PASS');
    const trailing = decideCoachPlay(sit({ down: 3, yardsToGo: 12, score: { home: 14, away: 0 } }));
    expect(trailing.offensePlayId).toBe('DEEP_CROSS');
  });

  it('counters a perceived pass with a cover play on defense', () => {
    const d = decideCoachPlay(sit({ aiIsOffense: false, down: 2, yardsToGo: 6, los: 40 }));
    expect(d.defensePlayId).toBe('COFFIN_COVER_3');
  });

  it('counters a short-yardage run with a run-stuff front', () => {
    const d = decideCoachPlay(sit({ aiIsOffense: false, down: 2, yardsToGo: 2, los: 40 }));
    expect(['GOAL_LINE_STUFF', 'RUN_STUFF_STAKE']).toContain(d.defensePlayId);
  });

  it('references only real plays from the playbook', () => {
    expect(aiPlaybookSize()).toBeGreaterThanOrEqual(27);
  });
});

describe('AICoach nasty & ref reactions', () => {
  it('arms Kill Ref when the opponent bribes the Necro-Ref against it', () => {
    const d = decideCoachPlay(sit({ refBribedAgainst: true, aiIsOffense: false }));
    expect(d.nasty).toBe('KILL_REF');
  });

  it('never arms a ref nasty once the Demon Ref is active', () => {
    const d = decideCoachPlay(sit({ demonRefActive: true, refBribedAgainst: true }));
    expect(d.nasty).not.toBe('BRIBE_REF');
    expect(d.nasty).not.toBe('KILL_REF');
  });

  it('arms Pumpkin Bomb on 3rd & long when a pass is called', () => {
    const d = decideCoachPlay(sit({ down: 3, yardsToGo: 12, los: 45 }));
    expect(d.nasty).toBe('PUMPKIN_BOMB_PASS');
  });

  it('holds its powder when nothing is situational', () => {
    const d = decideCoachPlay(
      sit({ down: 1, yardsToGo: 10, los: 25, availableNasties: ['QB_CRYPT_BLITZ'] }),
    );
    expect(d.nasty).toBeNull();
  });
});

function getKind(id: string): string {
  // Use the playbook's own kind lookup so the assertion stays in sync with the
  // real play definitions rather than a hand-maintained mirror.
  return getOffensePlay(id).kind;
}
