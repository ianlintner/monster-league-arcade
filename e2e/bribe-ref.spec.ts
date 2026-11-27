import { type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { trackErrors } from './errors';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

/**
 * Bribe / Kill Ref by real input: huddle A (Inside Gore Run) → pre-snap K→J bribes the
 * Necro-Ref for the home team; a second bribe in the same half is refused; after the next
 * whistle the ref's flag renders as a BOGUS PENALTY banner while the bribed badge stays lit.
 * Every action is a REAL key press; `window.__mlf` is only READ.
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(120_000);

interface Mlf {
  mode: string;
  bannerKind: string;
  session: {
    half: number;
    ref: { isBribed: boolean; bribedBy: string | null; huntedBy: string | null };
    nastyLog: { team: string; kind: string }[];
    lastResult: { penalties: { kind: string; text: string }[]; touchdown: boolean } | null;
  } | null;
}

/** Read-only probe of `window.__mlf` (assertion use only). */
const mlf = <T>(page: Page, pick: (m: Mlf) => T): Promise<T> =>
  page.evaluate(
    ([src]) =>
      (new Function(`return (${src})`)() as (m: unknown) => unknown)(
        (window as never as { __mlf: unknown }).__mlf,
      ),
    [pick.toString()],
  ) as Promise<T>;

const mode = (page: Page): Promise<string> => mlf(page, (m) => m.mode);

/** Space real presses past the InputManager's ~50 ms edge poll. */
async function combo(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await tap(page, k);
    await page.waitForTimeout(120);
  }
}

test('K→J bribes the ref once per half and the flag shows as a bogus penalty', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=180');
  await expect.poll(() => mode(page)).toBe('PICK');

  await tap(page, P1.A); // Inside Gore Run
  await expect.poll(() => mode(page)).toBe('PRE_SNAP');
  await expect(page.locator('.gsn-control-bar__prompt')).toContainText('[B=K');
  expect(await mlf(page, (m) => m.session!.ref.isBribed)).toBe(false);
  await expect(page.getByTestId('bribe-badge')).toHaveAttribute('data-active', 'false');

  await combo(page, P1.B, P1.A); // K → J : Bribe Ref
  await expect.poll(() => mlf(page, (m) => m.session!.ref.isBribed)).toBe(true);
  expect(await mlf(page, (m) => m.session!.ref.bribedBy)).toBe('home');
  expect(await mode(page)).toBe('PRE_SNAP'); // nothing hiked
  await expect(page.getByTestId('nasty-callout')).toContainText('BRIBE REF');
  await expect(page.getByTestId('bribe-badge')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('bribe-badge')).toContainText('BRIBED REF');

  // A second bribe in the same half is refused and spends nothing.
  await page.waitForTimeout(2000); // callout expires
  await combo(page, P1.B, P1.A);
  const callout = page.getByTestId('nasty-callout');
  await expect(callout).toContainText('REFUSED');
  await expect(callout).toContainText('ALREADY USED');
  expect(await mlf(page, (m) => m.session!.nastyLog.length)).toBe(1);

  // Hike (bare L) and run until the whistle: the bribed ref flags the CPU.
  await page.waitForTimeout(1800); // menu back to IDLE
  await tap(page, P1.C);
  await expect.poll(() => mode(page)).toBe('LIVE');
  const deadline = Date.now() + 40_000;
  while ((await mode(page)) === 'LIVE') {
    expect(Date.now(), 'down never ended').toBeLessThan(deadline);
    await page.keyboard.down(P1.right);
    await page.waitForTimeout(500);
    await page.keyboard.up(P1.right);
  }
  await expect.poll(() => mode(page)).toBe('BANNER');

  const last = await mlf(page, (m) => m.session!.lastResult);
  expect(last).not.toBeNull();
  if (!last!.touchdown) {
    // Flags are declined on scoring plays; every other whistle carries the bribe flag.
    expect(last!.penalties.some((p) => p.kind === 'BRIBE')).toBe(true);
    const banner = page.getByTestId('banner');
    await expect(banner).toContainText(/Yards —/i);
    if ((await mlf(page, (m) => m.bannerKind)) === 'PENALTY') {
      await expect(banner).toContainText('BOGUS PENALTY!');
    }
    await expect(page.getByTestId('bribe-badge')).toHaveAttribute('data-active', 'true');
    writeFileSync(join(screenshotDir, 'mlnext-bribe.png'), await page.screenshot());
  }
  expect(errors).toEqual([]);
});

test('K→K starts the Kill Ref hunt and shows it on the scorebug', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/football/?quarter=180');
  await expect.poll(() => mode(page)).toBe('PICK');
  await tap(page, P1.A);
  await expect.poll(() => mode(page)).toBe('PRE_SNAP');

  await combo(page, P1.B, P1.B); // K → K : Kill Ref
  await expect.poll(() => mlf(page, (m) => m.session!.ref.huntedBy)).toBe('home');
  await expect(page.getByTestId('nasty-callout')).toContainText('KILL REF');
  await expect(page.getByTestId('bribe-badge')).toContainText('REF HUNT');
  expect(await mode(page)).toBe('PRE_SNAP');
  expect(errors).toEqual([]);
});
