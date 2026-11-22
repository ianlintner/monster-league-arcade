import type { Page } from '@playwright/test';

/**
 * Known-benign message we tolerate: Chromium logs `net::ERR_ABORTED` to the
 * console when a subresource request is cancelled by a navigation or page
 * teardown (e.g. a Google Font still in flight when the test moves on). A
 * genuine load failure surfaces through the `requestfailed` listener instead,
 * so this does not mask real breakage.
 */
const KNOWN_BENIGN_CONSOLE = /fonts\.(googleapis|gstatic)|net::ERR_ABORTED/;

/**
 * Collect console errors, uncaught page errors and failed requests for the
 * given page. The returned array is appended to in place, so hold it across the
 * test and assert on it after the page has settled.
 */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN_BENIGN_CONSOLE.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`);
  });
  return errors;
}
