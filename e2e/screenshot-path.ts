import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory that E2E screenshots are written to.
 *
 * Defaults to `docs/screenshots/` (committed deliverable art). The live-deploy
 * config (`playwright.live.config.ts`) sets `E2E_SCREENSHOT_DIR` to the
 * gitignored `docs/screenshots/live/` so `e2e:live` does not dirty the working
 * tree and therefore does not trip deploy.sh's clean-tree preflight.
 */
export const screenshotDir = (() => {
  const dir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    process.env.E2E_SCREENSHOT_DIR ?? 'docs/screenshots',
  );
  mkdirSync(dir, { recursive: true });
  return dir;
})();
