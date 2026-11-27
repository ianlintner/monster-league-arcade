import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

/**
 * Full-drive smoke test that exercises the REAL keyboard path end to end.
 *
 * The previous suite passed while the shipped game was barely controllable
 * because it drove the scene through `window.__mlf.pick()/snap()`. This spec is
 * the regression guard for that gap: every down is called with a real 30 ms key
 * tap (the exact duration the shipped build dropped), snapped with a real C
 * (L) tap, steered with the real P1 WASD keys, and waited out through the
 * whistle. It only reads `window.__mlf` for assertions, never to act.
 *
 * Four downs are played: 1st → 2nd → 3rd → 4th. After each snap the down is
 * allowed to develop (a real 2–5 s run, never the old ~0.5 s instant tackle),
 * after the whistle the down text must be well-formed (ordinal + whole-yard or
 * INCHES, no raw floats), and the huddle must reappear for the next call.
 */
const mlf = (page: Page): Promise<{ mode: string; down: number }> =>
  page.evaluate(() => {
    const h = (window as unknown as { __mlf?: { mode: string; down: number } }).__mlf;
    return { mode: h?.mode ?? '', down: h?.down ?? 1 };
  });

/** 1ST–4TH ordinal plus INCHES or whole yards — exactly the HUD format, no floats.
 *  The broadcast font renders `&` as `$`, so the label uses a slash separator. */
const DOWN_TEXT = /^(1ST|2ND|3RD|4TH) \/ (INCHES|[0-9]{1,3})$/;

test('real-keyboard drive: four downs each tap, snap, steer, whistle', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();

  // High-water mark of the down number across the drive: a real series of snaps
  // must advance the down at least once (unless every run staged a first-down
  // reset, which the fixed 900 ms steer does not guarantee against individually).
  let maxDown = 1;

  for (let down = 1; down <= 4; down++) {
    // The play-call huddle must be showing before every down (defect #3: play-over
    // returned straight to PRE_SNAP with the previous play instead of a fresh call).
    await expect(page.getByTestId('huddle-overlay')).toBeVisible();
    await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('PICK');

    // Call a run play with a real 30 ms tap — short enough to fall between two
    // 60 Hz polls, so only the edge-buffered latch can deliver it. On 4th down A
    // is the PUNT and would leave the down parked in the kick meter (which needs
    // a C hold/release, not this smoke test's steer-and-whistle path), so call
    // C = "Go For It" — the same real-key choice full-match.spec.ts uses.
    const call = await mlf(page);
    await tap(page, call.down >= 4 ? P1.C : P1.A);
    await expect(page.getByTestId('huddle-overlay')).toBeHidden();
    await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('PRE_SNAP');

    // Snap the ball with a real 30 ms C (L) tap.
    await tap(page, P1.C);
    await expect.poll(async () => (await mlf(page)).mode, { timeout: 5_000 }).toBe('LIVE');

    // Steer the carrier downfield long enough for the down to develop (the instant-
    // tackle fix guarantees a believable 2–5 s run, not the old ~0.5 s collapse).
    await page.keyboard.down(P1.right);
    await page.waitForTimeout(900);
    await page.keyboard.up(P1.right);

    // The down must conclude on its own: the whistle returns the mode to PICK/PRE_SNAP
    // (never a stuck LIVE), and the banner auto-dismisses back into the huddle.
    await expect
      .poll(async () => (await mlf(page)).mode, { timeout: 12_000 })
      .toMatch(/^(PICK|PRE_SNAP)$/);

    // The down/distance read-out must be well-formed: ordinal + whole yards or
    // INCHES, never "2ND & 10.901356182310463".
    const label = page.locator('.gsn-scorebug__down');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(DOWN_TEXT);

    maxDown = Math.max(maxDown, (await mlf(page)).down);
  }

  // A drive that actually snapped real plays must have advanced the down number
  // beyond the opening 1st down at some point.
  expect(maxDown).toBeGreaterThan(1);

  expect(errors).toEqual([]);
});
