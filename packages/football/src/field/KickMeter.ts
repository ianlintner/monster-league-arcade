/**
 * KickMeter — punt / field-goal timing-meter presentation.
 *
 * Pure TypeScript, no Phaser. The card asks for "a simple timing meter on C":
 * holding C starts a sweep, tapping C locks the value. A perfect lock (as near
 * to the centre band as possible) maximizes kick effectiveness; a poor lock
 * under/over-shoots. Deterministic: the meter value is a pure function of the
 * hold duration, so tests can assert exact marks.
 */

export interface KickMeterState {
  /** 0..1 current sweep position. */
  value: number;
  /** True while actively sweeping. */
  sweeping: boolean;
  /** The locked value (or null if not yet locked). */
  locked: number | null;
}

export const KICK_METER = {
  /** Full sweep period in seconds (value goes 0 → 1 → 0 and repeats). */
  sweepPeriodSeconds: 1.2,
  /** The centre "sweet band" that counts as a perfect kick. */
  sweetBandMin: 0.42,
  sweetBandMax: 0.58,
} as const;

/** Sweep position for an elapsed hold time (triangle wave). */
export function meterValue(elapsedSeconds: number): number {
  const p = KICK_METER.sweepPeriodSeconds;
  const phase = (elapsedSeconds % p) / p; // 0..1
  // Triangulate: 0 → 1 over first half, 1 → 0 over second half.
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

/** 0..1 kick quality: 1 inside the sweet band, tapering to 0 at the extremes. */
export function kickQuality(value: number): number {
  const { sweetBandMin, sweetBandMax } = KICK_METER;
  if (value >= sweetBandMin && value <= sweetBandMax) return 1;
  // Distance to the near edge of the band, normalized.
  const d = value < sweetBandMin ? sweetBandMin - value : value - sweetBandMax;
  return Math.max(0, 1 - d / 0.4);
}

/** Resolve a punt / field-goal attempt from a locked meter value. */
export function resolveKick(
  value: number,
  distanceYards: number,
  maxPuntYards: number,
): { puntYards: number; fieldGoalGood: boolean } {
  const q = kickQuality(value);
  const puntYards = Math.round(maxPuntYards * (0.7 + q * 0.3));
  // Field-goal: quality maps to make probability; a perfect kick locks it in.
  const make = q >= 1 ? true : q > 0.5;
  return { puntYards, fieldGoalGood: make && distanceYards <= 66 };
}
