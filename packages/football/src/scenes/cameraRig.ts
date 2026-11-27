/**
 * cameraRig — pure presentation-camera state stepping + focus clamping.
 *
 * Extracted from `MatchScene.updateCamera`: the camera frames a ~37-yard window
 * around the ball and zooms out smoothly for deep passes and kicks. This module
 * owns the *math* (focus target, smooth-lerp, arena clamp) as pure functions
 * with no Phaser imports, so it unit-tests without booting the game. The scene
 * keeps the two-line `cam.setZoom` / `cam.centerOn` side-effect around the
 * return value.
 */
import { projectToScreen } from '@monster-league/shared-core';
import { projectActor } from '../field/fieldMapper';

export const CAMERA_CANVAS_WIDTH = 640;
export const CAMERA_CANVAS_HEIGHT = 360;

/** Current presentation camera state. `x`/`y` are the world-space focus point
 *  (screen space, pre-zoom); `zoom` is the render zoom. */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** Per-frame inputs needed to pick the next focus/zoom. The carrier position is
 *  in live (yard) space and re-projected with the LOS, exactly as the scene did. */
export interface CameraInput {
  dt: number;
  ballFlight: { fromX: number; fromY: number; toX: number; toY: number } | null;
  carrier: { x: number; y: number } | null;
  los: number;
  isPassPlay: boolean;
}

export const INITIAL_CAMERA: CameraState = {
  x: CAMERA_CANVAS_WIDTH / 2,
  y: -20,
  zoom: 2.2,
};

/**
 * Advance the camera focus and zoom by one frame. Picks a target (ball-flight
 * midpoint while airborne, the carrier otherwise, defaulting to a centred view),
 * smooth-lerps toward it, and returns the next *unclamped* state. The arena
 * edge clamp is applied separately at the `centerOn` call site (see
 * `clampFocus`) because the lerped `x`/`y` must keep accumulating toward the
 * target rather than snapping back to the clamped centre.
 */
export function stepCamera(prev: CameraState, input: CameraInput): CameraState {
  let tx = CAMERA_CANVAS_WIDTH / 2;
  let ty = CAMERA_CANVAS_HEIGHT * 0.45;
  let targetZoom = 2.2;

  // Focus on the ball: the carrier in huddle/pre-snap/live, the flight-path
  // midpoint while airborne, or the LOS otherwise.
  if (input.ballFlight) {
    const from = projectToScreen(input.ballFlight.fromX, input.ballFlight.fromY);
    const to = projectToScreen(input.ballFlight.toX, input.ballFlight.toY);
    tx = (from.x + to.x) / 2;
    ty = (from.y + to.y) / 2 - 24;
    targetZoom = 1.35; // wide enough to keep both the QB and the target visible
  } else if (input.carrier) {
    const f = projectActor(input.carrier.x, input.carrier.y, input.los);
    const s = projectToScreen(f.x, f.y);
    tx = s.x;
    ty = s.y - 6;
    // Deep pass: the QB drops back and throws; widen the window pre-throw.
    targetZoom = input.isPassPlay ? 1.6 : 2.2;
  }

  // Smooth-lerp the focus and zoom so the camera glides rather than snaps.
  const k = 1 - Math.exp(-input.dt * 6);
  return {
    x: prev.x + (tx - prev.x) * k,
    y: prev.y + (ty - prev.y) * k,
    zoom: prev.zoom + (targetZoom - prev.zoom) * (1 - Math.exp(-input.dt * 3)),
  };
}

/** Screen-space centre (already zoom-adjusted) the camera should focus on,
 *  i.e. the raw `centerOn` coords. Derived from the lerped state after the
 *  arena edge-clamp so the viewport never pans onto the VOID_BLACK surround. */
export function clampFocus(state: CameraState): { x: number; y: number } {
  // At zoom > 1 the visible world area shrinks, so the centre must stay inset
  // by half the visible width/height to keep the viewport on turf. Zoom < 1
  // (never used) or a viewport wider/taller than the arena is guarded below.
  const halfW = CAMERA_CANVAS_WIDTH / (2 * state.zoom);
  const halfH = CAMERA_CANVAS_HEIGHT / (2 * state.zoom);
  if (2 * halfW >= CAMERA_CANVAS_WIDTH) {
    return {
      x: CAMERA_CANVAS_WIDTH / 2,
      y: Math.max(0, Math.min(CAMERA_CANVAS_HEIGHT, state.y)),
    };
  }
  if (2 * halfH >= CAMERA_CANVAS_HEIGHT) {
    return { x: state.x, y: CAMERA_CANVAS_HEIGHT / 2 };
  }
  return {
    x: Math.max(halfW, Math.min(CAMERA_CANVAS_WIDTH - halfW, state.x)),
    y: Math.max(halfH, Math.min(CAMERA_CANVAS_HEIGHT - halfH, state.y)),
  };
}
