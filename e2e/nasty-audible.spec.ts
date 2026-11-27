import { type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { trackErrors } from './errors';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

/**
 * Nasty audibles by real input: huddle L (Quick Slants, a pass) → pre-snap J→L→J calls
 * Pumpkin Bomb Pass; repeating the combo in the same half is refused; a bare L still
 * hikes. Every action is a REAL key press; `window.__mlf` is only READ.
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(120_000);

interface Mlf {
  mode: string;
  session: {
    effects: { active: string[] };
    charges: { remaining(team: string, half: number): string[] };
    half: number;
  } | null;
}

const mode = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __mlf: Mlf }).__mlf.mode);
const active = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __mlf: Mlf }).__mlf.session!.effects.active);
const chargeCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const s = (window as unknown as { __mlf: Mlf }).__mlf.session!;
    return s.charges.remaining('home', s.half).length;
  });

/** Space real presses past the InputManager's ~50 ms edge poll. */
async function combo(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await tap(page, k);
    await page.waitForTimeout(120);
  }
}

test('J→L→J calls Pumpkin Bomb Pass once per half; bare L still hikes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=180');
  await expect.poll(() => mode(page)).toBe('PICK');

  await tap(page, P1.C); // Quick Slants (pass)
  await expect.poll(() => mode(page)).toBe('PRE_SNAP');
  await expect(page.locator('.gsn-control-bar__prompt')).toContainText('[A=J] Audible');
  await expect(page.getByTestId('nasty-presnap-drawer')).toBeVisible();
  const before = await chargeCount(page);
  expect(await active(page)).toEqual([]);

  await combo(page, P1.A, P1.C, P1.A);
  await expect.poll(() => active(page)).toContain('PUMPKIN_BOMB_PASS');
  expect(await mode(page)).toBe('PRE_SNAP'); // C inside the menu did not hike
  expect(await chargeCount(page)).toBe(before - 1);
  const callout = page.getByTestId('nasty-callout');
  await expect(callout).toContainText('PUMPKIN BOMB PASS');
  await expect(page.getByTestId('nasty-presnap-drawer')).toContainText('USED');
  writeFileSync(join(screenshotDir, 'mlnext-nasty.png'), await page.screenshot());

  await page.waitForTimeout(2000); // callout expires
  await combo(page, P1.A, P1.C, P1.A);
  await expect(callout).toContainText('REFUSED');
  await expect(callout).toContainText('ALREADY USED');
  expect(await chargeCount(page)).toBe(before - 1);
  expect(await mode(page)).toBe('PRE_SNAP');

  await page.waitForTimeout(1800); // menu state is IDLE again; a bare L hikes
  await tap(page, P1.C);
  await expect.poll(() => mode(page)).toBe('LIVE');
  expect(errors).toEqual([]);
});
