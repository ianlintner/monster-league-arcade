/**
 * matchConfig — query-string test seams for `MatchScene`. Pure so it is
 * unit-testable without Phaser or a DOM.
 */
import { DEFAULT_CONFIG } from '../sim/GameSession';

export const QUARTER_MIN_SECONDS = 10;
export const QUARTER_MAX_SECONDS = 180;

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
