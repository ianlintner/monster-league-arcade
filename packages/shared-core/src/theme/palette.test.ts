import { describe, expect, it } from 'vitest';
import {
  HALLOWEEN_MIDNIGHT_PALETTE,
  PALETTE_TOKENS,
  cssVarName,
  hexToRgb,
  isHexColor,
  paletteCssVars,
  rgbToHex,
  toPhaserColor,
  toRgba,
} from './palette';

const EXPECTED: Record<string, string> = {
  VOID_BLACK: '#0B0711',
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

describe('Halloween Midnight Palette', () => {
  it('matches every PLAN.md hex literal exactly', () => {
    expect(HALLOWEEN_MIDNIGHT_PALETTE).toEqual(EXPECTED);
  });

  it('has exactly 12 tokens and validates each as #RRGGBB', () => {
    expect(PALETTE_TOKENS).toHaveLength(12);
    for (const token of PALETTE_TOKENS) {
      expect(isHexColor(HALLOWEEN_MIDNIGHT_PALETTE[token])).toBe(true);
    }
  });

  it('round-trips hex <=> rgb', () => {
    expect(hexToRgb('#FFB800')).toEqual({ r: 255, g: 184, b: 0 });
    expect(rgbToHex(255, 184, 0)).toBe('#FFB800');
    expect(rgbToHex(314, -5, 128.4)).toBe('#FF0080');
  });

  it('clamps alpha and emits phaser color / rgba helpers', () => {
    expect(toPhaserColor('ECTO_GREEN')).toBe(0x39ff14);
    expect(toRgba('SPECTRAL_CYAN', 0.5)).toBe('rgba(0, 240, 255, 0.5)');
    expect(toRgba('BONE_WHITE', 1.7)).toBe('rgba(244, 239, 230, 1)');
  });

  it('builds kebab-cased CSS var names and a full root block', () => {
    expect(cssVarName('VOID_BLACK')).toBe('--gsn-void-black');
    const vars = paletteCssVars();
    expect(vars['--gsn-pumpkin-orange']).toBe('#FF6B1A');
    expect(Object.keys(vars)).toHaveLength(12);
  });

  it('rejects malformed hex input', () => {
    expect(isHexColor('#fff')).toBe(false);
    expect(() => hexToRgb('00F0FF')).toThrow();
  });
});
