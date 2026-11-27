import type { LivePlay } from '../field/LivePlay';
import type { MatchRuntime } from './matchController';

/**
 * Human pass input: C opens receiving windows (scope: behind LOS); A/B/C throw
 * to the matching receiver while they are open. Hold length sets style.
 *
 * Extracted from `matchSim.updateLive` to keep that module under the file-size
 * ceiling; it remains pure presentation routing over the `MatchRuntime` surface.
 */
export function updateHumanPassInput(
  s: MatchRuntime,
  dt: number,
  live: LivePlay,
  commit: (t: 'A' | 'B' | 'C') => void,
): void {
  const cHeld = s.buttonHeld('C');

  // The C press that opens the windows must NOT also throw to receiver C in the
  // same press: it is consumed once. Only a *fresh* subsequent C press (its own
  // keydown) — while windows are already open — is treated as a throw to C.
  if (s.pressedBtn('C') && !s.windowsOpen && !s.windowOpenPressConsumed) {
    // Windows may only open while the QB is behind (or on) the line of scrimmage.
    const qb = live.snapshot().actors.find((a) => a.id === live.carrier.id);
    if (qb && qb.x <= 0) {
      s.windowsOpen = true;
      s.passHoldMs = 0;
      s.windowOpenPressConsumed = true;
    }
  }

  if (s.windowsOpen) {
    // A/B throw on *release*, so a held receiver button accumulates hold time.
    if (s.buttonHeld('A')) {
      if (!s.heldThrowKey) s.heldThrowKey = 'A';
    } else if (s.buttonHeld('B')) {
      if (!s.heldThrowKey) s.heldThrowKey = 'B';
    }
    const aUp = s.releasedBtn('A');
    const bUp = s.releasedBtn('B');
    const released =
      s.heldThrowKey === 'A' && aUp ? 'A' : s.heldThrowKey === 'B' && bUp ? 'B' : null;
    const cUp = s.releasedBtn('C');
    const cTarget = !s.windowOpenPressConsumed && cUp ? 'C' : null;

    // Accumulate hold time by *elapsed* time (seconds → ms), not per rendered frame.
    if (s.heldThrowKey || (cHeld && !s.windowOpenPressConsumed)) {
      s.passHoldMs += dt * 1000;
    } else if (!released && !cTarget) {
      s.passHoldMs = 0;
    }

    const target = released ?? cTarget;
    if (target) {
      commit(target);
      s.heldThrowKey = null;
    }
  } else {
    s.passHoldMs = 0;
    s.heldThrowKey = null;
  }
}
