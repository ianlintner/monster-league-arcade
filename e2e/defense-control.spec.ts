import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

/**
 * Human defense: while the CPU has the ball P1 steers the highlighted defender
 * (WASD), `K` (B) switches to the defender nearest the carrier, `J` (A) is a
 * dive tackle. Every action is a REAL key press; `window.__mlf` is only READ.
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(300_000);

interface Pos {
  id: string;
  side: string;
  x: number;
  y: number;
}
interface Snap {
  mode: string;
  possession: string;
  carrierId: string | null;
  controlled: string | null;
  tackler: string | null;
  actors: Pos[];
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const h = (window as unknown as { __mlf?: Record<string, unknown> }).__mlf ?? {};
    return {
      mode: String(h.mode ?? ''),
      possession: String(h.possession ?? ''),
      carrierId: (h.carrierId as string | null) ?? null,
      controlled: (h.controlledDefenderId as string | null) ?? null,
      tackler: (h.tackler as string | null) ?? null,
      actors: (h.actors as Pos[]) ?? [],
    };
  });

const pos = (s: Snap, id: string | null): Pos | undefined => s.actors.find((a) => a.id === id);
const distTo = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Defender ids ordered nearest-first to the ball carrier. */
function byDistanceToCarrier(s: Snap): string[] {
  const c = pos(s, s.carrierId);
  if (!c) return [];
  return s.actors
    .filter((a) => a.side === 'DEFENSE')
    .sort((p, q) => distTo(p, c) - distTo(q, c))
    .map((a) => a.id);
}

/** Drive home downs with real keys until the CPU has the ball. */
async function reachCpuPossession(page: Page): Promise<void> {
  const deadline = Date.now() + 240_000;
  for (;;) {
    const s = await snap(page);
    if (s.possession === 'away') return;
    expect(Date.now(), 'home possession never flipped to the CPU').toBeLessThan(deadline);
    // Quick Slants with no throw: sack for no gain; 4th-down "Go For It" fails.
    if (s.mode === 'PICK' || s.mode === 'PRE_SNAP') await tap(page, P1.C);
    await page.waitForTimeout(100);
  }
}

test('human defense: steer, B switches to nearest, A dive tackles', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=30');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async () => (await snap(page)).mode, { timeout: 10_000 }).toBe('PICK');
  await reachCpuPossession(page);

  let tackled = false;
  let shot = false;
  const deadline = Date.now() + 200_000;
  while (!tackled) {
    expect(Date.now(), 'never completed a controlled dive tackle').toBeLessThan(deadline);
    const s = await snap(page);
    if (s.possession !== 'away') break; // CPU drive ended; handled below
    if (s.mode !== 'LIVE') {
      await page.waitForTimeout(100);
      continue;
    }

    // ---- LIVE CPU down: a defender is under P1 control from the snap. ----------
    const first = await snap(page);
    expect(
      first.controlled,
      'a defender must be controlled while the CPU has the ball',
    ).not.toBeNull();
    const firstId = first.controlled!;
    expect(pos(first, firstId)?.side).toBe('DEFENSE');

    // Steer: hold D (right / downfield); the controlled defender must move +x.
    const before = pos(first, firstId)!;
    await page.keyboard.down(P1.right);
    await page.waitForTimeout(350);
    const mid = await snap(page);
    if (mid.mode !== 'LIVE' || mid.controlled !== firstId) {
      await page.keyboard.up(P1.right);
      continue; // the down ended too quickly; try the next CPU down
    }
    expect(
      pos(mid, firstId)!.x - before.x,
      'held D must move the controlled defender +x',
    ).toBeGreaterThan(0.5);
    if (!shot) {
      await page.screenshot({ path: join(screenshotDir, 'ml-pq3-defense-ring.png') });
      shot = true;
    }
    await page.keyboard.up(P1.right);

    // B (K): control moves to the defender nearest the carrier (never the same one).
    await tap(page, P1.B);
    await expect
      .poll(
        async () => {
          const c = await snap(page);
          return c.mode !== 'LIVE' || c.controlled !== firstId;
        },
        { timeout: 3_000 },
      )
      .toBe(true);
    const sw = await snap(page);
    if (sw.mode !== 'LIVE') continue;
    expect(sw.controlled, 'K must change the controlled defender').not.toBe(firstId);
    expect(byDistanceToCarrier(sw).slice(0, 2)).toContain(sw.controlled);

    // Close in on the carrier with real stick keys (S = +y), then dive with a
    // neutral stick: the lunge heads straight at the carrier and tackles on contact.
    const diver = sw.controlled;
    const closeBy = Date.now() + 1_500;
    for (;;) {
      const c = await snap(page);
      const me = pos(c, diver);
      const ball = pos(c, c.carrierId);
      if (c.mode !== 'LIVE' || !me || !ball || distTo(me, ball) < 2.6 || Date.now() > closeBy)
        break;
      const held: string[] = [];
      if (Math.abs(ball.x - me.x) > 0.6) held.push(ball.x > me.x ? P1.right : P1.left);
      if (Math.abs(ball.y - me.y) > 0.6) held.push(ball.y > me.y ? P1.down : P1.up);
      for (const k of held) await page.keyboard.down(k);
      await page.waitForTimeout(60);
      for (const k of held) await page.keyboard.up(k);
    }
    if ((await snap(page)).mode !== 'LIVE') continue;
    await tap(page, P1.A);
    await expect.poll(async () => (await snap(page)).mode, { timeout: 8_000 }).not.toBe('LIVE');
    const end = await snap(page);
    // A dive that reaches the carrier tackles on contact (credited to the diver);
    // a whiff leaves him down and another defender (or the sim) ends the down, so
    // keep trying on following CPU downs until a controlled dive connects.
    if (end.tackler === diver) tackled = true;
    if (tackled) break;
    // Wait out the banner before the next CPU down (a finished match never leaves it).
    await expect
      .poll(async () => (await snap(page)).mode, { timeout: 20_000, message: 'match ended' })
      .not.toBe('BANNER');
  }

  expect(tackled, 'the controlled defender must make a dive tackle').toBe(true);
  expect(errors).toEqual([]);
});
