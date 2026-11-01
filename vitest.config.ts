import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration. Runs every package's unit suite from the repository
 * root (`npm test`) against a jsdom environment so design-system, input-manager
 * and DOM helper tests can exercise real browser globals.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
