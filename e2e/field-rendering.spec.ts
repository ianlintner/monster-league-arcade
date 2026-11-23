import { expect, test, type Page } from '@playwright/test';
import { P1, tap } from './keys';

// Field-rendering acceptance (card t_dbfa80af): full turf coverage under the
// 2.5D projection, readable players (≥48 CSS px), and the integer-scaled canvas.
// Every interaction below drives the game with REAL keyboard events; `window.__mlf`
// is read-only here (assertions only), never `pick()/snap()`.

/**
 * Read-only seam shared by the football specs: the controlled player's projected
 * screen-space footprint plus the live camera zoom, used to compute the on-screen
 * sprite height without interrogating Phaser internals or bypassing input.
 */
interface CarrierScreen {
  px: number;
  py: number;
  scale: number;
  camZoom: number;
}

type Mlf = {
  phase: string;
  mode: string;
  carrierScreen: CarrierScreen | null;
};

const SPRITE_BACKING = 48; // 48×48 atlas cell

/** Open the football route and settle into the play-call huddle. */
async function openField(page: Page): Promise<void> {
  await page.goto('/football/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByTestId('scorebug')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as { __mlf?: unknown }).__mlf), undefined, {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);
}

/** Read the debug handle, typed against the seam this spec relies on. */
function mlf(page: Page): () => Promise<Mlf> {
  return () => page.evaluate(() => (window as { __mlf?: Mlf }).__mlf as Mlf);
}

test.use({ viewport: { width: 1280, height: 800 } });

test('canvas is integer-scaled to 2x at 1280 wide, nearest-neighbour', async ({ page }) => {
  await openField(page);
  const r = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#game canvas')!;
    const rect = c.getBoundingClientRect();
    return {
      attrW: c.width,
      attrH: c.height,
      cssW: rect.width,
      cssH: rect.height,
      imageRendering: getComputedStyle(c).imageRendering,
    };
  });
  // 640×360 backing rendered as an exact integer multiple (2x at 1280 wide).
  expect(r.attrW).toBe(640);
  expect(r.attrH).toBe(360);
  expect(r.cssW).toBe(1280);
  expect(r.cssH).toBe(720);
  expect(r.imageRendering).toBe('pixelated');
});

test('pre-snap field polygon is fully turfed (no near-black gaps)', async ({ page }) => {
  await openField(page);
  // Confirm the opening run play then snap with real keys: the camera frames the
  // field around the ball, so the visible view is the turfed field-of-play.
  await tap(page, P1.A);
  await page.waitForTimeout(300);
  await tap(page, P1.C);
  await page.waitForTimeout(400);

  const c = page.locator('#game canvas');
  const buf = await c.screenshot();
  const sample = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { width: W, height: H } = cv;
    const data = ctx.getImageData(0, 0, W, H).data;
    let nearBlack = 0;
    let total = 0;
    const x0 = Math.floor(W * 0.06);
    const x1 = Math.floor(W * 0.94);
    const y0 = Math.floor(H * 0.12);
    const y1 = Math.floor(H * 0.92);
    for (let gy = y0; gy <= y1; gy += 4) {
      for (let gx = x0; gx <= x1; gx += 4) {
        const i = (gy * W + gx) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        total += 1;
        // "Near-black" = the field's void/outline colour (VOID_BLACK #0B0711 and
        // darker). Turf (#2a4d3e) is far outside this band.
        if (r < 25 && g < 20 && b < 25) nearBlack += 1;
      }
    }
    return { nearBlack, total };
  }, buf.toString('base64'));

  const fraction = sample.nearBlack / sample.total;
  // Turf is everywhere: the PLAN-mandated 1px #0B0711 sprite/line outlines survive
  // as scattered near-black pixels (≈3.5% at 2x), but the original defect left
  // ~57% of the field a contiguous near-black void behind the turf diagonal. A
  // fully turfed field stays comfortably under 8%; a regressed one blows past 50%.
  expect(fraction).toBeLessThan(0.08);
});

test('controlled player renders at least 48 CSS px tall at 1280x800', async ({ page }) => {
  await openField(page);
  await tap(page, P1.A);
  await page.waitForTimeout(300);
  await tap(page, P1.C); // real snap → the carrier becomes the controlled player
  await page.waitForTimeout(400);

  const read = mlf(page);
  const carrier = (await read()).carrierScreen;
  expect(carrier).not.toBeNull();
  // On-screen CSS height = 48 backing px × depth scale × camera zoom × CSS scale.
  const cssScale = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#game canvas')!;
    const rect = c.getBoundingClientRect();
    return rect.width / c.width; // 2 at 1280 wide
  });
  const cssHeight = SPRITE_BACKING * carrier!.scale * carrier!.camZoom * cssScale;
  expect(cssHeight).toBeGreaterThanOrEqual(48);
});
