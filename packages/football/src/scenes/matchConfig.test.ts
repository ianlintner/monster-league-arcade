import { describe, expect, it } from 'vitest';
import { quarterSecondsFromSearch } from './matchConfig';

describe('quarterSecondsFromSearch', () => {
  it('defaults to 150 when absent, empty or not a number', () => {
    expect(quarterSecondsFromSearch('')).toBe(150);
    expect(quarterSecondsFromSearch('?quarter=')).toBe(150);
    expect(quarterSecondsFromSearch('?quarter=abc')).toBe(150);
    expect(quarterSecondsFromSearch('?other=1')).toBe(150);
  });

  it('passes an in-range value through', () => {
    expect(quarterSecondsFromSearch('?quarter=15')).toBe(15);
    expect(quarterSecondsFromSearch('?quarter=180')).toBe(180);
  });

  it('clamps to 10..180', () => {
    expect(quarterSecondsFromSearch('?quarter=1')).toBe(10);
    expect(quarterSecondsFromSearch('?quarter=-5')).toBe(10);
    expect(quarterSecondsFromSearch('?quarter=9999')).toBe(180);
  });
});
