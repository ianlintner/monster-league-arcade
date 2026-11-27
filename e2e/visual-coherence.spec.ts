import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenshotDir } from './screenshot-path';
import { trackErrors } from './errors';
import { P1, tap } from './keys';

const mlf = (page: Page): Promise<{ mode: string; bannerKind: string }> =>
  page.evaluate(() => {
    const h = (window as unknown as { __mlf?: { mode: string; bannerKind: string } }).__mlf;
    return { mode: h?.mode ?? '', bannerKind: h?.bannerKind ?? '' };
  });

/** Map a 0-based play card index to the real P1 key that calls it (A/B/C). */
function pickKey(index: number): string {
  return ([P1.A, P1.B, P1.C] as const)[index]!;
}

/** Call a play card then snap the ball, driving real keyboard events. */
async function callAndSnap(page: Page, index: number): Promise<void> {
  await tap(page, pickKey(index));
  await page.waitForTimeout(80);
  await tap(page, P1.C);
}

/** Relocate the live carrier to an absolute cell (test seam, not player input). */
const forceCarrierTo = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      type Handle = { forceCarrierTo: (x: number, y: number) => void };
      (window as unknown as { __mlf: Handle }).__mlf.forceCarrierTo(px!, py!);
    },
    [x, y] as const,
  );

function trackAssets(page: Page): { errors: string[]; loaded: string[] } {
  const errors = trackErrors(page);
  const loaded: string[] = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/assets/')) {
      if (r.status() !== 200) errors.push(`${u.pathname} HTTP ${r.status()}`);
      else loaded.push(u.pathname);
    }
  });
  return { errors, loaded };
}

const capture = async (page: Page, name: string): Promise<void> => {
  writeFileSync(join(screenshotDir, name), await page.screenshot());
};

test('hub: cabinet, roster inspector and shared art/audio board load cleanly', async ({ page }) => {
  const { errors, loaded } = trackAssets(page);
  await page.goto('/');
  await expect(page.getByTestId('gsn-chrome')).toBeVisible();
  await page.getByRole('button', { name: /Rotting Deadskins/ }).click();
  await expect(page.getByTestId('faction-coach-portrait')).toBeVisible();
  await expect(page.getByTestId('faction-crest')).toBeVisible();
  await expect(page.getByTestId('arena-cursed_graveyard')).toBeVisible();
  await expect(page.getByTestId('official-necro-ref')).toBeVisible();
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.gsn-art-card__img')];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });

  // Unstyled-element guard: every visible button/link must carry a GSN class.
  const unstyled = await page.evaluate(
    () =>
      [...document.querySelectorAll('button, a')].filter(
        (n) => !n.className || !String(n.className).startsWith('gsn-'),
      ).length,
  );
  expect(unstyled).toBe(0);
  expect(loaded.some((p) => p.includes('/portraits/'))).toBe(true);
  expect(errors).toEqual([]);
  await capture(page, 'hub-arcade-cabinet.png');
});

test('football: pre-snap huddle and playbook', async ({ page }) => {
  const { errors, loaded } = trackAssets(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('huddle-overlay')).toBeVisible();
  await expect(page.getByTestId('play-a')).toBeVisible();
  await expect(page.getByTestId('play-b')).toBeVisible();
  await expect(page.getByTestId('play-c')).toBeVisible();
  await capture(page, 'football-pre-snap-huddle.png');
  expect(errors).toEqual([]);
  expect(loaded.length).toBeGreaterThan(0);
});

test('football: live 2.5D action with passing windows, hazards and scorebug', async ({ page }) => {
  const { errors, loaded } = trackAssets(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await callAndSnap(page, 2); // Quick Slants
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await page.keyboard.down(P1.C);
  await page.waitForTimeout(80);
  await page.keyboard.up(P1.C);
  await expect.poll(() => page.evaluate(() => window.__mlf!.mode)).toBe('LIVE');
  await capture(page, 'football-live-action.png');
  expect(loaded.some((p) => p.includes('/sprites/'))).toBe(true);
  expect(errors).toEqual([]);
});

test('football: broadcast banner (TOUCHDOWN!)', async ({ page }) => {
  const { errors, loaded } = trackAssets(page);
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await callAndSnap(page, 0);
  await forceCarrierTo(page, 112, 26);
  await expect
    .poll(() => mlf(page).then((h) => h.bannerKind), { timeout: 10_000 })
    .toBe('TOUCHDOWN');
  await capture(page, 'football-broadcast-banner.png');
  expect(errors).toEqual([]);
  expect(loaded.length).toBeGreaterThan(0);
});

test('hockey: rink preview with shared GSN chrome and art', async ({ page }) => {
  const { errors, loaded } = trackAssets(page);
  await page.goto('/hockey/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await expect(page.getByTestId('gsn-chrome')).toBeVisible();
  expect(errors).toEqual([]);
  expect(loaded.length).toBeGreaterThan(0);
  await capture(page, 'hockey-rink-preview.png');
});
