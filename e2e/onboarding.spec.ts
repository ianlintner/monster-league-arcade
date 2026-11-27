import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenshotDir } from './screenshot-path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

// Real keys only; `window.__mlf` is read for assertions, never to act.
test.use({ viewport: { width: 1280, height: 720 } });

const mode = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __mlf: { mode: string } }).__mlf.mode);

async function expectInViewport(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
}

const capture = async (page: Page, name: string): Promise<void> => {
  writeFileSync(join(screenshotDir, name), await page.screenshot());
};

test('first run shows the controls card; any key dismisses it; reload remembers', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  const card = page.getByTestId('controls-card');
  await expect(card).toBeVisible();
  await expectInViewport(page, 'controls-card');
  await expect(card).toContainText('score more than the Deadskins');
  await expect(card).toContainText('forfeit');
  await expect(card).toContainText('right');
  await capture(page, 'ml-pq4-first-run.png');

  // The dismissing key is swallowed: it must not also pick a play.
  await tap(page, P1.A);
  await expect(card).toBeHidden();
  expect(await mode(page)).toBe('PICK');

  await page.reload();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('onboard-prompt')).toBeVisible();
  await expect(page.getByTestId('controls-card')).toHaveCount(0);

  // `?` (Shift+/) and H reopen it.
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('controls-card')).toBeVisible();
  await expect(page.getByTestId('controls-card')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('controls-card')).toHaveCount(0);
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByTestId('controls-card')).toBeVisible();
  expect(errors).toEqual([]);
});

test('prompt stays inside the 1280x720 viewport in PICK, PRE_SNAP and LIVE', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.getByTestId('controls-card')).toBeVisible();
  await page.keyboard.press('Space'); // dismiss the first-run card
  await expect(page.getByTestId('controls-card')).toBeHidden();
  await expect.poll(() => mode(page)).toBe('PICK');

  const prompt = page.getByTestId('onboard-prompt');
  await expectInViewport(page, 'onboard-prompt');
  await expect(prompt).toContainText('Call the play');
  await capture(page, 'ml-pq4-pick-prompt.png');

  await tap(page, P1.A);
  await expect.poll(() => mode(page)).toBe('PRE_SNAP');
  await expectInViewport(page, 'onboard-prompt');
  await expect(prompt).toContainText('[C=L] Hike');

  await tap(page, P1.C);
  await expect.poll(() => mode(page)).toBe('LIVE');
  await expectInViewport(page, 'onboard-prompt');
  await expect(prompt).toContainText('WASD run');
  await page.keyboard.down(P1.right);
  await page.waitForTimeout(300);
  await capture(page, 'ml-pq4-live-prompt.png');
  await page.keyboard.up(P1.right);
  expect(errors).toEqual([]);
});

test('control-bar and prompt text list no input the scene does not handle', async ({ page }) => {
  await page.goto('/football/');
  await expect(page.getByTestId('controls-card')).toBeVisible();
  await page.keyboard.press('Space');
  await expect.poll(() => mode(page)).toBe('PICK');
  const states: string[] = [];
  const grab = async (): Promise<void> => {
    states.push(await page.locator('.gsn-control-bar__prompt').innerText());
    states.push(await page.getByTestId('onboard-prompt').innerText());
  };
  await grab();
  await tap(page, P1.A);
  await expect.poll(() => mode(page)).toBe('PRE_SNAP');
  await grab();
  await tap(page, P1.C);
  await expect.poll(() => mode(page)).toBe('LIVE');
  await grab();
  for (const text of states) {
    expect(text).not.toMatch(/audible|shift(?! defender)/i);
  }
});
