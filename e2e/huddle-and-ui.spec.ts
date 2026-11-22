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
  bannerKind: string;
  aiDecision: { offensePlayId: string; defensePlayId: string; nasty: string | null } | null;
  pick: (i: number) => void;
  snap: () => void;
}

function mlf(page: Page): Promise<MlfHandle> {
  return page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!);
}

test('the enriched scorebug renders crests, casualty skulls and a bribed-ref badge', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  const scorebug = page.locator('[data-testid="scorebug"]');
  await expect(scorebug).toBeVisible();

  // Two team crests (home + away) sit in the scoreboard shell.
  await expect(scorebug.locator('[data-crest]')).toHaveCount(2);

  // Each team starts with four unlit skulls; the bribe badge is armed-only.
  await expect(page.locator('[data-testid="skulls-home"] [data-lit="true"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="skulls-away"] [data-lit="true"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="bribe-badge"]')).toHaveAttribute('data-active', 'false');

  // Capture the scorebug in a huddle-free frame: leave PICK first so the overlay
  // is gone and the top bar reads in isolation (otherwise this screenshot is
  // pixel-identical to football-huddle.png).
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.pick(0));
  await expect(page.locator('[data-testid="huddle"]')).toBeHidden();
  await page.screenshot({ path: 'docs/screenshots/football-scorebug.png' });

  await page.waitForTimeout(300);
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);
});

test('the huddle overlay renders three play cards and the nasty drawer while PICKing', async ({
  page,
}) => {
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  const huddle = page.locator('[data-testid="huddle"]');
  await expect(huddle).toBeVisible();
  await expect(huddle.locator('[data-testid="huddle-overlay"]')).toBeVisible();

  // Three play cards A/B/C mirror the control-bar play menu.
  await expect(huddle.locator('[data-testid="play-a"]')).toBeVisible();
  await expect(huddle.locator('[data-testid="play-b"]')).toBeVisible();
  await expect(huddle.locator('[data-testid="play-c"]')).toBeVisible();

  // The nasty drawer lists at least one available dirty trick.
  await expect(huddle.locator('[data-testid="nasty-drawer"]')).toBeVisible();

  await page.screenshot({ path: 'docs/screenshots/football-huddle.png' });

  // Leaving PICK (confirm a play) hides the huddle overlay.
  await page.evaluate(() => (window as unknown as { __mlf?: MlfHandle }).__mlf!.pick(0));
  await expect(page.locator('[data-testid="huddle"]')).toBeHidden();
});

test('the AI coach returns a concrete play call for the offense of record', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  const decision = (await mlf(page)).aiDecision;
  expect(decision).not.toBeNull();
  // The AI's situational playcaller returns a real playbook id for the opening
  // 1st & 10 (e.g. POST_CORNER on long yardage); assert it is a concrete,
  // non-empty call rather than pinning to a specific route.
  expect(decision!.offensePlayId).toBeTruthy();
  expect(decision!.defensePlayId).toBeTruthy();

  await page.waitForTimeout(300);
  expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);
});
