/**
 * fieldMapper — the bridge between the simulation (`GameSession`/`Playbook`) and
 * the presentation runtime (`LivePlay`). Pure TypeScript, no Phaser, so it is
 * unit-testable in isolation from rendering.
 *
 * Coordinate conventions:
 *   - Playbook `Waypoint`: `x` = lateral from field centre (±~20 yd), `y` = downfield
 *     from the line of scrimmage (negative = backfield).
 *   - LivePlay yard-space: `x` = downfield from the LOS (positive = toward the
 *     offense's goal), `y` = lateral from field centre (positive = offense's right).
 *   - projection25d: `x` ∈ [0,120] along the field (0 = own end zone, 120 = far
 *     end zone), `y` ∈ [0,53] across (0 = far edge = top of screen).
 */

import type { GameSession } from '../sim/GameSession';
import { FIELD_LENGTH } from '../sim/GameSession';
import {
  OFFENSE_FORMATIONS,
  DEFENSE_FORMATIONS,
  getOffensePlay,
  getDefensePlay,
} from '../sim/Playbook';
import type { OffensePlay, DefensePlay, Waypoint } from '../sim/Playbook';
import type { OffenseSlot, DefenseSlot, Player } from '../sim/Roster';
import { OFFENSE_SLOTS, DEFENSE_SLOTS } from '../sim/Roster';
import type { LiveActorSpec, LivePlayInput, LiveWaypoint } from './LivePlay';

/** Map a 20-99 `speed` rating to a yards/second top speed (~4.2 .. 11 yd/s). */
export function speedToYardSpeed(speed: number): number {
  return 4.2 + (speed / 99) * 6.8;
}

/** Map a 0-1-ish `agility`/`tackle` rating (rated 20-99) to a turn-rate 0..1. */
export function rating01(rating: number): number {
  return Math.max(0, Math.min(1, rating / 100));
}

/**
 * Convert a Playbook waypoint (lateral x, downfield y) into LivePlay yard-space
 * (downfield x, lateral y). Pure flip of axes.
 */
export function toLiveWaypoint(wp: Waypoint): LiveWaypoint {
  return { x: wp.y, y: wp.x };
}

/** Minimum lateral gap (yards) between adjacent pre-snap actors. The catalog's
 *  I-form stacked QB/RB on the same x, which projects to one unreadable column. */
export const MIN_FORMATION_LATERAL_SPACING = 3;

/**
 * Spread a formation laterally so no two adjacent slots share a lane. Pure and
 * deterministic: keeps the original left-to-right order and centre of mass, and
 * leaves downfield (`y`) coordinates untouched so route timing is unchanged.
 * Applied to every offense/defense catalog formation in `buildLivePlayInput`.
 */
export function spreadFormationLaterally<S extends string>(
  positions: Record<S, Waypoint>,
): Record<S, Waypoint> {
  const slots = Object.keys(positions) as S[];
  if (slots.length === 0) return positions;
  const sorted = slots.slice().sort((a, b) => positions[a]!.x - positions[b]!.x);
  const spread = new Map<S, number>();
  let previous = -Infinity;
  for (const slot of sorted) {
    const x = Math.max(positions[slot]!.x, previous + MIN_FORMATION_LATERAL_SPACING);
    spread.set(slot, x);
    previous = x;
  }
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const shift =
    mean(slots.map((slot) => positions[slot]!.x)) - mean(slots.map((slot) => spread.get(slot)!));
  return Object.fromEntries(
    slots.map((slot) => [
      slot,
      { ...positions[slot]!, x: Math.round((spread.get(slot)! + shift) * 100) / 100 },
    ]),
  ) as Record<S, Waypoint>;
}

const OFFENSE_TO_LIVE: Record<OffenseSlot, string> = {
  QB: 'QB',
  RB1: 'RB1',
  'RB2/WR': 'RB2/WR',
  'WR/TE': 'WR/TE',
  OL1: 'OL1',
  OL2: 'OL2',
  OL3: 'OL3',
};
const DEFENSE_TO_LIVE: Record<DefenseSlot, string> = {
  DL1: 'DL1',
  DL2: 'DL2',
  DL3: 'DL3',
  LB1: 'LB1',
  LB2: 'LB2',
  DB1: 'DB1',
  DB2: 'DB2',
};

/** Build the 14-actor `LivePlayInput` for one play from the current session state. */
export function buildLivePlayInput(
  session: GameSession,
  offensePlayId: string,
  defensePlayId: string,
  seed: number,
): LivePlayInput {
  const offPlay: OffensePlay = getOffensePlay(offensePlayId);
  const defPlay: DefensePlay = getDefensePlay(defensePlayId);
  const offense = session.possession;
  const defense = session.defense;

  const offPositions = spreadFormationLaterally(OFFENSE_FORMATIONS[offPlay.formation].positions);
  const defPositions = spreadFormationLaterally(DEFENSE_FORMATIONS[defPlay.formation].positions);
  const actors: LiveActorSpec[] = [];

  // Offense actors.
  for (const slot of OFFENSE_SLOTS) {
    const player: Player = session.roster[offense].player('OFFENSE', slot);
    const pos = offPositions[slot];
    const id = `${offense}-${slot}`;
    const waypoint = toLiveWaypoint(pos);
    actors.push({
      id,
      team: offense,
      side: 'OFFENSE',
      slot,
      x: waypoint.x,
      y: waypoint.y,
      topSpeed: speedToYardSpeed(player.speed),
      acceleration: 1,
      turnRate: rating01(player.agility),
    });
  }

  // Defense actors (line up across the LOS).
  for (const slot of DEFENSE_SLOTS) {
    const player: Player = session.roster[defense].player('DEFENSE', slot);
    const pos = defPositions[slot];
    const id = `${defense}-${slot}`;
    const waypoint = toLiveWaypoint(pos);
    actors.push({
      id,
      team: defense,
      side: 'DEFENSE',
      slot,
      x: waypoint.x,
      y: waypoint.y,
      topSpeed: speedToYardSpeed(player.speed),
      acceleration: 1,
      turnRate: rating01(player.agility),
    });
  }

  // Carrier: for a run the play's `carrier` slot (RB/run); for a pass the QB
  // holds the ball at snap and drops back while receivers run their routes.
  const isPass = offPlay.kind === 'PASS';
  const carrierSlot: OffenseSlot = isPass ? 'QB' : offPlay.carrier;
  const carrierId = `${offense}-${carrierSlot}`;
  const carrierRoutes = offPlay.assignments[carrierSlot]?.route ?? [];
  const carrierRoute: LiveWaypoint[] = carrierRoutes.map(toLiveWaypoint);

  // Non-carrier routes (receivers/blockers) map into the optional routes map.
  const routes: Record<string, LiveWaypoint[]> = {};
  for (const slot of OFFENSE_SLOTS) {
    if (slot === carrierSlot) continue;
    const a = offPlay.assignments[slot];
    if (a && a.route.length > 0) routes[`${offense}-${slot}`] = a.route.map(toLiveWaypoint);
  }

  return { actors, carrierId, carrierRoute, routes, seed, los: session.los };
}

/**
 * Map a LivePlay actor's yard-space position (downfield-from-LOS, lateral) to
 * projection25d field coordinates. The offense drives +x along the field; the LOS
 * is at `los` yards from the offense's own goal line + the 10-yard end zone.
 */
export function projectActor(liveX: number, liveY: number, los: number): { x: number; y: number } {
  const fieldX = 10 + los + liveX; // 10 = own end zone; los in [0,100]
  const fieldY = 26.5 + liveY; // 26.5 = field centre across 53
  return { x: Math.max(0, Math.min(120, fieldX)), y: Math.max(0, Math.min(53, fieldY)) };
}

/** Field constants for renderers (end zone, LOS marker, hash marks). */
export const FIELD = {
  OWN_ENDZONE_START: 0,
  OWN_ENDZONE_END: 10,
  FAR_ENDZONE_START: 110,
  FAR_ENDZONE_END: 120,
} as const;

export { OFFENSE_SLOTS, DEFENSE_SLOTS, OFFENSE_TO_LIVE, DEFENSE_TO_LIVE, FIELD_LENGTH };
