import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { join } from 'node:path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

/**
 * Human defense: while the CPU has the ball P1 steers the highlighted defender
 * (WASD), `K` (B) switches to the defender nearest the carrier, `J` (A) is a
 * dive tackle. Every action is a REAL key press; `window.__mlf` is only READ.
 *
 * Design note (why this is not one long reaction chain): a CPU down lasts only a
 * couple of game seconds, and the 60 Hz sim does not wait for Playwright. Under a
 * parallel run every `page.evaluate` round trip costs ~30 ms (vs ~2 ms alone), so a
 * spec that steers, measures, switches, closes in and dives inside ONE down loses the
 * race to the AI pursuit. Each CPU down therefore carries ONE pending objective
 * (steer, then switch, then dive) and every wait is on observed state, never on a
 * fixed wall-clock slice.
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

/** One atomic read: every field comes from the same task, so they always agree. */
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

/** Poll `read` until it returns a non-null value or the CPU down is no longer LIVE. */
async function untilState<T>(
  page: Page,
  read: (s: Snap) => T | null,
  budgetMs: number,
): Promise<{ s: Snap; value: T | null }> {
  const end = Date.now() + budgetMs;
  for (;;) {
    const s = await snap(page);
    const value = read(s);
    if (value !== null || s.mode !== 'LIVE' || Date.now() > end) return { s, value };
    await page.waitForTimeout(10);
  }
}

/** Wait (on state) for the current down to whistle. */
async function untilDownEnds(page: Page): Promise<Snap> {
  let s = await snap(page);
  const end = Date.now() + 30_000;
  while (s.mode === 'LIVE' && Date.now() < end) {
    await page.waitForTimeout(20);
    s = await snap(page);
  }
  return s;
}

test('human defense: steer, B switches to nearest, A dive tackles', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=30');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async () => (await snap(page)).mode, { timeout: 10_000 }).toBe('PICK');
  await reachCpuPossession(page);

  const done = { steered: false, switched: false, tackled: false };
  const deadline = Date.now() + 240_000;
  let cpuDowns = 0;

  while (!done.tackled) {
    expect(Date.now(), 'never completed a controlled dive tackle').toBeLessThan(deadline);
    expect(cpuDowns, 'never completed a controlled dive tackle (CPU downs)').toBeLessThan(80);

    const s = await snap(page);
    if (s.possession !== 'away') {
      // The CPU drive ended (punt / score / turnover) before the objectives were
      // met: drive home downs with real keys until the CPU has the ball again.
      await reachCpuPossession(page);
      continue;
    }
    if (s.mode !== 'LIVE') {
      await page.waitForTimeout(40);
      continue;
    }

    // ---- LIVE CPU down: a defender is under P1 control from the snap. ----------
    cpuDowns += 1;
    expect(s.controlled, 'a defender must be controlled while the CPU has the ball').not.toBeNull();
    const firstId = s.controlled!;
    expect(pos(s, firstId)?.side).toBe('DEFENSE');

    // Objective 1 — steer: hold D (right / downfield) until the controlled defender
    // has actually moved +x (state, not a guessed duration).
    if (!done.steered) {
      const before = pos(s, firstId)!;
      await page.keyboard.down(P1.right);
      const moved = await untilState(
        page,
        (m) => {
          const p = pos(m, firstId);
          return m.controlled === firstId && p && p.x - before.x > 0.5 ? true : null;
        },
        4_000,
      );
      if (moved.value === true) {
        await page.screenshot({ path: join(screenshotDir, 'ml-pq3-defense-ring.png') });
        done.steered = true;
      }
      await page.keyboard.up(P1.right);
      // Not moved because the down whistled first: try the next CPU down.
      if (!done.steered) {
        await untilDownEnds(page);
        continue;
      }
    }

    // Objective 2 — B (K): control moves to a defender nearest the carrier.
    if (!done.switched) {
      const cur = await snap(page);
      if (cur.mode === 'LIVE' && cur.controlled !== null) {
        const from = cur.controlled;
        await tap(page, P1.B);
        const sw = await untilState(page, (m) => (m.controlled !== from ? m : null), 3_000);
        if (sw.s.mode === 'LIVE') {
          expect(sw.s.controlled, 'K must change the controlled defender').not.toBe(from);
          expect(byDistanceToCarrier(sw.s).slice(0, 2)).toContain(sw.s.controlled);
          done.switched = true;
        }
      }
      if (!done.switched) {
        await untilDownEnds(page);
        continue;
      }
    }

    // Objective 3 — dive: close in with real stick keys while watching state, then
    // dive with a neutral stick (the lunge heads straight at the carrier). The dive
    // fires the moment the controlled defender is in range, not after a timed slice.
    const held = new Set<string>();
    const setHeld = async (want: string[]): Promise<void> => {
      for (const k of [...held]) {
        if (!want.includes(k)) {
          await page.keyboard.up(k);
          held.delete(k);
        }
      }
      for (const k of want) {
        if (!held.has(k)) {
          await page.keyboard.down(k);
          held.add(k);
        }
      }
    };
    let diver: string | null = null;
    const closeBy = Date.now() + 8_000;
    for (;;) {
      const c = await snap(page);
      const me = pos(c, c.controlled);
      const ball = pos(c, c.carrierId);
      if (c.mode !== 'LIVE' || !me || !ball || Date.now() > closeBy) break;
      if (distTo(me, ball) < 2.2) {
        diver = c.controlled;
        break;
      }
      const want: string[] = [];
      if (Math.abs(ball.x - me.x) > 0.4) want.push(ball.x > me.x ? P1.right : P1.left);
      if (Math.abs(ball.y - me.y) > 0.4) want.push(ball.y > me.y ? P1.down : P1.up);
      await setHeld(want);
      await page.waitForTimeout(10);
    }
    await setHeld([]);
    if (diver === null) {
      await untilDownEnds(page);
      continue;
    }
    await tap(page, P1.A);
    const end = await untilDownEnds(page);
    expect(end.mode, 'the dive down must end').not.toBe('LIVE');
    // A dive that reaches the carrier tackles on contact (credited to the diver);
    // a whiff leaves him down and another defender (or the sim) ends the down, so
    // keep trying on following CPU downs until a controlled dive connects.
    if (end.tackler === diver) done.tackled = true;
  }

  expect(done, 'steer, switch and a controlled dive tackle must all be observed').toEqual({
    steered: true,
    switched: true,
    tackled: true,
  });
  expect(errors).toEqual([]);
});
