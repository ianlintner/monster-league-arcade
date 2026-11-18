import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Captures the art-uplift deliverable as real, reproducible screenshots under
// docs/screenshots/. The gallery page renders the regenerated assets at 4x
// nearest-neighbour from the served bundle; the football route shows the field.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

test('captures the asset gallery screenshot', async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator('h1')).toHaveText(/art uplift gallery/i);
  // Wait for every <img>/canvas draw to settle (images load async in the gallery).
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('img')];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });
  const buf = await page.screenshot({ fullPage: true });
  writeFileSync(join(OUT, 'gallery.png'), buf);
});

test('captures the football field screenshot', async ({ page }) => {
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await page.waitForTimeout(300);
  const buf = await page.screenshot();
  writeFileSync(join(OUT, 'football-field.png'), buf);
});
