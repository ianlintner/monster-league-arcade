import type { Page } from '@playwright/test';

/**
 * Mocked Gamepad driver for `navigator.getGamepads()`.
 *
 * `InputManager.poll()` (and `AudioManager`'s unlock poll) read the real Web
 * Gamepad API through `navigator.getGamepads()`. Playwright cannot attach real
 * hardware, so this helper installs a stable fake `Gamepad` at index 0 before
 * the page scripts run, then lets a test press/release standard-mapping face
 * buttons (South=A, East=B, West=C, Start=9) by mutating their `pressed` state
 * through an in-page API. It is a *gamepad* driver — every gameplay action the
 * scene observes still arrives through `InputManager`'s real gamepad path, never
 * through `window.__mlf.pick()/snap()`.
 */

export interface FakePad {
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
  connected: boolean;
  id: string;
  index: number;
}

/** Standard-mapping indices (A=0, B=1, C=2, START=9) live inside the init script below. */
type PadButton = 'A' | 'B' | 'C' | 'START';

/** Install a fake `Gamepad` at index 0 and expose a `window.__pad` driver. */
export async function installFakeGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Serialized into the page: must not close over module-level bindings.
    const GAMEPAD_BUTTONS = { A: 0, B: 1, C: 2, START: 9 } as const;
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const pad: FakePad = {
      buttons,
      axes: [0, 0],
      connected: true,
      id: 'Mocked Gamepad (e2e)',
      index: 0,
    };
    const getGamepads = () => [pad as unknown as Gamepad, null, null, null];
    // InputManager/AudioManager read `navigator.getGamepads()` per poll.
    Object.defineProperty(window.navigator, 'getGamepads', {
      configurable: true,
      value: getGamepads,
    });
    // Deterministic driver for the test to press/release the standard buttons.
    const driver = {
      press(b: PadButton) {
        const btn = buttons[GAMEPAD_BUTTONS[b]];
        if (!btn) return;
        btn.pressed = true;
        btn.value = 1;
      },
      release(b: PadButton) {
        const btn = buttons[GAMEPAD_BUTTONS[b]];
        if (!btn) return;
        btn.pressed = false;
        btn.value = 0;
      },
      axes(x: number, y: number) {
        pad.axes[0] = x;
        pad.axes[1] = y;
      },
    };
    (window as unknown as Record<string, unknown>).__pad = driver;
    (window as unknown as Record<string, unknown>).__padAxes = driver.axes.bind(driver);
  });
}

/** Press a gamepad face button for ~30 ms so it registers as a fresh edge. */
export async function padTap(page: Page, button: PadButton, holdMs = 30): Promise<void> {
  const press = (down: 'press' | 'release'): Promise<void> =>
    page.evaluate(
      ([b, d]) => {
        const w = window as unknown as {
          __pad: { press: (x: PadButton) => void; release: (x: PadButton) => void };
        };
        w.__pad[d](b);
      },
      [button, down] as const,
    );
  await press('press');
  // Unlike keydown, a gamepad press has no edge latch: `poll()` only sees the button if it
  // is still down on a frame boundary. Hold across >=3 animation frames AND `holdMs`.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let n = 0;
        const step = (): void => (++n >= 3 ? resolve() : void requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
  );
  await page.waitForTimeout(holdMs);
  await press('release');
  // Let one frame observe the released state so the next press is a fresh edge.
  await page.waitForTimeout(40);
}

/** Hold (or release) the left stick axes (deadzone is 0.25 in InputManager). */
export async function padStick(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([ax, ay]) => {
      const w = window as unknown as { __padAxes: (x: number, y: number) => void };
      w.__padAxes(ax, ay);
    },
    [x, y] as const,
  );
}
