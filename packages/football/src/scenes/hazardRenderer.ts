/**
 * hazardRenderer — procedural sprite layer for graveyard hazards.
 *
 * Split out of `fieldRenderer` to respect the ~400-line ceiling in
 * ARCHITECTURE.md; it owns the armed/telegraph drawing and the state key that
 * tells the scene when to redraw. All drawing is primitive shapes in the
 * Midnight Palette with a 1px `#0B0711` outline (PLAN.md §2) — no paid art, no
 * generated texture files, so `npm run validate-assets` stays untouched.
 */
import { projectToScreen, toPhaserColor } from '@monster-league/shared-core';
import type { HazardManager } from '../field/HazardManager';
import type { DrawSurface } from './drawSurface';

type Spot = { x: number; y: number; scale: number };

/** Redraw when armed state *or* a telegraphed geyser's countdown changes. */
export function hazardStateKey(manager: HazardManager): string {
  return manager
    .snapshot()
    .map((h) =>
      h.kind === 'LAVA_GEYSER' && !h.armed
        ? `${h.id}:telegraph:${Math.round(h.telegraphSeconds * 10)}`
        : `${h.id}:${h.armed}`,
    )
    .join('|');
}

function drawTombstoneSprite(g: DrawSurface, s: Spot): void {
  const u = Math.max(1, s.scale);
  const w = 9 * u;
  const h = 13 * u;
  const top = s.y - 9 * u;
  const x = s.x;
  // Plinth and shoulder pebbles.
  g.fillStyle(toPhaserColor('IRON_BEZEL'), 1);
  g.fillRect(x - 7 * u, s.y + 2 * u, 14 * u, 2 * u);
  g.fillStyle(toPhaserColor('TOMBSTONE_GRAY'), 1);
  g.fillRect(x - 5 * u, s.y + 1 * u, 3 * u, 2 * u);
  g.fillRect(x + 2 * u, s.y + 1 * u, 3 * u, 2 * u);
  // Headstone: black bezel then stone inset with a pointed shoulder.
  g.fillStyle(toPhaserColor('VOID_BLACK'), 1);
  g.fillRect(x - w / 2 - u, top - u, w + 2 * u, h + 2 * u);
  g.fillStyle(toPhaserColor('TOMBSTONE_GRAY'), 1);
  g.fillRect(x - w / 2, top, w, h);
  g.fillTriangle(x - w / 2, top, x, top - 3 * u, x + w / 2, top);
  // Engraved cross in bone; an IPU-style memorial, no lettering textures.
  g.fillStyle(toPhaserColor('BONE_WHITE'), 0.85);
  g.fillRect(x - u / 2, top + 3 * u, u, 5 * u);
  g.fillRect(x - 2.5 * u, top + 4 * u, 5 * u, u);
  g.fillStyle(toPhaserColor('VOID_BLACK'), 0.9);
  g.fillRect(x - 2 * u, top + 9 * u, 4 * u, u);
}

function drawOpenGraveSprite(g: DrawSurface, s: Spot): void {
  const u = Math.max(1, s.scale);
  const rx = 8 * u;
  const ry = 5 * u;
  // Dirt mound behind the pit, with scattered stones.
  g.fillStyle(toPhaserColor('IRON_BEZEL'), 1);
  g.fillEllipse(s.x, s.y + 2 * u, rx + 5 * u, ry + 2 * u);
  g.fillStyle(toPhaserColor('TOMBSTONE_GRAY'), 1);
  g.fillRect(s.x - 9 * u, s.y + 3 * u, 3 * u, 2 * u);
  g.fillRect(s.x + 6 * u, s.y + 2 * u, 3 * u, 2 * u);
  // The pit itself: pure void, rimmed with bone so it reads over dark turf.
  g.fillStyle(toPhaserColor('VOID_BLACK'), 1);
  g.fillEllipse(s.x, s.y, rx, ry);
  g.lineStyle(u, toPhaserColor('BONE_WHITE'), 0.9);
  g.strokeEllipse(s.x, s.y, rx, ry);
  // Coffin planks across the mouth, broken mid-span.
  g.lineStyle(u, toPhaserColor('TOMBSTONE_GRAY'), 0.85);
  g.lineBetween(s.x - 5 * u, s.y - 2 * u, s.x - u, s.y - u);
  g.lineBetween(s.x + u, s.y + u, s.x + 5 * u, s.y + 2 * u);
  // A bone on the lip: shaft and two knuckles, no sprite atlas needed.
  g.fillStyle(toPhaserColor('BONE_WHITE'), 1);
  g.fillRect(s.x - 4 * u, s.y + 4 * u, 6 * u, u);
  g.fillRect(s.x - 5 * u, s.y + 3 * u, u, 3 * u);
  g.fillRect(s.x + 1 * u, s.y + 4 * u, u, 3 * u);
}

function drawGeyserSprite(g: DrawSurface, s: Spot, armed: boolean, frac: number): void {
  const u = Math.max(1, s.scale);
  // Charred vent rim with a 1px outline before any state-specific core.
  g.fillStyle(toPhaserColor('VOID_BLACK'), 1);
  g.fillEllipse(s.x, s.y, 10 * u, 7 * u);
  g.lineStyle(u, toPhaserColor('IRON_BEZEL'), 1);
  g.strokeEllipse(s.x, s.y, 10 * u, 7 * u);
  if (armed) {
    g.fillStyle(toPhaserColor('VAMPIRE_CRIMSON'), 0.95);
    g.fillEllipse(s.x, s.y, 7 * u, 5 * u);
    g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
    g.fillEllipse(s.x, s.y - u, 4 * u, 2 * u);
    // Magma cracks radiating from the vent.
    g.lineStyle(u, toPhaserColor('HELLFIRE_AMBER'), 0.9);
    g.lineBetween(s.x - 11 * u, s.y - 4 * u, s.x - 6 * u, s.y - 2 * u);
    g.lineBetween(s.x + 6 * u, s.y + 2 * u, s.x + 11 * u, s.y + 4 * u);
    g.lineBetween(s.x - 2 * u, s.y + 6 * u, s.x, s.y + 9 * u);
  } else {
    // Telegraph: a filling core and a rising ember the player can read before
    // the eruption. `frac` goes 0→1 as the countdown runs out.
    g.lineStyle(u, toPhaserColor('HELLFIRE_AMBER'), 0.8);
    g.strokeEllipse(s.x, s.y, 8 * u, 5 * u);
    g.fillStyle(toPhaserColor('VAMPIRE_CRIMSON'), 0.25 + 0.3 * frac);
    g.fillEllipse(s.x, s.y, 7 * u * (0.35 + 0.65 * frac), 4 * u * (0.35 + 0.65 * frac));
    g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 0.9);
    g.fillRect(s.x - u, s.y - 6 * u - 2 * u * frac, 2 * u, 2 * u * frac);
  }
}

export function drawHazards(g: DrawSurface, manager: HazardManager): void {
  // Hazard coords are absolute field-of-play (x∈[0,100], y lat. ±26.66); the
  // 10-yard end zone offset maps them into projection space.
  for (const h of manager.snapshot()) {
    // Geysers are visible during their warning interval (armed=false,
    // telegraphSeconds>0) so the telegraph is readable *before* it erupts.
    // Other unarmed hazards (spent mines, dive-cleared sludge) stay invisible.
    const telegraphed = h.kind === 'LAVA_GEYSER' && !h.armed && h.telegraphSeconds > 0;
    if (!h.armed && !telegraphed) continue;
    const s = projectToScreen(10 + h.x, 26.5 + h.y);
    switch (h.kind) {
      case 'TOMBSTONE':
        drawTombstoneSprite(g, s);
        break;
      case 'OPEN_GRAVE':
        drawOpenGraveSprite(g, s);
        break;
      case 'MINE':
        g.fillStyle(toPhaserColor('PUMPKIN_ORANGE'), 1);
        g.fillEllipse(s.x, s.y, 6 * s.scale, 6 * s.scale);
        g.fillStyle(toPhaserColor('ECTO_GREEN'), 1);
        g.fillRect(s.x - 2 * s.scale, s.y - 3 * s.scale, 4 * s.scale, 2 * s.scale);
        break;
      case 'LAVA_GEYSER':
        drawGeyserSprite(g, s, h.armed, 1 - Math.max(0, Math.min(1, h.telegraphSeconds)));
        break;
      case 'BOG':
      case 'SLUDGE':
        g.fillStyle(
          h.kind === 'BOG' ? toPhaserColor('ECTO_GREEN') : toPhaserColor('IRON_BEZEL'),
          0.4,
        );
        g.fillEllipse(s.x, s.y, 12 * s.scale, 9 * s.scale);
        break;
    }
  }
}
