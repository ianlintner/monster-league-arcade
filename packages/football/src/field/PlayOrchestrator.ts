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

  // Downfield yardage physically resolved on the field (x is downfield from the
  // LOS), so the sim uses the actual catch/interception spot rather than rolling
  // random air yardage from the playbook.
  const yards = Math.round(attempt.toX - attempt.fromX);

  switch (resolution.kind) {
    case 'INTERCEPTION':
      return {
        target,
        force: { complete: false, intercepted: true, sacked: false, yards },
      };
    case 'DEFLECTION':
      // A deflection breaks up the catch. Deterministic by design (no RNG):
      // a deflection always results in an incompletion in this scope.
      return {
        target,
        force: { complete: false, intercepted: false, sacked: false, yards },
      };
    default:
      // CLEAN_CATCH (or INCOMPLETE, which resolvePass never returns here).
      return {
        target,
        force: { complete: true, intercepted: false, sacked: false, yards },
      };
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
    if (fumble.recoveredBy === null) {
      // Ball rolls dead: neither side takes it; treat as a normal tackle, no
      // forced fumble (possession is unchanged).
      return { force: { tackleDamage: attempt.damage } };
    }
    if (fumble.turnover) {
      // Defense recovered: a real turnover, so force the fumble (the sim treats
      // an explicit fumble as lost and flips possession).
      return { force: { fumble: true, tackleDamage: attempt.damage } };
    }
    // Offense recovered its own fumble: the ball stays with the offense. A fumble
    // did occur, but the down continues; do NOT force it as lost to the defense.
    return { force: { tackleDamage: attempt.damage } };
  }
  return { force: { tackleDamage: attempt.damage } };
}
