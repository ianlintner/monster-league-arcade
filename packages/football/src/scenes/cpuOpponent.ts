/**
 * cpuOpponent — the CPU away-team offense adapter for the live match scene.
 *
 * The playability audit found no opponent (PLAYABLE.md gap G1): the human picked
 * the play for BOTH teams and steered whoever carried the ball, so a real session
 * ended in score ping-pong with no stakes. This module closes that gap by wiring
 * the existing `AICoach.decideCoachPlay` decision engine into the same
 * `GameSession.selectPlays` / `commitPass` path the human offense uses, so the CPU
 * can never cheat the rules engine.
 *
 * Pure TypeScript, no Phaser. The scene drives the mode state machine; this module
 * only answers three questions:
 *   1. Is the CPU on offense right now?
 *   2. What offense play should the CPU call (and what situation feeds the coach)?
 *   3. On a CPU pass, which receiver window is most open (best-scored)?
 *
 * Scope guard (card `t_076ffea6`): the human side's defense stays `DEFAULT_DEFENSE`,
 * and no Nasty Audible is ever armed by the CPU here — those are ML-NEXT.
 */
import type { GameSession } from '../sim/index';
import { getOffensePlay } from '../sim/index';
import { decideCoachPlay, type CoachDecision, type CoachSituation } from '../ai/AICoach';
import { resolvePass, buildFlight } from '../field/Ballistics';
import type { DeflectorSpec } from '../field/Ballistics';
import type { LivePlay } from '../field/LivePlay';

/** The team the human (P1) controls; the CPU controls the other side. */
export const HUMAN_TEAM = 'home' as const;
export const CPU_TEAM = 'away' as const;

/** True when the CPU owns the current snap (away has the ball). */
export function cpuOnOffense(session: GameSession): boolean {
  return session.possession === CPU_TEAM;
}

/**
 * Assemble the `CoachSituation` snapshot for the away team — the exact same
 * inputs the `__mlf.aiDecision` debug probe built, so the CPU's live play-call
 * is indistinguishable from "what the AI coach would call" in the probe.
 */
export function cpuSituation(session: GameSession): CoachSituation {
  const team = CPU_TEAM;
  return {
    down: session.down,
    yardsToGo: session.yardsToGo,
    los: session.los,
    quarter: session.quarter,
    clockSeconds: session.clock,
    score: session.score,
    team,
    aiIsOffense: true,
    ownCasualties: session.roster[team].casualties,
    refBribedAgainst: session.ref.isBribed && session.ref.bribedBy !== team,
    demonRefActive: session.ref.kind === 'DEMON_REF',
    availableNasties: session.charges.remaining(team, session.half),
  };
}

/** The CPU's offense play-call (never its nasty — that is out of scope here). */
export function cpuCallOffense(session: GameSession): CoachDecision {
  return decideCoachPlay(cpuSituation(session));
}

/**
 * Pick which receiver window (A/B/C) is most open on a CPU pass: score each
 * receiver against the current defenders with the existing `Ballistics.resolvePass`
 * and choose the least-defended. Tie-break is the target with the greatest
 * nearest-defender distance to the QB→receiver flight, then lowest letter, so the
 * choice is deterministic. This reuses the exact pass-resolution geometry the
 * human pass path uses — no new rules module.
 */
export function bestReceiver(
  live: LivePlay,
  target: (a: 'A' | 'B' | 'C') => { id: string; x: number; y: number } | undefined,
): 'A' | 'B' | 'C' {
  const qb = live.actors.find((a) => a.id === live.carrier.id);
  const defenders: DeflectorSpec[] = live.actors
    .filter((a) => a.side === 'DEFENSE')
    .map((d) => ({ id: d.id, x: d.x, y: d.y, side: d.side }));

  let best: { t: 'A' | 'B' | 'C'; kindRank: number; gap: number } | null = null;
  for (const t of ['A', 'B', 'C'] as const) {
    const receiver = target(t);
    if (!receiver) continue;
    const flight = buildFlight({
      from: { x: qb ? qb.x : receiver.x, y: qb ? qb.y : receiver.y },
      to: { x: receiver.x, y: receiver.y },
      style: 'LOB',
    });
    const resolution = resolvePass(flight, defenders);
    const kindRank =
      resolution.kind === 'CLEAN_CATCH' ? 0 : resolution.kind === 'DEFLECTION' ? 1 : 2;
    // Gap = nearest defender distance to the flight; larger is better within a tier.
    let gap = Infinity;
    for (const d of defenders) {
      const g = pointSegmentDist(d.x, d.y, flight.sx, flight.sy, flight.tx, flight.ty);
      if (g < gap) gap = g;
    }
    if (!best || kindRank < best.kindRank || (kindRank === best.kindRank && gap > best.gap)) {
      best = { t, kindRank, gap };
    }
  }
  return best ? best.t : 'A';
}

/** Nearest distance from point `p` to segment `a`→`b` (mirrors Ballistics geometry). */
function pointSegmentDist(
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
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

/** Human-readable play name for the CPU-offense huddle overlay. */
export function cpuPlayName(offensePlayId: string): string {
  return getOffensePlay(offensePlayId).name;
}

/**
 * Drive the CPU's pass-play beat inside the live fixed-step loop: open the
 * receiving windows on a short beat, then throw to the receiver the existing
 * pass-window logic scores best. Fires `commitPass` (supplied by matchSim, to
 * avoid a cycle) once the throw is ready. Returns true when a throw launched.
 */
export function cpuDrivePass(
  s: CpuPassSurface,
  dt: number,
  qbX: number,
  targetPos: (a: 'A' | 'B' | 'C') => { id: string; x: number; y: number } | undefined,
  commit: (t: 'A' | 'B' | 'C') => void,
  live: LivePlay,
): void {
  s.cpuPassClock += dt;
  if (qbX <= 0) {
    if (!s.windowsOpen && s.cpuPassClock >= 0.5) {
      s.windowsOpen = true;
      s.passHoldMs = 0;
    } else if (s.windowsOpen && s.cpuPassClock >= 0.9) {
      const target = bestReceiver(live, targetPos);
      commit(target);
    }
  } else if (s.windowsOpen) {
    // Scrambled past the LOS: abandon the pass (mirrors the human guard).
    s.windowsOpen = false;
  }
}

/** Minimal slice of MatchRuntime the CPU pass driver mutates. */
export interface CpuPassSurface {
  windowsOpen: boolean;
  passHoldMs: number;
  cpuPassClock: number;
}
