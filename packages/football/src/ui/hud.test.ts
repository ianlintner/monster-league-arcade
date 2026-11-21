import { describe, expect, it } from 'vitest';
import { CARNAGE_LIMIT } from '../sim/Roster';
import {
  buildBroadcastBanner,
  buildControlsBar,
  buildHuddleOverlay,
  buildScorebug,
  downDistanceLabel,
  losLabel,
} from './hud';
import type { HudState } from './hud';

function state(over: Partial<HudState> = {}): HudState {
  return {
    home: { faction: 'reapers', score: 14, casualties: 1 },
    away: { faction: 'deadskins', score: 7, casualties: 3 },
    quarter: 2,
    clockSeconds: 90,
    playClockSeconds: 21,
    possession: 'home',
    down: 3,
    yardsToGo: 8,
    los: 62,
    bribedRefTeam: null,
    demonRefActive: false,
    availableNasties: ['PUMPKIN_BOMB_PASS', 'BRIBE_REF'],
    banner: '',
    ...over,
  };
}

describe('GSN 66.6 Scorebug', () => {
  it('renders team crests, LED scores, quarter, clock and play clock', () => {
    const el = buildScorebug(state());
    expect(el.querySelector('[data-testid="score-home"]')?.textContent).toBe('14');
    expect(el.querySelector('[data-testid="score-away"]')?.textContent).toBe('7');
    expect(el.querySelectorAll('[data-crest]')).toHaveLength(2);
    expect(el.querySelector('.gsn-scorebug__meta')?.textContent).toBe('Q2');
    expect(el.querySelector('.gsn-scorebug__playclock')?.textContent).toContain('21');
  });

  it('lights one casualty skull per team toward the carnage limit', () => {
    const el = buildScorebug(state());
    const home = el.querySelector('[data-testid="skulls-home"]')!;
    const away = el.querySelector('[data-testid="skulls-away"]')!;
    expect(home.querySelectorAll('.gsn-skull')).toHaveLength(CARNAGE_LIMIT);
    expect(home.querySelectorAll('[data-lit="true"]')).toHaveLength(1);
    expect(away.querySelectorAll('[data-lit="true"]')).toHaveLength(3);
  });

  it('shows down & distance plus ball position', () => {
    expect(downDistanceLabel(3, 8)).toBe('3RD & 8');
    expect(losLabel(62, 'home')).toBe('BALL ON OPP 38');
    const el = buildScorebug(state());
    expect(el.querySelector('.gsn-scorebug__down')?.textContent).toBe('3RD & 8');
  });

  it('activates the bribed-ref badge only when a bribe is in effect', () => {
    const idle = buildScorebug(state()).querySelector('[data-testid="bribe-badge"]')!;
    expect(idle.getAttribute('data-active')).toBe('false');
    const bribed = buildScorebug(state({ bribedRefTeam: 'away' })).querySelector(
      '[data-testid="bribe-badge"]',
    )!;
    expect(bribed.getAttribute('data-active')).toBe('true');
    expect(bribed.textContent).toContain('paid');
  });
});

describe('Huddle overlay', () => {
  it('renders formation selector, three A/B/C play cards and nasty drawer', () => {
    const el = buildHuddleOverlay({
      formations: ['GRAVEYARD_I_FORM', 'CRYPT_SHOTGUN'],
      plays: [
        { label: 'A', name: 'Inside Gore Run', kind: 'RUN', formation: 'I-FORM' },
        { label: 'B', name: 'Quick Slants', kind: 'PASS', formation: 'SHOTGUN' },
        { label: 'C', name: 'Deep Cross', kind: 'PASS', formation: 'SHOTGUN' },
      ],
      availableNasties: ['PUMPKIN_BOMB_PASS', 'BRIBE_REF'],
    });
    expect(el.querySelector('[data-testid="formations"]')?.children).toHaveLength(2);
    expect(el.querySelector('[data-testid="play-a"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="play-b"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="play-c"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="nasty-drawer"]')?.textContent).toContain(
      'PUMPKIN_BOMB_PASS',
    );
  });
});

describe('Broadcast banners', () => {
  it.each([
    ['TOUCHDOWN', 'TOUCHDOWN!'],
    ['TURNOVER', 'TURNOVER!'],
    ['PENALTY', 'BOGUS PENALTY!'],
    ['CASUALTY', 'PLAYER LIQUIDATED!'],
    ['REF_LIQUIDATED', 'REF LIQUIDATED!'],
    ['FORFEIT', 'FORFEIT BY CARNAGE!'],
  ] as const)('renders %s with the correct title', (kind, title) => {
    const el = buildBroadcastBanner(kind, 'detail');
    expect(el.getAttribute('data-kind')).toBe(kind);
    expect(el.querySelector('.gsn-banner__head')?.textContent).toBe(title);
  });
});

describe('Controls bar', () => {
  it('updates the button legend per context', () => {
    expect(buildControlsBar('PRE_SNAP').textContent).toContain('Hike');
    expect(buildControlsBar('CARRIER').textContent).toContain('Turbo');
    expect(buildControlsBar('DEFENSE').textContent).toContain('Switch');
    expect(buildControlsBar('HUDDLE').textContent).toContain('Nasty');
  });
});
