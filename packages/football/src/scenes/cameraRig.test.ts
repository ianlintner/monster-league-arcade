import { describe, expect, it } from 'vitest';
import {
  INITIAL_SHAKE,
  SHAKE_STRENGTH,
  cameraShakeOffset,
  focusWithShake,
  kickShake,
  type CameraShake,
  type CameraState,
} from './cameraRig';

const fresh = (): CameraShake => ({ ...INITIAL_SHAKE });

describe('camera shake', () => {
  it('offset is zero before any hit', () => {
    expect(cameraShakeOffset(fresh(), 1 / 60, false)).toEqual({ x: 0, y: 0 });
  });

  it('a tackle produces a bounded offset that decays to an exact zero', () => {
    const shake = fresh();
    kickShake(shake, 'TACKLE');
    const first = cameraShakeOffset(shake, 1 / 60, false);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0);
    expect(Math.abs(first.x)).toBeLessThanOrEqual(SHAKE_STRENGTH.TACKLE);
    for (let i = 0; i < 30; i++) cameraShakeOffset(shake, 1 / 60, false);
    expect(cameraShakeOffset(shake, 1 / 60, false)).toEqual({ x: 0, y: 0 });
    expect(shake.amplitude).toBe(0);
  });

  it('a casualty hits harder than a tackle', () => {
    const tackle = fresh();
    const casualty = fresh();
    kickShake(tackle, 'TACKLE');
    kickShake(casualty, 'CASUALTY');
    expect(SHAKE_STRENGTH.CASUALTY).toBeGreaterThan(SHAKE_STRENGTH.TACKLE);
    expect(casualty.amplitude).toBeGreaterThan(tackle.amplitude);
  });

  it('a stronger hit supersedes a weaker one still ringing out', () => {
    const shake = fresh();
    kickShake(shake, 'TACKLE');
    kickShake(shake, 'CASUALTY');
    expect(shake.amplitude).toBe(SHAKE_STRENGTH.CASUALTY);
  });

  it('reduced motion yields no offset and clears the pending shake', () => {
    const shake = fresh();
    kickShake(shake, 'CASUALTY');
    expect(cameraShakeOffset(shake, 1 / 60, true)).toEqual({ x: 0, y: 0 });
    expect(shake.amplitude).toBe(0);
    expect(cameraShakeOffset(shake, 1 / 60, false)).toEqual({ x: 0, y: 0 });
  });
});

describe('shaken camera focus', () => {
  it('clamps after adding shake so an edge impact cannot reveal the surround', () => {
    const zoom = 2.2;
    const halfW = 640 / (2 * zoom);
    const atLeftEdge: CameraState = { x: halfW, y: 180, zoom };

    expect(focusWithShake(atLeftEdge, { x: -20, y: 12 })).toEqual({ x: halfW, y: 192 });
    expect(focusWithShake({ x: 320, y: 180, zoom }, { x: 5, y: -7 })).toEqual({
      x: 325,
      y: 173,
    });
  });
});
