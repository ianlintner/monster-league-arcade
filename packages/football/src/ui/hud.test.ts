import { describe, expect, it } from 'vitest';
import { CARNAGE_LIMIT } from '../sim/Roster';
import {
  bannerKindForText,
  buildBroadcastBanner,
  buildControlsBar,
  buildHuddleOverlay,
  buildResultCard,
  buildScorebug,
  resultReasonLine,
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

  it('describes field position relative to the team with the ball', () => {
    const cases: [number, 'home' | 'away', string][] = [
      [25, 'home', 'BALL ON OWN 25'],
      [25, 'away', 'BALL ON OWN 25'],
      [62, 'home', 'BALL ON OPP 38'],
      [62, 'away', 'BALL ON OPP 38'],
      [1, 'home', 'BALL ON OWN 1'],
      [99, 'away', 'BALL ON OPP 1'],
      [50, 'home', 'BALL ON 50'],
      [50, 'away', 'BALL ON 50'],
    ];
    for (const [los, possession, expected] of cases) {
      expect(losLabel(los, possession), `losLabel(${los}, '${possession}')`).toBe(expected);
    }
  });

  it('rounds yardage for display and prints INCHES under a yard', () => {
    expect(downDistanceLabel(2, 10.901356182310463)).toBe('2ND & 11');
    expect(downDistanceLabel(1, 0.4)).toBe('1ST & INCHES');
    expect(losLabel(74.90135618231047, 'home')).toBe('BALL ON OPP 25');
  });

  it('labels field position with football OWN/50/OPP notation', () => {
    expect(losLabel(25, 'home')).toBe('BALL ON OWN 25');
    expect(losLabel(1, 'away')).toBe('BALL ON OWN 1');
    expect(losLabel(49, 'away')).toBe('BALL ON OWN 49');
    expect(losLabel(50, 'home')).toBe('BALL ON 50');
    expect(losLabel(51, 'home')).toBe('BALL ON OPP 49');
    expect(losLabel(99, 'away')).toBe('BALL ON OPP 1');
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
      'Pumpkin Bomb Pass',
    );
    expect(el.querySelector('[data-testid="nasty-drawer"]')?.textContent).toContain('2 charges');
    expect(el.querySelector('[data-nasty="PUMPKIN_BOMB_PASS"]')?.textContent).toContain(
      '[A→C → A]',
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

  it('classifies every GameSession.bannerFor() line without mislabelling ordinary plays', () => {
    // The exact literal strings `GameSession.bannerFor()` can return (see
    // GameSession.ts:900-911). None of the ordinary/scoring lines may fall through
    // to the casualty headline "PLAYER LIQUIDATED!".
    const cases: [string, string][] = [
      ['TOUCHDOWN!', 'TOUCHDOWN'],
      ['SAFETY!', 'NEUTRAL'],
      ['FIELD GOAL IS GOOD!', 'NEUTRAL'],
      ['FIELD GOAL NO GOOD', 'NEUTRAL'],
      ['PUNT — TOUCHBACK', 'NEUTRAL'],
      ['PUNT', 'NEUTRAL'],
      ['INTERCEPTED!', 'TURNOVER'],
      ['FUMBLE LOST!', 'FUMBLE'],
      ['TURNOVER ON DOWNS', 'TURNOVER'],
      ['SACKED!', 'NEUTRAL'],
      ['INCOMPLETE', 'NEUTRAL'],
      ['FIRST DOWN!', 'NEUTRAL'],
      ['+7 YARDS', 'NEUTRAL'],
      ['-3 YARDS', 'NEUTRAL'],
      ['PLAYER LIQUIDATED!', 'CASUALTY'],
      ['REF LIQUIDATED!', 'REF_LIQUIDATED'],
      ['FORFEIT BY CARNAGE! HOME wins!', 'FORFEIT'],
    ];
    for (const [text, expected] of cases) {
      expect(bannerKindForText(text), `"${text}"`).toBe(expected);
    }
  });
});

describe('Result card', () => {
  const base = {
    winner: 'home' as const,
    homeScore: 14,
    awayScore: 7,
    homeName: 'REAPERS',
    awayName: 'DEADSKINS',
    reason: 'SCORE' as const,
    forfeitLoser: null,
  };

  it('shows winner, final score, FINAL reason and the restart hint', () => {
    const el = buildResultCard(base);
    expect(el.querySelector('.gsn-result__head')?.textContent).toBe('REAPERS WINS!');
    expect(el.querySelector('[data-testid="result-score"]')?.textContent).toBe(
      'REAPERS 14 — 7 DEADSKINS',
    );
    expect(el.querySelector('[data-testid="result-reason"]')?.textContent).toBe('FINAL');
    expect(el.querySelector('[data-testid="result-hint"]')?.textContent).toContain('START=P');
  });

  it('names the forfeiting team when the match ends by carnage', () => {
    const s = {
      ...base,
      winner: 'away' as const,
      reason: 'FORFEIT_BY_CARNAGE' as const,
      forfeitLoser: 'home' as const,
    };
    expect(resultReasonLine(s)).toBe(`FORFEIT BY CARNAGE — REAPERS lost ${CARNAGE_LIMIT} monsters`);
    expect(buildResultCard(s).querySelector('.gsn-result__head')?.textContent).toBe(
      'DEADSKINS WINS!',
    );
  });

  it('reports a tie without a winner', () => {
    const el = buildResultCard({ ...base, winner: null, reason: 'TIE' });
    expect(el.querySelector('.gsn-result__head')?.textContent).toBe('FINAL — TIE');
  });
});

describe('Controls bar', () => {
  it('updates the button legend per context', () => {
    expect(buildControlsBar('PRE_SNAP').textContent).toContain('Hike');
    expect(buildControlsBar('CARRIER').textContent).toContain('Turbo');
    expect(buildControlsBar('DEFENSE').textContent).toContain('Switch');
    expect(buildControlsBar('HUDDLE').textContent).not.toContain('Nasty');
    expect(buildControlsBar('PRE_SNAP').textContent).toContain('[A=J] Audible');
  });
});
