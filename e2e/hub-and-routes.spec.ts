import { expect, test, type Page } from '@playwright/test';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

for (const [path, title] of [
  ['/', 'Monster League Arcade'],
  ['/football/', 'Football'],
  ['/hockey/', 'Hockey'],
] as const) {
  test(`${path} loads with GSN 66.6 chrome and no console errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(
      page.getByTestId('gsn-chrome').getByRole('heading', { name: 'GSN 66.6' }),
    ).toBeVisible();
    if (path !== '/') {
      await expect(page.locator('#game canvas')).toBeVisible();
      await expect(page.getByTestId('scorebug')).toBeVisible();
      await expect(page.getByTestId('control-bar')).toBeVisible();
    }
    await page.waitForTimeout(300);
    expect(errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_/.test(e))).toEqual([]);
  });
}

test('hub navigates to both games and back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('card-football').click();
  await expect(page).toHaveURL(/\/football\/$/);
  await page.getByTestId('back-hub').click();
  await page.getByTestId('card-hockey').click();
  await expect(page).toHaveURL(/\/hockey\/$/);
});

test('hub roster inspector and CRT toggle work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Rotting Deadskins/ }).click();
  await expect(page.getByTestId('faction-detail')).toContainText('Zombies');
  const crt = page.getByRole('button', { name: 'CRT Scanlines' });
  await crt.click();
  await expect(page.locator('body')).toHaveClass(/gsn-crt-on/);
});
