/**
 * PassWindows — pre-snap pass target windows and receiver lead reticles.
 *
 * Pure TypeScript, no Phaser. Given the called pass play's `receivers`
 * (A/B/C → slot) and each receiver's `OffenseAssignment.route`, computes where
 * each receiver is now and where its lead reticle sits on the turf — the
 * predicted catch point the QB would aim at. This drives the `[A][B][C]` cyan
 * badges floating over receivers and the turf reticles the UI draws for aiming.
 */
import type { OffenseSlot, Waypoint } from '../sim';

export interface PassTarget {
  key: 'A' | 'B' | 'C';
  slot: OffenseSlot;
  /** Current receiver position (yard-space). */
  x: number;
  y: number;
  /** Predicted catch (lead) point on the turf — where the throw is aimed. */
  leadX: number;
  leadY: number;
  /** Receiver speed magnitude (yards per unit route-progress). */
  speed: number;
}

export interface Deflection {
  /** Defender id that deflected the ball. */
  defenderId: string;
  /** Whether the ball was intercepted despite the deflection (false = incomplete). */
  intercepted: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Compute the pass targets for the play's receivers. Each receiver's route
 * comes from its `OffenseAssignment.route`; `routeT` holds the normalized
 * progress (0..1) travelled per slot; `leadSeconds` is how many seconds ahead
 * the ball is expected to be in the air (drives the lead reticle).
 */
export function computePassTargets(
  receivers: Partial<Record<'A' | 'B' | 'C', OffenseSlot>>,
  routeFor: (slot: OffenseSlot) => Waypoint[],
  routeT: Record<OffenseSlot, number>,
  leadSeconds: number,
): PassTarget[] {
  const keys: ('A' | 'B' | 'C')[] = ['A', 'B', 'C'];
  const out: PassTarget[] = [];
  for (const key of keys) {
    const slot = receivers[key];
    if (!slot) continue;
    const route = routeFor(slot);
    const t = clamp(routeT[slot] ?? 0, 0, 1);
    const pos = sampleRoute(route, t);
    const speed = routeSpeed(route, t);
    const len = routeLength(route);
    const leadT = len > 0 ? clamp(t + (leadSeconds * speed) / len, 0, 1) : t;
    const lead = sampleRoute(route, leadT);
    out.push({ key, slot, x: pos.x, y: pos.y, leadX: lead.x, leadY: lead.y, speed });
  }
  return out;
}

/** Linear interpolation along a polyline route at normalized progress t. */
export function sampleRoute(route: Waypoint[], t: number): { x: number; y: number } {
  const first = route[0];
  if (!first) return { x: 0, y: 0 };
  if (route.length === 1) return { x: first.x, y: first.y };
  const total = routeLength(route);
  if (total <= 0) return { x: first.x, y: first.y };
  let target = t * total;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= seg) {
      const f = seg === 0 ? 0 : target / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    target -= seg;
  }
  const last = route[route.length - 1]!;
  return { x: last.x, y: last.y };
}

export function routeLength(route: Waypoint[]): number {
  let len = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/**
 * Instantaneous speed along the route at progress t (yards per unit
 * route-progress). Used to extrapolate the receiver's future position for the
 * lead reticle (higher speed → sooner catch point).
 */
export function routeSpeed(route: Waypoint[], t: number): number {
  if (route.length < 2) return 0;
  const total = routeLength(route);
  if (total <= 0) return 0;
  let target = t * total;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= seg) return seg;
    target -= seg;
  }
  const a = route[route.length - 2]!;
  const b = route[route.length - 1]!;
  return Math.hypot(b.x - a.x, b.y - a.y);
}
