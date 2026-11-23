import { describe, expect, it } from 'vitest';
import { InputManager, digitalDirection, normalizeDirection } from './InputManager';

describe('InputManager', () => {
  it('maps P1 WASD/JKL and P2 arrows/ZXC independently', () => {
    const im = new InputManager();
    im.setKey('KeyD', true);
    im.setKey('KeyJ', true);
    im.setKey('ArrowUp', true);
    im.setKey('KeyC', true);
    const p1 = im.poll(0);
    const p2 = im.poll(1);
    expect(p1.x).toBe(1);
    expect(p1.buttons.A).toBe(true);
    expect(p1.buttons.C).toBe(false);
    expect(p2.y).toBe(-1);
    expect(p2.buttons.C).toBe(true);
  });

  it('normalises diagonals and applies deadzone', () => {
    const d = digitalDirection(true, false, false, true);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(normalizeDirection(0.1, 0.1)).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(...Object.values(normalizeDirection(3, 4)))).toBeCloseTo(1);
  });

  it('supports touch buttons and DOM key events', () => {
    const im = new InputManager();
    im.attach(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' }));
    expect(im.poll(0).buttons.B).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyK' }));
    expect(im.poll(0).buttons.B).toBe(false);
    im.setTouch(0, 'START', true);
    expect(im.poll(0).buttons.START).toBe(true);
    im.detach();
  });

  it('prevents default scroll on mapped keys only', () => {
    const im = new InputManager();
    im.attach(window);
    const space = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    window.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    const other = new KeyboardEvent('keydown', { code: 'KeyQ', cancelable: true });
    window.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    im.detach();
  });

  it('does not block native activation on interactive elements', () => {
    const im = new InputManager();
    im.attach(window);
    const btn = document.createElement('button');
    const a = document.createElement('a');
    a.href = '#x';
    const canvas = document.createElement('canvas');
    document.body.append(btn, a, canvas);
    const fire = (el: Element, code: string) => {
      const ev = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    for (const code of ['Space', 'Enter']) {
      expect(fire(btn, code)).toBe(false);
      expect(fire(a, code)).toBe(false);
    }
    for (const code of ['Space', 'ArrowUp', 'ArrowDown']) {
      expect(fire(document.body, code)).toBe(true);
      expect(fire(canvas, code)).toBe(true);
    }
    btn.remove();
    a.remove();
    canvas.remove();
    im.detach();
  });

  it('indexes gamepads by slot without compacting', () => {
    const pad = { buttons: [], axes: [1, 0] } as unknown as Gamepad;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, pad],
    });
    const im = new InputManager();
    expect(im.poll(0).x).toBe(0);
    expect(im.poll(1).x).toBe(1);
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: undefined });
  });

  it('delivers an edge press exactly once (a tap between two polls)', () => {
    const im = new InputManager();
    // Key down then up before the first poll — a fast 30ms tap.
    im.setKey('KeyJ', true);
    im.setKey('KeyJ', false);
    expect(im.poll(0).pressed.A).toBe(true);
    // The latch is consumed: the next poll reports no press.
    expect(im.poll(0).pressed.A).toBe(false);
    // A held key stays held, but only edges once.
    im.setKey('KeyL', true);
    expect(im.poll(0).pressed.C).toBe(true);
    expect(im.poll(0).buttons.C).toBe(true);
    expect(im.poll(0).pressed.C).toBe(false);
  });

  it('delivers a DOM keydown press edge per poll', () => {
    const im = new InputManager();
    im.attach(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' }));
    expect(im.poll(0).pressed.B).toBe(true);
    expect(im.poll(0).pressed.B).toBe(false);
    im.detach();
  });

  it('ignores OS auto-repeat keydowns (no fresh press edge)', () => {
    const im = new InputManager();
    im.attach(window);
    // A genuine keydown latches an edge.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL' }));
    expect(im.poll(0).pressed.C).toBe(true);
    // An auto-repeat of the same held key must NOT latch a new edge.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', repeat: true }));
    expect(im.poll(0).pressed.C).toBe(false);
    // The key is still held (level state), just not freshly pressed.
    expect(im.poll(0).buttons.C).toBe(true);
    im.detach();
  });

  it('does not latch a press edge for keys typed into an editable field', () => {
    const im = new InputManager();
    im.attach(window);
    const input = document.createElement('input');
    document.body.append(input);
    const ev = new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    // No edge queued, and the native behaviour is not blocked.
    expect(im.poll(0).pressed.A).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
    input.remove();
    im.detach();
  });

  it('clears pending press edges on window blur', () => {
    const im = new InputManager();
    im.attach(window);
    // A P2 code the scene never polls for (poll(1) is unused) still latches.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
    window.dispatchEvent(new KeyboardEvent('blur'));
    // After blur the stale latch must be gone, not re-fired on a later poll.
    expect(im.poll(1).pressed.C).toBe(false);
    im.detach();
  });

  it('detects a gamepad button false→true transition as a press edge', () => {
    const btn = (pressed: boolean) => ({ pressed, touched: false, value: 0 });
    const buttons = new Array(16).fill(btn(false));
    buttons[0] = btn(true);
    const pad = { buttons, axes: [0, 0] } as unknown as Gamepad;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad],
    });
    const im = new InputManager();
    expect(im.poll(0).pressed.A).toBe(true);
    expect(im.poll(0).buttons.A).toBe(true);
    // Still held, but no longer a fresh edge.
    expect(im.poll(0).pressed.A).toBe(false);
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: undefined });
  });

  it('drives pick → snap with a mocked Gamepad (A then C press edges)', () => {
    // A mocked Gamepad whose face buttons we flip between polls. The scene maps
    // A (button 0) to the play pick and C (button 2) to the snap; here we assert
    // the InputManager delivers those as distinct, ordered press edges so a
    // gamepad-only player can drive the whole pick → snap flow.
    const btn = (pressed: boolean) => ({ pressed, touched: false, value: 0 });
    const buttons = new Array(16).fill(btn(false));
    const pad = { buttons, axes: [0, 0] } as unknown as Gamepad;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad],
    });
    const im = new InputManager();

    // Pick: press A (button 0), poll, release.
    buttons[0] = btn(true);
    const pick = im.poll(0);
    expect(pick.pressed.A).toBe(true);
    expect(pick.pressed.C).toBe(false);
    buttons[0] = btn(false);
    im.poll(0); // consume the release

    // Snap: press C (button 2), poll.
    buttons[2] = btn(true);
    const snap = im.poll(0);
    expect(snap.pressed.C).toBe(true);
    expect(snap.pressed.A).toBe(false);

    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: undefined });
  });
});
