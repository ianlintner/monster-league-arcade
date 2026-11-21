import { DEFENSE_PLAYS, OFFENSE_PLAYS, getDefensePlay, getOffensePlay } from '../sim/Playbook';
import type { NastyKind } from '../sim/Playbook';
import type { TeamId } from '../sim/Roster';

/**
 * AI Coach — the CPU opponent's situational brain for GSN 66.6 Monster League.
 *
 * It is deliberately a *pure* decision engine: `decideCoachPlay()` reads a plain
 * `CoachSituation` snapshot (mirroring `GameSession`'s public fields) and returns
 * a play-call plus an optional Nasty Audible plan. The scene wires those decisions
 * back through the exact same `GameSession` API a human uses (`selectPlays`,
 * `callNasty`) so the AI can never cheat the rules engine.
 */

/** The AI's read of the game at huddle time. Keep this a shallow value type. */
export interface CoachSituation {
  down: number;
  yardsToGo: number;
  los: number;
  quarter: number;
  clockSeconds: number;
  score: { home: number; away: number };
  /** The team the AI is coaching (its own perspective). */
  team: TeamId;
  /** True when the AI's team has the ball this snap. */
  aiIsOffense: boolean;
  /** The AI's total casualties this game (drives desperation). */
  ownCasualties: number;
  /** Whether the opponent's Necro-Ref is currently bribed *against* the AI. */
  refBribedAgainst: boolean;
  /** Whether the Demon Ref is in play (both ref nasties are then unusable). */
  demonRefActive: boolean;
  /** Nasties the AI still holds charges for this half. */
  availableNasties: NastyKind[];
}

/** A single decision: the offense play, defense play, and an optional armed nasty. */
export interface CoachDecision {
  offensePlayId: string;
  defensePlayId: string;
  /** Nasty to arm this snap (before the AI snaps); null when it holds its powder. */
  nasty: NastyKind | null;
  /** Human-readable reason, useful for banner/telemetry and tests. */
  reason: string;
}

/** Goal-line: within 3 horizontal yards of the end zone (los >= 97). */
const GOAL_LINE_LOS = 97;
/** Short yardage: a down-and-distance where a brute run is the safe call. */
const SHORT_YARDS = 3;
/** Long yardage overrides the run/pass mix in favour of a deep route. */
const LONG_YARDS = 7;
/** Two-minute-warning urgency threshold (seconds). */
const HURRY_UP_CLOCK = 30;
/** Field-goal comfort window in yards from the end zone (los 78..92 ≈ 8..22 yd kick). */
const FG_LOS_LOW = 78;
const FG_LOS_HIGH = 92;

const RUN_PLAYS = ['INSIDE_GORE_RUN', 'COFFIN_SWEEP', 'OPTION_PITCH', 'DRAW_OF_DOOM'] as const;
const SHORT_RUN_PLAYS = ['SPECTER_SNEAK', 'TOMBSTONE_PLUNGE'] as const;
const PUNT = 'PUNT';
const FIELD_GOAL = 'FIELD_GOAL';

function ownScore(s: CoachSituation): number {
  return s.team === 'home' ? s.score.home : s.score.away;
}
function oppScore(s: CoachSituation): number {
  return s.team === 'home' ? s.score.away : s.score.home;
}

/** Deterministic, side-agnostic pick from a list. */
function pick<T>(items: readonly T[], n: number): T {
  return items[n % items.length]!;
}

function scoreDiff(s: CoachSituation): number {
  return ownScore(s) - oppScore(s);
}
function trailingLate(s: CoachSituation): boolean {
  return scoreDiff(s) < 0 && (s.clockSeconds <= HURRY_UP_CLOCK || s.quarter >= 4);
}

/** Choose the AI's offense play for the current down/distance/yards-to-go. */
function chooseOffensePlay(s: CoachSituation): string {
  const { down, yardsToGo, los } = s;
  const diff = scoreDiff(s);

  // 4th down: always punt or kick — never "go for it" for the base AI.
  if (down >= 4) {
    return los >= FG_LOS_LOW && los <= FG_LOS_HIGH ? FIELD_GOAL : PUNT;
  }

  // Goal line: brute force plunge/sneak.
  if (los >= GOAL_LINE_LOS) {
    return pick(SHORT_RUN_PLAYS, down + yardsToGo);
  }

  // Short yardage prefers a run unless the AI is trailing late and must air it out.
  if (yardsToGo <= SHORT_YARDS) {
    return trailingLate(s) ? 'QUICK_SLANTS' : pick(SHORT_RUN_PLAYS, down);
  }

  // Long yardage pushes the passing game.
  if (yardsToGo >= LONG_YARDS) {
    if (trailingLate(s) || diff < -7) return 'DEEP_CROSS';
    return 'POST_CORNER';
  }

  // Mid yardage: mix run/pass with a slight trailing bias toward passes.
  const usePass = (down + yardsToGo) % 2 === 0;
  if (usePass) return diff < 0 ? 'QUICK_SLANTS' : 'SCREEN_TRAP';
  return pick(RUN_PLAYS, down + los);
}

/** Choose a defense that reacts to whether a run or pass is likely incoming. */
function guessOffenseKind(s: CoachSituation): 'RUN' | 'PASS' {
  if (s.los >= GOAL_LINE_LOS || s.yardsToGo <= SHORT_YARDS) return 'RUN';
  if (s.yardsToGo >= LONG_YARDS) return 'PASS';
  return (s.down + s.yardsToGo) % 2 === 0 ? 'PASS' : 'RUN';
}
function chooseDefensePlay(s: CoachSituation, guessedRun: boolean): string {
  if (s.down >= 4) return 'BLOCK_PARTY'; // special teams block unit
  if (s.los >= GOAL_LINE_LOS) return 'GOAL_LINE_STUFF';
  if (guessedRun) {
    return s.yardsToGo <= SHORT_YARDS ? 'GOAL_LINE_STUFF' : 'RUN_STUFF_STAKE';
  }
  return s.yardsToGo >= LONG_YARDS ? 'PREVENT_SHROUD' : 'COFFIN_COVER_3';
}

/**
 * Decide which Nasty Audible to arm (if any) using the same once-per-half charge
 * rules the human faces. Reactions, in priority order:
 *   1. Demon Ref in play → no ref nasties possible.
 *   2. Opponent bribed the Necro-Ref against the AI → KILL_REF (hunt it down).
 *   3. 3rd & long → PUMPKIN_BOMB_PASS on a pass, else DYNAMITE_PITCH on a run.
 *   4. Late/trailing, offense → BAT_WING_JET_BOOST to break one open.
 *   5. Goal line, offense → GHOUL_GAS to clear a path.
 *   6. On defense, counter a likely pass → PHANTOM_SHROUD / HEX_OF_CONFUSION.
 *   7. Tight game late → BRIBE_REF for a corrupt edge.
 */
function chooseNasty(s: CoachSituation, offenseIsRun: boolean): NastyKind | null {
  const can = (k: NastyKind): boolean => s.availableNasties.includes(k);

  if (!s.demonRefActive) {
    if (s.refBribedAgainst && can('KILL_REF')) return 'KILL_REF';
  }

  if (s.aiIsOffense) {
    if (s.down >= 3 && s.yardsToGo >= LONG_YARDS && !offenseIsRun && can('PUMPKIN_BOMB_PASS')) {
      return 'PUMPKIN_BOMB_PASS';
    }
    if (s.down >= 3 && offenseIsRun && can('DYNAMITE_PITCH') && s.los < GOAL_LINE_LOS) {
      return 'DYNAMITE_PITCH';
    }
    if (trailingLate(s) && offenseIsRun && can('BAT_WING_JET_BOOST')) {
      return 'BAT_WING_JET_BOOST';
    }
    if (s.los >= GOAL_LINE_LOS && can('GHOUL_GAS')) return 'GHOUL_GAS';
  } else {
    // Defending AI counters the opponent's likely play.
    if (!offenseIsRun && can('PHANTOM_SHROUD')) return 'PHANTOM_SHROUD';
    if (!offenseIsRun && can('HEX_OF_CONFUSION')) return 'HEX_OF_CONFUSION';
    if (offenseIsRun && can('QB_CRYPT_BLITZ')) return 'QB_CRYPT_BLITZ';
  }

  // Late tight-game corrupt edge: bribe to manufacture a flag against the foe.
  if (
    !s.demonRefActive &&
    !s.refBribedAgainst &&
    can('BRIBE_REF') &&
    s.quarter >= 3 &&
    scoreDiff(s) <= 0
  ) {
    return 'BRIBE_REF';
  }

  return null;
}

/**
 * Produce a full AI play-call for the current situation. The returned decision is
 * what the scene then feeds to `session.selectPlays(...)` (+ `callNasty(...)`).
 */
export function decideCoachPlay(s: CoachSituation): CoachDecision {
  const offensePlayId = s.aiIsOffense
    ? chooseOffensePlay(s)
    : // When the AI defends, the *offense* play is the opponent's; the AI chooses
      // a counter based on its read of down/distance rather than a placeholder.
      'INSIDE_GORE_RUN';
  // Whether the upcoming snap is a run, from the AI's perspective:
  //  - on offense: from the play it actually called,
  //  - on defense: a situational guess (short yardage or goal line ⇒ likely run).
  const offKind = s.aiIsOffense ? getOffensePlay(offensePlayId).kind : guessOffenseKind(s);
  const offenseIsRun = offKind === 'RUN' || offKind === 'PUNT';
  const defensePlayId = chooseDefensePlay(s, offenseIsRun);

  const nasty = chooseNasty(s, offenseIsRun);

  const reason = [
    `down ${s.down} & ${s.yardsToGo}`,
    s.aiIsOffense ? 'on offense' : 'on defense',
    nasty ? `arms ${nasty}` : 'no nasty',
    `(${getOffensePlay(offensePlayId).name} vs ${getDefensePlay(defensePlayId).name})`,
  ].join(' ');

  return { offensePlayId, defensePlayId, nasty, reason };
}

/** Total defense plays available (AI breadth sanity check). */
export function aiPlaybookSize(): number {
  return Object.keys(OFFENSE_PLAYS).length + Object.keys(DEFENSE_PLAYS).length;
}

export { RUN_PLAYS, SHORT_RUN_PLAYS };
