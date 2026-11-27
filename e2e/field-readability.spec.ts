import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { P1, tap } from './keys';
import { screenshotDir } from './screenshot-path';

// ML-NEXT scope 5 (G10 field readability): a visible football marker in every
// phase, driven with real keys; `window.__mlf` is read-only assertion seam.

type BallMarkerKind = 'SPOT' | 'HELD' | 'FLIGHT' | 'LOOSE';
interface BallMarker {
  visible: boolean;
  kind: BallMarkerKind;
  px: number;
  py: number;
  scale: number;
}
type Mlf = { mode: string; ballMarker: BallMarker | null };

test.use({ viewport: { width: 1280, height: 720 } });

async function openField(page: Page): Promise<void> {
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as { __mlf?: unknown }).__mlf), undefined, {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);
}

function marker(page: Page): () => Promise<BallMarker | null> {
  return () =>
    page.evaluate(() => {
      const mlf = (window as { __mlf?: Mlf }).__mlf;
      return mlf?.ballMarker ?? null;
    });
}

function expectVisibleMarker(m: BallMarker | null): void {
  expect(m).not.toBeNull();
  expect(m!.visible).toBe(true);
  // Backing canvas is 640x360; the marker must actually be on the visible field,
  // not an offscreen sentinel that merely satisfies a boolean.
  expect(m!.px).toBeGreaterThan(0);
  expect(m!.px).toBeLessThan(640);
  expect(m!.py).toBeGreaterThan(0);
  expect(m!.py).toBeLessThan(360);
  expect(m!.scale).toBeGreaterThan(0);
}

test('capture the readable field at 1280x720 with no horizontal overflow', async ({ page }) => {
  await openField(page);
  await tap(page, P1.A); // real key: confirm the opening run play
  await page.waitForTimeout(250);
  await tap(page, P1.C); // real key: snap into the live down
  await page.waitForTimeout(350);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const name = process.env.MLNEXT_FIELD_CAPTURE ?? 'mlnext-field-1280.png';
  writeFileSync(join(screenshotDir, name), await page.screenshot());
});

test('ball marker stays visible through PICK, PRE_SNAP and LIVE', async ({ page }) => {
  await openField(page);
  const read = marker(page);

  await expect
    .poll(async () => await page.evaluate(() => (window as { __mlf?: Mlf }).__mlf?.mode))
    .toBe('PICK');
  expectVisibleMarker(await read());

  await tap(page, P1.A); // real key: pick
  await expect
    .poll(async () => await page.evaluate(() => (window as { __mlf?: Mlf }).__mlf?.mode))
    .toBe('PRE_SNAP');
  expectVisibleMarker(await read());

  await tap(page, P1.C); // real key: snap
  await expect
    .poll(async () => await page.evaluate(() => (window as { __mlf?: Mlf }).__mlf?.mode))
    .toBe('LIVE');
  expectVisibleMarker(await read());
  expect((await read())!.kind).toBe('HELD');
});
