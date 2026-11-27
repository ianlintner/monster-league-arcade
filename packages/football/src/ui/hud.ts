/**
 * Unified `GSN 66.6` broadcast HUD — framework-free DOM builders/updaters.
 *
 * Card 6 (PLAN.md §2.5) supplies four overlays that read *all* their data from a
 * plain `HudState` snapshot of `GameSession`. Keeping these modules Phaser-free
 * (matching `@monster-league/shared-core/ui`) means they are unit-testable under
 * jsdom and reuse the master palette/CSS, while `MatchScene` owns the live wiring.
 */
import { FACTIONS, type FactionId } from '@monster-league/shared-core';
import { CARNAGE_LIMIT } from '../sim/Roster';
import type { NastyKind } from '../sim/Playbook';
import { NASTY_INFO } from '../sim/DirtyTricks';

/** Serialisable snapshot of everything the broadcast HUD displays. */
export interface HudState {
  home: { faction: FactionId; score: number; casualties: number };
  away: { faction: FactionId; score: number; casualties: number };
  quarter: number;
  clockSeconds: number;
  playClockSeconds: number;
  possession: 'home' | 'away';
  down: number;
  yardsToGo: number;
  los: number;
  /** Faction whose Necro-Ref is bribed against the offense, else null. */
  bribedRefTeam: 'home' | 'away' | null;
  /** True once the Demon Ref has taken over (ref nasties are then locked out). */
  demonRefActive: boolean;
  /** Nasties still charged for the offense this half. */
  availableNasties: NastyKind[];
  /** Last result banner line (empty when no banner is showing). */
  banner: string;
}

/** Format `MM:SS` (and `SS` for a short play clock). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return s >= 60 ? `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : String(s);
}

/** Format a yardage for display: < 1 yard → "INCHES", else whole yards. */
export function formatYards(yards: number): string {
  const clamped = Math.max(0, yards);
  return clamped < 1 ? 'INCHES' : String(Math.round(clamped));
}

/**
 * Football field-position label, relative to the team in possession. `los` is
 * measured from the offense's own goal line (0..100), so OWN 1-49, dead-centre
 * "50", then OPP 49-1 — never `100 - los` against the wrong end zone.
 */
export function losLabel(los: number, _possession: 'home' | 'away'): string {
  const y = Math.round(los);
  if (los <= 0) return 'BALL ON OWN GOAL LINE';
  if (los >= 100) return 'BALL ON OPP GOAL LINE';
  if (los < 50) return `BALL ON OWN ${y}`;
  if (los > 50) return `BALL ON OPP ${100 - y}`;
  return 'BALL ON 50';
}

export function downDistanceLabel(down: number, yardsToGo: number): string {
  return `${ordinal(down)} & ${formatYards(yardsToGo)}`;
}

function ordinal(n: number): string {
  switch (n) {
    case 1:
      return '1ST';
    case 2:
      return '2ND';
    case 3:
      return '3RD';
    case 4:
      return '4TH';
    default:
      return `${n}TH`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function crestMarkup(faction: FactionId, className: string): HTMLElement {
  const f = FACTIONS.find((x) => x.id === faction);
  const img = el('span', className);
  // The atlas holds a crest keyed by faction id; fall back to a colour swatch when
  // no image asset is available so tests and headless renders stay deterministic.
  img.setAttribute('data-crest', f?.id ?? faction);
  img.style.background = f?.colors.primary ?? 'transparent';
  return img;
}

function skullRow(team: 'home' | 'away', casualties: number): HTMLElement {
  const row = el('span', 'gsn-skulls');
  row.setAttribute('data-testid', `skulls-${team}`);
  row.setAttribute('aria-label', `${casualties} casualties`);
  for (let i = 0; i < CARNAGE_LIMIT; i++) {
    const skull = el('span', 'gsn-skull');
    skull.setAttribute('data-lit', String(i < casualties));
    row.append(skull);
  }
  return row;
}

/** Build the full top broadcast scorebug (crests, digits, clocks, down, skulls, bribe). */
export function buildScorebug(state: HudState): HTMLElement {
  const wrap = el('div', 'gsn-scorebug');
  // NOTE: the outer `#scorebug` host (index.html) already carries the
  // `data-testid="scorebug"`; the inner bar must not duplicate it or the e2e
  // locator resolves to two elements.

  // Home cluster: crest + name + casualties.
  const home = el('div', 'gsn-scorebug__team');
  home.append(crestMarkup(state.home.faction, 'gsn-scorebug__crest'));
  home.append(el('span', 'gsn-scorebug__name', factionName(state.home.faction)));
  home.append(skullRow('home', state.home.casualties));

  const homeScore = el('span', 'gsn-scorebug__score', String(state.home.score));
  homeScore.setAttribute('data-testid', 'score-home');

  // Center: quarter · game clock · play clock · down & distance · LOS.
  const center = el('div', 'gsn-scorebug__center');
  center.append(
    el('div', 'gsn-scorebug__meta', `Q${state.quarter}`),
    el('div', 'gsn-scorebug__clock', formatClock(state.clockSeconds)),
    el('div', 'gsn-scorebug__playclock', `PLAY ${formatClock(state.playClockSeconds)}`),
    el('div', 'gsn-scorebug__down', downDistanceLabel(state.down, state.yardsToGo)),
    el('div', 'gsn-scorebug__los', losLabel(state.los, state.possession)),
  );

  const awayScore = el('span', 'gsn-scorebug__score', String(state.away.score));
  awayScore.setAttribute('data-testid', 'score-away');

  const away = el('div', 'gsn-scorebug__team gsn-scorebug__team--away');
  away.append(skullRow('away', state.away.casualties));
  away.append(el('span', 'gsn-scorebug__name', factionName(state.away.faction)));
  away.append(crestMarkup(state.away.faction, 'gsn-scorebug__crest'));

  // Optional bribe badge (active Necro-Ref corruption) below the bar.
  const bribe = el('div', 'gsn-scorebug__bribe');
  bribe.setAttribute('data-testid', 'bribe-badge');
  if (state.bribedRefTeam) {
    const briber = state.bribedRefTeam === 'home' ? state.home.faction : state.away.faction;
    const victim = state.bribedRefTeam === 'home' ? state.away.faction : state.home.faction;
    bribe.textContent = `BRIBED REF · ${factionName(briber)} paid · flags ${factionName(victim)}`;
    bribe.setAttribute('data-active', 'true');
  } else {
    bribe.setAttribute('data-active', 'false');
  }

  wrap.append(home, homeScore, center, awayScore, away);
  const root = el('div', 'gsn-scorebug-shell');
  root.append(wrap, bribe);
  return root;
}

/** The Genesis-style pre-snap huddle overlay (split-panel CRT + play cards). */
export interface HuddlePlayCard {
  label: 'A' | 'B' | 'C';
  name: string;
  kind: 'RUN' | 'PASS' | 'PUNT' | 'FIELD_GOAL';
  formation: string;
}

/** One dirty-trick row: which combo calls it and whether its half charge is left. */
export interface NastyDrawerEntry {
  kind: NastyKind;
  /** Menu slot letter after `A→C` (the router's combo is `[A→C → <slot>]`). */
  slot: 'A' | 'B' | 'C';
  charges: 0 | 1;
  /** Optional qualifier (e.g. the play type the trick needs). */
  note?: string;
}

/** Shared dirty-tricks drawer (huddle overlay + pre-snap overlay). */
export function buildNastyDrawer(entries: NastyDrawerEntry[], testId: string): HTMLElement {
  const drawer = el('div', 'gsn-huddle__drawer');
  drawer.setAttribute('data-testid', testId);
  drawer.append(el('span', 'gsn-huddle__drawer-label', 'DIRTY TRICKS'));
  const count = entries.filter((e) => e.charges > 0).length;
  if (count === 0) {
    drawer.append(el('span', undefined, 'no charges'));
  }
  const list = el('span', 'gsn-huddle__drawer-list');
  for (const e of entries) {
    const entry = el('span', 'gsn-huddle__drawer-item');
    entry.setAttribute('data-nasty', e.kind);
    entry.setAttribute('data-charges', String(e.charges));
    const note = e.note ? ` (${e.note})` : '';
    entry.textContent = `${NASTY_INFO[e.kind].name}${note} · [A→C → ${e.slot}]${e.charges ? '' : ' · USED'}`;
    list.append(entry);
  }
  drawer.append(list);
  if (count > 0) drawer.append(el('span', undefined, `${count} charge${count === 1 ? '' : 's'}`));
  return drawer;
}

export function buildHuddleOverlay(opts: {
  formations: string[];
  plays: HuddlePlayCard[];
  /** Remaining kinds (slot letters assigned in order) or explicit drawer rows. */
  availableNasties: (NastyKind | NastyDrawerEntry)[];
  /** Hidden P2 selection is obscured, but the card still renders for the tests. */
  hideSelection?: boolean;
}): HTMLElement {
  const overlay = el('div', 'gsn-huddle');
  overlay.setAttribute('data-testid', 'huddle-overlay');

  // Left panel: formation selector.
  const formPanel = el('div', 'gsn-huddle__formations');
  formPanel.setAttribute('data-testid', 'formations');
  for (const f of opts.formations) {
    formPanel.append(el('div', 'gsn-huddle__formation', f.toUpperCase()));
  }

  // Right panel: three play cards (A/B/C).
  const cardPanel = el('div', 'gsn-huddle__cards');
  for (const p of opts.plays) {
    const card = el('div', 'gsn-huddle__card');
    card.setAttribute('data-testid', `play-${p.label.toLowerCase()}`);
    card.append(
      el('span', 'gsn-huddle__card-key', `[${p.label}]`),
      el('span', 'gsn-huddle__card-name', p.name),
      el('span', 'gsn-huddle__card-kind', p.kind),
    );
    cardPanel.append(card);
  }

  // Dirty tricks drawer: display names + charges + the audible combo that calls
  // each (A -> C opens the nasty menu; A/B/C picks its slot, per `nastyMenu`).
  const entries: NastyDrawerEntry[] = opts.availableNasties.map((n, i) =>
    typeof n === 'string' ? { kind: n, slot: (['A', 'B', 'C'] as const)[i % 3]!, charges: 1 } : n,
  );
  const drawer = buildNastyDrawer(entries, 'nasty-drawer');

  overlay.append(formPanel, cardPanel, drawer);
  return overlay;
}

/**
 * The CPU-offense huddle overlay: instead of the A/B/C pick list, show a single
 * non-interactive card naming the play the AI coach just called. P1 cannot pick
 * or change the CPU's play here — there are no cards to press.
 */
export function buildCpuHuddleOverlay(opts: {
  playName: string;
  kind: 'RUN' | 'PASS' | 'PUNT' | 'FIELD_GOAL';
  formation: string;
  /** Display name of the dirty trick the coach armed with this call (omitted = none). */
  nasty?: string;
}): HTMLElement {
  const overlay = el('div', 'gsn-huddle gsn-huddle--cpu');
  overlay.setAttribute('data-testid', 'huddle-overlay');
  overlay.setAttribute('data-cpu', 'true');

  const head = el('div', 'gsn-huddle__cpu-head', 'CPU OFFENSE');
  head.setAttribute('data-testid', 'cpu-offense-head');

  const card = el('div', 'gsn-huddle__card gsn-huddle__card--cpu');
  card.setAttribute('data-testid', 'cpu-play');
  card.append(
    el('span', 'gsn-huddle__card-name', `— ${opts.playName}`),
    el('span', 'gsn-huddle__card-kind', opts.kind),
    el('span', 'gsn-huddle__card-formation', opts.formation.toUpperCase()),
  );

  overlay.append(head, card);
  if (opts.nasty) {
    const trick = el('div', 'gsn-huddle__cpu-nasty', `NASTY: ${opts.nasty.toUpperCase()}`);
    trick.setAttribute('data-testid', 'cpu-nasty');
    overlay.append(trick);
  }
  return overlay;
}

export type BannerKind =
  | 'TOUCHDOWN'
  | 'TURNOVER'
  | 'FUMBLE'
  | 'NASTY'
  | 'PENALTY'
  | 'CASUALTY'
  | 'REF_LIQUIDATED'
  | 'FORFEIT'
  | 'NEUTRAL';

export function buildBroadcastBanner(kind: BannerKind, detail = ''): HTMLElement {
  const banner = el('div', 'gsn-banner gsn-banner--kinetic');
  banner.setAttribute('data-testid', 'banner');
  banner.setAttribute('data-kind', kind);
  banner.classList.add('gsn-banner--enter');

  const head = el('span', 'gsn-banner__head', bannerTitle(kind));
  const body = el('span', 'gsn-banner__body', detail);
  banner.append(head, body);
  return banner;
}

function bannerTitle(kind: BannerKind): string {
  switch (kind) {
    case 'TOUCHDOWN':
      return 'TOUCHDOWN!';
    case 'TURNOVER':
      return 'TURNOVER!';
    case 'FUMBLE':
      return 'FUMBLE!';
    case 'NASTY':
      return 'NASTY AUDIBLE ACTIVATED!';
    case 'PENALTY':
      return 'BOGUS PENALTY!';
    case 'CASUALTY':
      return 'PLAYER LIQUIDATED!';
    case 'REF_LIQUIDATED':
      return 'REF LIQUIDATED!';
    case 'FORFEIT':
      return 'FORFEIT BY CARNAGE!';
    case 'NEUTRAL':
      return 'PLAY RESULT';
  }
}

/** The terminal-match result screen (winner, final score, reason, restart hint).
 *  Reuses the GSN 66.6 banner chrome but presents a full-width final-result card
 *  that stays inside the 1280×720 fold — the dead-end the playability audit
 *  flagged (banner below fold, START/C doing nothing at GAME_OVER). */
export interface ResultState {
  winner: 'home' | 'away' | null;
  homeScore: number;
  awayScore: number;
  homeName: string;
  awayName: string;
  /** 'SCORE' | 'TIE' | 'FORFEIT_BY_CARNAGE' — drives the reason line. */
  reason: 'SCORE' | 'TIE' | 'FORFEIT_BY_CARNAGE' | null;
  /** The team that forfeited (lost all monsters), else null. */
  forfeitLoser: 'home' | 'away' | null;
}

/** Compose the one-line reason for the result screen (FINAL vs forfeit detail). */
export function resultReasonLine(s: ResultState): string {
  if (s.reason === 'FORFEIT_BY_CARNAGE') {
    const loser = s.forfeitLoser === 'home' ? s.homeName : s.awayName;
    return `FORFEIT BY CARNAGE — ${loser} lost ${CARNAGE_LIMIT} monsters`;
  }
  return 'FINAL';
}

/** Build the final-result card shown at GAME_OVER. */
export function buildResultCard(s: ResultState): HTMLElement {
  const card = el('div', 'gsn-result');
  card.setAttribute('data-testid', 'result-card');
  card.setAttribute('data-winner', s.winner ?? 'tie');

  const head = el('span', 'gsn-result__head');
  head.textContent =
    s.winner === null ? 'FINAL — TIE' : `${s.winner === 'home' ? s.homeName : s.awayName} WINS!`;

  const score = el('span', 'gsn-result__score');
  score.setAttribute('data-testid', 'result-score');
  score.textContent = `${s.homeName} ${s.homeScore} — ${s.awayScore} ${s.awayName}`;

  const reason = el('span', 'gsn-result__reason');
  reason.setAttribute('data-testid', 'result-reason');
  reason.textContent = resultReasonLine(s);

  const hint = el('span', 'gsn-result__hint');
  hint.setAttribute('data-testid', 'result-hint');
  hint.textContent = 'PRESS [START=P] OR [C=L] TO RESTART';

  card.append(head, score, reason, hint);
  return card;
}

/** Classify a `GameSession.bannerFor` headline into a broadcast banner kind. */
export function bannerKindForText(text: string): BannerKind {
  const t = text.toUpperCase();
  if (t.startsWith('TOUCHDOWN')) return 'TOUCHDOWN';
  if (t.startsWith('INTERCEPTED') || t.startsWith('TURNOVER ON DOWNS')) return 'TURNOVER';
  if (t.startsWith('FUMBLE')) return 'FUMBLE';
  if (t.startsWith('REF LIQUIDATED') || t.startsWith('REF BASHING')) return 'REF_LIQUIDATED';
  if (t.startsWith('FORFEIT')) return 'FORFEIT';
  if (t.includes('YARDS —')) return 'PENALTY';
  if (t.startsWith('PLAYER LIQUIDATED')) return 'CASUALTY';
  if (t.includes('NASTY')) return 'NASTY';
  // Scoring and ordinary-play lines from `bannerFor` (SAFETY!, FIELD GOAL IS
  // GOOD!, FIELD GOAL NO GOOD, PUNT, SACKED!, INCOMPLETE, FIRST DOWN!, +N YARDS)
  // are not a casualty: fall through to a neutral broadcast banner rather than
  // mislabelling every routine play as "PLAYER LIQUIDATED!".
  return 'NEUTRAL';
}

/** Bottom dynamic context bar with a per-context button legend. */
export type ControlContext = 'HUDDLE' | 'PRE_SNAP' | 'PASSING' | 'CARRIER' | 'DEFENSE';

export function buildControlsBar(context: ControlContext): HTMLElement {
  const bar = el('div', 'gsn-control-bar');
  bar.setAttribute('data-testid', 'control-bar');
  const prompt = el('span', 'gsn-control-bar__prompt');
  prompt.setAttribute('data-testid', 'control-prompt');
  prompt.textContent = legendFor(context);
  bar.append(prompt);
  return bar;
}

function legendFor(context: ControlContext): string {
  // Keyboard labels mirror the shared-core InputManager P1 map (A=J/Space, B=K,
  // C=L, Start=P, movement WASD); gamepad uses the standard South/East/West face
  // buttons for A/B/C. Show the real keys so the prompt matches what actually works.
  switch (context) {
    case 'HUDDLE':
      return 'Huddle: [A=J]/[B=K]/[C=L] Call Play';
    case 'PRE_SNAP':
      return 'Pre-Snap: [C=L] Hike · [A=J] Audible · [A→C → A/B/C] Nasty';
    case 'PASSING':
      return 'Passing: [A=J]/[B=K]/[C=L] Throw · WASD lead receiver';
    case 'CARRIER':
      return 'Ball Carrier: WASD run · [A=J] Dive · [C=L] Turbo';
    case 'DEFENSE':
      return 'Defense: WASD pursue · [B=K] Switch defender';
  }
}

export function factionName(id: FactionId): string {
  return FACTIONS.find((x) => x.id === id)?.name.toUpperCase() ?? id.toUpperCase();
}
