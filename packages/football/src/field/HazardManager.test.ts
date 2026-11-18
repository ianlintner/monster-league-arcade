import { describe, expect, it } from 'vitest';
import { HazardManager } from './HazardManager';
import type { Side, Slot, TeamId } from '../sim/Roster';

const ACTOR = (team: TeamId = 'home'): { team: TeamId; side: Side; slot: Slot } => ({
  team,
  side: 'OFFENSE',
  slot: 'RB1',
});

describe('HazardManager — graveyard', () => {
  it('builds a deterministic layout for a fixed seed', () => {
    const a = new HazardManager('cursed-graveyard', 42);
    const b = new HazardManager('cursed-graveyard', 42);
    expect(a.hazards.map((h) => [h.id, h.x, h.y])).toEqual(b.hazards.map((h) => [h.id, h.x, h.y]));
  });

  it('places tombstones, graves and mines in the graveyard', () => {
    const m = new HazardManager('cursed-graveyard', 7);
    const kinds = new Set(m.hazards.map((h) => h.kind));
    expect(kinds.has('TOMBSTONE')).toBe(true);
    expect(kinds.has('OPEN_GRAVE')).toBe(true);
    expect(kinds.has('MINE')).toBe(true);
  });

  it('open grave is an instant casualty (lethal hit)', () => {
    const m = new HazardManager('cursed-graveyard', 7);
    const grave = m.hazards.find((h) => h.kind === 'OPEN_GRAVE')!;
    const inf = m.evaluate(grave.x, grave.y, ACTOR(), false, 1 / 60);
    expect(inf.hits.length).toBeGreaterThan(0);
    expect(inf.hits[0]!.amount).toBeGreaterThanOrEqual(999);
  });

  it('mine detonates unless cleared by a dive', () => {
    const m = new HazardManager('cursed-graveyard', 7);
    const mine = m.hazards.find((h) => h.kind === 'MINE')!;
    // No dive → detonation.
    const det = m.evaluate(mine.x, mine.y, ACTOR(), false, 1 / 60);
    expect(det.hits.length).toBeGreaterThan(0);
    expect(det.hits[0]!.source).toBe('EXPLOSION');
    expect(mine.armed).toBe(false);
  });

  it('a dive clears a mine without taking damage', () => {
    const m = new HazardManager('cursed-graveyard', 7);
    const mine = m.hazards.find((h) => h.kind === 'MINE')!;
    const inf = m.evaluate(mine.x, mine.y, ACTOR(), true, 1 / 60);
    expect(inf.hits).toEqual([]);
    expect(inf.cleared).toContain(mine.id);
    expect(mine.armed).toBe(false);
  });
});

describe('HazardManager — hellfire', () => {
  it('geysers start unarmed with a telegraph', () => {
    const m = new HazardManager('brimstone-hellfire-pit', 3);
    const geysers = m.hazards.filter((h) => h.kind === 'LAVA_GEYSER');
    expect(geysers.length).toBeGreaterThan(0);
    for (const g of geysers) {
      expect(g.armed).toBe(false);
      expect(g.telegraphSeconds).toBeGreaterThan(0);
    }
    // Nothing erupts while armed=false.
    expect(m.evaluate(geysers[0]!.x, geysers[0]!.y, ACTOR(), false, 1 / 60).hits).toEqual([]);
  });

  it('a geyser arms after its telegraph elapses and then erupts', () => {
    const m = new HazardManager('brimstone-hellfire-pit', 3);
    const g = m.hazards.find((h) => h.kind === 'LAVA_GEYSER')!;
    const total = g.telegraphSeconds;
    // Advance just past the telegraph.
    m.tick(total + 0.01);
    const inf = m.evaluate(g.x, g.y, ACTOR(), false, 1 / 60);
    expect(g.armed).toBe(true);
    expect(inf.hits.length).toBeGreaterThan(0);
    expect(inf.hits[0]!.source).toBe('EXPLOSION');
  });
});

describe('HazardManager — swamp', () => {
  it('bog lowers friction', () => {
    const m = new HazardManager('ectoplasm-swamp', 11);
    const bog = m.hazards.find((h) => h.kind === 'BOG')!;
    const inf = m.evaluate(bog.x, bog.y, ACTOR(), false, 1 / 60);
    expect(inf.frictionMult).toBeLessThan(1);
  });

  it('sludge slows and applies damage over time, and is cleared by a dive', () => {
    const m = new HazardManager('ectoplasm-swamp', 11);
    const sludge = m.hazards.find((h) => h.kind === 'SLUDGE')!;
    const slow = m.evaluate(sludge.x, sludge.y, ACTOR(), false, 1 / 60);
    expect(slow.slowMult).toBeLessThan(1);
    // DoT accrues over a full second (60 ticks).
    let dotDamage = 0;
    for (let i = 0; i < 60; i++) {
      dotDamage += m
        .evaluate(sludge.x, sludge.y, ACTOR(), false, 1 / 60)
        .hits.filter((h) => h.source === 'POISON')
        .reduce((s, h) => s + h.amount, 0);
    }
    expect(dotDamage).toBeGreaterThan(0);

    // Re-arm manually for the dive-clears test.
    sludge.armed = true;
    const cleared = m.evaluate(sludge.x, sludge.y, ACTOR(), true, 1 / 60);
    expect(cleared.cleared).toContain(sludge.id);
    expect(sludge.armed).toBe(false);
  });
});
