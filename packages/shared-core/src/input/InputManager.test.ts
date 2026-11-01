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
});
