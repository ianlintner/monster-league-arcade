/**
 * cameraPresenter — the Phaser-side half of the match camera.
 *
 * `cameraRig` owns the pure stepping/clamp/shake math; this module applies its
 * result to a Phaser camera. Keeping the side-effect here lets `MatchScene`
 * stay a thin coordinator and under the repository's 450-line lint ceiling.
 */
import type * as Phaser from 'phaser';
import {
  stepCamera,
  focusWithShake,
  cameraShakeOffset,
  prefersReducedMotion,
  type CameraInput,
  type CameraState,
  type CameraShake,
} from './cameraRig';

/** Advance and apply one camera frame. Returns the next tracked state; the
 *  hit-reaction offset is applied only to the centre-on point so lerp cannot
 *  accumulate shake into the follow target. */
export function presentCamera(
  cam: Phaser.Cameras.Scene2D.Camera,
  state: CameraState,
  shake: CameraShake,
  input: CameraInput,
): CameraState {
  const next = stepCamera(state, input);
  const focus = focusWithShake(next, cameraShakeOffset(shake, input.dt, prefersReducedMotion()));
  cam.setZoom(next.zoom);
  cam.centerOn(focus.x, focus.y);
  return next;
}
