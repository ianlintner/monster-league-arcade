import type { Page } from '@playwright/test';

/**
 * P1 (player 0) keyboard map as defined by `@monster-league/shared-core`
 * `KEY_MAPS[0]`. The on-screen prompts and README mirror these exactly, so e2e
 * must drive the game with the same real keys — never the raw Phaser key codes
 * the scene used to poll, and never the `window.__mlf.pick()/snap()` bypass.
 */
export const P1 = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  /** Play card A (run) / deep-run dive / throw-to-receiver A. */
  A: 'KeyJ',
  /** Play card B (run) / showboat / throw-to-receiver B. */
  B: 'KeyK',
  /** Play card C (pass) / snap / turbo / open+throw-to-C receivers. */
  C: 'KeyL',
  START: 'KeyP',
} as const;

/**
 * Tap a key for ~30 ms so it registers as a *press* (edge), not a hold. A tap
 * this short falls entirely between two consecutive 60 Hz input polls; the
 * InputManager's edge-buffered latch must still deliver it once — this is the
 * exact defect the shipped build dropped, so the hold length is load-bearing.
 */
export async function tap(page: Page, key: string, holdMs = 30): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
}
