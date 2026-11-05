import { describe, expect, it } from 'vitest';
import { DYNAMITE_GRENADES, NastyCharges } from './DirtyTricks';
import { GameSession } from './GameSession';
import { AudibleController, DEFENSE_PLAYS, NASTY_SIDE, OFFENSE_PLAYS } from './Playbook';
import { Referee } from './Referee';
import { Rng } from './Rng';
import { ROSTER_SIZE } from './Roster';
import type { TeamId } from './Roster';

function start(seed = 7, extra: Record<string, unknown> = {}): GameSession {
  const g = new GameSession({ seed, ...extra });
  g.coinToss('home');
  g.kickoff({ touchback: true });
  return g;
}
function setup(g: GameSession, off = 'INSIDE_GORE_RUN', def = 'BONE_CRUSH_BASE'): void {
  if (g.phase === 'PLAY_OVER_BANNER') g.dismissBanner();
  g.selectPlays(off, def);
}
function run(g: GameSession, yards: number, off = 'INSIDE_GORE_RUN') {
  setup(g, off);
  return g.snap({ force: { yards, fumble: false, tackleDamage: 1 } });
}

describe('determinism & roster', () => {
  it('same seed gives same rosters and results', () => {
    const a = start(42);
    const b = start(42);
    setup(a);
    setup(b);
    expect(a.snap()).toEqual(b.snap());
    expect(a.roster.home.players.map((p) => p.maxHp)).toEqual(
      b.roster.home.players.map((p) => p.maxHp),
    );
  });
  it('11-man rosters: 7 active + 4 bench', () => {
    const g = start();
    expect(g.roster.home.players).toHaveLength(ROSTER_SIZE);
    expect(g.roster.home.active).toHaveLength(7);
    expect(g.roster.home.bench).toHaveLength(4);
  });
  it('Rng ranges', () => {
    const r = new Rng(1);
    for (let i = 0; i < 200; i++) expect(r.int(3, 5)).toBeGreaterThanOrEqual(3);
  });
});

describe('playbook', () => {
  it('has required breadth', () => {
    const o = Object.values(OFFENSE_PLAYS);
    const d = Object.values(DEFENSE_PLAYS);
    expect(o.length).toBeGreaterThanOrEqual(15);
    expect(d.length).toBeGreaterThanOrEqual(12);
    expect(new Set(o.map((p) => p.formation)).size).toBe(5);
    expect(new Set(d.map((p) => p.formation)).size).toBe(5);
    for (const p of o) for (const a of p.audibles) expect(OFFENSE_PLAYS[a]).toBeDefined();
    for (const p of d) for (const a of p.audibles) expect(DEFENSE_PLAYS[a]).toBeDefined();
    for (const id of [
      'INSIDE_GORE_RUN',
      'COFFIN_SWEEP',
      'OPTION_PITCH',
      'QUICK_SLANTS',
      'POST_CORNER',
      'HAIL_MARY_HOWL',
      'SCREEN_TRAP',
      'PUNT',
      'FIELD_GOAL',
    ]) {
      expect(OFFENSE_PLAYS[id]).toBeDefined();
    }
    expect(OFFENSE_PLAYS.POST_CORNER?.assignments['WR/TE'].route.length).toBeGreaterThan(1);
  });
  it('standard audible A->A/B', () => {
    const c = new AudibleController('OFFENSE', 'INSIDE_GORE_RUN', 'RUN');
    expect(c.press('A')).toBeNull();
    expect(c.press('B')).toEqual({
      kind: 'STANDARD',
      playId: OFFENSE_PLAYS.INSIDE_GORE_RUN?.audibles[1],
    });
    const d = new AudibleController('OFFENSE', 'INSIDE_GORE_RUN', 'RUN');
    d.press('A');
    expect(d.press('A')).toEqual({
      kind: 'STANDARD',
      playId: OFFENSE_PLAYS.INSIDE_GORE_RUN?.audibles[0],
    });
  });
  it('nasty audible A->C->A/B/C', () => {
    const picks = (['A', 'B', 'C'] as const).map((b) => {
      const c = new AudibleController('OFFENSE', 'QUICK_SLANTS', 'PASS');
      c.press('A');
      c.press('C');
      return c.press(b);
    });
    expect(picks).toEqual([
      { kind: 'NASTY', nasty: 'PUMPKIN_BOMB_PASS' },
      { kind: 'NASTY', nasty: 'BAT_WING_JET_BOOST' },
      { kind: 'NASTY', nasty: 'GHOUL_GAS' },
    ]);
    const c = new AudibleController('DEFENSE', 'BONE_CRUSH_BASE', null);
    c.press('A');
    c.press('C');
    expect(c.press('C')).toEqual({ kind: 'NASTY', nasty: 'HEX_OF_CONFUSION' });
  });
  it('session audible swaps play and fires nasty', () => {
    const g = start();
    setup(g, 'QUICK_SLANTS');
    g.audible('home', ['A', 'A']);
    expect(
      g.snap({ force: { yards: 3, complete: true, sacked: false, fumble: false, tackleDamage: 1 } })
        .offensePlayId,
    ).toBe(OFFENSE_PLAYS.QUICK_SLANTS?.audibles[0]);
    const h = start();
    setup(h, 'INSIDE_GORE_RUN');
    h.audible('home', ['A', 'C', 'B']);
    expect(h.effects.knockdownResistant).toBe(true);
  });
});

describe('downs, clock & scoring', () => {
  it('kickoff touchback to the 25', () => {
    const g = start();
    expect([g.possession, g.los, g.down, g.yardsToGo]).toEqual(['home', 25, 1, 10]);
    expect(g.phase).toBe('HUDDLE_PLAYCALL');
  });
  it('first down chain and down counting', () => {
    const g = start();
    run(g, 4);
    expect([g.down, g.yardsToGo, g.los]).toEqual([2, 6, 29]);
    const r = run(g, 7);
    expect(r.firstDown).toBe(true);
    expect([g.down, g.yardsToGo, g.los]).toEqual([1, 10, 36]);
  });
  it('turnover on downs', () => {
    const g = start();
    run(g, 1);
    run(g, 1);
    run(g, 1);
    const r = run(g, 1);
    expect(r.turnoverOnDowns).toBe(true);
    expect(g.possession).toBe('away');
    expect([g.down, g.los]).toEqual([1, 71]);
  });
  it('touchdown, extra point kick and 2-pt conversion', () => {
    const g = start();
    g.los = 95;
    const r = run(g, 9);
    expect(r.touchdown).toBe(true);
    expect(g.score.home).toBe(6);
    g.dismissBanner();
    expect(g.phase).toBe('EXTRA_POINT');
    expect(g.extraPoint('KICK', true)).toEqual({ good: true, points: 1 });
    expect(g.score.home).toBe(7);
    expect(g.phase).toBe('KICKOFF');
    const h = start();
    h.los = 95;
    run(h, 9);
    h.dismissBanner();
    h.extraPoint('CONVERSION', true);
    expect(h.score.home).toBe(8);
    h.kickoff({ touchback: true });
    expect(h.possession).toBe('away');
  });
  it('field goal good = 3, miss turns ball over', () => {
    const g = start();
    g.los = 80;
    setup(g, 'FIELD_GOAL');
    const r = g.snap({ force: { fieldGoalGood: true } });
    expect(r.fieldGoalGood).toBe(true);
    expect(g.score.home).toBe(3);
    g.dismissBanner();
    expect(g.phase).toBe('KICKOFF');
    const m = start();
    m.los = 60;
    setup(m, 'FIELD_GOAL');
    m.snap({ force: { fieldGoalGood: false } });
    expect(m.possession).toBe('away');
  });
  it('punt flips field; touchback to 20', () => {
    const g = start();
    setup(g, 'PUNT');
    const r = g.snap({ force: { puntYards: 40 } });
    expect(r.turnover).toBe(true);
    expect(g.possession).toBe('away');
    expect(g.los).toBeGreaterThanOrEqual(35);
    const h = start();
    h.los = 70;
    setup(h, 'PUNT');
    expect(h.snap({ force: { puntYards: 45 } }).touchback).toBe(true);
    expect(h.los).toBe(20);
  });
  it('safety awards 2 to defense and kicks', () => {
    const g = start();
    g.los = 3;
    const r = run(g, -6);
    expect(r.safety).toBe(true);
    expect(g.score.away).toBe(2);
    g.dismissBanner();
    expect(g.phase).toBe('KICKOFF');
  });
  it('interception flips possession', () => {
    const g = start();
    setup(g, 'POST_CORNER');
    const r = g.snap({ force: { sacked: false, complete: false, intercepted: true, yards: 15 } });
    expect(r.kind).toBe('INTERCEPTION');
    expect(g.possession).toBe('away');
  });
  it('clock: quarters, halftime, timeouts reset, game end', () => {
    const g = start(3, { quarterSeconds: 10 });
    expect(g.callTimeout('home')).toBe(true);
    expect(g.timeouts.home).toBe(2);
    setup(g);
    g.snap({ force: { yards: 3, fumble: false, tackleDamage: 1 } });
    expect(g.clock).toBe(4);
    g.dismissBanner();
    run(g, 2);
    expect(g.clock).toBe(0);
    g.dismissBanner();
    expect(g.phase).toBe('QUARTER_END');
    g.advancePeriod();
    expect(g.quarter).toBe(2);
    run(g, 2);
    run(g, 2);
    g.dismissBanner();
    expect(g.phase).toBe('HALFTIME');
    g.advancePeriod();
    expect(g.phase).toBe('KICKOFF');
    expect(g.timeouts.home).toBe(3);
    g.kickoff({ touchback: true });
    // Opening receiver was home; the second half kicks to the other team.
    expect(g.possession).toBe('away');
  });
  it('25s play clock delay of game', () => {
    const g = start();
    expect(g.tickPlayClock(24)).toBeNull();
    const p = g.tickPlayClock(1);
    expect(p?.yards).toBe(5);
    expect(g.los).toBe(20);
  });
  it('full game ends with winner after Q4', () => {
    const g = start(5, { quarterSeconds: 3 });
    let guard = 0;
    while (g.phase !== 'GAME_OVER' && guard++ < 50) {
      if (g.phase === 'KICKOFF') g.kickoff({ touchback: true });
      else if (g.phase === 'QUARTER_END' || g.phase === 'HALFTIME') g.advancePeriod();
      else if (g.phase === 'PLAY_OVER_BANNER') g.dismissBanner();
      else if (g.phase === 'EXTRA_POINT') g.extraPoint('KICK', true);
      else {
        g.selectPlays('INSIDE_GORE_RUN', 'BONE_CRUSH_BASE');
        g.snap({ force: { yards: 2, fumble: false, tackleDamage: 1 } });
      }
    }
    expect(g.phase).toBe('GAME_OVER');
    expect(g.endReason).toBe('TIE');
  });
});

describe('nasty audibles', () => {
  const pre = (off: string, def = 'BONE_CRUSH_BASE') => {
    const g = start();
    setup(g, off, def);
    return g;
  };
  it('once-per-half charges, reset at half', () => {
    const c = new NastyCharges();
    expect(c.consume('home', 'GHOUL_GAS', 1)).toBe(true);
    expect(c.consume('home', 'GHOUL_GAS', 1)).toBe(false);
    expect(c.consume('away', 'GHOUL_GAS', 1)).toBe(true);
    expect(c.consume('home', 'GHOUL_GAS', 2)).toBe(true);
    const g = pre('INSIDE_GORE_RUN');
    expect(g.callNasty('home', 'BAT_WING_JET_BOOST').ok).toBe(true);
    expect(g.callNasty('home', 'BAT_WING_JET_BOOST')).toEqual({
      ok: false,
      reason: 'ALREADY_USED_THIS_HALF',
    });
    expect(g.callNasty('home', 'QB_CRYPT_BLITZ')).toEqual({ ok: false, reason: 'WRONG_SIDE' });
    expect(NASTY_SIDE.HEX_OF_CONFUSION).toBe('DEFENSE');
  });
  it('Bat-Wing Jet Boost: +65% speed, knockdown resistance, damage cut', () => {
    const g = pre('INSIDE_GORE_RUN');
    g.callNasty('home', 'BAT_WING_JET_BOOST');
    expect(g.effects.carrierSpeedMult).toBe(1.65);
    expect(g.effects.knockdownResistant).toBe(true);
    const base = pre('INSIDE_GORE_RUN');
    const a = g.snap({ force: { yards: 4, tackleDamage: 20 } });
    const b = base.snap({ force: { yards: 4, tackleDamage: 20 } });
    expect(a.damage[0]!.dealt).toBeLessThan(b.damage[0]!.dealt);
    expect(a.fumble).toBe(false);
  });
  it('Dynamite Pitch: 3 grenades damage defenders', () => {
    const g = pre('INSIDE_GORE_RUN');
    g.callNasty('home', 'DYNAMITE_PITCH');
    expect(g.effects.grenades).toBe(DYNAMITE_GRENADES);
    const r = g.snap({ force: { yards: 4, fumble: false, tackleDamage: 1 } });
    expect(r.damage.filter((d) => d.source === 'WEAPON' && d.team === 'away')).toHaveLength(3);
  });
  it('Ghoul Gas poisons tacklers', () => {
    const g = pre('INSIDE_GORE_RUN');
    g.callNasty('home', 'GHOUL_GAS');
    expect(g.effects.gasCloud).toBe(true);
    const r = g.snap({ force: { yards: 4, fumble: false, tackleDamage: 1 } });
    expect(r.damage.some((d) => d.source === 'POISON' && d.team === 'away')).toBe(true);
  });
  it('Pumpkin Bomb explodes on catch and on interception', () => {
    const g = pre('QUICK_SLANTS');
    g.callNasty('home', 'PUMPKIN_BOMB_PASS');
    const r = g.snap({
      force: { sacked: false, complete: true, yards: 6, fumble: false, tackleDamage: 1 },
    });
    expect(r.damage.filter((d) => d.source === 'EXPLOSION').length).toBeGreaterThanOrEqual(3);
    const h = pre('QUICK_SLANTS');
    h.callNasty('home', 'PUMPKIN_BOMB_PASS');
    const i = h.snap({ force: { sacked: false, complete: false, intercepted: true, yards: 6 } });
    expect(i.kind).toBe('INTERCEPTION');
    expect(i.damage.filter((d) => d.source === 'EXPLOSION').length).toBe(3);
  });
  it('Pumpkin Bomb fizzles on a run', () => {
    const g = pre('INSIDE_GORE_RUN');
    g.callNasty('home', 'PUMPKIN_BOMB_PASS');
    const r = g.snap({ force: { yards: 3, fumble: false, tackleDamage: 1 } });
    expect(r.fizzled).toEqual(['PUMPKIN_BOMB_PASS']);
    expect(r.damage.some((d) => d.source === 'EXPLOSION')).toBe(false);
  });
  it('QB Crypt Blitz: +50% DL speed, QB takes hits', () => {
    const g = pre('QUICK_SLANTS');
    g.callNasty('away', 'QB_CRYPT_BLITZ');
    expect(g.effects.dlSpeedMult).toBe(1.5);
    expect(g.effects.qbHitDamageMult).toBe(1.5);
    const r = g.snap({ force: { sacked: false, complete: false, intercepted: false } });
    expect(r.damage.some((d) => d.team === 'home' && d.slot === 'QB')).toBe(true);
  });
  it('Phantom Shroud 4s and Hex 3s', () => {
    const g = pre('INSIDE_GORE_RUN');
    g.callNasty('away', 'PHANTOM_SHROUD');
    g.callNasty('away', 'HEX_OF_CONFUSION');
    expect(g.effects.shroudSeconds).toBe(4);
    expect(g.effects.invertControlsSeconds).toBe(3);
    const r = g.snap({ force: { fumble: false, tackleDamage: 1 } });
    expect(r.effects.shroudSeconds).toBe(4);
    expect(g.effects.shroudSeconds).toBe(0);
  });
});

describe('referee', () => {
  it('Bribe: 3 plays of bogus penalties on opponent', () => {
    const g = start();
    setup(g);
    expect(g.callNasty('away', 'BRIBE_REF').ok).toBe(true);
    expect(g.ref.bribedBy).toBe('away');
    expect(g.callNasty('away', 'BRIBE_REF')).toEqual({
      ok: false,
      reason: 'ALREADY_USED_THIS_HALF',
    });
    const texts = new Set<string>();
    for (let i = 0; i < 3; i++) {
      if (i > 0) setup(g);
      const r = g.snap({ force: { yards: 3, fumble: false, tackleDamage: 1 } });
      expect(r.penalties).toHaveLength(1);
      const p = r.penalties[0]!;
      expect(p.against).toBe('home');
      expect(p.text).toMatch(
        /^(5 Yards — (Excessive Whining!|Breathing on the Zombie!)|10 Yards — Unsportsmanlike Pulse!)$/,
      );
      texts.add(p.text);
    }
    expect(g.ref.isBribed).toBe(false);
    setup(g);
    expect(g.snap({ force: { yards: 3, fumble: false, tackleDamage: 1 } }).penalties).toHaveLength(
      0,
    );
  });
  it('Referee bribe generates all three satire lines', () => {
    const rng = new Rng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = new Referee();
      r.bribe('home');
      seen.add(r.endPlay(rng, false)[0]!.text);
    }
    expect(seen).toEqual(
      new Set([
        '5 Yards — Excessive Whining!',
        '5 Yards — Breathing on the Zombie!',
        '10 Yards — Unsportsmanlike Pulse!',
      ]),
    );
  });
  it('Kill Ref full flow', () => {
    const g = start();
    g.los = 40;
    setup(g);
    g.callNasty('away', 'BRIBE_REF');
    // Bribe is active; offense (home) now hunts the ref.
    g.callNasty('home', 'KILL_REF');
    g.setRefKilledOverride(true);
    const r = g.snap({ force: { yards: 3, fumble: false, tackleDamage: 1 } });
    expect(r.refKilled).toBe(true);
    expect(g.ref.kind).toBe('DEMON_REF');
    expect(g.ref.isBribed).toBe(false);
    expect(r.penalties).toHaveLength(1);
    expect(r.penalties[0]).toMatchObject({
      kind: 'REF_BASHING',
      against: 'home',
      yards: 5,
      text: '5 Yards — Ref Bashing',
    });
    expect(r.penalties[0]!.appliedYards).toBe(5);
    expect(g.los).toBe(38);
    // Demon ref cannot be bribed again.
    g.dismissBanner();
    g.selectPlays('INSIDE_GORE_RUN', 'BONE_CRUSH_BASE');
    expect(g.callNasty('away', 'KILL_REF')).toEqual({ ok: false, reason: 'DEMON_REF_PRESENT' });
  });
  it('Kill Ref survives -> no penalty', () => {
    const g = start();
    setup(g);
    g.callNasty('home', 'KILL_REF');
    g.setRefKilledOverride(false);
    const r = g.snap({ force: { yards: 3, fumble: false, tackleDamage: 1 } });
    expect(r.penalties).toHaveLength(0);
    expect(g.ref.kind).toBe('NECRO_REF');
  });
});

describe('casualties & carnage', () => {
  it('HP reduction mitigated by armor, persists', () => {
    const g = start();
    const qb = g.roster.home.player('OFFENSE', 'QB');
    const before = qb.currentHp;
    g.inflictDamage('home', 'OFFENSE', 'QB', 10, 'HAZARD');
    expect(qb.currentHp).toBeLessThan(before);
    expect(qb.currentHp).toBeGreaterThan(0);
  });
  it('lethal hit on carrier = fumble, removal, bench sub, skull', () => {
    const g = start();
    setup(g);
    const rb = g.roster.home.player('OFFENSE', 'RB1');
    const r = g.snap({ force: { yards: 4, tackleDamage: 9999, fumble: false } });
    expect(r.casualties).toHaveLength(1);
    expect(r.casualties[0]).toMatchObject({ team: 'home', slot: 'RB1', fumbled: true });
    expect(r.fumble).toBe(true);
    expect(r.turnover).toBe(true);
    expect(g.possession).toBe('away');
    expect(rb.status).toBe('DEAD');
    expect(g.roster.home.casualties).toBe(1);
    const sub = g.roster.home.player('OFFENSE', 'RB1');
    expect(sub.id).not.toBe(rb.id);
    expect(sub.status).toBe('ACTIVE');
    expect(g.roster.home.bench).toHaveLength(3);
  });
  it('4 casualties = Forfeit by Carnage', () => {
    const g = start();
    const slots = ['RB1', 'RB2/WR', 'WR/TE', 'OL1'] as const;
    for (const [i, s] of slots.entries()) {
      g.inflictDamage('home', 'OFFENSE', s, 9999, 'HAZARD');
      if (i < 3) expect(g.phase).not.toBe('GAME_OVER');
    }
    expect(g.roster.home.casualties).toBe(4);
    expect(g.phase).toBe('GAME_OVER');
    expect(g.winner).toBe('away');
    expect(g.forfeitLoser).toBe('home');
    expect(g.endReason).toBe('FORFEIT_BY_CARNAGE');
  });
  it('forfeit mid-play via hazards ends game immediately', () => {
    const g = start();
    setup(g);
    const hazards = (['QB', 'RB2/WR', 'WR/TE', 'OL1'] as const).map((slot) => ({
      team: 'away' as TeamId,
      side: 'DEFENSE' as const,
      slot: ({ QB: 'DL1', 'RB2/WR': 'DL2', 'WR/TE': 'DL3', OL1: 'LB1' } as const)[slot],
      amount: 9999,
    }));
    const r = g.snap({ hazards });
    expect(r.kind).toBe('FORFEIT');
    expect(g.phase).toBe('GAME_OVER');
    expect(g.winner).toBe('home');
    expect(g.forfeitLoser).toBe('away');
  });
});
