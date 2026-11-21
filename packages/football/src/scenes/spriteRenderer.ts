/**
 * spriteRenderer — pure animation selection for the atlas-backed field render.
 *
 * This module owns *which* cell of a faction sprite sheet to show for a live
 * actor, given the 60 Hz `LiveActorState`. It is Phaser-free (so it is unit
 * testable) and deliberately does not draw anything: `MatchScene` feeds a
 * resolved `{ sheet, row, col }` into a Phaser image with nearest-neighbour
 * scaling.
 *
 * Sheet layout (public/assets/atlas.json, 48x48 cells, 6 cols x 14 rows):
 *   row 0        idle_stance        (4 frames)
 *   rows 1..8    run_8dir           (8 rows, 6 frames, facing S..SW)
 *   row 9        pass_windup_throw  (4 frames; rendered as `pass_aim`/`pass_aim_throw`)
 *   row 10       dive_tackle_lunge  (3 frames)
 *   row 11       hit_stagger_knockdown (4 frames)
 *   row 12       casualty_death     (6 frames)
 *   row 13       celebration        (4 frames)
 */

import type { Faction } from '../sim/Roster';
import type { LiveActorState } from '../field/LivePlay';

/** Uppercase sim `Faction` → lowercase sheet id used by the atlas + PNG files. */
export const FACTION_SHEET: Record<Faction, string> = {
  REAPERS: 'boneyard_reapers',
  DEADSKINS: 'rotting_deadskins',
  NIGHTSTALKERS: 'transylvania_nightstalkers',
  GHOULS: 'salem_bayou_ghouls',
};

export const REF_SHEET_NECRO = 'necro_ref';
export const REF_SHEET_DEMON = 'demon_ref';

/** Animation kinds this renderer can request. */
export type ActorAnimation =
  | 'idle_stance'
  | 'run_8dir'
  | 'pass_aim'
  | 'pass_aim_throw'
  | 'dive_tackle_lunge'
  | 'hit_stagger_knockdown'
  | 'casualty_death'
  | 'celebration';

/** Per-animation row + frame count, mirroring atlas.json (single source of truth). */
export const ANIMATION_SPEC: Record<ActorAnimation, { firstRow: number; frames: number }> = {
  idle_stance: { firstRow: 0, frames: 4 },
  run_8dir: { firstRow: 1, frames: 6 },
  pass_aim: { firstRow: 9, frames: 4 },
  pass_aim_throw: { firstRow: 9, frames: 4 },
  dive_tackle_lunge: { firstRow: 10, frames: 3 },
  hit_stagger_knockdown: { firstRow: 11, frames: 4 },
  casualty_death: { firstRow: 12, frames: 6 },
  celebration: { firstRow: 13, frames: 4 },
};

/** run_8dir facing order (row offset 0..7 within the 8-row block), matching atlas. */
export const RUN_DIR_ORDER = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type RunDir = (typeof RUN_DIR_ORDER)[number];

export const SPRITE_CELL = 48;
export const SPRITE_COLS = 6;
export const SPRITE_ROWS = 14;
/** Full faction/ref sheet dimensions in pixels (6×14 cells of 48px). */
export const SHEET_WIDTH = SPRITE_CELL * SPRITE_COLS;
export const SHEET_HEIGHT = SPRITE_CELL * SPRITE_ROWS;

/** Resolved cell: which row/col of which sheet to draw. */
export interface SpriteCell {
  sheet: string;
  row: number;
  col: number;
  animation: ActorAnimation;
  /** True when this is a run frame advanced by distance (frame index drives playback). */
  facing?: RunDir;
}

/**
 * Presentation-only terminal status layered over `LiveActorState` by the scene.
 * `LivePlay` never sets `downed` on a tackle and has no death/casualty flag, so
 * the resolver needs the scene to hand it what actually became of each actor.
 * Death outranks knockdown; both outrank any movement-derived animation.
 */
export interface ActorPresentationState {
  /** Tackled this down (knockdown) — set from the scene's tackle/casualty events. */
  downed?: boolean;
  /** Casualty of the play (death animation) — terminal over `downed`. */
  dead?: boolean;
  /** Celebrating (TD scorer / winner) — terminal over movement animations. */
  celebrating?: boolean;
}

/**
 * 8-way facing from a velocity vector. Uses screen/field orientation where
 * +x = downfield (E on the field map is positive x toward the offence goal).
 * Small velocities (below MAG_EPS) face S (toward the camera) by default.
 */
export function runFacingFromVelocity(vx: number, vy: number): RunDir {
  const MAG_EPS = 0.05;
  const mag = Math.hypot(vx, vy);
  if (mag < MAG_EPS) return 'S';
  const ang = Math.atan2(vy, vx); // screen coords: y-down, so 0 = +x (E), +90° = +y (S)
  const deg = ((ang * 180) / Math.PI + 360) % 360;
  // The atlas `dirIdx` for each screen compass direction (see generate-art.mjs
  // DIRS): the sheet draws S at index 0, then wraps counter-clockwise around
  // the facing wheel (S,SE,E,NE,N,NW,W,SW) — which, in screen coords, runs
  // E→NE→N→NW→W→SW→S→SE. Map the 45° sector explicitly to the `RUN_DIR_ORDER`
  // index so atlas rows and velocity never desync.
  const DIR_IDX: Record<number, number> = {
    0: 2, // E
    45: 1, // SE
    90: 0, // S
    135: 7, // SW
    180: 6, // W
    225: 5, // NW
    270: 4, // N
    315: 3, // NE
  };
  const sector = Math.round(deg / 45) % 8;
  const oct = DIR_IDX[sector * 45] ?? 0;
  return RUN_DIR_ORDER[oct] ?? 'S';
}

/**
 * The base animation for an actor, ignoring run-frame playback. Presentation
 * terminal status (`dead`/`downed`/`celebrating`) takes priority, then dive,
 * pass aiming, idle and run are chosen from live state.
 *
 * `passing` is `'aim'` while the QB is choosing a target (cocked, ball still in
 * hand) and `'throw'` for the release frames that follow a launched pass.
 */
export function baseAnimation(
  state: LiveActorState,
  passing: 'aim' | 'throw' | null = null,
  presentation: ActorPresentationState = {},
): ActorAnimation {
  if (presentation.dead) return 'casualty_death';
  if (presentation.downed || state.downed) return 'hit_stagger_knockdown';
  if (presentation.celebrating) return 'celebration';
  if (state.diving) return 'dive_tackle_lunge';
  if (passing === 'throw') return 'pass_aim_throw';
  if (passing === 'aim') return 'pass_aim';
  if (state.engaged && Math.hypot(state.vx, state.vy) < 0.3) return 'idle_stance';
  // Running vs idle: a moving actor runs; a stationary one idles.
  if (Math.hypot(state.vx, state.vy) < 0.15) return 'idle_stance';
  return 'run_8dir';
}

/**
 * Advance a run animation frame by distance travelled so feet do not slide.
 * Returns a frame index 0..frames-1 derived from the accumulated distance.
 * `carry` is the caller's accumulated metres; one full cycle = `strideLength`
 * yards of travel (independent of framerate).
 */
export function runFrameIndex(distanceAccum: number, strideLength = 1.6): number {
  const cycles = distanceAccum / strideLength;
  const frac = cycles - Math.floor(cycles);
  return Math.floor(frac * ANIMATION_SPEC.run_8dir.frames) % ANIMATION_SPEC.run_8dir.frames;
}

/**
 * Resolve the exact cell to draw for a live actor. `frameAccum` is the actor's
 * distance travelled (used only for run playback); `timeAccum` seconds since the
 * actor's *current animation* began (so a freshly started dive/throw/knockdown
 * starts on frame 0, not an arbitrary mid-animation frame); `passingQB` flags
 * the QB mid-windup; `presentation` carries scene-side terminal state.
 */
export function resolveActorCell(
  state: LiveActorState,
  sheet: string,
  frameAccum: number,
  timeAccum: number,
  passing: 'aim' | 'throw' | null = null,
  presentation: ActorPresentationState = {},
): SpriteCell {
  const anim = baseAnimation(state, passing, presentation);
  if (anim === 'run_8dir') {
    const facing = runFacingFromVelocity(state.vx, state.vy);
    const row = ANIMATION_SPEC.run_8dir.firstRow + RUN_DIR_ORDER.indexOf(facing);
    return {
      sheet,
      row,
      col: runFrameIndex(frameAccum),
      animation: 'run_8dir',
      facing,
    };
  }
  const spec = ANIMATION_SPEC[anim];
  // One-shot/looping non-run frames tick on time; cycle idle/celebration, hold
  // terminal frames on the last cell. A dive is also one-shot: LivePlay's dive
  // lasts 0.4 s but 3 frames at 8 fps wrap in 0.375 s, so clamping to the last
  // frame (like the terminal animations) keeps the lunge from snapping back to
  // its starting pose before it completes.
  //
  // `pass_aim` is a *cocked aim*: hold the QB's wind-up frame (frame 1, the arm
  // drawn back) while the player chooses a target — it must NOT cycle into the
  // release pose every 0.5 s without a throw. `pass_aim_throw` is the one-shot
  // release that follows `commitPass()`. The airborne ball launches the instant
  // commitPass fires (the carried ball switches to the in-flight overlay), so the
  // QB must skip the three wind-up frames that still bake a *held* ball into the
  // artwork (row 9 cols 0–2, `hold: f < 3` in generate-art.mjs). Jump straight to
  // col 3 — the release pose with no ball drawn — and hold it, so the QB never
  // shows a second football beside the one already flying.
  const fps = 8;
  const frame = Math.floor(timeAccum * fps);
  let col: number;
  if (anim === 'pass_aim') col = 1;
  else if (anim === 'pass_aim_throw') col = spec.frames - 1;
  else if (
    anim === 'casualty_death' ||
    anim === 'hit_stagger_knockdown' ||
    anim === 'dive_tackle_lunge'
  )
    col = Math.min(frame, spec.frames - 1);
  else col = frame % spec.frames;
  return { sheet, row: spec.firstRow, col, animation: anim };
}

/** Faction id → home or away sheet path (`.png` files under sprites/). */
export function sheetKey(sheet: string, away: boolean): string {
  return away ? `${sheet}-away` : sheet;
}
