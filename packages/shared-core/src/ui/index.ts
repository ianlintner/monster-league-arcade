/**
 * Lightweight DOM helpers for building the unified GSN 66.6 UI. These are
 * framework-free so every route (hub, football, hockey) renders identical
 * broadcast chrome from the same primitives.
 */
import { FACTIONS, type FactionId } from '../factions/index';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Format the shrunken-head scorebug clock `MM:SS`. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Build a `[HOME | 0] QTR CLOCK [AWAY 0]`-style scorebug row. */
export function buildScorebug(
  home: FactionId,
  away: FactionId,
  opts: { homeScore: number; awayScore: number; quarter: number; clockSeconds: number },
): HTMLElement {
  const homeF = FACTIONS.find((f) => f.id === home);
  const awayF = FACTIONS.find((f) => f.id === away);
  const wrap = el('div', 'gsn-scorebug');

  const homeTeam = el('div', 'gsn-scorebug__team');
  const homeSwatch = el('span', 'gsn-scorebug__swatch');
  homeSwatch.style.background = homeF?.colors.primary ?? 'transparent';
  homeTeam.append(homeSwatch, el('span', undefined, homeF?.name.toUpperCase() ?? 'HOME'));

  const homeScore = el('span', 'gsn-scorebug__score', String(opts.homeScore));

  const center = el('div', 'gsn-scorebug__center');
  center.append(
    el('div', 'gsn-scorebug__meta', `Q${opts.quarter}`),
    el('div', undefined, formatClock(opts.clockSeconds)),
  );

  const awayScore = el('span', 'gsn-scorebug__score', String(opts.awayScore));

  const awayTeam = el('div', 'gsn-scorebug__team');
  const awaySwatch = el('span', 'gsn-scorebug__swatch');
  awaySwatch.style.background = awayF?.colors.primary ?? 'transparent';
  awayTeam.append(el('span', undefined, awayF?.name.toUpperCase() ?? 'AWAY'), awaySwatch);

  wrap.append(homeTeam, homeScore, center, awayScore, awayTeam);
  return wrap;
}

/** Toggle the CRT scanline overlay via a `gsn-crt-on` body class. */
export function setCrtEnabled(on: boolean): void {
  document.body.classList.toggle('gsn-crt-on', on);
}

export function isCrtEnabled(): boolean {
  return document.body.classList.contains('gsn-crt-on');
}
