/**
 * matchConfig — query-string test seams for `MatchScene`. Pure so it is
 * unit-testable without Phaser or a DOM.
 */
import { DEFAULT_CONFIG } from '../sim/GameSession';
import { CARNAGE_LIMIT } from '../sim/Roster';

export const QUARTER_MIN_SECONDS = 10;
export const QUARTER_MAX_SECONDS = 180;

/**
 * Resolve `?casualties=<n>` into a home-team pre-match casualty count (0..3).
 * Setup seam only: the value is applied when the session is *constructed*, never
 * through the live debug handle. Capped one below `CARNAGE_LIMIT` so a test can
 * set up the forfeit warning without starting a match already forfeited.
 */
export function casualtiesFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get('casualties');
  if (raw === null || raw.trim() === '') return DEFAULT_CONFIG.initialCasualties;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.initialCasualties;
  return Math.min(CARNAGE_LIMIT - 1, Math.max(0, Math.round(n)));
}

/**
 * Resolve `?quarter=<seconds>` into a quarter length. Unset/invalid input keeps
 * the default (150); a valid number is clamped to 10..180 so a full match fits
 * inside an e2e test without allowing a degenerate zero-length quarter.
 */
export function quarterSecondsFromSearch(search: string): number {
  const raw = new URLSearchParams(search).get('quarter');
  if (raw === null || raw.trim() === '') return DEFAULT_CONFIG.quarterSeconds;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.quarterSeconds;
  return Math.min(QUARTER_MAX_SECONDS, Math.max(QUARTER_MIN_SECONDS, Math.round(n)));
}
