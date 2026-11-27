import { describe, expect, it } from 'vitest';
import { quarterSecondsFromSearch, casualtiesFromSearch } from './matchConfig';

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

describe('casualtiesFromSearch', () => {
  it('defaults to zero when absent, empty or not a number', () => {
    expect(casualtiesFromSearch('')).toBe(0);
    expect(casualtiesFromSearch('?casualties=')).toBe(0);
    expect(casualtiesFromSearch('?casualties=abc')).toBe(0);
  });

  it('passes 0..3 through and clamps above the forfeit warning threshold', () => {
    expect(casualtiesFromSearch('?casualties=2')).toBe(2);
    expect(casualtiesFromSearch('?casualties=3')).toBe(3);
    expect(casualtiesFromSearch('?casualties=-4')).toBe(0);
    expect(casualtiesFromSearch('?casualties=99')).toBe(3);
  });
});
