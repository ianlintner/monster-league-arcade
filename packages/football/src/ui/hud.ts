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

/** "BALL ON OWN 25" field-position label. */
export function losLabel(los: number, possession: 'home' | 'away'): string {
  const fromGoal = possession === 'home' ? 100 - los : los;
  return `BALL ON ${possession === 'home' ? 'OPP' : 'OWN'} ${fromGoal}`;
}

export function downDistanceLabel(down: number, yardsToGo: number): string {
  return `${ordinal(down)} & ${yardsToGo}`;
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
  wrap.setAttribute('data-testid', 'scorebug');

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

export function buildHuddleOverlay(opts: {
  formations: string[];
  plays: HuddlePlayCard[];
  availableNasties: NastyKind[];
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

  // Dirty tricks drawer.
  const drawer = el('div', 'gsn-huddle__drawer');
  drawer.setAttribute('data-testid', 'nasty-drawer');
  const active = opts.availableNasties.length
    ? opts.availableNasties.join(' · ')
    : 'no charges';
  drawer.append(el('span', 'gsn-huddle__drawer-label', 'DIRTY TRICKS'), el('span', undefined, active));

  overlay.append(formPanel, cardPanel, drawer);
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
  | 'FORFEIT';

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
  }
}

/** Bottom dynamic context bar with a per-context button legend. */
export type ControlContext =
  | 'HUDDLE'
  | 'PRE_SNAP'
  | 'PASSING'
  | 'CARRIER'
  | 'DEFENSE';

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
  switch (context) {
    case 'HUDDLE':
      return 'Huddle: [A]/[B]/[C] Call Play · [C] Nasty Drawer';
    case 'PRE_SNAP':
      return 'Pre-Snap: [A] Audible · [B] Shift · [C] Hike';
    case 'PASSING':
      return 'Passing: [A]/[B]/[C] Throw · arrows lead receiver';
    case 'CARRIER':
      return 'Ball Carrier: arrows run · [A] Dive · [C] Turbo';
    case 'DEFENSE':
      return 'Defense: arrows pursue · [B] Switch defender';
  }
}

function factionName(id: FactionId): string {
  return FACTIONS.find((x) => x.id === id)?.name.toUpperCase() ?? id.toUpperCase();
}