import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

/**
 * CPU opponent regression guard: when the away team has possession, the AI
 * coach calls and runs its own play end-to-end with NO human input — the down
 * advances PICK → PRE_SNAP → LIVE → whistle on its own, `__mlf.down`/`los`
 * advance, and a P1 key tap during the CPU huddle cannot change the called play.
 *
 * `window.__mlf` is only ever READ for assertions; every action is a real key
 * tap (the `J` probe during the CPU huddle, never `pick()/snap()/throwTo()`).
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(300_000);

interface Snap {
  phase: string;
  mode: string;
  down: number;
  quarter: number;
  los: number;
  possession: string;
  cpuPlayId: string | null;
  carrierId: string | null;
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
      los: Number(h.los ?? 0),
      possession: String(h.possession ?? ''),
      cpuPlayId: (h.cpuPlayId as string | null) ?? null,
      carrierId: (h.carrierId as string | null) ?? null,
      score: (h.score as Snap['score']) ?? null,
    };
  });

test('CPU opponent: away down advances PICK→PRE_SNAP→LIVE→whistle on its own', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=180');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async () => (await snap(page)).mode, { timeout: 10_000 }).toBe('PICK');

  // ---- Play home (human) downs until possession flips to the CPU. -------------
  // Home receives the opening kickoff (coinToss('home') + touchback), so the
  // human drives the first possession. On 4th down punt (A) to force a clean flip.
  const deadline = Date.now() + 240_000;
  for (;;) {
    const s = await snap(page);
    if (s.possession === 'away') break;
    expect(Date.now(), 'home possession never flipped to the CPU in time').toBeLessThan(deadline);

    if (s.mode === 'PICK') {
      // Downs 1-3: Quick Slants (PASS) with NO throw → QB takes a sack for no
      // gain, stalling the drive. 4th down: "Go For It (Run)" that fails to
      // convert → turnover on downs → possession flips (no kick meter needed).
      await tap(page, P1.C);
      await page.waitForTimeout(80);
    } else if (s.mode === 'PRE_SNAP') {
      await tap(page, P1.C); // snap
      await page.waitForTimeout(80);
    } else if (s.mode === 'LIVE') {
      // Pass with windows never opened → the QB is sacked / throws it away, the
      // down ends with no gain. Just wait for the whistle.
      await page.waitForTimeout(150);
    } else {
      await page.waitForTimeout(150); // BANNER
    }
  }

  // ---- Observe the CPU drive its possession with no keys pressed. -------------
  // The CPU huddle overlay names its play instead of the A/B/C pick list. We
  // watch EVERY CPU down (not just the first) so a second consecutive CPU down —
  // the exact path the stale-play bug broke — is exercised whenever the drive
  // does not end on the first snap. On every down the CPU re-arms a fresh call,
  // shows the huddle beat, then runs PICK→PRE_SNAP→LIVE→whistle on its own.
  await expect.poll(async () => (await snap(page)).mode, { timeout: 10_000 }).toBe('PICK');

  const cpuDownDeadline = Date.now() + 240_000;
  let cpuDownsSeen = 0;
  let opening: Snap | null = null;

  for (;;) {
    const s = await snap(page);
    expect(Date.now(), 'CPU drive never finished in time').toBeLessThan(cpuDownDeadline);

    // The CPU's turn is over once possession flips back to the human.
    if (s.possession !== 'away') break;

    if (s.mode === 'PICK') {
      // While the CPU huddles, its call is armed and named in the overlay. On a
      // SECOND consecutive down this only renders because the call was cleared
      // between downs and freshly re-armed (the stale-play bug skipped it).
      expect(s.cpuPlayId).not.toBeNull();
      await expect(page.getByTestId('huddle-overlay')).toBeVisible();
      await expect(page.getByTestId('cpu-offense-head')).toBeVisible();
      if (cpuDownsSeen === 0) {
        await page.screenshot({ path: join(screenshotDir, 'ml-pq2-cpu-huddle.png') });
        // A P1 play tap during this first CPU huddle must NOT change the call.
        const beforeProbe = await snap(page);
        await tap(page, P1.A); // J — the human "play A" key
        await page.waitForTimeout(120);
        const afterProbe = await snap(page);
        expect(afterProbe.cpuPlayId, 'P1 play keys must not change the CPU call').toBe(
          beforeProbe.cpuPlayId,
        );
      }
      await page.waitForTimeout(120);
    } else if (s.mode === 'PRE_SNAP' || s.mode === 'LIVE') {
      // Capture the down/los + a live screenshot on the first down.
      if (cpuDownsSeen === 0 && opening === null && s.mode === 'LIVE') {
        await expect
          .poll(async () => (await snap(page)).carrierId, { timeout: 5_000 })
          .not.toBeNull();
        await page.screenshot({ path: join(screenshotDir, 'ml-pq2-cpu-live.png') });
        opening = s;
      }
      // No key pressed: the CPU snaps and plays LIVE on its own.
      await page.waitForTimeout(150);
    } else if (s.mode === 'BANNER') {
      // The whistle fired: a CPU down completed. Record it and keep watching if
      // the CPU retained possession (a second consecutive down).
      cpuDownsSeen += 1;
      await page.waitForTimeout(150);
    } else {
      await page.waitForTimeout(150);
    }
  }

  // The CPU ran at least one full down to a whistle on its own, with zero keys.
  expect(cpuDownsSeen, 'CPU must complete at least one autonomous down').toBeGreaterThanOrEqual(1);

  // After the CPU drive, possession is back with the human and the session has
  // advanced from the opening snap (down/los changed, or a score reset to 1).
  if (opening) {
    const after = await snap(page);
    expect(after.down !== opening.down || after.los !== opening.los).toBe(true);
  }

  expect(errors).toEqual([]);
});
