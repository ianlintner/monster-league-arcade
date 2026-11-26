import { expect, test, type Page } from '@playwright/test';
import { trackErrors } from './errors';

// Run only via playwright.subpath.config.ts (build with --base=/monster-league-arcade/, served
// under that prefix). The default config ignores this file.
const BASE = '/monster-league-arcade/';

function trackRequests(page: Page) {
  const outside: string[] = [];
  const own: string[] = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') return; // fonts etc.
    if (!u.pathname.startsWith(BASE)) outside.push(`${u.pathname} (HTTP ${r.status()})`);
    else if (r.status() !== 200) outside.push(`${u.pathname} HTTP ${r.status()}`);
    else own.push(u.pathname);
  });
  return { outside, own };
}

test('hub renders art and links stay under the base path', async ({ page }) => {
  const errors = trackErrors(page);
  const { outside, own } = trackRequests(page);
  await page.goto('');
  await expect(page.getByTestId('gsn-chrome')).toBeVisible();
  await page.getByRole('button', { name: /Rotting Deadskins/ }).click();
  await expect(page.getByTestId('faction-coach-portrait')).toBeVisible();
  await page.waitForTimeout(500);
  expect(outside).toEqual([]);
  expect(own.some((p) => p.startsWith(`${BASE}assets/portraits/`))).toBe(true);
  expect(errors).toEqual([]);

  await page.getByTestId('card-football').click();
  await expect(page).toHaveURL(new RegExp(`${BASE}football/$`));
  await page.getByTestId('back-hub').click();
  await expect(page).toHaveURL(new RegExp(`${BASE}$`));
  await page.getByTestId('card-hockey').click();
  await expect(page).toHaveURL(new RegExp(`${BASE}hockey/$`));
});

test('football boots and loads atlas, sprites and arenas from the base path', async ({ page }) => {
  const errors = trackErrors(page);
  const { outside, own } = trackRequests(page);
  await page.goto('football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(outside).toEqual([]);
  expect(own).toContain(`${BASE}assets/atlas.json`);
  expect(own.some((p) => p.startsWith(`${BASE}assets/sprites/`))).toBe(true);
  expect(own.some((p) => p.startsWith(`${BASE}assets/arenas/`))).toBe(true);
  expect(errors).toEqual([]);
});

test('hockey loads and gallery resolves art relative to the base', async ({ page }) => {
  const errors = trackErrors(page);
  const { outside } = trackRequests(page);
  await page.goto('hockey/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.goto('gallery.html');
  await page.waitForTimeout(800);
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});
