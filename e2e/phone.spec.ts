import { type Page } from '@playwright/test';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { trackErrors } from './errors';
import { screenshotDir } from './screenshot-path';

/**
 * Phone acceptance for ML-NEXT scope 6: no horizontal overflow at 390px and a
 * genuine pick → snap → whistle driven only by real taps on the on-screen pad.
 * `window.__mlf` is read for assertions only — never used to call play(), snap(),
 * throwTo() or otherwise mutate the game.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Read-only snapshot; cast locally to avoid colliding with other specs' global Window augmentation. */
const state = (page: Page): Promise<{ mode: string; phase: string; down: number }> =>
  page.evaluate(() => {
    const h = (window as unknown as { __mlf?: { mode?: string; phase?: string; down?: number } })
      .__mlf;
    return { mode: h?.mode ?? '', phase: h?.phase ?? '', down: h?.down ?? 1 };
  });

async function noOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `document scrollWidth at 390px viewport`).toBeLessThanOrEqual(390);
}

async function tapControl(page: Page, control: string): Promise<void> {
  const button = page.getByTestId(`touch-${control}`);
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box, `touch-${control} hit target`).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await button.tap();
  await page.waitForTimeout(40); // one input poll after the pointer release
}

test('390px pages do not overflow horizontally', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('gsn-chrome')).toBeVisible();
  await noOverflow(page);

  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('touch-controls')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('tap-only drive: pick a play, snap and reach the whistle', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('huddle-overlay')).toBeVisible();
  await expect.poll(async () => (await state(page)).mode).toBe('PICK');

  // Committed capture: huddle + scorebug + on-screen pad at 390x844.
  await page.screenshot({ path: join(screenshotDir, 'mlnext-phone-390.png') });

  // A = call the run card. Real touch pointer events feed InputManager.setTouch,
  // exactly like the keyboard path — no __mlf writes.
  await tapControl(page, 'A');
  await expect(page.getByTestId('huddle-overlay')).toBeHidden();
  await expect.poll(async () => (await state(page)).mode).toBe('PRE_SNAP');

  // C = snap.
  await tapControl(page, 'C');
  await expect.poll(async () => (await state(page)).mode).toBe('LIVE');

  // Steer with the d-pad, then let the down conclude on its own.
  await tapControl(page, 'right');
  await expect
    .poll(async () => (await state(page)).mode, { timeout: 12_000 })
    .toMatch(/^(PICK|PRE_SNAP)$/);
  expect((await state(page)).down).toBeGreaterThanOrEqual(1);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('scorebug stacks by team and huddle/control text is not clipped', async ({ page }) => {
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('huddle-overlay')).toBeVisible();

  const layout = await page.evaluate(() => {
    const scorebug = document.querySelector('.gsn-scorebug')!;
    const teams = scorebug.querySelectorAll('.gsn-scorebug__team');
    const scores = scorebug.querySelectorAll('.gsn-scorebug__score');
    const center = scorebug.querySelector('.gsn-scorebug__center')!;
    const box = (el: Element) => el.getBoundingClientRect();
    const prompt = document.querySelector('.gsn-control-bar__prompt') as HTMLElement;
    const cards = [...document.querySelectorAll('.gsn-huddle__card')] as HTMLElement[];
    return {
      display: getComputedStyle(scorebug).display,
      homeRowDelta: Math.abs(box(teams[0]!).top - box(scores[0]!).top),
      awayRowDelta: Math.abs(box(teams[1]!).top - box(scores[1]!).top),
      centerBelowHome: box(center).top >= box(teams[0]!).bottom - 2,
      homeScoreRight: box(scores[0]!).left >= box(teams[0]!).right - 2,
      awayScoreLeft: box(scores[1]!).right <= box(teams[1]!).left + 2,
      promptClipped: prompt.scrollWidth > prompt.clientWidth + 1,
      cardClipped: cards.some((card) => card.scrollWidth > card.clientWidth + 1),
    };
  });

  expect(layout.display).toBe('grid');
  expect(layout.homeRowDelta).toBeLessThan(20);
  expect(layout.awayRowDelta).toBeLessThan(20);
  expect(layout.centerBelowHome).toBe(true);
  expect(layout.homeScoreRight).toBe(true);
  expect(layout.awayScoreLeft).toBe(true);
  expect(layout.promptClipped).toBe(false);
  expect(layout.cardClipped).toBe(false);
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false, isMobile: false });

  test('touch overlay is hidden when a pointer is available', async ({ page }) => {
    await page.goto('/football/');
    await expect(page.locator('#game canvas')).toBeVisible();
    await expect(page.getByTestId('touch-controls')).toBeHidden();
  });
});
