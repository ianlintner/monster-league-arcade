/**
 * fieldRenderer — pure drawing for the static 2.5D gridiron + hazard terrain.
 *
 * Extracted from `MatchScene` so the field-and-hazard layer (a few hundred lines
 * of `Graphics`/`tileSprite` calls) lives apart from the scene's state machine.
 * Every function here is stateless: it takes a `DrawSurface` (the narrowed Phaser
 * `Graphics` interface) + a scene/manager and draws once. No Phaser imports; the
 * projection and palette come from `shared-core`, and the yard-number label from
 * `fieldTextures`, so this module stays unit-testable without booting Phaser.
 */
import { projectToScreen, toPhaserColor } from '@monster-league/shared-core';
import { yardNumberLabel } from './fieldTextures';
import type { DrawSurface } from './drawSurface';

export type { DrawSurface } from './drawSurface';
export { drawHazards, hazardStateKey } from './hazardRenderer';

export const FIELD_CANVAS_WIDTH = 640;
export const FIELD_CANVAS_HEIGHT = 360;

/**
 * Tiled arena turf + end-zone sprites under the line-work. The home faction's
 * arena (REAPERS → cursed_graveyard) supplies the 64×64 tiles. Because the
 * projection is a perspective trapezoid, each field region (two end zones and
 * the field of play between them) is drawn as its **own** horizontal band whose
 * left/right edges follow the projected corners, so the three regions sit
 * side-by-side instead of overlapping one rectangle.
 *
 * The Phaser **canvas** renderer clamps a geometry mask to a near-point
 * triangle, so we don't use `createGeometryMask` here. Instead each region is
 * sliced into thin horizontal `tileSprite` bands: every band is a plain
 * rectangle spanning the region's x-range at that row, and the bands' tapered
 * widths trace the trapezoid's left/right edges. Bands overlap their neighbours
 * by 1px so the tile lines never gap, and the region boundaries land exactly on
 * the x=10/110 goal lines, so the end-zone and field-of-play textures never
 * bleed across each other.
 */
export function drawFieldSprites(scene: {
  textures: { exists(key: string): boolean };
  add: {
    tileSprite(
      x: number,
      y: number,
      width: number,
      height: number,
      key: string,
    ): {
      setOrigin(x: number, y: number): { setDepth(d: number): unknown };
      setDepth(d: number): unknown;
    };
  };
}): void {
  const turf = 'cursed_graveyard_turf';
  const endzone = 'cursed_graveyard_endzone';
  if (!scene.textures.exists(turf)) return;

  // Slice the field height (53 yd) into thin bands. Each band is a full-width
  // rectangle at that row whose x-range is the region's projected span; stacked
  // top-to-bottom they trace the perspective trapezoid without a mask.
  const BANDS = 20;
  const drawRegion = (x0: number, x1: number, key: string) => {
    for (let i = 0; i < BANDS; i++) {
      // Field-y of the band's centre row (0 = far edge, 53 = near edge). The
      // near edge (bottom) is *below* the far edge on screen.
      const y0 = (i / BANDS) * 53;
      const y1 = ((i + 1) / BANDS) * 53;
      const farL = projectToScreen(x0, y0);
      const farR = projectToScreen(x1, y0);
      const nearR = projectToScreen(x1, y1);
      const nearL = projectToScreen(x0, y1);
      // Left edge is the min of the two left corners, right the max of the two
      // right corners; overdraw 1px horizontally so neighbouring bands tile
      // without a gap along the tapered (non-vertical) boundary.
      const left = Math.min(farL.x, nearL.x) - 1;
      const right = Math.max(farR.x, nearR.x) + 1;
      const w = right - left;
      const cy = (farL.y + nearL.y) / 2;
      const h = Math.max(1, nearL.y - farL.y) + 1;
      scene.add
        .tileSprite(left + w / 2, cy, w, h, key)
        .setOrigin(0.5, 0.5)
        .setDepth(-1);
    }
  };

  // Field of play first, end zones on top, so the (overdrawn 1px) end-zone
  // edges sit exactly on the x=10/110 goal lines and never smear either way.
  drawRegion(10, 110, turf);
  drawRegion(0, 10, endzone);
  drawRegion(110, 120, endzone);
}

/** Draw the static 2.5D gridiron line-work + markings once. */
export function drawField(g: DrawSurface): void {
  // NOTE: no opaque backdrop is painted here. The game config sets
  // `backgroundColor: VOID_BLACK`, which fills every pixel the depth -1 arena
  // sprites don't cover. Painting an opaque rectangle on this Graphics layer's
  // depth 0 would sit *above* those arena images and hide the turf. The
  // line-work below is translucent and belongs above the turf.

  // Arena surround: the field is a perspective trapezoid whose two far corners
  // pull in from the canvas top. The corner wedges left behind must read as
  // "ground outside the field" (CRYPT_SLATE) — not unrendered void or leached
  // turf — so paint both wedges here, above the turf band, before the markings.
  const tlOut = projectToScreen(0, 0);
  const trOut = projectToScreen(120, 0);
  const blOut = projectToScreen(0, 53);
  const brOut = projectToScreen(120, 53);
  g.fillStyle(toPhaserColor('CRYPT_SLATE'), 1);
  // Top-left wedge: (0,0) → (far-left) → (near-left).
  g.fillTriangle(0, 0, tlOut.x, tlOut.y, blOut.x, blOut.y);
  // Top-right wedge: (640,0) → (far-right) → (near-right).
  g.fillTriangle(FIELD_CANVAS_WIDTH, 0, trOut.x, trOut.y, brOut.x, brOut.y);

  // Solid sideline borders on all four field edges so the bands read cleanly
  // against the surround (no clipped/detached edges).
  g.lineStyle(2, toPhaserColor('BONE_WHITE'), 0.9);
  g.lineBetween(tlOut.x, tlOut.y, trOut.x, trOut.y); // far sideline (top)
  g.lineBetween(blOut.x, blOut.y, brOut.x, brOut.y); // near sideline (bottom)
  g.lineBetween(tlOut.x, tlOut.y, blOut.x, blOut.y); // left diagonal
  g.lineBetween(trOut.x, trOut.y, brOut.x, brOut.y); // right diagonal

  // End-zone tint quads (the turf/end-zone sprites fill them; these add a faint
  // faction-color wash). The field of play is now the turf sprite, so no quad here.
  perspectiveQuad(g, 0, 10, toPhaserColor('PUMPKIN_ORANGE'), 0.2);
  perspectiveQuad(g, 110, 120, toPhaserColor('VAMPIRE_CRIMSON'), 0.2);

  // Yard lines every 5 yards; heavier at 10s; hash marks on minors.
  for (let x = 10; x <= 110; x += 5) {
    const major = x % 10 === 0;
    const a = projectToScreen(x, 0);
    const b = projectToScreen(x, 53);
    g.lineStyle(major ? 2 : 1, toPhaserColor('BONE_WHITE'), major ? 0.9 : 0.5);
    g.lineBetween(a.x, a.y, b.x, b.y);
    if (!major) drawHashes(g, x);
  }

  // Yard numbers sit ON the 10-yard lines. Nine labels span the field
  // 10 → 20 → 30 → 40 → 50 → 40 → 30 → 20 → 10 exactly once each: the "10"
  // appears at BOTH ends (x=20 and x=100, ten yards inside each goal line) but
  // never doubled on one end, and both halves mirror each other around midfield.
  for (let x = 20; x <= 100; x += 10) {
    drawYardNumber(g, x);
  }

  // Midfield crest at the 50.
  const c = projectToScreen(60, 26.5);
  drawCrest(g, c.x, c.y, c.scale);

  // Goalposts at the back of each end zone (x≈0 and x≈120), anchored on the
  // goal line and rotated none — they stand up out of the field.
  drawGoalpost(g, projectToScreen(0.5, 26.5));
  drawGoalpost(g, projectToScreen(119.5, 26.5));

  drawAttackArrows(g);
}

/** Attack-direction cue: every drive runs +x (toward the right end zone, whichever
 *  team has the ball), so paint chevrons ahead of each 10-yard line pointing right
 *  and a bold arrow in the target end zone. Static, drawn once with the field. */
function drawAttackArrows(g: DrawSurface): void {
  const color = toPhaserColor('ECTO_GREEN');
  const chevron = (x: number, y: number, size: number, alpha: number) => {
    const tip = projectToScreen(x + size, y);
    const top = projectToScreen(x, y - size * 0.9);
    const bot = projectToScreen(x, y + size * 0.9);
    g.lineStyle(2, color, alpha);
    g.lineBetween(top.x, top.y, tip.x, tip.y);
    g.lineBetween(bot.x, bot.y, tip.x, tip.y);
  };
  for (const x of [25, 35, 45, 55, 65, 75, 85, 95]) chevron(x, 26.5, 2, 0.35);
  // End-zone arrow: shaft + head at the centre of the target end zone.
  const tail = projectToScreen(112, 26.5);
  const head = projectToScreen(118, 26.5);
  g.lineStyle(3, color, 0.85);
  g.lineBetween(tail.x, tail.y, head.x, head.y);
  chevron(115.5, 26.5, 2.5, 0.85);
}

function perspectiveQuad(
  g: DrawSurface,
  x0: number,
  x1: number,
  color: number,
  alpha: number,
): void {
  const tl = projectToScreen(x0, 0);
  const tr = projectToScreen(x1, 0);
  const br = projectToScreen(x1, 53);
  const bl = projectToScreen(x0, 53);
  g.fillStyle(color, alpha);
  g.fillTriangle(tl.x, tl.y, tr.x, tr.y, br.x, br.y);
  g.fillTriangle(tl.x, tl.y, br.x, br.y, bl.x, bl.y);
}

function drawHashes(g: DrawSurface, x: number): void {
  g.lineStyle(1, toPhaserColor('AGED_PARCHMENT'), 0.6);
  for (const cy of [20.5, 32.5]) {
    const a = projectToScreen(x, cy - 1);
    const b = projectToScreen(x, cy + 1);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }
}

function drawYardNumber(g: DrawSurface, x: number): void {
  // Numbers sit ON a 10-yard line (caller passes x = 20, 30, …, 100), so the
  // label is the yard-line's distance to the *nearer* goal line (x=10 vs
  // x=110) — the two halves mirror each other exactly: x=20→"10", x=60→"50",
  // x=100→"10". The 10-yard band just inside each goal reads "10" (not "0").
  const label = yardNumberLabel(x);
  const top = projectToScreen(x, 14);
  const bot = projectToScreen(x, 39);
  drawBlockText(g, label, top.x, top.y, top.scale);
  drawBlockText(g, label, bot.x, bot.y, bot.scale);
}

/** A cheap 3x5 pixel digit drawn as filled cells (only 0..9 needed). */
function drawBlockText(g: DrawSurface, text: string, cx: number, cy: number, s: number): void {
  const glyphs: Record<string, number> = {
    '0': 0x7b6f,
    '1': 0x1249,
    '2': 0x73e7,
    '3': 0x73cf,
    '4': 0x5bc9,
    '5': 0x79cf,
    '6': 0x79ef,
    '7': 0x7249,
    '8': 0x7bef,
    '9': 0x7bcf,
  };
  const cw = Math.max(3, 4 * s);
  const ch = Math.max(5, 6 * s);
  const gap = Math.max(1, s);
  // Render every digit, offsetting each glyph to the right, so "10"/"40" show
  // both characters instead of only the leading one.
  const total = text.length * (cw * 3) + (text.length - 1) * gap;
  const xBase = cx - total / 2;
  const y0 = cy - ch / 2;
  // 1px #0B0711 outline so the digits read clearly over the turf/yard lines.
  const outline = Math.max(1, Math.round(s));
  // The yard numbers at x=15,25,… coincide with the *minor* lines drawn every
  // five yards, so those lines run straight through the label and peek between
  // the digit cells (a per-cell outline can't hide a line inside a glyph gap).
  // Lay a VOID_BLACK panel over the label's full bounds — including the outline
  // and a hair of padding — so the crossing line is masked around the whole
  // number, not just the lit cells. VOID_BLACK is the outline colour, so the
  // panel reads as the number's dark plaque rather than a stray turf patch.
  // Each digit occupies five glyph rows vertically (`y0 + row * ch`), so the
  // panel must be `5 * ch` tall to cover the lower rows' glyph gaps — not `ch`,
  // which masks only the top row and lets the minor line peek through below.
  const pad = Math.max(1, Math.round(s * 2));
  g.fillStyle(toPhaserColor('VOID_BLACK'), 1);
  g.fillRect(
    xBase - outline - pad,
    y0 - outline - pad,
    total + (outline + pad) * 2,
    5 * ch + (outline + pad) * 2,
  );
  const draw = (color: number, alpha: number, inset: number) => {
    g.fillStyle(color, alpha);
    for (let i = 0; i < text.length; i++) {
      const bits = glyphs[text[i] ?? '0'] ?? 0;
      const x0 = xBase + i * (cw * 3 + gap);
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (bits & (1 << (row * 3 + col))) {
            g.fillRect(
              x0 + col * cw - inset,
              y0 + row * ch - inset,
              cw + inset * 2,
              ch + inset * 2,
            );
          }
        }
      }
    }
  };
  // Outline pass (expanded by 1px), then the white fill on top.
  draw(toPhaserColor('VOID_BLACK'), 1, outline);
  draw(toPhaserColor('BONE_WHITE'), 0.85, 0);
}

function drawCrest(g: DrawSurface, cx: number, cy: number, s: number): void {
  const r = Math.max(8, 16 * s);
  g.fillStyle(toPhaserColor('IRON_BEZEL'), 0.8);
  g.fillEllipse(cx, cy, r, r);
  g.lineStyle(Math.max(1, 2 * s), toPhaserColor('BONE_WHITE'), 0.9);
  g.strokeEllipse(cx, cy, r, r);
  g.fillStyle(toPhaserColor('BONE_WHITE'), 1);
  g.fillRect(cx - r * 0.4, cy - r * 0.3, r * 0.2, r * 0.3);
  g.fillRect(cx + r * 0.2, cy - r * 0.3, r * 0.2, r * 0.3);
}

function drawGoalpost(g: DrawSurface, base: { x: number; y: number; scale: number }): void {
  // Solid goalposts anchored at the back of each end zone: two filled uprights
  // and a solid crossbar, sized to the depth scale so the near goalpost reads
  // clearly while the far one stays proportional. The uprights sit on the back
  // goal line and rise straight up (no detached "floating H" outline).
  const u = Math.max(2, 3 * base.scale); // upright thickness
  const h = 30 * base.scale; // upright height above the crossbar line
  const w = 11 * base.scale; // half the crossbar span
  const crossY = base.y - h * 0.45; // crossbar elevation
  g.fillStyle(toPhaserColor('BONE_WHITE'), 1);
  g.fillRect(base.x - w - u / 2, base.y - h - u, u, h); // left upright
  g.fillRect(base.x + w - u / 2, base.y - h - u, u, h); // right upright
  g.fillRect(base.x - w, crossY - u / 2, w * 2, u); // crossbar
}
