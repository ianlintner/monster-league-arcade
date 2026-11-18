/** Halloween Midnight Palette (PLAN.md §2.2) + faction colours (§2.3) and derived shade ramps. */
export const VOID_BLACK = '#0B0711';

export const MASTER = {
  VOID_BLACK,
  CRYPT_SLATE: '#1A1426',
  IRON_BEZEL: '#2E2540',
  TOMBSTONE_GRAY: '#5C5270',
  BONE_WHITE: '#F4EFE6',
  AGED_PARCHMENT: '#D6C7B2',
  PUMPKIN_ORANGE: '#FF6B1A',
  HELLFIRE_AMBER: '#FFB800',
  ECTO_GREEN: '#39FF14',
  VAMPIRE_CRIMSON: '#E6193C',
  HEX_PURPLE: '#9D4EDD',
  SPECTRAL_CYAN: '#00F0FF',
};

export const FACTION_COLORS = {
  OBSIDIAN_PURPLE: '#2B0938',
  PUTRID_OLIVE: '#6B8E23',
  RUST_BLOOD: '#8B1E1E',
  MIDNIGHT_CRIMSON: '#990024',
  VAMPIRE_GOLD: '#FFD166',
  VELVET_BLACK: '#110B1A',
  HEX_VIOLET: '#7B2CBF',
  SWAMP_MOSS: '#2A4D3E',
};

export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgbToHex = (r) =>
  '#' +
  r
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

/** Deterministic shade used by generators AND palette ramp (factors 0.7 / 1.3 only). */
export function shade(hex, f) {
  return rgbToHex(hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * f)))));
}
export const dark = (h) => shade(h, 0.7);
export const light = (h) => shade(h, 1.3);

const bases = [...Object.values(MASTER), ...Object.values(FACTION_COLORS)];
export const PALETTE = [...new Set(bases.flatMap((b) => [b.toUpperCase(), dark(b), light(b)]))].map(
  (h) => ({ hex: h, rgb: hexToRgb(h) }),
);
export const PALETTE_SET = new Set(PALETTE.map((p) => p.hex));
