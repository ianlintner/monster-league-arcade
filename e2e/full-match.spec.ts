import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { join } from 'node:path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

/**
 * Core-loop regression guard: a whole match played with REAL keyboard events,
 * from the first huddle to GAME_OVER, then restarted with START (P).
 *
 * `?quarter=15` (the test seam, clamped 10..180) shrinks a quarter so the match
 * fits in a test. `window.__mlf` is only ever READ for assertions; every action
 * is a real key tap (never `pick()/snap()/throwTo()`).
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(300_000);

interface Snap {
  phase: string;
  mode: string;
  down: number;
  quarter: number;
  possession: string;
  score: { home: number; away: number } | null;
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const h = (window as unknown as { __mlf?: Record<string, unknown> }).__mlf ?? {};
    return {
      phase: String(h.phase ?? ''),
      mode: String(h.mode ?? ''),
      down: Number(h.down ?? 1),
      quarter: Number(h.quarter ?? 0),
      possession: String(h.possession ?? ''),
      score: (h.score as Snap['score']) ?? null,
    };
  });

test('real-keyboard full match: play to GAME_OVER, see the result, restart with P', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=15');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async () => (await snap(page)).mode, { timeout: 10_000 }).toBe('PICK');
  expect((await snap(page)).quarter).toBe(1);

  const deadline = Date.now() + 240_000;
  let calledNasty = false;
  for (;;) {
    const s = await snap(page);
    if (s.phase === 'GAME_OVER') break;
    expect(Date.now(), 'match did not reach GAME_OVER in time').toBeLessThan(deadline);

    // CPU possession: the away team calls and runs its own down — wait it out,
    // never press a key (a stray A/B/C would neither help nor hurt, but the CPU
    // must drive the whole down itself; the extra-point/kickoff collapse happens
    // in the BANNER tick like every other possession).
    if (s.possession === 'away') {
      await page.waitForTimeout(200);
      continue;
    }

    if (s.mode === 'PICK') {
      // Always pick a run: A (Inside Gore Run) normally, C (Go For It) on 4th
      // down, where A/B are punt / field goal.
      await tap(page, s.down >= 4 ? P1.C : P1.A);
      await page.waitForTimeout(80);
    } else if (s.mode === 'PRE_SNAP') {
      if (!calledNasty) {
        // One real-key Bribe Ref (B→A) before the first hike: the match must see a nasty.
        calledNasty = true;
        await tap(page, P1.B);
        await page.waitForTimeout(120);
        await tap(page, P1.A);
        await page.waitForTimeout(150);
      }
      await tap(page, P1.C); // snap
      await page.waitForTimeout(80);
    } else if (s.mode === 'LIVE') {
      await page.keyboard.down(P1.right);
      await page.waitForTimeout(700);
      await page.keyboard.up(P1.right);
    } else {
      await page.waitForTimeout(150); // BANNER: let the whistle banner run out
    }
  }

  // At least one nasty was called over the match (the human's bribe, plus any the CPU armed).
  const nastyCount = await page.evaluate(
    () =>
      (window as unknown as { __mlf: { session: { nastyLog: unknown[] } } }).__mlf.session.nastyLog
        .length,
  );
  expect(nastyCount).toBeGreaterThanOrEqual(1);

  // The final result is on screen, inside the 1280x720 viewport.
  const card = page.getByTestId('result-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  await expect(page.getByTestId('result-reason')).toHaveText(/FINAL|FORFEIT BY CARNAGE/);
  await expect(page.getByTestId('result-score')).toContainText(/\d+ — \d+/);
  await expect(page.getByTestId('result-hint')).toContainText('START=P');
  await page.screenshot({ path: join(screenshotDir, 'ml-pq1-final-result.png') });

  // START (P) starts a fresh match: 0-0, Q1, huddle (PICK) showing again.
  await page.waitForTimeout(800); // outlast the restart lockout
  await tap(page, P1.START);
  await expect
    .poll(async () => (await snap(page)).phase, { timeout: 5_000 })
    .toBe('HUDDLE_PLAYCALL');
  const fresh = await snap(page);
  expect(fresh.score).toEqual({ home: 0, away: 0 });
  expect(fresh.quarter).toBe(1);
  expect(fresh.mode).toBe('PICK');
  await expect(card).toBeHidden();
  await expect(page.getByTestId('huddle-overlay')).toBeVisible();
  await page.screenshot({ path: join(screenshotDir, 'ml-pq1-restarted.png') });

  expect(errors).toEqual([]);
});
