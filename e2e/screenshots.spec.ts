import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Captures the art-uplift deliverable as real, reproducible screenshots under
// docs/screenshots/. The gallery page renders the regenerated assets at 4x
// nearest-neighbour from the served bundle; the football route shows the field.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

declare global {
  interface Window {
    __mlf?: {
      phase: string;
      mode: string;
      spriteBackedActors: number;
      pick: (i: number) => void;
      snap: () => void;
      openWindows: () => void;
      throwTo: (t: 'A' | 'B' | 'C') => void;
      forceCarrierTo: (x: number, y: number) => void;
    };
    __galleryReady?: Promise<void>;
  }
}

test('captures the asset gallery screenshot', async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator('h1')).toHaveText(/art uplift gallery/i);
  // The gallery draws both <img> elements and sprite strips onto <canvas> from
  // detached Image() loads that an img.complete check cannot see. Await the
  // explicit readiness signal the page resolves once every tracked load (canvas
  // and <img>, including onerror releases) has settled.
  await page.waitForFunction(
    () => (window as Window & { __galleryReady?: Promise<void> }).__galleryReady,
    undefined,
    { timeout: 10_000 },
  );
  // Belt-and-braces: there must be no still-loading <img> left either.
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('img')];
    return imgs.every((i) => i.complete && i.naturalWidth > 0);
  });
  const buf = await page.screenshot({ fullPage: true });
  writeFileSync(join(OUT, 'gallery.png'), buf);
});

/** Open the football route and wait until the game scene has booted. */
async function openField(page: Page): Promise<void> {
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__mlf), undefined, { timeout: 10_000 });
  // Give the first render loop a tick so `spriteBackedActors` is populated.
  await page.waitForTimeout(300);
}

test('football field renders sprite-backed actors, not rectangles', async ({ page }) => {
  await openField(page);
  // Advance from the play-call huddle into the PRE_SNAP formation, where the
  // scene renders all 14 field players plus the referee in idle stance.
  await page.evaluate(() => window.__mlf!.pick(0));
  await page.waitForTimeout(300);
  // No actor may regress to a flat rectangle: the scene must report 15
  // sprite-backed actors (14 field players + 1 referee).
  const count = await page.evaluate(() => window.__mlf!.spriteBackedActors);
  expect(count).toBe(15);
});

test('captures the pre-snap formation screenshot', async ({ page }) => {
  await openField(page);
  // Confirm the opening play to reach the pre-snap huddle (idle stances, both
  // teams in home/away colours, ball at the line of scrimmage).
  await page.evaluate(() => window.__mlf!.pick(0));
  await page.waitForTimeout(300);
  writeFileSync(join(OUT, 'football-presnap.png'), await page.screenshot());
});

test('captures the mid-run screenshot', async ({ page }) => {
  await openField(page);
  await page.evaluate(() => {
    window.__mlf!.pick(0);
    window.__mlf!.snap();
  });
  await page.waitForTimeout(700);
  writeFileSync(join(OUT, 'football-midrun.png'), await page.screenshot());
});

test('captures the pass-in-flight screenshot', async ({ page }) => {
  await openField(page);
  await page.evaluate(() => {
    window.__mlf!.pick(2); // Quick Slants (pass)
    window.__mlf!.snap();
    window.__mlf!.openWindows();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__mlf!.throwTo('A'));
  await page.waitForTimeout(150);
  // Distinct filename: `football-pass-hazard.spec.ts` writes `football-pass.png`
  // *after* the banner, so a shared path would let that suite overwrite this
  // genuinely in-flight capture (or vice-versa).
  writeFileSync(join(OUT, 'football-pass-inflight.png'), await page.screenshot());
});

test('captures the tackle screenshot', async ({ page }) => {
  await openField(page);
  await page.evaluate(() => {
    window.__mlf!.pick(0); // run play: carrier meets the defence
    window.__mlf!.snap();
  });
  // Let the run carry into contact — the knockdown/dive states show here.
  await page.waitForTimeout(1200);
  writeFileSync(join(OUT, 'football-tackle.png'), await page.screenshot());
});

test('captures the touchdown screenshot', async ({ page }) => {
  await openField(page);
  await page.evaluate(() => {
    window.__mlf!.pick(0);
    window.__mlf!.snap();
    // Relocate the carrier to the far end zone so the run resolves a touchdown.
    window.__mlf!.forceCarrierTo(112, 26);
  });
  await page.waitForTimeout(1200);
  writeFileSync(join(OUT, 'football-touchdown.png'), await page.screenshot());
});
