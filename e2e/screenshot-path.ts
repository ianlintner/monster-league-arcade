import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory that E2E screenshots are written to.
 *
 * Defaults to `docs/screenshots/` (committed deliverable art). A temporary
 * override via `E2E_SCREENSHOT_DIR` can point at a gitignored directory so
 * non-deliverable captures do not dirty the working tree.
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
