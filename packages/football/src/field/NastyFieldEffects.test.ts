import { describe, expect, it } from 'vitest';
import { NastyFieldEffects } from './NastyFieldEffects';
import { computeEffects } from '../sim/DirtyTricks';
import type { NastyEffects } from '../sim/DirtyTricks';

function input(
  effects: NastyEffects,
  over: Partial<Parameters<NastyFieldEffects['tick']>[0]> = {},
) {
  return {
    effects,
    t: 0,
    pressedB: false,
    pressedC: false,
    carrierTeam: 'home' as const,
    carrierSlot: 'RB1',
    ...over,
  };
}

describe('NastyFieldEffects', () => {
  it('Bat-Wing Jet Boost raises carrier speed and knockdown resistance', () => {
    const fx = new NastyFieldEffects();
    fx.begin(computeEffects(['BAT_WING_JET_BOOST']));
    const snap = fx.tick(input(computeEffects(['BAT_WING_JET_BOOST'])));
    expect(snap.carrierSpeedMult).toBeGreaterThan(1);
    expect(snap.knockdownResistant).toBe(true);
  });

  it('no active nasties → neutral multipliers', () => {
    const fx = new NastyFieldEffects();
    const eff = computeEffects([]);
    fx.begin(eff);
    const snap = fx.tick(input(eff));
    expect(snap.carrierSpeedMult).toBe(1);
    expect(snap.dlSpeedMult).toBe(1);
    expect(snap.knockdownResistant).toBe(false);
  });

  it('Dynamite Pitch grants up to 3 grenade throws, one per B press', () => {
    const fx = new NastyFieldEffects();
    const eff = computeEffects(['DYNAMITE_PITCH']);
    fx.begin(eff);
    for (let i = 0; i < 4; i++) {
      const snap = fx.tick(input(eff, { pressedB: true, t: i }));
      expect(snap.grenadesThrown).toBe(i < 3 ? 1 : 0);
    }
  });

  it('Ghoul Gas drops a lingering cloud on the first B press', () => {
    const fx = new NastyFieldEffects();
    const eff = computeEffects(['GHOUL_GAS']);
    fx.begin(eff);
    const drop = fx.tick(input(eff, { pressedB: true, t: 0 }));
    expect(drop.gasDropped).toBe(true);
    expect(drop.gasActive).toBe(true);
    const mid = fx.tick(input(eff, { pressedB: false, t: 2 }));
    expect(mid.gasActive).toBe(true);
    const late = fx.tick(input(eff, { pressedB: false, t: 4 }));
    expect(late.gasActive).toBe(false);
  });

  it('Hex of Confusion reports a 3-second control inversion', () => {
    const fx = new NastyFieldEffects();
    const eff = computeEffects(['HEX_OF_CONFUSION']);
    fx.begin(eff);
    const at0 = fx.tick(input(eff, { t: 0 }));
    expect(at0.hexRemaining).toBeGreaterThan(0);
    const at4 = fx.tick(input(eff, { t: 4 }));
    expect(at4.hexRemaining).toBe(0);
  });
});
