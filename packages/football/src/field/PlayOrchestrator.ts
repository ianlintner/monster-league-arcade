/**
 * PlayOrchestrator — turns live-field events into `GameSession.snap()` inputs.
 *
 * The LivePlay loop produces *physical* events (a tackle, a receiver running a
 * route, a QB who releases). This module owns the *down decision state* that
 * maps those events onto the sim's single source of truth:
 *   - pass: which target (A/B/C), throw style (lob/bullet), and the catch vs
 *     interception vs deflection resolution (via `resolvePass`).
 *   - tackle: damage dealt (`tackleDamage`) and whether the hit forces a fumble
 *     (via `resolveFumble` → `force.fumble`).
 *
 * Pure TypeScript, deterministic under a seed, no Phaser. MatchScene drives the
 * fields with live inputs and reads the derived `snap` args once the down ends.
 */
import type { SnapOptions } from '../sim/GameSession';
import { resolvePass, buildFlight, styleForHold } from './Ballistics';
import { resolveFumble } from './LooseBall';

export interface PassAttempt {
  /** Where the throw originated (QB yard-space). */
  fromX: number;
  fromY: number;
  /** Where the throw is aimed (receiver lead point). */
  toX: number;
  toY: number;
  /** Hold duration in ms → lob (< 180) or bullet (>= 180). */
  holdMs: number;
  /** Defender positions for interception/deflection resolution. */
  defenders: { id: string; x: number; y: number }[];
}

export interface TackleAttempt {
  /** Damage dealt to the carrier by the tackle. */
  damage: number;
  /** Chasers near the loose ball, for a possible fumble recovery. */
  chasers: { team: 'home' | 'away'; speed: number; distance: number }[];
  /** Whether the hit has enough force to force a fumble roll. */
  bigHit: boolean;
  /** Where the ball sits if a fumble occurs. */
  ballX: number;
  ballY: number;
}

/**
 * Resolve a pass attempt: build the closed-form flight from the QB to the
 * receiver lead point, then resolve catch vs interception vs deflection against
 * the defender positions. Returns the `snap()` args including the resolved
 * `target` for the sim.
 */
export function resolvePassAttempt(attempt: PassAttempt, target: 'A' | 'B' | 'C'): SnapOptions {
  const style = styleForHold(attempt.holdMs);
  const flight = buildFlight({
    from: { x: attempt.fromX, y: attempt.fromY },
    to: { x: attempt.toX, y: attempt.toY },
    style,
  });
  const resolution = resolvePass(
    flight,
    attempt.defenders.map((d) => ({ id: d.id, x: d.x, y: d.y, side: 'DEFENSE' as const })),
  );

  switch (resolution.kind) {
    case 'INTERCEPTION':
      return { target, force: { complete: false, intercepted: true, sacked: false } };
    case 'DEFLECTION':
      // A deflection breaks up the catch. Deterministic by design (no RNG):
      // a deflection always results in an incompletion in this scope.
      return { target, force: { complete: false, intercepted: false, sacked: false } };
    default:
      // CLEAN_CATCH (or INCOMPLETE, which resolvePass never returns here).
      return { target, force: { complete: true, intercepted: false, sacked: false } };
  }
}

/**
 * Resolve a tackle: damage dealt, plus a fumble roll when the hit qualifies as
 * a "big hit". The fumble (if any) is resolved deterministically via the
 * nearest, fastest chaser; `offense` is the offense's team id for turnover.
 */
export function resolveTackleAttempt(
  attempt: TackleAttempt,
  offense: 'home' | 'away',
  seed: number,
): SnapOptions {
  if (attempt.bigHit && attempt.chasers.length > 0) {
    const fumble = resolveFumble({
      x: attempt.ballX,
      y: attempt.ballY,
      offense,
      chasers: attempt.chasers,
      seed,
    });
    // The sim only needs `fumble: true`; the recovery flips possession on its
    // own (defense recovery = turnover).
    if (fumble.turnover || fumble.recoveredBy !== null) {
      return { force: { fumble: true, tackleDamage: attempt.damage } };
    }
  }
  return { force: { tackleDamage: attempt.damage } };
}
