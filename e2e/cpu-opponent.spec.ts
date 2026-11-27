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

  // ---- Observe the CPU drive a full down with no keys pressed. ---------------
  // The CPU huddle overlay names its play instead of the A/B/C pick list.
  await expect.poll(async () => (await snap(page)).mode, { timeout: 10_000 }).toBe('PICK');
  const cpuHuddleSnap = await snap(page);
  expect(cpuHuddleSnap.possession).toBe('away');
  expect(cpuHuddleSnap.cpuPlayId).not.toBeNull();
  await expect(page.getByTestId('huddle-overlay')).toBeVisible();
  await expect(page.getByTestId('cpu-offense-head')).toBeVisible();
  await page.screenshot({ path: join(screenshotDir, 'ml-pq2-cpu-huddle.png') });

  // A P1 J tap during the CPU huddle must NOT change the called play (the CPU
  // plays itself; the human A/B/C never feeds the CPU's call).
  const beforeProbe = await snap(page);
  await tap(page, P1.A); // J — the human "play A" key
  await page.waitForTimeout(120);
  const afterProbe = await snap(page);
  expect(afterProbe.cpuPlayId, 'P1 play keys must not change the CPU call').toBe(
    beforeProbe.cpuPlayId,
  );

  // The CPU snaps on its own, plays LIVE with no steer, and reaches the whistle.
  // Capture the CPU's opening down/los BEFORE the play advances (still in PICK).
  const opening = await snap(page);
  const downBefore = opening.down;
  const losBefore = opening.los;
  await expect.poll(async () => (await snap(page)).mode, { timeout: 15_000 }).toBe('PRE_SNAP');
  // The human C (snap) must not be required: wait for LIVE without touching C.
  await expect.poll(async () => (await snap(page)).mode, { timeout: 15_000 }).toBe('LIVE');
  // Capture the CPU live down for the readability screenshot.
  await expect.poll(async () => (await snap(page)).carrierId, { timeout: 5_000 }).not.toBeNull();
  await page.screenshot({ path: join(screenshotDir, 'ml-pq2-cpu-live.png') });

  // The down runs to the whistle and the session advances on its own.
  await expect.poll(async () => (await snap(page)).mode, { timeout: 20_000 }).toBe('BANNER');
  // After the banner, possession flips back to home and down/los have advanced.
  await expect.poll(async () => (await snap(page)).mode, { timeout: 15_000 }).toBe('PICK');
  const afterWhistle = await snap(page);
  expect(afterWhistle.possession).not.toBe('away');
  // `down` advanced unless the CPU scored (then it resets to 1 via kickoff) —
  // either way the session state changed from the pre-snap reading.
  expect(afterWhistle.down !== downBefore || afterWhistle.los !== losBefore).toBe(true);

  expect(errors).toEqual([]);
});
