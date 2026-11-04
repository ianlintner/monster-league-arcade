/**
 * Monster League Arcade — Master "Halloween Midnight Palette"
 * Graveyard Sports Network (GSN 66.6) unified design system.
 *
 * These are the single source of truth for every colour used across the
 * `/`, `/football/` and `/hockey/` routes: CSS custom properties, procedural
 * canvas drawing, Phaser tints and `fal.ai` post-processing quantization all
 * resolve to these exact literals. Never hard-code a hex value elsewhere.
 */

/** Canonical literal hex constants (uppercase `#RRGGBB`). */
export const HALLOWEEN_MIDNIGHT_PALETTE = {
  // Void & Iron Neutrals — backgrounds and frames
  VOID_BLACK: '#0B0711',
  CRYPT_SLATE: '#1A1426',
  IRON_BEZEL: '#2E2540',
  TOMBSTONE_GRAY: '#5C5270',
  BONE_WHITE: '#F4EFE6',
  AGED_PARCHMENT: '#D6C7B2',

  // Halloween accents — CTAs, LEDs and broadcast glows
  PUMPKIN_ORANGE: '#FF6B1A',
  HELLFIRE_AMBER: '#FFB800',
  ECTO_GREEN: '#39FF14',
  VAMPIRE_CRIMSON: '#E6193C',
  HEX_PURPLE: '#9D4EDD',
  SPECTRAL_CYAN: '#00F0FF',
} as const;

/** Union of every valid palette key. */
export type PaletteToken = keyof typeof HALLOWEEN_MIDNIGHT_PALETTE;

/** Ordered list of palette keys (stable for iteration in tests/UI). */
export const PALETTE_TOKENS = Object.keys(HALLOWEEN_MIDNIGHT_PALETTE) as PaletteToken[];

/** Validate an arbitrary string as a `#RRGGBB` colour literal. */
export function isHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value);
}

/** Parse a `#RRGGBB` literal into an 0-255 channel triple. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!isHexColor(hex)) {
    throw new Error(`Invalid hex colour literal: ${hex}`);
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Convert 0-255 channels back to an uppercase `#RRGGBB` literal. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  const hexByte = (n: number): string => clamp(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

/** Convert a palette literal to a Phaser-friendly `0xRRGGBB` numeric colour. */
export function toPhaserColor(token: PaletteToken): number {
  const { r, g, b } = hexToRgb(HALLOWEEN_MIDNIGHT_PALETTE[token]);
  return (r << 16) | (g << 8) | b;
}

/** Wrap a palette literal in an `rgba(...)` string for CSS / canvas alpha use. */
export function toRgba(token: PaletteToken, alpha: number): string {
  const { r, g, b } = hexToRgb(HALLOWEEN_MIDNIGHT_PALETTE[token]);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/** Kebab-cased CSS custom property name, e.g. `VOID_BLACK` → `--gsn-void-black`. */
export function cssVarName(token: PaletteToken): string {
  return `--gsn-${token.toLowerCase().replace(/_/g, '-')}`;
}

/** Palette as a plain `{ '--gsn-void-black': '#0B0711', ... }` record for CSS injection. */
export function paletteCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const token of PALETTE_TOKENS) {
    vars[cssVarName(token)] = HALLOWEEN_MIDNIGHT_PALETTE[token];
  }
  return vars;
}

/** Full `:root { ... }` declaration block mirroring {@link paletteCssVars}. */
export function paletteCssRootBlock(): string {
  const lines = Object.entries(paletteCssVars())
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `:root {\n${lines}\n}`;
}
