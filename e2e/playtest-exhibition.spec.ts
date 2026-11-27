import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

/**
 * QA gate: one full exhibition quarter played with REAL keyboard events only.
 *
 * Covers: run, completed pass (windows -> throw), punt, hazard hit + casualty,
 * touchdown (auto extra point) and the quarter change. Every action is a key
 * tap/hold via `page.keyboard`; `window.__mlf` is READ for assertions, with the single
 * documented positioning seam `forceCarrierTo` (relocates the carrier onto a grave /
 * into the end zone — it is not input and cannot pick, snap or throw).
 *
 * Screenshots land in docs/qa/ (see docs/qa/PLAYTEST.md).
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(300_000);

const qaDir = join(process.cwd(), 'docs', 'qa');
mkdirSync(qaDir, { recursive: true });
const shot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ path: join(qaDir, name) });

interface Mlf {
  phase: string;
  mode: string;
  down: number;
  quarter: number;
  possession: string;
  los: number;
  score: { home: number; away: number };
  windowsOpen: boolean;
  isPassPlay: boolean;
  bannerKind: string;
  lastDamage: number;
  lastCasualties: number;
  hazards: { kind: string; x: number; y: number; armed: boolean }[];
}

/** Copy the live `__mlf` getters into plain primitives (read-only). */
const mlf = (page: Page): Promise<Mlf> =>
  page.evaluate(() => {
    const h = (window as unknown as { __mlf: Mlf }).__mlf;
    return {
      phase: h.phase,
      mode: h.mode,
      down: h.down,
      quarter: h.quarter,
      possession: h.possession,
      los: h.los,
      score: { ...h.score },
      windowsOpen: h.windowsOpen,
      isPassPlay: h.isPassPlay,
      bannerKind: h.bannerKind,
      lastDamage: h.lastDamage,
      lastCasualties: h.lastCasualties,
      hazards: h.hazards.map((x) => ({ kind: x.kind, x: x.x, y: x.y, armed: x.armed })),
    };
  });

const bannerText = (page: Page): Promise<string> =>
  page.evaluate(() => (document.getElementById('banner')?.textContent ?? '').trim());

/** Wait until it is the human's turn to call a play. */
async function untilHomePick(page: Page): Promise<Mlf> {
  let s = await mlf(page);
  const deadline = Date.now() + 90_000;
  while (!(s.possession === 'home' && s.mode === 'PICK' && s.phase === 'HUDDLE_PLAYCALL')) {
    expect(Date.now(), `stuck waiting for a home huddle (${JSON.stringify(s)})`).toBeLessThan(
      deadline,
    );
    await page.waitForTimeout(150);
    s = await mlf(page);
  }
  return s;
}

const untilBanner = async (page: Page): Promise<void> => {
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 15_000 }).toBe('BANNER');
};

/** Call a play card with a real tap, then snap with a real C tap. */
async function callAndSnap(page: Page, key: string): Promise<void> {
  await tap(page, key);
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('PRE_SNAP');
  await tap(page, P1.C);
  await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('LIVE');
}

test('full exhibition quarter with real keys: run, pass, punt, hazard, casualty, TD+XP, quarter change', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=180');
  await expect(page.locator('#game canvas')).toBeVisible();
  await untilHomePick(page);
  await shot(page, '01-huddle-kickoff.png');

  // --- 1. A run: A (Inside Gore Run), snap, steer right with a real held key.
  await callAndSnap(page, P1.A);
  await page.keyboard.down(P1.right);
  await page.waitForTimeout(600);
  await shot(page, '02-run-live.png');
  await page.keyboard.up(P1.right);
  await untilBanner(page);
  await shot(page, '03-run-result-banner.png');

  // --- 2. Reach 4th down on offense with un-steered runs, then PUNT (A, then C meter).
  // This runs BEFORE the pass step on purpose. A quarter rollover resets the down to
  // 1st, and the match clock is spent by every down played; a throw that fails (sack,
  // incomplete, pick) costs a variable number of downs/possessions depending on input
  // timing. Un-steered runs from the opening drive are the near-deterministic part, so
  // they go first, while the quarter is fresh, and the timing-dependent pass step
  // absorbs whatever clock is left.
  let punted = false;
  for (let i = 0; i < 40 && !punted; i++) {
    const s = await untilHomePick(page);
    if (s.down >= 4) {
      await shot(page, '06-fourth-down-special-teams.png');
      const before = s.los;
      await tap(page, P1.A); // Punt
      await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('PRE_SNAP');
      await tap(page, P1.C); // snap into the kick meter
      await page.keyboard.down(P1.C); // hold C to sweep the meter, release to lock
      await page.waitForTimeout(500);
      await shot(page, '07-punt-meter.png');
      await page.keyboard.up(P1.C);
      await untilBanner(page);
      await shot(page, '08-punt-result-banner.png');
      expect((await mlf(page)).possession, `punt from los ${before} must flip possession`).toBe(
        'away',
      );
      punted = true;
    } else {
      await callAndSnap(page, P1.A);
      await untilBanner(page);
    }
  }
  expect(punted, 'never reached a 4th-down punt').toBe(true);

  // --- 3. A completed pass: C (Quick Slants), snap, open windows, throw to a receiver.
  // Whether a throw completes depends on where the defenders are at the throw
  // instant, and that shifts with real-time input latency (a parallel run adds tens
  // of ms per round trip). So the spec does not bet on one receiver or three tries:
  // it rotates A/B/C and keeps throwing until a pass completes (interceptions hand the
  // ball to the CPU and `untilHomePick` waits for it to come back).
  const RECEIVER_KEYS = [P1.A, P1.B, P1.C];
  let completed = false;
  for (let attempt = 0; attempt < 15 && !completed; attempt++) {
    const s = await untilHomePick(page);
    if (s.down >= 4) {
      // 4th down offers special teams: C = "Go For It" (a plain run) keeps the drive alive.
      await callAndSnap(page, P1.C);
      await untilBanner(page);
      continue;
    }
    await callAndSnap(page, P1.C);
    await page.keyboard.down(P1.C);
    await page.waitForTimeout(100);
    await page.keyboard.up(P1.C);
    await expect.poll(async () => (await mlf(page)).windowsOpen, { timeout: 5_000 }).toBe(true);
    await page.waitForTimeout(150);
    if (!completed) await shot(page, '04-pass-windows-open.png');
    const throwKey = RECEIVER_KEYS[attempt % RECEIVER_KEYS.length]!;
    await page.keyboard.down(throwKey);
    await page.waitForTimeout(220);
    await page.keyboard.up(throwKey);
    await untilBanner(page);
    const text = (await bannerText(page)).toUpperCase();
    // Completed = a gain, a first down or a TD; not INCOMPLETE / SACKED / INTERCEPTED.
    completed = !/INCOMPLETE|SACK|INTERCEPT|FUMBLE/.test(text) && text.length > 0;
    if (completed) await shot(page, '05-pass-completed-banner.png');
  }
  expect(completed, 'no completed pass in 15 attempts').toBe(true);

  // --- 4. Hazard hit + casualty: walk the carrier onto an armed grave.
  await untilHomePick(page);
  await callAndSnap(page, P1.A);
  const grave = (await mlf(page)).hazards.find((h) => h.kind === 'OPEN_GRAVE' && h.armed);
  expect(grave, 'no armed open grave on this seed').toBeTruthy();
  await page.evaluate(
    ([x, y]) =>
      (
        window as unknown as { __mlf: { forceCarrierTo: (x: number, y: number) => void } }
      ).__mlf.forceCarrierTo(x, y),
    [grave!.x, grave!.y] as const,
  );
  await untilBanner(page);
  await page.waitForTimeout(250);
  const hit = await mlf(page);
  expect(hit.lastDamage + hit.lastCasualties).toBeGreaterThan(0);
  await shot(page, '09-hazard-hit.png');
  await shot(page, '10-casualty.png');

  // --- 5. Touchdown + automatic extra point.
  await untilHomePick(page);
  const before = (await mlf(page)).score.home;
  await callAndSnap(page, P1.A);
  await page.evaluate(() =>
    (
      window as unknown as { __mlf: { forceCarrierTo: (x: number, y: number) => void } }
    ).__mlf.forceCarrierTo(112, 26),
  );
  await expect
    .poll(async () => (await mlf(page)).bannerKind, { timeout: 10_000 })
    .toBe('TOUCHDOWN');
  await shot(page, '11-touchdown-banner.png');
  // The extra point is auto-kicked in the banner tick (no key exists for it).
  await expect
    .poll(async () => (await mlf(page)).score.home, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(before + 6);
  await shot(page, '12-after-touchdown-extra-point.png');

  // --- 6. Quarter change: play it out with real keys (CPU drives its own downs).
  const startQuarter = (await mlf(page)).quarter;
  const deadline = Date.now() + 200_000;
  for (;;) {
    const s = await mlf(page);
    if (s.quarter > startQuarter) break;
    expect(Date.now(), 'quarter never advanced').toBeLessThan(deadline);
    if (s.possession === 'home' && s.mode === 'PICK') {
      await tap(page, s.down >= 4 ? P1.C : P1.A);
      await page.waitForTimeout(80);
    } else if (s.possession === 'home' && s.mode === 'PRE_SNAP') {
      await tap(page, P1.C);
      await page.waitForTimeout(80);
    } else if (s.possession === 'home' && s.mode === 'LIVE') {
      await page.keyboard.down(P1.right);
      await page.waitForTimeout(500);
      await page.keyboard.up(P1.right);
    } else {
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(400);
  await shot(page, '13-quarter-change.png');
  expect((await mlf(page)).quarter).toBe(startQuarter + 1);

  expect(errors).toEqual([]);
});
