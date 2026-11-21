import type { Faction } from '@monster-league/shared-core';

/**
 * Halloween Monster Bowl — 4-team single-elimination bracket culminating in the
 * "Hole of Flame" MVP ceremony (PLAN.md §3.5, Card 6 "Halloween Monster Bowl").
 *
 * This is a *pure* tournament state machine with no I/O: the presentation layer
 * feeds it match results (final scores + MVP stats) and reads bracket positions
 * back to render the GSN 66.6 broadcast bracket. It is deliberately deterministic
 * and framework-free so it can be unit-tested and reused by both the hub shell and
 * the MatchScene bracket overlay.
 */

export type BracketSlotId = 'semi-1' | 'semi-2' | 'championship';

export interface TeamSeed {
  faction: Faction;
  seed: number;
}

export interface BracketTeam {
  factionId: string;
  name: string;
  crestColor: string;
  seed: number;
}

export interface MatchResult {
  slot: BracketSlotId;
  homeScore: number;
  awayScore: number;
}

export interface ChampionCrown {
  champion: BracketTeam;
  runnerUp: BracketTeam;
}

export interface MvpAward {
  playerName: string;
  factionId: string;
  /** Tally of the deciding stat (e.g. casualties inflicted, touchdowns). */
  stat: number;
}

/** A single Monster Bowl tournament's live bracket. */
export interface MonsterBowl {
  teams: BracketTeam[];
  /** semifinal matchups, in bracket order [home, away]. */
  semifinals: [BracketTeam, BracketTeam][];
  winners: Partial<Record<BracketSlotId, BracketTeam>>;
  champion: BracketTeam | null;
  runnerUp: BracketTeam | null;
  mvp: MvpAward | null;
  ceremonyTriggered: boolean;
}

const SEMIFINAL_PAIRINGS: [number, number][] = [
  [0, 3], // #1 seed vs #4 seed
  [1, 2], // #2 seed vs #3 seed
];

/** Build a fresh bracket from four seeded teams (highest seed first). */
export function createMonsterBowl(seeds: TeamSeed[]): MonsterBowl {
  if (seeds.length !== 4) {
    throw new Error(`Monster Bowl needs exactly 4 teams, got ${seeds.length}`);
  }
  const ordered = [...seeds].sort((a, b) => a.seed - b.seed);
  const teams = ordered.map((s) => ({
    factionId: s.faction.id,
    name: s.faction.name,
    crestColor: s.faction.colors.primary,
    seed: s.seed,
  }));
  const semifinals = SEMIFINAL_PAIRINGS.map(
    ([a, b]) => [teams[a]!, teams[b]!] as [BracketTeam, BracketTeam],
  );

  return {
    teams,
    semifinals,
    winners: {},
    champion: null,
    runnerUp: null,
    mvp: null,
    ceremonyTriggered: false,
  };
}

/** Record a semifinal result and place the winner into the championship slot. */
export function recordSemifinal(
  bowl: MonsterBowl,
  slot: Exclude<BracketSlotId, 'championship'>,
  homeScore: number,
  awayScore: number,
): BracketTeam {
  const [home, away] = bowl.semifinals[slot === 'semi-1' ? 0 : 1]!;
  const winner = homeScore >= awayScore ? home : away;
  bowl.winners[slot] = winner;
  return winner;
}

/** Get the championship matchup once both semifinals are resolved, else null. */
export function championshipMatchup(bowl: MonsterBowl): [BracketTeam, BracketTeam] | null {
  const a = bowl.winners['semi-1'];
  const b = bowl.winners['semi-2'];
  if (!a || !b) return null;
  return [a, b];
}

/** Record the championship result and crown the Monster Bowl champion. */
export function crownChampion(
  bowl: MonsterBowl,
  homeScore: number,
  awayScore: number,
): ChampionCrown | null {
  const matchup = championshipMatchup(bowl);
  if (!matchup) return null;
  const [home, away] = matchup;
  const champion = homeScore >= awayScore ? home : away;
  const runnerUp = champion === home ? away : home;
  bowl.champion = champion;
  bowl.runnerUp = runnerUp;
  return { champion, runnerUp };
}

/**
 * Award the "Hole of Flame" MVP. Only callable once, on a completed bowl. Returns
 * false when no champion has been crowned (the ceremony must wait for the final).
 */
export function tentMvp(bowl: MonsterBowl, award: MvpAward): boolean {
  if (bowl.ceremonyTriggered || !bowl.champion) return false;
  bowl.mvp = award;
  bowl.ceremonyTriggered = true;
  return true;
}

/** True once the championship is decided (the bracket is complete). */
export function isComplete(bowl: MonsterBowl): boolean {
  return bowl.champion !== null;
}

/** Render an ordered list of bracket rows for the broadcast overlay. */
export function bracketRows(bowl: MonsterBowl): { slot: BracketSlotId; text: string }[] {
  return [
    ...bowl.semifinals.map(([home, away], i) => ({
      slot: (i === 0 ? 'semi-1' : 'semi-2') as BracketSlotId,
      text: `${home.name} vs ${away.name}`,
    })),
    {
      slot: 'championship',
      text: championshipMatchup(bowl)
        ? `${championshipMatchup(bowl)![0].name} vs ${championshipMatchup(bowl)![1].name}`
        : 'TBD vs TBD',
    },
  ];
}
