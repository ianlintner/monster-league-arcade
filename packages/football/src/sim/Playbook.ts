import { DEFENSE_SLOTS, OFFENSE_SLOTS } from './Roster';
import type { DefenseSlot, OffenseSlot, Side } from './Roster';

/** Field-relative point in yards: x = lateral from field centre, y = downfield from the LOS (negative = backfield). */
export interface Waypoint {
  x: number;
  y: number;
}

export type OffenseFormationId =
  | 'GRAVEYARD_I_FORM'
  | 'CRYPT_SHOTGUN'
  | 'HAUNTED_SINGLEBACK'
  | 'MONSTER_GOAL_LINE'
  | 'SPECIAL_TEAMS';
export type DefenseFormationId =
  'BONE_CRUSH_4_3' | 'NICKEL_BANSHEE' | 'CRYPT_BLITZ' | 'GOAL_LINE_WALL' | 'PREVENT_HAUNT';

export interface OffenseFormation {
  id: OffenseFormationId;
  name: string;
  positions: Record<OffenseSlot, Waypoint>;
}
export interface DefenseFormation {
  id: DefenseFormationId;
  name: string;
  positions: Record<DefenseSlot, Waypoint>;
}

const off = (p: readonly [number, number][]): Record<OffenseSlot, Waypoint> =>
  Object.fromEntries(
    OFFENSE_SLOTS.map((s, i) => [s, { x: p[i]?.[0] ?? 0, y: p[i]?.[1] ?? 0 }]),
  ) as Record<OffenseSlot, Waypoint>;
const def = (p: readonly [number, number][]): Record<DefenseSlot, Waypoint> =>
  Object.fromEntries(
    DEFENSE_SLOTS.map((s, i) => [s, { x: p[i]?.[0] ?? 0, y: p[i]?.[1] ?? 0 }]),
  ) as Record<DefenseSlot, Waypoint>;

// Order: QB, RB1, RB2/WR, WR/TE, OL1, OL2, OL3
export const OFFENSE_FORMATIONS: Record<OffenseFormationId, OffenseFormation> = {
  GRAVEYARD_I_FORM: {
    id: 'GRAVEYARD_I_FORM',
    name: 'Graveyard I-Form',
    positions: off([
      [0, -2],
      [0, -6],
      [0, -4],
      [14, 0],
      [-2, 0],
      [0, 0],
      [2, 0],
    ]),
  },
  CRYPT_SHOTGUN: {
    id: 'CRYPT_SHOTGUN',
    name: 'Crypt Shotgun',
    positions: off([
      [0, -5],
      [3, -5],
      [-18, 0],
      [18, 0],
      [-2, 0],
      [0, 0],
      [2, 0],
    ]),
  },
  HAUNTED_SINGLEBACK: {
    id: 'HAUNTED_SINGLEBACK',
    name: 'Haunted Singleback',
    positions: off([
      [0, -2],
      [0, -6],
      [-14, 0],
      [4, 0],
      [-2, 0],
      [0, 0],
      [2, 0],
    ]),
  },
  MONSTER_GOAL_LINE: {
    id: 'MONSTER_GOAL_LINE',
    name: 'Monster Goal Line',
    positions: off([
      [0, -1],
      [0, -4],
      [2, -3],
      [4, 0],
      [-2, 0],
      [0, 0],
      [-4, 0],
    ]),
  },
  SPECIAL_TEAMS: {
    id: 'SPECIAL_TEAMS',
    name: 'Special Teams',
    positions: off([
      [0, -14],
      [-3, -1],
      [3, -1],
      [20, 0],
      [-2, 0],
      [0, 0],
      [2, 0],
    ]),
  },
};

// Order: DL1, DL2, DL3, LB1, LB2, DB1, DB2
export const DEFENSE_FORMATIONS: Record<DefenseFormationId, DefenseFormation> = {
  BONE_CRUSH_4_3: {
    id: 'BONE_CRUSH_4_3',
    name: '4-3 Bone Crush',
    positions: def([
      [-3, 1],
      [0, 1],
      [3, 1],
      [-6, 4],
      [6, 4],
      [-14, 8],
      [14, 8],
    ]),
  },
  NICKEL_BANSHEE: {
    id: 'NICKEL_BANSHEE',
    name: 'Nickel Banshee',
    positions: def([
      [-3, 1],
      [0, 1],
      [3, 1],
      [0, 5],
      [-17, 6],
      [-10, 9],
      [17, 9],
    ]),
  },
  CRYPT_BLITZ: {
    id: 'CRYPT_BLITZ',
    name: 'Crypt Blitz',
    positions: def([
      [-3, 1],
      [0, 1],
      [3, 1],
      [-5, 2],
      [5, 2],
      [-14, 6],
      [14, 6],
    ]),
  },
  GOAL_LINE_WALL: {
    id: 'GOAL_LINE_WALL',
    name: 'Goal Line Wall',
    positions: def([
      [-4, 1],
      [0, 1],
      [4, 1],
      [-2, 2],
      [2, 2],
      [-8, 3],
      [8, 3],
    ]),
  },
  PREVENT_HAUNT: {
    id: 'PREVENT_HAUNT',
    name: 'Prevent Haunt',
    positions: def([
      [-3, 1],
      [0, 1],
      [3, 1],
      [-8, 12],
      [8, 12],
      [-16, 22],
      [16, 22],
    ]),
  },
};

export type OffensePlayKind = 'RUN' | 'PASS' | 'PUNT' | 'FIELD_GOAL';
export type OffenseAssignmentRole = 'CARRY' | 'ROUTE' | 'BLOCK' | 'PITCH' | 'PASS' | 'KICK';
export type DefenseAssignmentRole = 'RUSH' | 'BLITZ' | 'ZONE' | 'MAN' | 'SPY' | 'CONTAIN';

export interface OffenseAssignment {
  role: OffenseAssignmentRole;
  route: Waypoint[];
}
export interface DefenseAssignment {
  role: DefenseAssignmentRole;
  /** Man target (receiver slot) or zone label. */
  target?: string;
  route: Waypoint[];
}

export interface OffensePlay {
  id: string;
  name: string;
  kind: OffensePlayKind;
  formation: OffenseFormationId;
  assignments: Record<OffenseSlot, OffenseAssignment>;
  /** Run: slot that carries. Pass: slot receiving A/B/C taps. */
  carrier: OffenseSlot;
  /** Genesis A/B/C receiver mapping for pass plays. */
  receivers: Partial<Record<'A' | 'B' | 'C', OffenseSlot>>;
  /** Mean gain (run) or mean air yards (pass). */
  avgYards: number;
  /** Gain spread (+/- yards). */
  spread: number;
  /** Base completion chance (pass only). */
  completion: number;
  /** Base turnover risk per play. */
  risk: number;
  /** Two alternates reachable through the standard `A -> A/B` audible. */
  audibles: [string, string];
}

export interface DefensePlay {
  id: string;
  name: string;
  formation: DefenseFormationId;
  assignments: Record<DefenseSlot, DefenseAssignment>;
  /** 0..1 modifiers consumed by the sim. */
  runStop: number;
  passCover: number;
  pressure: number;
  deepGuard: number;
  audibles: [string, string];
}

const wp = (x: number, y: number): Waypoint => ({ x, y });
const block = (): OffenseAssignment => ({ role: 'BLOCK', route: [] });

function offensePlay(
  p: Omit<OffensePlay, 'assignments'> & { skill: Partial<Record<OffenseSlot, OffenseAssignment>> },
): OffensePlay {
  const { skill, ...rest } = p;
  const assignments = {} as Record<OffenseSlot, OffenseAssignment>;
  for (const s of OFFENSE_SLOTS) {
    assignments[s] = skill[s] ?? block();
  }
  return { ...rest, assignments };
}

const run = (...pts: [number, number][]): OffenseAssignment => ({
  role: 'CARRY',
  route: pts.map(([x, y]) => wp(x, y)),
});
const rt = (...pts: [number, number][]): OffenseAssignment => ({
  role: 'ROUTE',
  route: pts.map(([x, y]) => wp(x, y)),
});
const qb = (role: OffenseAssignmentRole, ...pts: [number, number][]): OffenseAssignment => ({
  role,
  route: pts.map(([x, y]) => wp(x, y)),
});

const PASS_RECV = { A: 'WR/TE', B: 'RB2/WR', C: 'RB1' } as const;

export const OFFENSE_PLAYS: Record<string, OffensePlay> = Object.fromEntries(
  [
    offensePlay({
      id: 'INSIDE_GORE_RUN',
      name: 'Inside Gore Run',
      kind: 'RUN',
      formation: 'GRAVEYARD_I_FORM',
      carrier: 'RB1',
      receivers: {},
      avgYards: 4.2,
      spread: 3,
      completion: 0,
      risk: 0.02,
      audibles: ['COFFIN_SWEEP', 'QUICK_SLANTS'],
      skill: { QB: qb('PITCH', [0, -4]), RB1: run([0, -2], [0, 3], [1, 8]) },
    }),
    offensePlay({
      id: 'COFFIN_SWEEP',
      name: 'Coffin Sweep',
      kind: 'RUN',
      formation: 'HAUNTED_SINGLEBACK',
      carrier: 'RB1',
      receivers: {},
      avgYards: 4.8,
      spread: 5,
      completion: 0,
      risk: 0.03,
      audibles: ['INSIDE_GORE_RUN', 'OPTION_PITCH'],
      skill: { QB: qb('PITCH', [3, -3]), RB1: run([10, -3], [16, 2], [14, 10]) },
    }),
    offensePlay({
      id: 'OPTION_PITCH',
      name: 'Option Pitch',
      kind: 'RUN',
      formation: 'CRYPT_SHOTGUN',
      carrier: 'RB1',
      receivers: {},
      avgYards: 5.0,
      spread: 6,
      completion: 0,
      risk: 0.05,
      audibles: ['COFFIN_SWEEP', 'SCREEN_TRAP'],
      skill: { QB: qb('PITCH', [6, -3]), RB1: run([8, -4], [14, 1], [18, 9]) },
    }),
    offensePlay({
      id: 'DRAW_OF_DOOM',
      name: 'Draw of Doom',
      kind: 'RUN',
      formation: 'CRYPT_SHOTGUN',
      carrier: 'RB1',
      receivers: {},
      avgYards: 4.5,
      spread: 4,
      completion: 0,
      risk: 0.02,
      audibles: ['INSIDE_GORE_RUN', 'QUICK_SLANTS'],
      skill: { QB: qb('PITCH', [0, -3]), RB1: run([3, -3], [0, 3], [-2, 9]) },
    }),
    offensePlay({
      id: 'SPECTER_SNEAK',
      name: 'Specter Sneak',
      kind: 'RUN',
      formation: 'MONSTER_GOAL_LINE',
      carrier: 'QB',
      receivers: {},
      avgYards: 2.2,
      spread: 1.5,
      completion: 0,
      risk: 0.02,
      audibles: ['INSIDE_GORE_RUN', 'TOMBSTONE_PLUNGE'],
      skill: { QB: run([0, 0], [0, 2]) },
    }),
    offensePlay({
      id: 'TOMBSTONE_PLUNGE',
      name: 'Tombstone Plunge',
      kind: 'RUN',
      formation: 'MONSTER_GOAL_LINE',
      carrier: 'RB1',
      receivers: {},
      avgYards: 3.0,
      spread: 2,
      completion: 0,
      risk: 0.03,
      audibles: ['SPECTER_SNEAK', 'COFFIN_SWEEP'],
      skill: { QB: qb('PITCH', [0, -2]), RB1: run([0, -1], [0, 1], [0, 3]) },
    }),
    offensePlay({
      id: 'QUICK_SLANTS',
      name: 'Quick Slants',
      kind: 'PASS',
      formation: 'CRYPT_SHOTGUN',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 6,
      spread: 4,
      completion: 0.7,
      risk: 0.03,
      audibles: ['SCREEN_TRAP', 'INSIDE_GORE_RUN'],
      skill: {
        QB: qb('PASS', [0, -5]),
        'WR/TE': rt([-6, 3], [-10, 6]),
        'RB2/WR': rt([6, 3], [10, 6]),
        RB1: rt([4, -2], [8, 4]),
      },
    }),
    offensePlay({
      id: 'POST_CORNER',
      name: 'Post Corner',
      kind: 'PASS',
      formation: 'HAUNTED_SINGLEBACK',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 16,
      spread: 7,
      completion: 0.5,
      risk: 0.07,
      audibles: ['QUICK_SLANTS', 'HAIL_MARY_HOWL'],
      skill: {
        QB: qb('PASS', [0, -5]),
        'WR/TE': rt([4, 8], [-8, 16], [-18, 22]),
        'RB2/WR': rt([-4, 8], [8, 14]),
        RB1: rt([6, 0], [10, 6]),
      },
    }),
    offensePlay({
      id: 'HAIL_MARY_HOWL',
      name: 'Hail Mary Howl',
      kind: 'PASS',
      formation: 'CRYPT_SHOTGUN',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 38,
      spread: 14,
      completion: 0.22,
      risk: 0.14,
      audibles: ['POST_CORNER', 'QUICK_SLANTS'],
      skill: {
        QB: qb('PASS', [0, -7]),
        'WR/TE': rt([0, 20], [-4, 40]),
        'RB2/WR': rt([0, 20], [4, 40]),
        RB1: rt([2, 18], [0, 38]),
      },
    }),
    offensePlay({
      id: 'SCREEN_TRAP',
      name: 'Screen Trap',
      kind: 'PASS',
      formation: 'GRAVEYARD_I_FORM',
      carrier: 'RB1',
      receivers: { A: 'RB1', B: 'RB2/WR' },
      avgYards: 5,
      spread: 6,
      completion: 0.76,
      risk: 0.04,
      audibles: ['DRAW_OF_DOOM', 'QUICK_SLANTS'],
      skill: { QB: qb('PASS', [0, -6]), RB1: rt([8, -2], [10, 2]), 'RB2/WR': rt([-6, -1]) },
    }),
    offensePlay({
      id: 'CURL_FLAT',
      name: 'Curl & Flat',
      kind: 'PASS',
      formation: 'HAUNTED_SINGLEBACK',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 8,
      spread: 4,
      completion: 0.64,
      risk: 0.04,
      audibles: ['QUICK_SLANTS', 'POST_CORNER'],
      skill: {
        QB: qb('PASS', [0, -5]),
        'WR/TE': rt([-14, 8], [-13, 6]),
        'RB2/WR': rt([-14, 8], [-14, 6]),
        RB1: rt([10, 0], [14, 3]),
      },
    }),
    offensePlay({
      id: 'DEEP_CROSS',
      name: 'Deep Crossing Coffin',
      kind: 'PASS',
      formation: 'CRYPT_SHOTGUN',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 14,
      spread: 6,
      completion: 0.55,
      risk: 0.06,
      audibles: ['CURL_FLAT', 'POST_CORNER'],
      skill: {
        QB: qb('PASS', [0, -5]),
        'WR/TE': rt([-2, 12], [14, 14]),
        'RB2/WR': rt([2, 12], [-14, 14]),
        RB1: rt([0, 4]),
      },
    }),
    offensePlay({
      id: 'BOOTLEG_BANSHEE',
      name: 'Bootleg Banshee (Play Action)',
      kind: 'PASS',
      formation: 'GRAVEYARD_I_FORM',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 12,
      spread: 6,
      completion: 0.58,
      risk: 0.05,
      audibles: ['INSIDE_GORE_RUN', 'DEEP_CROSS'],
      skill: {
        QB: qb('PASS', [-6, -4], [-8, -5]),
        'WR/TE': rt([8, 6], [4, 14]),
        'RB2/WR': rt([0, 4], [-6, 10]),
        RB1: rt([0, -2], [-8, 2]),
      },
    }),
    offensePlay({
      id: 'FADE_TO_BLACK',
      name: 'Fade to Black',
      kind: 'PASS',
      formation: 'MONSTER_GOAL_LINE',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 10,
      spread: 4,
      completion: 0.5,
      risk: 0.06,
      audibles: ['QUICK_SLANTS', 'SPECTER_SNEAK'],
      skill: {
        QB: qb('PASS', [0, -4]),
        'WR/TE': rt([10, 4], [12, 10]),
        'RB2/WR': rt([-4, 3], [-8, 8]),
        RB1: rt([2, 0], [4, 3]),
      },
    }),
    offensePlay({
      id: 'FLEA_FLICKER_FRIGHT',
      name: 'Flea-Flicker Fright',
      kind: 'PASS',
      formation: 'HAUNTED_SINGLEBACK',
      carrier: 'WR/TE',
      receivers: PASS_RECV,
      avgYards: 22,
      spread: 9,
      completion: 0.42,
      risk: 0.1,
      audibles: ['POST_CORNER', 'COFFIN_SWEEP'],
      skill: {
        QB: qb('PASS', [0, -5]),
        'WR/TE': rt([-4, 12], [-8, 24]),
        'RB2/WR': rt([4, 12], [8, 24]),
        RB1: qb('PITCH', [0, 2], [0, -4]),
      },
    }),
    offensePlay({
      id: 'PUNT',
      name: 'Punt',
      kind: 'PUNT',
      formation: 'SPECIAL_TEAMS',
      carrier: 'QB',
      receivers: {},
      avgYards: 42,
      spread: 8,
      completion: 0,
      risk: 0.01,
      audibles: ['FIELD_GOAL', 'INSIDE_GORE_RUN'],
      skill: { QB: { role: 'KICK', route: [wp(0, -14), wp(0, -12)] }, 'WR/TE': rt([20, 40]) },
    }),
    offensePlay({
      id: 'FIELD_GOAL',
      name: 'Field Goal',
      kind: 'FIELD_GOAL',
      formation: 'SPECIAL_TEAMS',
      carrier: 'QB',
      receivers: {},
      avgYards: 0,
      spread: 0,
      completion: 0,
      risk: 0.01,
      audibles: ['PUNT', 'INSIDE_GORE_RUN'],
      skill: { QB: { role: 'KICK', route: [wp(0, -7), wp(0, -6)] } },
    }),
  ].map((p) => [p.id, p]),
);

const z = (target: string, ...pts: [number, number][]): DefenseAssignment => ({
  role: 'ZONE',
  target,
  route: pts.map(([x, y]) => wp(x, y)),
});
const man = (target: OffenseSlot, ...pts: [number, number][]): DefenseAssignment => ({
  role: 'MAN',
  target,
  route: pts.map(([x, y]) => wp(x, y)),
});
const rush = (...pts: [number, number][]): DefenseAssignment => ({
  role: 'RUSH',
  route: pts.map(([x, y]) => wp(x, y)),
});
const blitz = (...pts: [number, number][]): DefenseAssignment => ({
  role: 'BLITZ',
  target: 'QB',
  route: pts.map(([x, y]) => wp(x, y)),
});
const spy = (...pts: [number, number][]): DefenseAssignment => ({
  role: 'SPY',
  target: 'QB',
  route: pts.map(([x, y]) => wp(x, y)),
});
const contain = (...pts: [number, number][]): DefenseAssignment => ({
  role: 'CONTAIN',
  route: pts.map(([x, y]) => wp(x, y)),
});

type DefInit = Omit<DefensePlay, 'assignments'> & { a: readonly DefenseAssignment[] };
const defensePlay = ({ a, ...rest }: DefInit): DefensePlay => ({
  ...rest,
  assignments: Object.fromEntries(DEFENSE_SLOTS.map((s, i) => [s, a[i]])) as Record<
    DefenseSlot,
    DefenseAssignment
  >,
});

// Assignment order: DL1, DL2, DL3, LB1, LB2, DB1, DB2
export const DEFENSE_PLAYS: Record<string, DefensePlay> = Object.fromEntries(
  [
    defensePlay({
      id: 'BONE_CRUSH_BASE',
      name: 'Bone Crush Base',
      formation: 'BONE_CRUSH_4_3',
      runStop: 0.55,
      passCover: 0.5,
      pressure: 0.35,
      deepGuard: 0.5,
      audibles: ['CRYPT_ZONE_2', 'RUN_STUFF_STAKE'],
      a: [
        rush([-2, -3]),
        rush([0, -3]),
        rush([2, -3]),
        z('HOOK_L', [-6, 8]),
        z('HOOK_R', [6, 8]),
        z('DEEP_HALF_L', [-12, 14]),
        z('DEEP_HALF_R', [12, 14]),
      ],
    }),
    defensePlay({
      id: 'CRYPT_ZONE_2',
      name: 'Crypt Zone 2',
      formation: 'BONE_CRUSH_4_3',
      runStop: 0.45,
      passCover: 0.6,
      pressure: 0.3,
      deepGuard: 0.65,
      audibles: ['BONE_CRUSH_BASE', 'COFFIN_COVER_3'],
      a: [
        rush([-2, -3]),
        rush([0, -3]),
        rush([2, -3]),
        z('FLAT_L', [-14, 5]),
        z('FLAT_R', [14, 5]),
        z('DEEP_HALF_L', [-13, 16]),
        z('DEEP_HALF_R', [13, 16]),
      ],
    }),
    defensePlay({
      id: 'COFFIN_COVER_3',
      name: 'Coffin Cover 3',
      formation: 'NICKEL_BANSHEE',
      runStop: 0.4,
      passCover: 0.62,
      pressure: 0.3,
      deepGuard: 0.7,
      audibles: ['CRYPT_ZONE_2', 'BANSHEE_MAN'],
      a: [
        rush([-2, -3]),
        rush([0, -3]),
        rush([2, -3]),
        z('HOOK', [0, 9]),
        z('FLAT_R', [14, 5]),
        z('DEEP_THIRD_L', [-12, 18]),
        z('DEEP_THIRD_R', [12, 18]),
      ],
    }),
    defensePlay({
      id: 'BANSHEE_MAN',
      name: 'Banshee Man-Eater',
      formation: 'NICKEL_BANSHEE',
      runStop: 0.4,
      passCover: 0.66,
      pressure: 0.35,
      deepGuard: 0.45,
      audibles: ['COFFIN_COVER_3', 'LB_BLITZ_HEX'],
      a: [
        rush([-2, -3]),
        rush([0, -3]),
        rush([2, -3]),
        man('RB1', [0, 4]),
        man('RB2/WR', [-17, 8]),
        man('WR/TE', [-10, 12]),
        spy([0, 8]),
      ],
    }),
    defensePlay({
      id: 'LB_BLITZ_HEX',
      name: 'Linebacker Hex Blitz',
      formation: 'CRYPT_BLITZ',
      runStop: 0.5,
      passCover: 0.4,
      pressure: 0.6,
      deepGuard: 0.4,
      audibles: ['BONE_CRUSH_BASE', 'ALL_OUT_ASSAULT'],
      a: [
        rush([-2, -4]),
        rush([0, -4]),
        rush([2, -4]),
        blitz([-5, -5]),
        blitz([5, -5]),
        z('DEEP_HALF_L', [-12, 14]),
        z('DEEP_HALF_R', [12, 14]),
      ],
    }),
    defensePlay({
      id: 'ALL_OUT_ASSAULT',
      name: 'All-Out Assault',
      formation: 'CRYPT_BLITZ',
      runStop: 0.45,
      passCover: 0.25,
      pressure: 0.8,
      deepGuard: 0.2,
      audibles: ['LB_BLITZ_HEX', 'CRYPT_ZONE_2'],
      a: [
        blitz([-2, -5]),
        blitz([0, -5]),
        blitz([2, -5]),
        blitz([-5, -5]),
        blitz([5, -5]),
        man('WR/TE', [-14, 8]),
        man('RB2/WR', [14, 8]),
      ],
    }),
    defensePlay({
      id: 'CORNER_BLITZ_CURSE',
      name: 'Corner Blitz Curse',
      formation: 'CRYPT_BLITZ',
      runStop: 0.45,
      passCover: 0.35,
      pressure: 0.65,
      deepGuard: 0.35,
      audibles: ['LB_BLITZ_HEX', 'BANSHEE_MAN'],
      a: [
        rush([-2, -4]),
        rush([0, -4]),
        rush([2, -4]),
        z('HOOK', [0, 8]),
        z('FLAT_R', [10, 5]),
        blitz([-12, -4]),
        z('DEEP_ALL', [10, 20]),
      ],
    }),
    defensePlay({
      id: 'GOAL_LINE_STUFF',
      name: 'Goal Line Stuff',
      formation: 'GOAL_LINE_WALL',
      runStop: 0.85,
      passCover: 0.35,
      pressure: 0.4,
      deepGuard: 0.1,
      audibles: ['RUN_STUFF_STAKE', 'BONE_CRUSH_BASE'],
      a: [
        rush([-3, -1]),
        rush([0, -1]),
        rush([3, -1]),
        rush([-2, 0]),
        rush([2, 0]),
        man('WR/TE', [-8, 2]),
        contain([8, 2]),
      ],
    }),
    defensePlay({
      id: 'RUN_STUFF_STAKE',
      name: 'Run-Stuff Stake',
      formation: 'BONE_CRUSH_4_3',
      runStop: 0.75,
      passCover: 0.35,
      pressure: 0.4,
      deepGuard: 0.3,
      audibles: ['BONE_CRUSH_BASE', 'GOAL_LINE_STUFF'],
      a: [
        rush([-3, -2]),
        rush([0, -2]),
        rush([3, -2]),
        blitz([-4, -2]),
        rush([4, 0]),
        contain([-14, 5]),
        contain([14, 5]),
      ],
    }),
    defensePlay({
      id: 'PREVENT_SHROUD',
      name: 'Prevent Shroud',
      formation: 'PREVENT_HAUNT',
      runStop: 0.25,
      passCover: 0.7,
      pressure: 0.15,
      deepGuard: 0.95,
      audibles: ['CRYPT_ZONE_2', 'COFFIN_COVER_3'],
      a: [
        rush([-2, -2]),
        rush([0, -2]),
        rush([2, -2]),
        z('DEEP_MID', [-8, 16]),
        z('DEEP_MID', [8, 16]),
        z('DEEP_ALL', [-16, 28]),
        z('DEEP_ALL', [16, 28]),
      ],
    }),
    defensePlay({
      id: 'SPY_THE_QB',
      name: 'Spook-Spy QB',
      formation: 'NICKEL_BANSHEE',
      runStop: 0.5,
      passCover: 0.55,
      pressure: 0.4,
      deepGuard: 0.5,
      audibles: ['BANSHEE_MAN', 'BONE_CRUSH_BASE'],
      a: [
        rush([-2, -3]),
        rush([0, -3]),
        rush([2, -3]),
        spy([0, 5]),
        z('HOOK', [0, 9]),
        z('DEEP_HALF_L', [-12, 15]),
        z('DEEP_HALF_R', [12, 15]),
      ],
    }),
    defensePlay({
      id: 'BLOCK_PARTY',
      name: 'Block Party (Kick Rush)',
      formation: 'GOAL_LINE_WALL',
      runStop: 0.5,
      passCover: 0.3,
      pressure: 0.7,
      deepGuard: 0.2,
      audibles: ['GOAL_LINE_STUFF', 'PREVENT_SHROUD'],
      a: [
        rush([-3, -2]),
        rush([0, -2]),
        rush([3, -2]),
        rush([-5, -2]),
        rush([5, -2]),
        rush([-8, -2]),
        rush([8, -2]),
      ],
    }),
  ].map((p) => [p.id, p]),
);

export function getOffensePlay(id: string): OffensePlay {
  const play = OFFENSE_PLAYS[id];
  if (!play) throw new Error(`Unknown offensive play: ${id}`);
  return play;
}
export function getDefensePlay(id: string): DefensePlay {
  const play = DEFENSE_PLAYS[id];
  if (!play) throw new Error(`Unknown defensive play: ${id}`);
  return play;
}

// ---------------------------------------------------------------------------
// Genesis pre-snap audible combo
// ---------------------------------------------------------------------------

export type Button = 'A' | 'B' | 'C';

export type NastyKind =
  | 'PUMPKIN_BOMB_PASS'
  | 'DYNAMITE_PITCH'
  | 'BAT_WING_JET_BOOST'
  | 'GHOUL_GAS'
  | 'QB_CRYPT_BLITZ'
  | 'PHANTOM_SHROUD'
  | 'HEX_OF_CONFUSION'
  | 'BRIBE_REF'
  | 'KILL_REF';

export const NASTY_SIDE: Record<NastyKind, Side | 'ANY'> = {
  PUMPKIN_BOMB_PASS: 'OFFENSE',
  DYNAMITE_PITCH: 'OFFENSE',
  BAT_WING_JET_BOOST: 'OFFENSE',
  GHOUL_GAS: 'OFFENSE',
  QB_CRYPT_BLITZ: 'DEFENSE',
  PHANTOM_SHROUD: 'DEFENSE',
  HEX_OF_CONFUSION: 'DEFENSE',
  BRIBE_REF: 'ANY',
  KILL_REF: 'ANY',
};

/**
 * Three-slot Nasty menu (A/B/C) shown after `A -> C`. Offensive menu is play-aware: Pumpkin Bomb needs a
 * pass, Dynamite Pitch needs a run. Bribe Ref / Kill Ref are fired via GameSession.callNasty.
 */
export function nastyMenu(
  side: Side,
  playKind: OffensePlayKind | null,
): [NastyKind, NastyKind, NastyKind] {
  if (side === 'DEFENSE') return ['QB_CRYPT_BLITZ', 'PHANTOM_SHROUD', 'HEX_OF_CONFUSION'];
  const first: NastyKind = playKind === 'PASS' ? 'PUMPKIN_BOMB_PASS' : 'DYNAMITE_PITCH';
  return [first, 'BAT_WING_JET_BOOST', 'GHOUL_GAS'];
}

export type AudibleState = 'IDLE' | 'AUDIBLE_MENU' | 'NASTY_MENU' | 'DONE';

export type AudibleSelection =
  { kind: 'STANDARD'; playId: string } | { kind: 'NASTY'; nasty: NastyKind } | { kind: 'CANCEL' };

/**
 * Genesis combo:
 *   A -> A/B        standard audible (swap to alternate play 1 or 2)
 *   A -> C -> A/B/C Nasty Audible (pick one of three dirty tricks)
 * Pressing B in any menu cancels.
 */
export class AudibleController {
  state: AudibleState = 'IDLE';

  constructor(
    private readonly side: Side,
    private readonly currentPlayId: string,
    private readonly playKind: OffensePlayKind | null,
  ) {}

  private alternates(): [string, string] {
    return this.side === 'OFFENSE'
      ? getOffensePlay(this.currentPlayId).audibles
      : getDefensePlay(this.currentPlayId).audibles;
  }

  /** Feed a button; returns a selection once the combo resolves. */
  press(button: Button): AudibleSelection | null {
    switch (this.state) {
      case 'IDLE':
      case 'DONE':
        if (button === 'A') this.state = 'AUDIBLE_MENU';
        return null;
      case 'AUDIBLE_MENU': {
        if (button === 'C') {
          this.state = 'NASTY_MENU';
          return null;
        }
        const alts = this.alternates();
        this.state = 'DONE';
        // `A -> B` is the second alternate; `A -> A` the first.
        return button === 'A'
          ? { kind: 'STANDARD', playId: alts[0] }
          : { kind: 'STANDARD', playId: alts[1] };
      }
      case 'NASTY_MENU': {
        const menu = nastyMenu(this.side, this.playKind);
        this.state = 'DONE';
        return { kind: 'NASTY', nasty: menu[button === 'A' ? 0 : button === 'B' ? 1 : 2] };
      }
    }
  }

  reset(): void {
    this.state = 'IDLE';
  }
}
