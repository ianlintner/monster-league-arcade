import { describe, expect, it } from 'vitest';
import { MIN_FORMATION_LATERAL_SPACING, spreadFormationLaterally } from './fieldMapper';
import { DEFENSE_FORMATIONS, OFFENSE_FORMATIONS } from '../sim/Playbook';

describe('formation lateral spread', () => {
  const formations = [...Object.values(OFFENSE_FORMATIONS), ...Object.values(DEFENSE_FORMATIONS)];

  it('gives every catalog play at least 3 yards between adjacent lanes', () => {
    expect(formations.length).toBeGreaterThanOrEqual(10);
    for (const formation of formations) {
      const positions = formation.positions as Record<string, { x: number; y: number }>;
      const spread = spreadFormationLaterally(positions);
      const xs = Object.values(spread)
        .map((p) => p.x)
        .sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(MIN_FORMATION_LATERAL_SPACING - 1e-9);
      }
      expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(26.5);
      for (const slot of Object.keys(formation.positions)) {
        expect(spread[slot]?.y).toBe(positions[slot]!.y);
      }
    }
  });

  it('breaks the I-form stacked QB/RB column into distinct lanes', () => {
    const positions = OFFENSE_FORMATIONS.GRAVEYARD_I_FORM.positions;
    const spread = spreadFormationLaterally(positions);
    const backfield = new Set([spread.QB!.x, spread.RB1!.x, spread['RB2/WR']!.x]);
    expect(backfield.size).toBe(3);
    expect(positions.QB.x).toBe(positions.RB1.x); // catalog itself is untouched
  });
});
