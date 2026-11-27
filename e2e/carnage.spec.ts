/**
 * Carnage readability acceptance (card t_41f52bb0).
 *
 * The forfeit-warning scenario is set up with the construction-time
 * `?casualties=<n>` seam (capped below the forfeit limit). Every interaction
 * below uses real keyboard events; `window.__mlf` is read-only for assertions
 * and never used to mutate the session or steer a player.
 */
import { expect, test } from './fixtures';
import { join } from 'node:path';
import { screenshotDir } from './screenshot-path';
import { tap } from './keys';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

interface Hazard {
  id: string;
  kind: string;
  armed: boolean;
}
interface Mlf {
  mode: string;
  hazards: Hazard[];
}
const mlf = (page: Page): Promise<Mlf> =>
  page.evaluate(() => (window as unknown as { __mlf?: Mlf }).__mlf!);

test('forfeit warning appears at three casualties, not at two', async ({ page }) => {
  const open = async (casualties: number) => {
    await page.goto(`/football/?quarter=120&casualties=${casualties}`);
    await expect(page.getByTestId('scorebug')).toBeVisible();
    await expect(page.locator('#game canvas')).toBeVisible();
    await page.waitForFunction(() => Boolean((window as { __mlf?: unknown }).__mlf), undefined, {
      timeout: 10_000,
    });
  };

  await open(2);
  const row = page.getByTestId('skulls-home');
  await expect(row).not.toHaveAttribute('data-warning', 'forfeit');
  await expect(row.locator('.gsn-skulls__warning')).toBeHidden();
  await expect(row).toHaveAttribute('aria-label', /2 casualties/);

  await open(3);
  await expect(row).toHaveAttribute('data-warning', 'forfeit');
  await expect(row.locator('.gsn-skulls__warning')).toBeVisible();
  await expect(row.locator('.gsn-skulls__warning')).toHaveText('1 MORE = FORFEIT');
  await expect(row).toHaveAttribute('aria-label', /1 more = forfeit/i);
  await page.screenshot({ path: join(screenshotDir, 'mlnext-forfeit-warning.png') });
});

test('graveyard hazards render armed sprites during live play', async ({ page }) => {
  await page.goto('/football/?quarter=120');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as { __mlf?: unknown }).__mlf), undefined, {
    timeout: 10_000,
  });
  // Real keys only: pick play A, then snap with C.
  await tap(page, 'KeyJ');
  await tap(page, 'KeyL');
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 10_000 }).toBe('LIVE');
  // Read-only observation: wait until at least one graveyard hazard is armed.
  await expect
    .poll(
      async () =>
        (await mlf(page)).hazards.some(
          (h) => h.armed && (h.kind === 'OPEN_GRAVE' || h.kind === 'TOMBSTONE'),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.screenshot({ path: join(screenshotDir, 'mlnext-hazards-after.png') });
});
