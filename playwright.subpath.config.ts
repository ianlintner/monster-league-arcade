import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_SUBPATH_PORT ?? 4174);
const BASE_PATH = '/monster-league-arcade/';

/**
 * Sub-path smoke: the hub (https://games.cat-herding.net/monster-league-arcade/) builds this
 * repo with `--base=/monster-league-arcade/`. This config reproduces that build and serves it
 * under the same prefix (404 outside it), so any root-absolute URL fails the run.
 *
 *   npx playwright test --config playwright.subpath.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'subpath-smoke.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results/subpath',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-subpath', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build -w @monster-league/arcade-hub -- --base=${BASE_PATH} && npm run serve:dist`,
    url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT), E2E_BASE_PATH: BASE_PATH },
  },
});
