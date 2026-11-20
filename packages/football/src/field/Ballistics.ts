/**
 * Ballistics — deterministic pass/kick flight model for the live field.
 *
 * Pure TypeScript, no Phaser. Models a thrown ball with height `z`, a ground
 * shadow at `(x, y)`, a catch radius and a defender deflection/interception
 * radius. Two release styles (PLAN.md §3.2):
 *   - lob   (tap): high arc, longer air time, lower apex
 *   - bullet (hold > 180 ms): low, fast line, quick air time
 *
 * Flight is closed-form (no per-tick integration) so both the LivePlay loop and
 * the unit tests can sample `at(t)` deterministically and compare flight time
 * and apex exactly. Resolution (catch vs interception vs deflection) is also
 * deterministic given the sideline actor positions.
 */
import type { Side } from '../sim/Roster';

export type PassStyle = 'LOB' | 'BULLET';

export interface BallInFlight {
  /** Horizontal start/end in yard-space (downfield x, lateral y). */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  style: PassStyle;
  /** Peak height in "yards" (visual z scale). */
  apex: number;
  /** Total air time in seconds. */
  flightTime: number;
  /** Horizontal speed in yards/second. */
  speed: number;
}

export interface PassModel {
  from: { x: number; y: number };
  to: { x: number; y: number };
  style: PassStyle;
}

export interface BallSample {
  x: number;
  y: number;
  z: number;
  /** True once the ball has reached the target (flight over). */
  landed: boolean;
}

/** Determine the flight style from a held-duration in milliseconds. */
export function styleForHold(holdMs: number): PassStyle {
  return holdMs > 180 ? 'BULLET' : 'LOB';
}

/**
 * Build the closed-form flight. Lobs take longer, arc higher; bullets are flat
 * and fast. Deterministic: no RNG, pure geometry on the two endpoints.
 */
export function buildFlight(model: PassModel): BallInFlight {
  const dx = model.to.x - model.from.x;
  const dy = model.to.y - model.from.y;
  const dist = Math.hypot(dx, dy);
  const bullet = model.style === 'BULLET';
  // Bullets fly ~2.4x faster and lower; lobs hang.
  const speed = bullet ? 22 : 13;
  const flightTime = dist / speed;
  const apex = bullet ? Math.max(0.6, dist * 0.08) : Math.max(1.2, dist * 0.22);
  return {
    sx: model.from.x,
    sy: model.from.y,
    tx: model.to.x,
    ty: model.to.y,
    style: model.style,
    apex,
    flightTime,
    speed,
  };
}

/** Sample the ball's position and height at time `t` (clamped to flight end). */
export function sampleFlight(flight: BallInFlight, t: number): BallSample {
  const tt = Math.max(0, Math.min(1, t / flight.flightTime));
  const landed = tt >= 1;
  const x = flight.sx + (flight.tx - flight.sx) * tt;
  const y = flight.sy + (flight.ty - flight.sy) * tt;
  // Parabolic arc peaking at apex at the midpoint (simple gravity model).
  const z = landed ? 0 : flight.apex * 4 * tt * (1 - tt);
  return { x, y, z, landed };
}

export interface DeflectorSpec {
  /** Unique stable id. */
  id: string;
  x: number;
  y: number;
  side: Side;
}

/**
 * Resolve the outcome of a thrown ball near a set of defenders: who catches,
 * who intercepts, who deflects. Deterministic — nearest-defender logic, no RNG,
 * so tests can assert exact outcomes from exact positions.
 */
export interface PassResolution {
  kind: 'CLEAN_CATCH' | 'INTERCEPTION' | 'DEFLECTION' | 'INCOMPLETE';
  /** The defender responsible for an interception/deflection (if any). */
  defenderId: string | null;
}

export const PASS_TUNING = {
  /** Catch radius around the receiver (yards). */
  catchRadius: 1.6,
  /** Defender interception radius around the ball path (yards). */
  interceptionRadius: 1.2,
  /** Defender deflection radius (yards) — slightly larger, weaker effect. */
  deflectionRadius: 1.8,
  /** Hold threshold for bullet vs lob, ms. */
  bulletHoldMs: 180,
} as const;

/** Point-to-segment squared distance from `p` to the segment `a`→`b`. */
function pointSegmentDist2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  // Degenerate segment: distance to the single point.
  if (len2 === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

export function resolvePass(flight: BallInFlight, defenders: DeflectorSpec[]): PassResolution {
  // Distance to the entire start→target segment, so a defender anywhere along
  // the 30-yard flight line is detected (not just at start/mid/end).
  let best: { id: string; d: number } | null = null;
  for (const d of defenders) {
    const dNear = Math.sqrt(
      pointSegmentDist2(d.x, d.y, flight.sx, flight.sy, flight.tx, flight.ty),
    );
    if (!best || dNear < best.d) best = { id: d.id, d: dNear };
  }
  if (!best) return { kind: 'CLEAN_CATCH', defenderId: null };
  if (best.d <= PASS_TUNING.interceptionRadius) {
    return { kind: 'INTERCEPTION', defenderId: best.id };
  }
  if (best.d <= PASS_TUNING.deflectionRadius) {
    return { kind: 'DEFLECTION', defenderId: best.id };
  }
  return { kind: 'CLEAN_CATCH', defenderId: null };
}

export interface DeflectionResult {
  /** Net outcome after a deflection (receiver still may catch, or incomplete). */
  caught: boolean;
  /** The deflecting defender id. */
  defenderId: string;
}
