import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { screenshotDir } from './screenshot-path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

interface MlfHandle {
  phase: string;
  mode: string;
  score: { home: number; away: number };
  los: number;
  down: number;
  carrierId: string | null;
}

function mlf(page: Page): Promise<MlfHandle> {
  return page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!);
}

/** Map a 0-based play card index to the real P1 key that calls it (A/B/C). */
function pickKey(index: number): string {
  return ([P1.A, P1.B, P1.C] as const)[index]!;
}

test('football boots into the play-call huddle with no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  const handle = await mlf(page);
  expect(handle).toBeTruthy();
  // bootstrap reaches HUDDLE_PLAYCALL after coin toss + touchback
  expect(handle.phase).toBe('HUDDLE_PLAYCALL');
  expect(handle.mode).toBe('PICK');

  await page.waitForTimeout(300);
  expect(errors).toEqual([]);

  await page.screenshot({ path: join(screenshotDir, 'football-pick.png') });
});

test('pick → snap → live down ends and the GameSession commits the result', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Call the first run play (A) with a real 30 ms tap and confirm pre-snap.
  await tap(page, pickKey(0));
  expect((await mlf(page)).phase).toBe('PRE_SNAP');
  expect((await mlf(page)).mode).toBe('PRE_SNAP');
  // Incidental capture for this gameplay test — not the deliverable art. The
  // deliverable `football-presnap.png` is written solely by screenshots.spec.ts.
  await page.screenshot({ path: join(screenshotDir, 'football-presnap-run.png') });

  // Snap into the live down with a real 30 ms C (L) tap.
  await tap(page, P1.C);
  expect((await mlf(page)).mode).toBe('LIVE');

  // Steer the carrier downfield (P1 right = D) and let the down play out.
  await page.keyboard.down(P1.right);
  await page.waitForTimeout(1000);
  // Mid-run capture while the down is still live. Incidental to this gameplay
  // test; the deliverable `football-midrun.png` is written by screenshots.spec.ts.
  await page.screenshot({ path: join(screenshotDir, 'football-midrun-run.png') });
  await page.waitForTimeout(1500);
  await page.keyboard.up(P1.right);

  // The live down must conclude: after the whistle the field leaves LIVE and the
  // banner, settling into the next down (pre-snap or the next play call).
  await expect
    .poll(async () => (await mlf(page)).mode, { timeout: 10_000 })
    .toMatch(/^(PICK|PRE_SNAP)$/);

  const handle = await mlf(page);
  // A completed down must advance the GameSession: after a 1st-down snap the
  // session moves to down 2 (the UI snapshot shows "DOWN 2 · 13 TO GO").
  expect(handle.phase).not.toBe('PLAY_OVER_BANNER');
  expect(handle.down).toBe(2);

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await page.screenshot({ path: join(screenshotDir, 'football-post-play.png') });
});
