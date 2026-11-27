import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenshotDir } from './screenshot-path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

// Real keys / real clicks only; `window.__mlf` is read for assertions, never to act.
test.use({ viewport: { width: 1280, height: 720 } });

type Mlf = { audio: () => { muted: boolean; unlocked: boolean } };
const audioState = (page: Page): Promise<{ muted: boolean; unlocked: boolean }> =>
  page.evaluate(() => (window as unknown as { __mlf: Mlf }).__mlf.audio());
const contexts = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __ctxCount: number }).__ctxCount);

test.beforeEach(async ({ page }) => {
  // Count AudioContext constructions (the autoplay-policy evidence).
  await page.addInitScript(() => {
    const w = window as unknown as { __ctxCount: number; AudioContext: typeof AudioContext };
    w.__ctxCount = 0;
    const Real = w.AudioContext;
    w.AudioContext = class extends Real {
      constructor(opts?: AudioContextOptions) {
        super(opts);
        w.__ctxCount += 1;
      }
    };
  });
});

test('no AudioContext before a gesture; first real key creates exactly one', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('controls-card')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await contexts(page)).toBe(0);
  expect((await audioState(page)).unlocked).toBe(false);

  // The first key also dismisses the controls card; it must still unlock audio.
  await tap(page, P1.A);
  await expect.poll(() => contexts(page)).toBe(1);
  await expect.poll(async () => (await audioState(page)).unlocked).toBe(true);

  await tap(page, P1.A); // more keys never create a second context
  expect(await contexts(page)).toBe(1);
  expect(errors).toEqual([]);
});

test('mute button and M both toggle; state and aria-pressed survive reload', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  const btn = page.getByTestId('mute-toggle');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect((await audioState(page)).muted).toBe(false);

  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect((await audioState(page)).muted).toBe(true);

  await page.keyboard.press('KeyM'); // dismisses the first-run card (swallowed) ...
  await expect(page.getByTestId('controls-card')).toHaveCount(0);
  expect((await audioState(page)).muted).toBe(true);
  await page.keyboard.press('KeyM'); // ... then M toggles
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect((await audioState(page)).muted).toBe(false);

  await page.keyboard.press('KeyM');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect((await audioState(page)).muted).toBe(true);

  await page.reload();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('mute-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await audioState(page)).muted).toBe(true);

  writeFileSync(join(screenshotDir, 'ml-audio-muted.png'), await page.screenshot());
  expect(errors).toEqual([]);
});

test('M typed while a control is focused is not a mute toggle', async ({ page }) => {
  await page.goto('/football/');
  await tap(page, P1.A); // dismiss card
  await page.getByTestId('back-hub').focus();
  await page.keyboard.press('KeyM');
  expect((await audioState(page)).muted).toBe(false);
});
