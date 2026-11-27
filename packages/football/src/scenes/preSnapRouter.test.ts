import { describe, expect, it, vi } from 'vitest';
import { GameSession } from '../sim/GameSession';
import { NastyFieldEffects } from '../field/NastyFieldEffects';
import {
  MENU_TIMEOUT_S,
  routePreSnapButton,
  tickNotice,
  updateRouter,
  type PreSnapRuntime,
} from './preSnapRouter';
import type { ArcadeButton } from '@monster-league/shared-core';

function runtime(
  over: { possession?: 'home' | 'away'; off?: string; def?: string } = {},
): PreSnapRuntime & { pressed: Set<ArcadeButton> } {
  const session = new GameSession({ seed: 3 });
  session.possession = over.possession ?? 'home';
  session.phase = 'HUDDLE_PLAYCALL';
  session.selectPlays(over.off ?? 'QUICK_SLANTS', over.def ?? 'BONE_CRUSH_BASE');
  const pressed = new Set<ArcadeButton>();
  return {
    session,
    nastyFields: new NastyFieldEffects(),
    audible: null,
    audibleClock: 0,
    audibleCombo: [],
    audiblePlayId: null,
    nastyNotice: '',
    nastyNoticeKind: null,
    nastyNoticeTimer: 0,
    pressedBtn: (b) => pressed.has(b),
    pressed,
  };
}

const combo = (s: PreSnapRuntime, ...bs: ArcadeButton[]) =>
  bs.map((b) => routePreSnapButton(s, b, () => {}));

describe('pre-snap combo router', () => {
  it('bare C hikes', () => {
    const s = runtime();
    expect(combo(s, 'C')).toEqual(['HIKE']);
  });

  it('A,C,A calls Pumpkin Bomb Pass on a pass play and consumes the charge', () => {
    const s = runtime();
    expect(combo(s, 'A', 'C', 'A')).toEqual(['HANDLED', 'HANDLED', 'HANDLED']);
    expect(s.session.effects.active).toContain('PUMPKIN_BOMB_PASS');
    expect(s.session.charges.available('home', 'PUMPKIN_BOMB_PASS', 1)).toBe(false);
    expect(s.nastyNoticeKind).toBe('call');
    expect(s.nastyNotice).toContain('PUMPKIN BOMB PASS');
    expect(s.audible).toBeNull();
  });

  it('repeating the combo in the same half is refused without consuming anything', () => {
    const s = runtime();
    combo(s, 'A', 'C', 'A');
    const before = s.session.charges.remaining('home', 1).length;
    combo(s, 'A', 'C', 'A');
    expect(s.session.charges.remaining('home', 1).length).toBe(before);
    expect(s.nastyNoticeKind).toBe('refuse');
    expect(s.nastyNotice).toMatch(/REFUSED.*ALREADY USED/);
  });

  it('C inside an open menu never snaps', () => {
    const s = runtime();
    expect(combo(s, 'A', 'C')).toEqual(['HANDLED', 'HANDLED']);
    expect(s.audible?.state).toBe('NASTY_MENU');
  });

  it('an unresolved menu times out back to IDLE so C hikes again', () => {
    const s = runtime();
    routePreSnapButton(s, 'A', () => {});
    expect(s.audibleClock).toBe(MENU_TIMEOUT_S);
    updateRouter(s, MENU_TIMEOUT_S + 0.01, () => {});
    expect(s.audible).toBeNull();
    s.pressed.add('C');
    expect(updateRouter(s, 0.016, () => {})).toBe('HIKE');
  });

  it('defense side A,C,A calls QB Crypt Blitz', () => {
    const s = runtime({ possession: 'away', off: 'INSIDE_GORE_RUN' });
    combo(s, 'A', 'C', 'A');
    expect(s.session.effects.active).toContain('QB_CRYPT_BLITZ');
    expect(s.nastyNoticeKind).toBe('call');
  });

  it('A,A is a standard audible that swaps the play and rebuilds the formation', () => {
    const s = runtime({ off: 'INSIDE_GORE_RUN' });
    const rebuild = vi.fn();
    routePreSnapButton(s, 'A', rebuild);
    routePreSnapButton(s, 'A', rebuild);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(s.audiblePlayId).toBe(s.session.selectedOffensePlayId);
    expect(s.audiblePlayId).not.toBe('INSIDE_GORE_RUN');
  });

  it('B from IDLE is a no-op (ref-menu hook)', () => {
    const s = runtime();
    expect(combo(s, 'B')).toEqual(['HANDLED']);
    expect(s.audible).toBeNull();
  });

  it('the callout expires', () => {
    const s = runtime();
    combo(s, 'A', 'C', 'A');
    tickNotice(s, 5);
    expect(s.nastyNotice).toBe('');
  });
});
