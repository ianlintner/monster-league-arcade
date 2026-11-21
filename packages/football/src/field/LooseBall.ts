/**
 * LooseBall — deterministic fumble/recovery resolution for the live field.
 *
 * Pure TypeScript, no Phaser. When the carrier is tackled hard enough (or dies
 * on the field), the ball pops loose. It lands at a spot near the hit and both
 * sides converge; the first actor to reach it recovers. This module models the
 * loose ball as a deterministic chase: each team's recovery odds come from its
 * active players' `speed` ratings and their distance to the ball, so a seeded
 * replay always produces the same recovery winner.
 *
 * Output is a `FumbleResult` that the caller folds into `LivePlayResult` and,
 * ultimately, `GameSession.snap({ force: { fumble } })` plus a recovery-side
 * hint for the presentation layer.
 */
import type { TeamId } from '../sim/Roster';

export interface FumbleInput {
  /** Where the ball came loose (yard-space: downfield x, lateral y). */
  x: number;
  y: number;
  /** The offense's team id. */
  offense: TeamId;
  /** Active chasers and their speeds/distance to the ball. */
  chasers: { team: TeamId; speed: number; distance: number }[];
  /** Deterministic seed. */
  seed: number;
}

export interface FumbleResult {
  /** Which team recovered (or null if the ball rolls dead / out). */
  recoveredBy: TeamId | null;
  /** Whether the recovery flips possession. */
  turnover: boolean;
  /** The spot the ball was recovered at (yard-space). */
  x: number;
  y: number;
  /** Chaser id that won the recovery (presentation hint). */
  recoveredChaser: string | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Resolve who recovers the fumble. A chaser's effective reach is
 * `speed / (distance + 1)` — faster closers beat slower ones, but proximity
 * dominates, so a nearby lineman can still beat a far-off cornerback. The
 * result is deterministic under the seed (rolls a small jitter onto each
 * chaser's reach to break ties without randomness leaking into re-runs).
 */
export function resolveFumble(input: FumbleInput): FumbleResult {
  const rng = mulberry32(input.seed);
  let bestChaser: string | null = null;
  let bestReach = -1;
  let bestTeam: TeamId | null = null;

  input.chasers.forEach((c, i) => {
    const jitter = 0.9 + rng() * 0.2;
    const reach = (c.speed * jitter) / (c.distance + 1);
    if (reach > bestReach) {
      bestReach = reach;
      bestTeam = c.team;
      bestChaser = `chaser-${i}`;
    }
  });

  if (bestTeam === null) {
    // No chasers: ball rolls dead at the spot; possession stays with the tackler's
    // opponent is ambiguous, so return a neutral dead-ball (offense keeps ball).
    return {
      recoveredBy: null,
      turnover: false,
      x: clamp(input.x, 0, 100),
      y: clamp(input.y, -26.66, 26.66),
      recoveredChaser: null,
    };
  }

  const recoveryX = clamp(input.x + (rng() - 0.5) * 2, 0, 100);
  const recoveryY = clamp(input.y + (rng() - 0.5) * 2, -26.66, 26.66);
  return {
    recoveredBy: bestTeam,
    turnover: bestTeam !== input.offense,
    x: recoveryX,
    y: recoveryY,
    recoveredChaser: bestChaser,
  };
}
