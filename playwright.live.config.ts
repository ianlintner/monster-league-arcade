import { defineConfig, devices } from '@playwright/test';

/**
 * Run the same E2E suite against an already-deployed Azure Static Web App.
 *
 *   E2E_BASE_URL=https://<host> npm run e2e:live
 *
 * No local web server: the deployment is the artifact under test. Screenshots
 * are written to docs/screenshots/live/ so local captures are not overwritten.
 */
const baseURL = (process.env.E2E_BASE_URL ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(baseURL)) {
  throw new Error('E2E_BASE_URL must be an http(s) URL of the deployed SWA');
}

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['screenshots.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/live',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-live', use: { ...devices['Desktop Chrome'] } }],
});
