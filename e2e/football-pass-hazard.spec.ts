import { expect, test, type Page } from '@playwright/test';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

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
  pick: (i: number) => void;
  snap: () => void;
  openWindows: () => void;
  throwTo: (t: 'A' | 'B' | 'C') => void;
  forceCarrierTo: (x: number, y: number) => void;
}

function mlf(page: Page): Promise<MlfHandle> {
  return page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!);
}

test('passing windows open, throw completes, no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Call the pass play (index 2 = Quick Slants).
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.pick(2));
  expect((await mlf(page)).mode).toBe('PRE_SNAP');

  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.snap());
  expect((await mlf(page)).mode).toBe('LIVE');
  expect((await mlf(page)).isPassPlay).toBe(true);

  // Open the receiving windows; the [A][B][C] badges must be on.
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.openWindows());
  expect((await mlf(page)).windowsOpen).toBe(true);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/screenshots/football-passing-windows.png' });

  // Throw to the A receiver and wait for the ball to land + banner.
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.throwTo('A'));
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 10_000 }).toBe('BANNER');
  await page.screenshot({ path: 'docs/screenshots/football-pass.png' });

  await page.waitForTimeout(300);
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);
});

test('carrier walks into a grave → hazard hit and casualty render', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // Run play (index 0) so the carrier is on-field in the graveyard.
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.pick(0));
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.snap());
  expect((await mlf(page)).mode).toBe('LIVE');

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
  await page.screenshot({ path: 'docs/screenshots/football-hazard-hit.png' });

  const handle = await mlf(page);
  // At least one hazard hit was committed through SnapOptions.
  expect(handle.lastDamage + handle.lastCasualties).toBeGreaterThan(0);
  await page.screenshot({ path: 'docs/screenshots/football-casualty.png' });

  await page.waitForTimeout(300);
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);
});
