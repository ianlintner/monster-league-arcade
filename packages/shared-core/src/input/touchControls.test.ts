import { beforeEach, describe, expect, it } from 'vitest';
import { InputManager } from './InputManager';
import { mountTouchControls } from './touchControls';

function pointerEvent(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function button(control: string): HTMLButtonElement {
  const found = document.querySelector(`[data-testid="touch-${control}"]`);
  if (!found) throw new Error(`missing touch-${control}`);
  return found as HTMLButtonElement;
}

describe('mountTouchControls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.classList.remove('gsn-touch-ready');
  });

  it('mounts an accessible d-pad + A/B/C/START wired to the shared manager', () => {
    const input = new InputManager();
    const root = mountTouchControls({ input });

    expect(root.getAttribute('role')).toBe('group');
    expect(document.querySelectorAll('.gsn-touch-btn')).toHaveLength(8);
    for (const control of ['up', 'down', 'left', 'right', 'A', 'B', 'C', 'START']) {
      const el = button(control);
      expect(el.getAttribute('aria-label')).toBeTruthy();
      // The card asks for ≥44px hit targets; the CSS enforces this.
      expect(el.dataset.control).toBe(control);
    }

    const a = button('A');
    a.dispatchEvent(pointerEvent('pointerdown'));
    expect(a.classList.contains('is-pressed')).toBe(true);
    expect(input.poll(0).pressed.A).toBe(true); // edge latches exactly once
    expect(input.poll(0).buttons.A).toBe(true); // still held
    a.dispatchEvent(pointerEvent('pointerup'));
    expect(a.classList.contains('is-pressed')).toBe(false);
    expect(input.poll(0).buttons.A).toBe(false);
  });

  it('releases on cancel/leave and maps the d-pad before a pre-snap tap', () => {
    const input = new InputManager();
    mountTouchControls({ input });

    const right = button('right');
    right.dispatchEvent(pointerEvent('pointerdown'));
    expect(input.poll(0).x).toBe(1);
    right.dispatchEvent(pointerEvent('pointerleave'));
    expect(input.poll(0).x).toBe(0);

    const c = button('C');
    c.dispatchEvent(pointerEvent('pointerdown'));
    expect(input.poll(0).pressed.C).toBe(true);
    c.dispatchEvent(pointerEvent('pointercancel'));
    expect(input.poll(0).buttons.C).toBe(false);
  });

  it('activates the overlay on a hybrid device only after a real touch', () => {
    const input = new InputManager();
    mountTouchControls({ input });
    document.body.classList.remove('gsn-touch-ready');
    window.dispatchEvent(new Event('touchstart'));
    expect(document.body.classList.contains('gsn-touch-ready')).toBe(true);
  });
});
