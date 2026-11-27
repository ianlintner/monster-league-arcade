/**
 * defenderControl — movement for the one human-controlled defender in
 * `LivePlay`: stick steer, the committed dive-tackle lunge and the knockdown
 * after a whiffed dive. Pure functions over `LiveActorState`; LivePlay owns the
 * latched input and the tackle resolution.
 */
import type { LiveActorState } from './LivePlay';

export interface DefenderControlTuning {
  dt: number;
  accelTimeSeconds: number;
  diveYards: number;
  diveCommitSeconds: number;
  defenderRecoverySeconds: number;
}

export interface DefenderControlInput {
  steerX: number;
  steerY: number;
  dive: boolean;
  topSpeed: number;
  /** The ball carrier's position (a neutral-stick dive lunges at it). */
  target: { x: number; y: number };
}

/**
 * Step the controlled defender one tick. Returns true when it handled the
 * movement, false (no stick, no dive) so the caller falls back to pursuit AI.
 * `onWhiff` fires when a dive ends without contact so the caller can arm the
 * recovery (knockdown) timer.
 */
export function stepControlledDefender(
  a: LiveActorState,
  inp: DefenderControlInput,
  t: DefenderControlTuning,
  onWhiff: () => void,
): boolean {
  const mag = Math.hypot(inp.steerX, inp.steerY);

  if (inp.dive && !a.diving) {
    // Committed lunge along the stick (or straight at the carrier with a neutral stick).
    const dx = mag > 0.1 ? inp.steerX : inp.target.x - a.x;
    const dy = mag > 0.1 ? inp.steerY : inp.target.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const speed = t.diveYards / t.diveCommitSeconds;
    a.diving = true;
    a.diveTimer = t.diveCommitSeconds;
    a.vx = (dx / m) * speed;
    a.vy = (dy / m) * speed;
  }
  if (a.diving) {
    a.diveTimer -= t.dt;
    a.x += a.vx * t.dt;
    a.y += a.vy * t.dt;
    if (a.diveTimer <= 0) {
      // Whiffed: he is down for a beat (cannot tackle or move) — the risk side.
      a.diving = false;
      a.vx = 0;
      a.vy = 0;
      a.downed = true;
      onWhiff();
    }
    return true;
  }
  if (mag <= 0.1) return false;
  const k = 1 - Math.exp(-t.dt / t.accelTimeSeconds);
  const scale = (Math.min(1, mag) * inp.topSpeed) / mag;
  a.vx += (inp.steerX * scale - a.vx) * k;
  a.vy += (inp.steerY * scale - a.vy) * k;
  a.x += a.vx * t.dt;
  a.y += a.vy * t.dt;
  return true;
}
