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

  const actors: LiveActorSpec[] = [];

  // Offense actors.
  for (const slot of OFFENSE_SLOTS) {
    const player: Player = session.roster[offense].player('OFFENSE', slot);
    const pos = OFFENSE_FORMATIONS[offPlay.formation].positions[slot];
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
    const pos = DEFENSE_FORMATIONS[defPlay.formation].positions[slot];
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

  // Carrier route: the play's CARRY assignment (or QB kick/pass route).
  const carrierSlot = offPlay.carrier;
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
