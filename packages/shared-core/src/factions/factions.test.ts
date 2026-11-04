import { describe, expect, it } from 'vitest';
import { ARENAS, FACTIONS, getArena, getFaction } from './index';
import { isHexColor } from '../theme/palette';

describe('faction registry', () => {
  it('defines the 4 canonical teams', () => {
    expect(FACTIONS.map((f) => f.name)).toEqual([
      'Boneyard Reapers',
      'Rotting Deadskins',
      'Transylvania Nightstalkers',
      'Salem Bayou Ghouls',
    ]);
    expect(FACTIONS.map((f) => f.species)).toEqual([
      'Skeletons',
      'Zombies',
      'Vampires',
      'Ghouls & Witches',
    ]);
  });

  it('has valid colors, stats and star players', () => {
    for (const f of FACTIONS) {
      for (const c of Object.values(f.colors)) expect(isHexColor(c)).toBe(true);
      for (const v of Object.values(f.stats)) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(10);
      }
      expect(f.stars.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('has 3 arenas and every home arena resolves', () => {
    expect(ARENAS.map((a) => a.name)).toEqual([
      'The Cursed Graveyard',
      'Brimstone Hellfire Pit',
      'Ectoplasm Swamp',
    ]);
    for (const f of FACTIONS) expect(getArena(f.homeArena).id).toBe(f.homeArena);
  });

  it('looks up factions and throws on unknown ids', () => {
    expect(getFaction('reapers').species).toBe('Skeletons');
    expect(() => getFaction('nope' as never)).toThrow();
  });
});
