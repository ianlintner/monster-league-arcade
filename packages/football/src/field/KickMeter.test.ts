import { describe, expect, it } from 'vitest';
import { meterValue, kickQuality, resolveKick, KICK_METER } from './KickMeter';

describe('KickMeter', () => {
  it('sweeps 0 → 1 → 0 over one full period', () => {
    const p = KICK_METER.sweepPeriodSeconds;
    expect(meterValue(0)).toBe(0);
    expect(meterValue(p / 4)).toBeCloseTo(0.5, 5);
    expect(meterValue(p / 2)).toBeCloseTo(1, 5);
    expect(meterValue((3 * p) / 4)).toBeCloseTo(0.5, 5);
    expect(meterValue(p)).toBeCloseTo(0, 5);
  });

  it('is periodic', () => {
    expect(meterValue(0.1)).toBeCloseTo(meterValue(0.1 + KICK_METER.sweepPeriodSeconds), 5);
  });

  it('a perfect lock in the sweet band gives quality 1', () => {
    expect(kickQuality(0.5)).toBe(1);
    expect(kickQuality(0.42)).toBe(1);
    expect(kickQuality(0.58)).toBe(1);
  });

  it('quality tapers toward zero at the extremes', () => {
    expect(kickQuality(0)).toBe(0);
    expect(kickQuality(1)).toBe(0);
    expect(kickQuality(0.7)).toBeGreaterThan(0);
    expect(kickQuality(0.7)).toBeLessThan(1);
  });

  it('a perfect short field goal is good; a miss outside range is not', () => {
    expect(resolveKick(0.5, 40, 60).fieldGoalGood).toBe(true);
    expect(resolveKick(0.0, 40, 60).fieldGoalGood).toBe(false);
  });

  it('punt yards scale with kick quality', () => {
    const perfect = resolveKick(0.5, 0, 60).puntYards;
    const shank = resolveKick(0.0, 0, 60).puntYards;
    expect(perfect).toBeGreaterThan(shank);
  });
});
