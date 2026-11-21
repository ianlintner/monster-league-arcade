import { expect, test, type Page } from '@playwright/test';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

interface MlfHandle {
  phase: string;
  mode: string;
  score: { home: number; away: number };
  los: number;
  down: number;
  carrierId: string | null;
  pick: (i: number) => void;
  snap: () => void;
}

function mlf(page: Page): Promise<MlfHandle> {
  return page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!);
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
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);

  await page.screenshot({ path: 'docs/screenshots/football-pick.png' });
});

test('pick → snap → live down ends and the GameSession commits the result', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Call the first run play (A) and confirm we reach pre-snap.
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.pick(0));
  expect((await mlf(page)).phase).toBe('PRE_SNAP');
  expect((await mlf(page)).mode).toBe('PRE_SNAP');
  // Incidental capture for this gameplay test — not the deliverable art. The
  // deliverable `football-presnap.png` is written solely by screenshots.spec.ts.
  await page.screenshot({ path: 'docs/screenshots/football-presnap-run.png' });

  // Snap into the live down.
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.snap());
  expect((await mlf(page)).mode).toBe('LIVE');

  // Steer the carrier downfield and let the down play out.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1000);
  // Mid-run capture while the down is still live. Incidental to this gameplay
  // test; the deliverable `football-midrun.png` is written by screenshots.spec.ts.
  await page.screenshot({ path: 'docs/screenshots/football-midrun-run.png' });
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowRight');

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
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);
  await page.screenshot({ path: 'docs/screenshots/football-post-play.png' });
});
