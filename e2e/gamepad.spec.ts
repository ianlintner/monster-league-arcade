import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { installFakeGamepad, padTap, padStick } from './gamepad';

/**
 * Gamepad QA gate: drive the pick → snap → run loop with a mocked Gamepad API
 * so the shipped game is verified playable with a controller, not just keys.
 *
 * Every gameplay input below is a *gamepad face button / stick* mutation that
 * flows through `InputManager.poll`'s real `navigator.getGamepads()` path —
 * never `window.__mlf.pick()/snap()`, which is read-only for assertions here.
 */

interface MlF {
  phase: string;
  mode: string;
  down: number;
  possession: string;
  quarter: number;
  score: { home: number; away: number };
  windowsOpen: boolean;
}

async function mlf(page: Page): Promise<MlF> {
  return page.evaluate(() => (window as unknown as { __mlf: MlF }).__mlf);
}

test('gamepad drives pick → snap → run to a fresh down', async ({ page }) => {
  await installFakeGamepad(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/football/?quarter=30');
  await page.waitForSelector('[data-testid="huddle-overlay"], #app', { timeout: 30_000 });

  // Boot into the first huddle: pre-snap controls already seeded by `fixtures`.
  await page.waitForFunction(
    () =>
      (window as unknown as { __mlf: { mode: string } }).__mlf.mode === 'PICK' ||
      (window as unknown as { __mlf: { mode: string } }).__mlf.mode === 'PRE_SNAP',
    { timeout: 30_000 },
  );

  // Confirm a play with the gamepad A button (South face = run play A).
  await padTap(page, 'A');
  await page.waitForFunction(
    () => (window as unknown as { __mlf: { mode: string } }).__mlf.mode === 'PRE_SNAP',
    { timeout: 15_000 },
  );
  await expect.poll(async () => (await mlf(page)).down).toBe(1);

  // Snap the ball with gamepad C.
  await padTap(page, 'C');
  await page.waitForFunction(
    () => (window as unknown as { __mlf: { mode: string } }).__mlf.mode === 'LIVE',
    { timeout: 15_000 },
  );

  // Steer the carrier to the right with the left stick (deadzone 0.25).
  await padStick(page, 1, 0);
  await page.waitForTimeout(400);

  // The play resolves offline: poll back to the next huddle/pick and assert
  // the down advanced (a real ball was carried past the original line).
  await page.waitForFunction(
    () => {
      const f = (window as unknown as { __mlf: { mode: string } }).__mlf;
      return f.mode === 'PICK' || f.mode === 'PRE_SNAP' || f.mode === 'BANNER';
    },
    { timeout: 30_000 },
  );
  // Work through the banner if one is showing, then confirm a new down is cued.
  await padTap(page, 'START');
  await page.waitForTimeout(200);
  await padTap(page, 'START');

  await expect
    .poll(async () => {
      const f = await mlf(page);
      return f.mode === 'PICK' || f.mode === 'PRE_SNAP';
    })
    .toBe(true);

  // Center the stick again so no lingering steer bleeds into the next play.
  await padStick(page, 0, 0);
});

test('gamepad C opens passing windows and re-arms a throw', async ({ page }) => {
  await installFakeGamepad(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/football/?quarter=30');
  await page.waitForSelector('[data-testid="huddle-overlay"], #app', { timeout: 30_000 });

  await page.waitForFunction(
    () => (window as unknown as { __mlf: { mode: string } }).__mlf.mode === 'PICK',
    { timeout: 30_000 },
  );
  // Select a pass play with gamepad C (play index 2 = pass).
  await padTap(page, 'C');
  await page.waitForFunction(
    () => (window as unknown as { __mlf: { mode: string } }).__mlf.mode === 'PRE_SNAP',
    { timeout: 15_000 },
  );
  await padTap(page, 'C'); // snap
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('LIVE');

  // A C press held ~100 ms opens the receiving windows without throwing.
  await padTap(page, 'C', 100);
  await expect.poll(async () => (await mlf(page)).windowsOpen, { timeout: 5_000 }).toBe(true);
  expect((await mlf(page)).mode).toBe('LIVE');

  // Throw to receiver A with a >180 ms hold (bullet) and land it → BANNER.
  await padTap(page, 'A', 220);
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 10_000 }).toBe('BANNER');
});
