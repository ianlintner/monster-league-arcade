import { test as base, expect } from '@playwright/test';

/**
 * `test` with the first-run controls card pre-dismissed. The card swallows the first
 * key press by design, so gameplay specs that tap a play key right after load seed
 * `mla.football.seenControls` before the page scripts run. `onboarding.spec.ts`
 * imports `@playwright/test` directly so it sees the true first-run experience.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('mla.football.seenControls', '1');
    });
    await use(context);
  },
});

export { expect };
