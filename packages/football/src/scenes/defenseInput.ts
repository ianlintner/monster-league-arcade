/**
 * defenseInput — human defense while the CPU has the ball. P1 steers one
 * "controlled" defender (WASD / left stick), `B` hands control to the defender
 * nearest the ball carrier, `A` is a committed dive tackle. The sim side lives
 * in `LivePlay` (steer / dive / recovery); this module only maps scene input
 * onto it and keeps the `highlightDefender` index the presenter rings.
 */
import type { LivePlay } from '../field/LivePlay';
import type { MatchRuntime } from './matchController';

const defendersOf = (live: LivePlay) => live.actors.filter((a) => a.side === 'DEFENSE');

/** Index (into the defender list) of the defender nearest `x,y`, skipping `skipIdx`. */
export function nearestDefenderIndex(live: LivePlay, x: number, y: number, skipIdx = -1): number {
  let best = -1;
  let bestD = Infinity;
  defendersOf(live).forEach((d, i) => {
    if (i === skipIdx || d.downed) return;
    const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  });
  return best;
}

/** Take control of defender `idx` (or release with -1) and mirror it on the scene. */
export function controlDefender(s: MatchRuntime, live: LivePlay, idx: number): void {
  s.highlightDefender = idx;
  live.setControlledDefender(idx >= 0 ? (defendersOf(live)[idx]?.id ?? null) : null);
}

/** At the snap of a CPU-offense down: control the defender nearest the ball. */
export function assignDefaultDefender(s: MatchRuntime, live: LivePlay): void {
  controlDefender(s, live, nearestDefenderIndex(live, live.carrier.x, live.carrier.y));
}

/** The controlled defender's id, or null when the human is on offense. */
export function controlledDefenderId(s: Pick<MatchRuntime, 'live'>): string | null {
  return s.live?.controlledDefenderId ?? null;
}

/** Per-frame edge handling: B switches to nearest, A latches a dive tackle. */
export function updateDefenseButtons(s: MatchRuntime, live: LivePlay): void {
  if (s.pressedBtn('B')) {
    // Nearest defender to the carrier other than the one already controlled, so
    // a tap always changes who you steer (PLAN §3.2 "switch to nearest").
    const next = nearestDefenderIndex(live, live.carrier.x, live.carrier.y, s.highlightDefender);
    if (next >= 0) controlDefender(s, live, next);
  }
  if (s.pressedBtn('A')) live.defenderDive();
}
