import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { screenshotDir } from './screenshot-path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

interface HazardSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  armed: boolean;
  telegraphSeconds: number;
}

interface MlfHandle {
  phase: string;
  mode: string;
  score: { home: number; away: number };
  los: number;
  down: number;
  carrierId: string | null;
  isPassPlay: boolean;
  windowsOpen: boolean;
  playIndex: number;
  lastDamage: number;
  lastCasualties: number;
  hazards: HazardSnapshot[];
  forceCarrierTo: (x: number, y: number) => void;
}

function mlf(page: Page): Promise<MlfHandle> {
  return page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!);
}

/** Map a 0-based play card index to the real P1 key that calls it (A/B/C). */
function pickKey(index: number): string {
  return ([P1.A, P1.B, P1.C] as const)[index]!;
}

test('passing windows open, throw completes, no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Call the pass play (index 2 = Quick Slants) with a real 30 ms C (L) tap.
  await tap(page, pickKey(2));
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('PRE_SNAP');

  await tap(page, P1.C);
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('LIVE');
  await expect.poll(async () => (await mlf(page)).isPassPlay, { timeout: 5_000 }).toBe(true);

  // Open the receiving windows with a *real* C (L) key press. The same press must
  // open the windows WITHOUT also throwing to receiver C (the player then gets to
  // choose A or B) — regression for the open-vs-throw coupling in the same frame.
  await page.keyboard.down(P1.C);
  await page.waitForTimeout(100);
  await page.keyboard.up(P1.C);
  await expect.poll(async () => (await mlf(page)).windowsOpen, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(screenshotDir, 'football-passing-windows.png') });

  // After a single C press, mode is still LIVE (a throw to C would commit a pass
  // and advance to BANNER). Confirm no throw fired from the opening press.
  expect((await mlf(page)).mode).toBe('LIVE');
  expect((await mlf(page)).windowsOpen).toBe(true);

  // Throw to the A receiver with a real key press and wait for the ball to land.
  await page.keyboard.down(P1.A);
  await page.waitForTimeout(220); // hold > 180 ms → bullet; lob under that
  await page.keyboard.up(P1.A);
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 10_000 }).toBe('BANNER');
  await page.screenshot({ path: join(screenshotDir, 'football-pass.png') });

  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('carrier walks into a grave → hazard hit and casualty render', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Run play (index 0) so the carrier is on-field in the graveyard.
  await tap(page, pickKey(0));
  await tap(page, P1.C);
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('LIVE');

  // Find the first open grave and walk the carrier onto it (deterministic seed).
  const hazards = (await mlf(page)).hazards;
  const grave = hazards.find((h) => h.kind === 'OPEN_GRAVE' && h.armed);
  expect(grave).toBeTruthy();
  await page.evaluate(
    ([x, y]) => (window as unknown as { __mlf?: MlfHandle }).__mlf!.forceCarrierTo(x, y),
    [grave!.x, grave!.y] as const,
  );

  // The real hazard → damage/casualty pipeline commits at the whistle.
  await expect
    .poll(async () => (await mlf(page)).mode, { timeout: 10_000 })
    .toMatch(/^(PICK|PRE_SNAP|BANNER)$/);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(screenshotDir, 'football-hazard-hit.png') });

  const handle = await mlf(page);
  // At least one hazard hit was committed through SnapOptions.
  expect(handle.lastDamage + handle.lastCasualties).toBeGreaterThan(0);
  await page.screenshot({ path: join(screenshotDir, 'football-casualty.png') });

  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
