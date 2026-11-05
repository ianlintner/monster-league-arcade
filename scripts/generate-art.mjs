#!/usr/bin/env node
/**
 * Deterministic procedural pixel-art generator ($0 spend, no model calls, no text in pixels).
 * Draws raw frames, then runs EVERY frame through scripts/normalize-art.mjs (palette + 1px VOID outline).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASTER as M, FACTION_COLORS as F, hexToRgb, dark, light } from './art-palette.mjs';
import { normalizeFrame } from './normalize-art.mjs';
import * as S from './asset-spec.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets');

class Buf {
  constructor(w, h, fill = null) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
    if (fill) this.rect(0, 0, w, h, fill);
  }
  px(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d.set([...hexToRgb(c), 255], (y * this.w + x) * 4);
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  ell(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2 <= 1) this.px(x, y, c);
  }
  line(x0, y0, x1, y1, c, t = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++)
      this.rect(
        Math.round(x0 + ((x1 - x0) * i) / n),
        Math.round(y0 + ((y1 - y0) * i) / n),
        t,
        t,
        c,
      );
  }
  recolorSolid(c) {
    const rgb = hexToRgb(c);
    for (let i = 0; i < this.d.length; i += 4) if (this.d[i + 3]) this.d.set(rgb, i);
  }
}

// ---- faction styling ---------------------------------------------------------------------------
const STYLE = {
  boneyard_reapers: {
    skin: M.BONE_WHITE,
    jersey: F.OBSIDIAN_PURPLE,
    trim: M.BONE_WHITE,
    pad: M.TOMBSTONE_GRAY,
    eye: M.SPECTRAL_CYAN,
    pants: F.OBSIDIAN_PURPLE,
  },
  rotting_deadskins: {
    skin: F.PUTRID_OLIVE,
    jersey: F.RUST_BLOOD,
    trim: M.ECTO_GREEN,
    pad: F.RUST_BLOOD,
    eye: M.HELLFIRE_AMBER,
    pants: dark(F.RUST_BLOOD),
  },
  transylvania_nightstalkers: {
    skin: M.AGED_PARCHMENT,
    jersey: F.MIDNIGHT_CRIMSON,
    trim: F.VAMPIRE_GOLD,
    pad: F.VELVET_BLACK,
    eye: M.VAMPIRE_CRIMSON,
    pants: F.VELVET_BLACK,
  },
  salem_bayou_ghouls: {
    skin: F.SWAMP_MOSS,
    jersey: F.HEX_VIOLET,
    trim: M.PUMPKIN_ORANGE,
    pad: F.HEX_VIOLET,
    eye: M.PUMPKIN_ORANGE,
    pants: F.SWAMP_MOSS,
  },
  necro_ref: {
    skin: M.BONE_WHITE,
    jersey: M.BONE_WHITE,
    trim: M.VOID_BLACK,
    pad: M.VOID_BLACK,
    eye: M.VAMPIRE_CRIMSON,
    pants: M.VOID_BLACK,
    stripes: true,
  },
  demon_ref: {
    skin: M.VAMPIRE_CRIMSON,
    jersey: M.BONE_WHITE,
    trim: M.VOID_BLACK,
    pad: M.VOID_BLACK,
    eye: M.HELLFIRE_AMBER,
    pants: M.VOID_BLACK,
    stripes: true,
  },
};

/** pose: view{kind,s}, bob, lx, rx, ll, rl (leg lift), al/ar hand [dx,dy], lean */
function drawUpright(b, id, p) {
  const st = STYLE[id];
  const cx = 24 + (p.lean ?? 0);
  const bob = p.bob ?? 0;
  const v = p.view ?? { kind: 'front', s: 0 };
  const side = v.kind === 'side';
  const tw = side ? 9 : 14;
  const legY = 32 + bob;
  const lleg = (side ? cx - 4 : cx - 6) + (p.lx ?? 0);
  const rleg = (side ? cx + 0 : cx + 2) + (p.rx ?? 0);
  for (const [lx, lift] of [
    [lleg, p.ll ?? 0],
    [rleg, p.rl ?? 0],
  ]) {
    b.rect(lx, legY, 4, 10 - bob - lift, st.pants);
    b.rect(
      lx - 1,
      legY + 9 - bob - lift,
      6,
      3,
      M.VOID_BLACK === st.pants ? M.IRON_BEZEL : dark(st.pants),
    );
  }
  // arms (behind torso for back view is fine)
  const shY = 23 + bob;
  const armC =
    id === 'rotting_deadskins' || id === 'salem_bayou_ghouls' || id === 'demon_ref'
      ? st.skin
      : st.skin;
  const sx = side ? 4 : 9;
  b.line(cx - sx, shY, cx - sx + (p.al?.[0] ?? -2), shY + (p.al?.[1] ?? 8), armC, 2);
  b.line(cx + sx - 1, shY, cx + sx - 1 + (p.ar?.[0] ?? 2), shY + (p.ar?.[1] ?? 8), armC, 2);
  // torso
  const tx = cx - Math.floor(tw / 2);
  b.rect(tx, 20 + bob, tw, 13, st.jersey);
  b.rect(tx, 20 + bob, tw, 2, light(st.jersey)); // top-left rim highlight band
  if (st.stripes) for (let i = 0; i < tw; i += 3) b.rect(tx + i, 22 + bob, 1, 11, M.VOID_BLACK);
  else b.rect(tx, 29 + bob, tw, 2, st.trim); // jersey belt trim
  if (id === 'boneyard_reapers' && !side && v.kind === 'front')
    for (let y = 23; y < 29; y += 2) b.rect(cx - 4, y + bob, 8, 1, M.BONE_WHITE); // ribcage
  if (id === 'salem_bayou_ghouls')
    b.rect(cx - 2 + (side ? 2 : 0), 31 + bob, 4, 3, M.PUMPKIN_ORANGE); // lantern belt
  if (id === 'rotting_deadskins') {
    b.px(tx + 2, 27 + bob, st.skin);
    b.px(tx + 6, 31 + bob, st.skin);
  } // torn jersey
  // shoulder pads
  const padL = id === 'rotting_deadskins' ? 8 : 6;
  const padR = id === 'rotting_deadskins' ? 5 : 6;
  if (!side) {
    b.rect(cx - 10, 19 + bob, padL, 5, st.pad);
    b.rect(cx - 10, 19 + bob, padL, 1, light(st.pad));
    b.rect(cx + 10 - padR, 19 + bob, padR, 5, st.pad);
    if (id === 'boneyard_reapers') {
      b.px(cx - 9, 17 + bob, M.BONE_WHITE);
      b.px(cx - 9, 18 + bob, M.BONE_WHITE);
      b.px(cx + 8, 17 + bob, M.BONE_WHITE);
      b.px(cx + 8, 18 + bob, M.BONE_WHITE);
    }
    if (id === 'transylvania_nightstalkers') {
      b.rect(cx - 10, 18 + bob, 3, 2, F.VAMPIRE_GOLD);
      b.rect(cx + 7, 18 + bob, 3, 2, F.VAMPIRE_GOLD);
      b.rect(cx - 7, 34 + bob, 14, 3, F.VELVET_BLACK);
    }
  } else b.rect(cx - 4, 19 + bob, 8, 5, st.pad);
  // head
  const hy = 9 + bob;
  b.rect(cx - 5, hy, 10, 10, st.skin);
  b.rect(cx - 5, hy, 10, 1, light(st.skin));
  if (id === 'boneyard_reapers') {
    b.rect(cx - 6, hy - 1, 12, 3, M.TOMBSTONE_GRAY);
    b.px(cx - 6, hy - 3, M.BONE_WHITE);
    b.px(cx - 6, hy - 2, M.BONE_WHITE);
    b.px(cx + 5, hy - 3, M.BONE_WHITE);
    b.px(cx + 5, hy - 2, M.BONE_WHITE);
  }
  if (id === 'transylvania_nightstalkers') {
    b.rect(cx - 5, hy - 1, 10, 3, F.VELVET_BLACK);
    b.rect(cx - 6, hy + 8, 12, 2, F.VELVET_BLACK);
  }
  if (id === 'salem_bayou_ghouls') {
    b.rect(cx - 6, hy - 2, 12, 5, F.HEX_VIOLET);
    b.rect(cx - 6, hy + 3, 2, 7, F.HEX_VIOLET);
    b.rect(cx + 4, hy + 3, 2, 7, F.HEX_VIOLET);
  }
  if (id === 'demon_ref') {
    b.px(cx - 5, hy - 2, M.BONE_WHITE);
    b.px(cx - 6, hy - 3, M.BONE_WHITE);
    b.px(cx + 4, hy - 2, M.BONE_WHITE);
    b.px(cx + 5, hy - 3, M.BONE_WHITE);
  }
  if (id === 'necro_ref') b.rect(cx - 5, hy - 2, 10, 3, M.VOID_BLACK);
  if (id === 'rotting_deadskins') b.rect(cx - 5, hy, 10, 2, dark(st.skin));
  // eyes
  const ey = hy + 4;
  if (v.kind === 'front') {
    b.rect(cx - 3 + v.s * 2, ey, 2, 2, st.eye);
    b.rect(cx + 1 + v.s * 2, ey, 2, 2, st.eye);
  } else if (v.kind === 'side') b.rect(cx + v.s * 3 - 1, ey, 2, 2, st.eye);
  if (v.kind !== 'back') b.rect(cx - 2 + (side ? v.s * 2 : v.s * 2), hy + 8, 4, 1, M.VOID_BLACK);
  // faction facemask / cape
  if (id === 'salem_bayou_ghouls' && v.kind === 'front')
    b.rect(cx - 4, hy + 7, 8, 1, M.TOMBSTONE_GRAY);
  if (id === 'transylvania_nightstalkers' && v.kind === 'back')
    b.rect(cx - 6, 21 + bob, 12, 16, F.MIDNIGHT_CRIMSON);
  if (p.hold)
    b.ell(
      cx + p.hold[0],
      23 + bob + p.hold[1],
      3,
      2,
      M.PUMPKIN_ORANGE === st.jersey ? M.HELLFIRE_AMBER : '#' + '8B5A2B'.padEnd(6, '0'),
    ); // ball (brown, palette-snapped)
}

/** Horizontal body (dive, knockdown, collapse). dirX: 1 head right; up: lying on back face-up. */
function drawHoriz(b, id, { x = 6, y = 28, dirX = 1, tilt = 0, smear = 0 } = {}) {
  const st = STYLE[id];
  const px = (rx) => (dirX === 1 ? x + rx : 47 - x - rx);
  const R = (rx, ry, w, h, c) =>
    b.rect(dirX === 1 ? px(rx) : px(rx) - w + 1, y + ry + tilt, w, h, c);
  if (smear) for (let i = 1; i <= smear; i++) R(-i * 3, 2, 3, 2, TOMB);
  R(0, 3, 12, 4, st.pants);
  R(0, 3, 12, 1, light(st.pants));
  R(12, 0, 16, 10, st.jersey);
  R(12, 0, 16, 2, light(st.jersey));
  if (st.stripes) for (let i = 0; i < 16; i += 3) R(12 + i, 2, 1, 8, M.VOID_BLACK);
  else R(12, 8, 16, 2, st.trim);
  R(24, -2, 5, 5, st.pad);
  R(28, 1, 10, 4, st.skin);
  R(36, 0, 6, 6, st.skin);
  R(30, -1, 11, 3, st.skin);
  R(28, 0, 14, 11, st.skin); // head block
  R(28, -1, 14, 2, light(st.skin));
  R(35, 3, 2, 2, st.eye);
  R(39, 3, 2, 2, st.eye);
  if (id === 'boneyard_reapers') R(28, -3, 14, 3, M.TOMBSTONE_GRAY);
  if (id === 'salem_bayou_ghouls') R(28, -3, 14, 4, F.HEX_VIOLET);
  if (id === 'transylvania_nightstalkers') R(28, -3, 14, 3, F.VELVET_BLACK);
}
const TOMB = M.TOMBSTONE_GRAY;

// ---- animation poses ---------------------------------------------------------------------------
const DIRS = [
  { kind: 'front', s: 0 },
  { kind: 'front', s: 1 },
  { kind: 'side', s: 1 },
  { kind: 'back', s: 1 },
  { kind: 'back', s: 0 },
  { kind: 'back', s: -1 },
  { kind: 'side', s: -1 },
  { kind: 'front', s: -1 },
];

function drawFrame(id, anim, f, dirIdx = 0) {
  const b = new Buf(48, 48);
  const bounce = [0, 1, 0, 1][f % 4];
  switch (anim) {
    case 'idle_stance':
      drawUpright(b, id, { bob: bounce, al: [-3, 7 + bounce], ar: [3, 7 - bounce] });
      break;
    case 'run_8dir': {
      const v = DIRS[dirIdx];
      const ph = (f / 6) * Math.PI * 2;
      const sw = Math.round(Math.sin(ph) * 3);
      const side = v.kind === 'side';
      const bob = f % 3 === 0 ? 1 : 0;
      drawUpright(b, id, {
        view: v,
        bob,
        lean: side ? v.s : 0,
        lx: side ? sw : 0,
        rx: side ? -sw : 0,
        ll: !side && sw > 0 ? 3 : 0,
        rl: !side && sw < 0 ? 3 : 0,
        al: [-2 - (side ? 0 : 0), 8 - sw],
        ar: [2, 8 + sw],
      });
      if (f % 2 === 0) {
        const dc = id === 'rotting_deadskins' ? M.ECTO_GREEN : TOMB;
        b.px(24 - 9 * (v.s || 0) - 4, 44, dc);
        b.px(24 - 9 * (v.s || 0) - 6, 43, dc);
      }
      break;
    }
    case 'pass_windup_throw': {
      const al = [
        [-6, 1],
        [-8, -4],
        [7, -10],
        [9, 3],
      ][f];
      drawUpright(b, id, {
        view: { kind: 'side', s: 1 },
        lean: [-1, -2, 1, 2][f],
        ar: [-2, 6],
        al,
        hold: f < 3 ? [6 - f * 2, f === 1 ? -9 : 2] : null,
      });
      break;
    }
    case 'dive_tackle_lunge':
      drawHoriz(b, id, { x: [8, 4, 2][f], y: [22, 26, 32][f], tilt: 0, smear: f + 1 });
      break;
    case 'hit_stagger_knockdown': {
      if (f === 0) {
        drawUpright(b, id, { view: { kind: 'side', s: 1 }, lean: -2, al: [-5, 4], ar: [5, 3] });
        b.recolorSolid(M.BONE_WHITE);
      } else if (f === 1)
        drawUpright(b, id, {
          view: { kind: 'side', s: 1 },
          lean: -4,
          bob: 1,
          al: [-6, 2],
          ar: [6, 1],
        });
      else drawHoriz(b, id, { x: 4, y: f === 2 ? 32 : 31, dirX: -1, tilt: f === 3 ? -1 : 0 });
      break;
    }
    case 'casualty_death':
      death(b, id, f);
      break;
    case 'celebration': {
      const j = [0, 2, 3, 1][f];
      drawUpright(b, id, {
        bob: -j + 3 - 3,
        view: { kind: 'front', s: 0 },
        al: [-5, f % 2 ? -12 : -9],
        ar: [5, f % 2 ? -9 : -12],
        ll: j,
        rl: j ? 0 : 0,
      });
      b.rect(
        10 + f * 8,
        4,
        2,
        2,
        [M.HELLFIRE_AMBER, M.PUMPKIN_ORANGE, M.HEX_PURPLE, M.ECTO_GREEN][f],
      );
      break;
    }
  }
  return b;
}

function death(b, id, f) {
  const st = STYLE[id];
  if (f === 0) {
    drawUpright(b, id, { view: { kind: 'side', s: 1 }, lean: -3, al: [-6, 2], ar: [6, 2] });
    b.recolorSolid(M.BONE_WHITE);
    return;
  }
  if (f === 1) {
    drawUpright(b, id, { view: { kind: 'side', s: 1 }, lean: -5, bob: 3, al: [-7, 0], ar: [7, 0] });
    return;
  }
  if (f === 2) {
    drawHoriz(b, id, { x: 4, y: 33, dirX: -1 });
    return;
  }
  const t = f - 3; // 0..2
  const up = [0, -5, -9][t];
  if (id === 'boneyard_reapers') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.rect(
        24 + Math.cos(a) * (6 + t * 4),
        34 + up * (i % 2 ? 0.5 : 1) + Math.sin(a) * 3 + t * 3,
        3,
        1,
        M.BONE_WHITE,
      );
    }
    b.ell(24, 38, 4, 3, M.BONE_WHITE);
    b.rect(22, 37, 2, 2, M.VOID_BLACK);
    b.rect(25, 37, 2, 2, M.VOID_BLACK);
    b.rect(22, 40 + (t % 2), 5, 1, M.TOMBSTONE_GRAY);
  } else if (id === 'rotting_deadskins') {
    b.ell(24, 40, 8 + t * 3, 3 + t, M.ECTO_GREEN);
    b.ell(22, 39, 4 + t, 2, light(M.ECTO_GREEN));
    for (let i = 0; i < 3; i++) b.px(16 + i * 8, 36 - ((t + i) % 3) * 2, M.ECTO_GREEN);
    b.rect(34, 34 - (t % 2), 6, 2, F.PUTRID_OLIVE);
    b.rect(39, 33 - (t % 2), 2, 4, F.PUTRID_OLIVE);
  } else if (id === 'transylvania_nightstalkers') {
    b.ell(24, 38, 8 + t * 2, 5 - t, M.TOMBSTONE_GRAY);
    b.ell(24, 37, 5 + t * 2, 3, M.AGED_PARCHMENT);
    for (let i = 0; i < 5; i++) {
      const bx = 10 + i * 7,
        by = 28 + up + ((i * 3) % 5);
      b.line(bx - 2, by, bx, by + 1, F.VELVET_BLACK, 1);
      b.line(bx, by + 1, bx + 2, by, F.VELVET_BLACK, 1);
      b.px(bx, by - 1, F.MIDNIGHT_CRIMSON);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const h = 8 - Math.abs(i - 1.5) * 2 + t * 2;
      b.rect(15 + i * 5, 42 - h, 4, h, i % 2 ? M.HEX_PURPLE : F.HEX_VIOLET);
      b.rect(16 + i * 5, 42 - h * 0.6, 2, h * 0.6, M.PUMPKIN_ORANGE);
    }
    b.ell(24, 22 + up, 3, 3, M.SPECTRAL_CYAN);
    b.px(24, 18 + up, M.BONE_WHITE);
  }
  void st;
}

// ---- crests ------------------------------------------------------------------------------------
function crest(id) {
  const st = STYLE[id];
  const b = new Buf(64, 64);
  const col = {
    boneyard_reapers: [F.OBSIDIAN_PURPLE, M.BONE_WHITE],
    rotting_deadskins: [F.RUST_BLOOD, M.ECTO_GREEN],
    transylvania_nightstalkers: [F.MIDNIGHT_CRIMSON, F.VAMPIRE_GOLD],
    salem_bayou_ghouls: [F.HEX_VIOLET, M.PUMPKIN_ORANGE],
  }[id];
  b.rect(8, 6, 48, 36, col[0]);
  for (let i = 0; i < 24; i++) b.rect(8 + Math.floor(i * 1), 42 + i, 48 - i * 2, 1, col[0]);
  b.rect(8, 6, 48, 3, col[1]);
  b.rect(8, 6, 3, 36, col[1]);
  b.rect(53, 6, 3, 36, dark(col[1]));
  const c = 32;
  if (id === 'boneyard_reapers') {
    b.ell(c, 24, 11, 10, M.BONE_WHITE);
    b.rect(24, 36, 16, 5, M.BONE_WHITE);
    b.rect(25, 21, 5, 5, M.VOID_BLACK);
    b.rect(34, 21, 5, 5, M.VOID_BLACK);
    b.rect(31, 28, 2, 3, M.VOID_BLACK);
    for (let i = 0; i < 4; i++) b.rect(26 + i * 4, 37, 1, 4, M.VOID_BLACK);
    b.rect(14, 12, 4, 3, M.SPECTRAL_CYAN);
    b.rect(46, 12, 4, 3, M.SPECTRAL_CYAN);
  }
  if (id === 'rotting_deadskins') {
    b.ell(c, 24, 12, 11, F.PUTRID_OLIVE);
    b.rect(23, 20, 6, 4, M.HELLFIRE_AMBER);
    b.rect(35, 20, 6, 4, M.HELLFIRE_AMBER);
    b.rect(26, 31, 12, 3, M.VOID_BLACK);
    for (let i = 0; i < 4; i++) b.rect(27 + i * 3, 31, 2, 3, M.BONE_WHITE);
    b.rect(14, 38, 4, 8, M.ECTO_GREEN);
    b.rect(46, 36, 4, 6, M.ECTO_GREEN);
  }
  if (id === 'transylvania_nightstalkers') {
    b.ell(c, 24, 20, 8, F.VELVET_BLACK);
    b.rect(12, 16, 12, 8, F.VELVET_BLACK);
    b.rect(40, 16, 12, 8, F.VELVET_BLACK);
    b.rect(28, 12, 8, 14, F.VELVET_BLACK);
    b.rect(29, 18, 2, 2, M.VAMPIRE_CRIMSON);
    b.rect(33, 18, 2, 2, M.VAMPIRE_CRIMSON);
    b.rect(30, 22, 1, 4, M.BONE_WHITE);
    b.rect(33, 22, 1, 4, M.BONE_WHITE);
    b.rect(26, 34, 12, 3, F.VAMPIRE_GOLD);
  }
  if (id === 'salem_bayou_ghouls') {
    b.ell(c, 26, 11, 11, M.PUMPKIN_ORANGE);
    b.rect(31, 12, 3, 4, F.SWAMP_MOSS);
    b.rect(25, 22, 4, 4, M.VOID_BLACK);
    b.rect(35, 22, 4, 4, M.VOID_BLACK);
    b.rect(26, 30, 12, 2, M.VOID_BLACK);
    b.rect(24, 8, 16, 4, M.HEX_PURPLE);
    b.rect(28, 4, 8, 4, M.HEX_PURPLE);
  }
  void st;
  return b;
}

// ---- portraits ---------------------------------------------------------------------------------
const PORT = {
  coach_boneyard_reapers: {
    skin: M.BONE_WHITE,
    shirt: F.OBSIDIAN_PURPLE,
    eye: M.SPECTRAL_CYAN,
    extra: 'horns',
  },
  coach_rotting_deadskins: {
    skin: F.PUTRID_OLIVE,
    shirt: F.RUST_BLOOD,
    eye: M.HELLFIRE_AMBER,
    extra: 'cap',
  },
  coach_transylvania_nightstalkers: {
    skin: M.AGED_PARCHMENT,
    shirt: F.MIDNIGHT_CRIMSON,
    eye: M.VAMPIRE_CRIMSON,
    extra: 'slick',
  },
  coach_salem_bayou_ghouls: {
    skin: F.SWAMP_MOSS,
    shirt: F.HEX_VIOLET,
    eye: M.PUMPKIN_ORANGE,
    extra: 'witch',
  },
  necro_ref: { skin: M.BONE_WHITE, shirt: M.BONE_WHITE, eye: M.VAMPIRE_CRIMSON, extra: 'refcap' },
  demon_ref: {
    skin: M.VAMPIRE_CRIMSON,
    shirt: M.BONE_WHITE,
    eye: M.HELLFIRE_AMBER,
    extra: 'demon',
  },
  crypt_announcer: {
    skin: M.TOMBSTONE_GRAY,
    shirt: M.IRON_BEZEL,
    eye: M.ECTO_GREEN,
    extra: 'headset',
  },
};
function portrait(id, jaw) {
  const p = PORT[id];
  const b = new Buf(64, 64);
  b.rect(6, 50, 52, 12, p.shirt);
  b.rect(6, 50, 52, 2, light(p.shirt));
  if (p.extra === 'refcap' || p.extra === 'demon')
    for (let i = 8; i < 56; i += 6) b.rect(i, 52, 2, 10, M.VOID_BLACK);
  b.rect(26, 42, 12, 10, dark(p.skin));
  b.ell(32, 26, 17, 17, p.skin);
  b.rect(16, 26, 33, 12, p.skin);
  b.rect(16, 11, 28, 2, light(p.skin));
  b.rect(20, 36 + jaw, 24, 7, p.skin); // jaw drop
  b.rect(22, 36, 20, 1 + jaw, M.CRYPT_SLATE);
  b.rect(22, 36, 20, 1, M.BONE_WHITE);
  b.rect(24, 36 + jaw, 16, 1, M.BONE_WHITE);
  b.rect(21, 22, 7, 6, M.CRYPT_SLATE);
  b.rect(36, 22, 7, 6, M.CRYPT_SLATE);
  b.rect(23, 23, 4, 4, p.eye);
  b.rect(38, 23, 4, 4, p.eye);
  b.rect(31, 29, 2, 3, dark(p.skin));
  if (p.extra === 'horns') {
    b.rect(14, 12, 4, 10, M.BONE_WHITE);
    b.rect(12, 8, 3, 6, M.BONE_WHITE);
    b.rect(46, 12, 4, 10, M.BONE_WHITE);
    b.rect(49, 8, 3, 6, M.BONE_WHITE);
  }
  if (p.extra === 'cap') {
    b.rect(14, 8, 36, 6, F.RUST_BLOOD);
    b.rect(34, 12, 20, 3, F.RUST_BLOOD);
    b.rect(18, 20, 8, 1, dark(p.skin));
  }
  if (p.extra === 'slick') {
    b.rect(14, 6, 36, 8, F.VELVET_BLACK);
    b.rect(14, 14, 4, 8, F.VELVET_BLACK);
    b.rect(46, 14, 4, 8, F.VELVET_BLACK);
    b.rect(8, 42, 12, 12, F.VELVET_BLACK);
    b.rect(44, 42, 12, 12, F.VELVET_BLACK);
    b.rect(27, 37 + jaw, 2, 3, M.BONE_WHITE);
    b.rect(36, 37 + jaw, 2, 3, M.BONE_WHITE);
  }
  if (p.extra === 'witch') {
    b.rect(10, 10, 44, 4, F.HEX_VIOLET);
    b.rect(20, 2, 24, 8, F.HEX_VIOLET);
    b.rect(26, 0, 12, 3, F.HEX_VIOLET);
    b.rect(20, 8, 24, 2, M.PUMPKIN_ORANGE);
  }
  if (p.extra === 'refcap') {
    b.rect(14, 8, 36, 6, M.VOID_BLACK);
    b.rect(14, 12, 40, 2, M.VOID_BLACK);
    b.rect(30, 9, 4, 2, M.HELLFIRE_AMBER);
    b.rect(14, 20, 36, 1, M.VOID_BLACK);
  }
  if (p.extra === 'demon') {
    b.rect(16, 6, 4, 8, M.BONE_WHITE);
    b.rect(14, 3, 3, 5, M.BONE_WHITE);
    b.rect(44, 6, 4, 8, M.BONE_WHITE);
    b.rect(47, 3, 3, 5, M.BONE_WHITE);
    b.rect(26, 16, 12, 2, M.VOID_BLACK);
  }
  if (p.extra === 'headset') {
    b.rect(13, 14, 3, 16, M.VOID_BLACK);
    b.rect(48, 14, 3, 16, M.VOID_BLACK);
    b.rect(14, 10, 36, 3, M.VOID_BLACK);
    b.rect(10, 24, 6, 8, M.IRON_BEZEL);
    b.rect(48, 24, 6, 8, M.IRON_BEZEL);
    b.rect(46, 38, 10, 2, M.VOID_BLACK);
    b.ell(54, 40, 3, 3, M.HELLFIRE_AMBER);
  }
  return b;
}

// ---- arenas ------------------------------------------------------------------------------------
const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const ARENA_STYLE = {
  cursed_graveyard: {
    turf: F.SWAMP_MOSS,
    speck: [dark(F.SWAMP_MOSS), light(F.SWAMP_MOSS)],
    line: M.BONE_WHITE,
    ez: [F.OBSIDIAN_PURPLE, F.HEX_VIOLET],
  },
  brimstone_hellfire_pit: {
    turf: M.IRON_BEZEL,
    speck: [dark(M.IRON_BEZEL), M.TOMBSTONE_GRAY],
    line: M.PUMPKIN_ORANGE,
    ez: [F.RUST_BLOOD, M.PUMPKIN_ORANGE],
  },
  ectoplasm_swamp: {
    turf: dark(F.PUTRID_OLIVE),
    speck: [dark(dark(F.PUTRID_OLIVE)), F.PUTRID_OLIVE],
    line: M.ECTO_GREEN,
    ez: [F.SWAMP_MOSS, M.ECTO_GREEN],
  },
};
function turf(a) {
  const s = ARENA_STYLE[a];
  const b = new Buf(64, 64, s.turf);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const h = hash(x, y, a.length) % 100;
      if (h < 9) b.px(x, y, s.speck[0]);
      else if (h < 14) b.px(x, y, s.speck[1]);
    }
  b.rect(0, 62, 64, 2, dark(s.turf)); // tileable horizontal grain bands
  return b;
}
function endzone(a) {
  const s = ARENA_STYLE[a];
  const b = new Buf(64, 64, s.ez[0]);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) if (((x + y) >> 3) % 2 === 0) b.px(x, y, dark(s.ez[1]));
  for (let i = 0; i < 64; i += 16) {
    b.line(i, 0, i + 8, 32, s.ez[1], 2);
    b.line(i + 8, 32, i, 63, s.ez[1], 2);
  }
  b.rect(0, 0, 64, 2, s.line);
  b.rect(0, 62, 64, 2, s.line);
  return b;
}
function hazard(name, t) {
  const b = new Buf(64, 64);
  const w = Math.sin((t / 4) * Math.PI * 2);
  switch (name) {
    case 'tombstones':
      for (const [x, y, h] of [
        [10, 22, 28],
        [32, 14, 36],
      ]) {
        b.rect(x, y + 6, 18, h - 6, M.TOMBSTONE_GRAY);
        b.ell(x + 9, y + 6, 9, 6, M.TOMBSTONE_GRAY);
        b.rect(x + 8, y + 8, 2, 10, M.IRON_BEZEL);
        b.rect(x + 5, y + 11, 8, 2, M.IRON_BEZEL);
        b.rect(x, y + 6, 2, h - 6, light(M.TOMBSTONE_GRAY));
      }
      b.ell(52, 24 - t * 2, 3, 4, M.SPECTRAL_CYAN);
      b.px(52, 28 - t * 2, M.BONE_WHITE);
      b.rect(8, 54, 48, 3, F.SWAMP_MOSS);
      break;
    case 'grave_pit':
      b.ell(32, 36, 26, 16, dark(F.RUST_BLOOD));
      b.ell(32, 38, 22, 12, M.VOID_BLACK);
      b.ell(32, 40, 16, 7, M.CRYPT_SLATE);
      b.rect(30 + Math.round(w * 2), 28 - t * 2, 3, 10, M.BONE_WHITE);
      b.rect(28 + Math.round(w * 2), 26 - t * 2, 7, 3, M.BONE_WHITE);
      break;
    case 'jack_o_lantern_mine': {
      b.ell(32, 38, 20, 16, M.PUMPKIN_ORANGE);
      b.ell(26, 36, 6, 12, light(M.PUMPKIN_ORANGE));
      b.rect(30, 18, 4, 6, F.SWAMP_MOSS);
      const g = t % 2 ? M.HELLFIRE_AMBER : M.VOID_BLACK;
      b.rect(22, 32, 6, 6, M.VOID_BLACK);
      b.rect(36, 32, 6, 6, M.VOID_BLACK);
      b.rect(24, 33, 3, 3, g);
      b.rect(38, 33, 3, 3, g);
      b.rect(24, 44, 16, 3, M.VOID_BLACK);
      b.rect(28, 44, 2, 3, M.HELLFIRE_AMBER);
      b.rect(34, 44, 2, 3, M.HELLFIRE_AMBER);
      b.rect(32, 12 - (t % 2), 2, 2, M.HELLFIRE_AMBER);
      break;
    }
    case 'obsidian_cracks':
      b.rect(6, 10, 52, 44, M.CRYPT_SLATE);
      b.rect(6, 10, 52, 2, M.IRON_BEZEL);
      for (const pts of [
        [8, 20, 24, 32, 20, 44],
        [30, 12, 36, 30, 52, 40],
        [40, 52, 44, 36, 56, 24],
      ]) {
        const c = t % 2 ? M.HELLFIRE_AMBER : M.PUMPKIN_ORANGE;
        b.line(pts[0], pts[1], pts[2], pts[3], c, 2);
        b.line(pts[2], pts[3], pts[4], pts[5], c, 2);
        b.px(pts[2], pts[3], M.BONE_WHITE);
      }
      break;
    case 'lava_geyser': {
      b.ell(32, 54, 18, 6, M.VOID_BLACK);
      b.ell(32, 54, 14, 4, M.VAMPIRE_CRIMSON);
      const h = [14, 28, 38, 22][t];
      b.rect(28, 52 - h, 8, h, M.PUMPKIN_ORANGE);
      b.rect(30, 52 - h, 3, h, M.HELLFIRE_AMBER);
      b.ell(32, 52 - h, 7, 4, M.HELLFIRE_AMBER);
      for (let i = 0; i < 4; i++)
        b.px(22 + i * 6 + (t % 2) * 2, 52 - h - 4 - (i % 2) * 5, M.PUMPKIN_ORANGE);
      break;
    }
    case 'sludge_puddle':
      b.ell(32, 40, 26, 14, dark(M.ECTO_GREEN));
      b.ell(30, 38, 20, 10, M.ECTO_GREEN);
      b.ell(26, 34, 8, 3, light(M.ECTO_GREEN));
      for (let i = 0; i < 3; i++) b.ell(20 + i * 12, 40 - ((t + i) % 4) * 2, 2, 2, M.BONE_WHITE);
      break;
    case 'bog_patch':
      b.ell(32, 42, 26, 13, F.SWAMP_MOSS);
      b.ell(32, 43, 20, 9, dark(F.SWAMP_MOSS));
      b.ell(28, 44, 8, 3, M.ECTO_GREEN);
      for (const x of [14, 22, 46, 52]) {
        b.rect(x, 24 + (x % 3), 2, 16, F.PUTRID_OLIVE);
        b.rect(x - 1 + Math.round(w), 22 + (x % 3), 4, 4, M.AGED_PARCHMENT);
      }
      break;
    case 'fog':
      for (const [x, y, r] of [
        [18, 40, 12],
        [34, 34, 14],
        [46, 42, 10],
        [28, 46, 10],
      ]) {
        b.ell(x + t * 3 - 4, y, r, r * 0.55, M.TOMBSTONE_GRAY);
        b.ell(x + t * 3 - 5, y - 2, r * 0.7, r * 0.35, M.AGED_PARCHMENT);
      }
      break;
  }
  return b;
}

// ---- output ------------------------------------------------------------------------------------
async function writePng(path, w, h, rgba) {
  mkdirSync(dirname(path), { recursive: true });
  await sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(path);
}
function blit(dst, dw, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++)
    dst.set(src.subarray(y * sw * 4, (y + 1) * sw * 4), ((oy + y) * dw + ox) * 4);
}
async function sheet(path, cols, rows, cw, ch, frames, opts) {
  const W = cols * cw,
    H = rows * ch;
  const out = new Uint8Array(W * H * 4);
  for (const { col, row, buf } of frames)
    blit(out, W, normalizeFrame(buf.d, cw, ch, opts), cw, ch, col * cw, row * ch);
  await writePng(path, W, H, out);
}

async function main() {
  const layout = [];
  for (const id of S.SPRITE_SHEETS) {
    const frames = [];
    let row = 0;
    for (const a of S.ANIMATIONS) {
      for (let r = 0; r < a.rows; r++, row++)
        for (let f = 0; f < a.frames; f++)
          frames.push({ col: f, row, buf: drawFrame(id, a.name, f, r) });
    }
    await sheet(join(OUT, 'sprites', `${id}.png`), S.SHEET_COLS, S.SHEET_ROWS, 48, 48, frames, {});
  }
  let row = 0;
  for (const a of S.ANIMATIONS) {
    layout.push({ name: a.name, firstRow: row, rows: a.rows, frames: a.frames });
    row += a.rows;
  }
  for (const id of S.CREST_FACTIONS)
    await sheet(
      join(OUT, 'sprites', `crest_${id}.png`),
      1,
      1,
      64,
      64,
      [{ col: 0, row: 0, buf: crest(id) }],
      {},
    );
  for (const id of S.PORTRAITS)
    await sheet(
      join(OUT, 'portraits', `${id}.png`),
      2,
      1,
      64,
      64,
      [0, 1].map((j) => ({ col: j, row: 0, buf: portrait(id, j * 3) })),
      {},
    );
  for (const [arena, hz] of Object.entries(S.ARENAS)) {
    await sheet(
      join(OUT, 'arenas', `${arena}_turf.png`),
      1,
      1,
      64,
      64,
      [{ col: 0, row: 0, buf: turf(arena) }],
      { opaque: true },
    );
    await sheet(
      join(OUT, 'arenas', `${arena}_endzone.png`),
      1,
      1,
      64,
      64,
      [{ col: 0, row: 0, buf: endzone(arena) }],
      { opaque: true },
    );
    for (const h of hz)
      await sheet(
        join(OUT, 'arenas', `${arena}_${h}.png`),
        S.HAZARD_FRAMES,
        1,
        64,
        64,
        [0, 1, 2, 3].map((t) => ({ col: t, row: 0, buf: hazard(h, t) })),
        {},
      );
  }
  writeFileSync(
    join(OUT, 'atlas.json'),
    JSON.stringify(
      {
        sprites: {
          cell: 48,
          cols: S.SHEET_COLS,
          rows: S.SHEET_ROWS,
          animations: layout,
          run_8dir_order: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'],
          sheets: S.SPRITE_SHEETS,
          crests: S.CREST_FACTIONS,
        },
        portraits: { cell: 64, frames: 2, ids: S.PORTRAITS },
        arenas: { tile: 64, hazardFrames: S.HAZARD_FRAMES, hazards: S.ARENAS },
      },
      null,
      2,
    ) + '\n',
  );
  console.log('generated assets in public/assets');
}
await main();
