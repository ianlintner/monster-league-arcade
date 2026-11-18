import { describe, expect, it } from 'vitest';
import { buildFlight, resolvePass, sampleFlight, styleForHold, PASS_TUNING } from './Ballistics';

describe('Ballistics flight model', () => {
  it('lob (tap) has a longer flight time than bullet (hold > 180 ms)', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 30, y: 0 };
    const lob = buildFlight({ from, to, style: styleForHold(100) });
    const bullet = buildFlight({ from, to, style: styleForHold(400) });
    expect(lob.style).toBe('LOB');
    expect(bullet.style).toBe('BULLET');
    expect(lob.flightTime).toBeGreaterThan(bullet.flightTime);
  });

  it('lob apexes higher than a bullet over the same distance', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 30, y: 0 };
    const lob = buildFlight({ from, to, style: 'LOB' });
    const bullet = buildFlight({ from, to, style: 'BULLET' });
    expect(lob.apex).toBeGreaterThan(bullet.apex);
  });

  it('samples a parabolic arc with z=0 at launch and landing', () => {
    const flight = buildFlight({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, style: 'LOB' });
    const start = sampleFlight(flight, 0);
    const mid = sampleFlight(flight, flight.flightTime / 2);
    const end = sampleFlight(flight, flight.flightTime);
    expect(start.z).toBe(0);
    expect(end.z).toBe(0);
    expect(end.landed).toBe(true);
    expect(mid.z).toBeGreaterThan(0);
  });

  it('is deterministic: identical build produces identical samples', () => {
    const a = buildFlight({ from: { x: 0, y: 0 }, to: { x: 25, y: 3 }, style: 'LOB' });
    const b = buildFlight({ from: { x: 0, y: 0 }, to: { x: 25, y: 3 }, style: 'LOB' });
    expect(sampleFlight(a, 0.4)).toEqual(sampleFlight(b, 0.4));
  });
});

describe('Ballistics pass resolution', () => {
  it('cleans when no defender is near the path', () => {
    const flight = buildFlight({ from: { x: 0, y: 0 }, to: { x: 30, y: 0 }, style: 'LOB' });
    const res = resolvePass(flight, [{ id: 'away-DB1', x: 3, y: 20, side: 'DEFENSE' }]);
    expect(res.kind).toBe('CLEAN_CATCH');
    expect(res.defenderId).toBeNull();
  });

  it('intercepts when a defender sits on the path midpoint', () => {
    const flight = buildFlight({ from: { x: 0, y: 0 }, to: { x: 30, y: 0 }, style: 'BULLET' });
    const mid = sampleFlight(flight, flight.flightTime / 2);
    const res = resolvePass(flight, [{ id: 'away-DB1', x: mid.x, y: mid.y, side: 'DEFENSE' }]);
    expect(res.kind).toBe('INTERCEPTION');
    expect(res.defenderId).toBe('away-DB1');
  });

  it('deflects (not intercepts) when a defender is at the deflection fringe', () => {
    const flight = buildFlight({ from: { x: 0, y: 0 }, to: { x: 30, y: 0 }, style: 'BULLET' });
    const mid = sampleFlight(flight, flight.flightTime / 2);
    const fringe = PASS_TUNING.deflectionRadius * 0.9;
    const res = resolvePass(flight, [
      { id: 'away-DB2', x: mid.x + fringe, y: mid.y, side: 'DEFENSE' },
    ]);
    expect(res.kind).toBe('DEFLECTION');
    expect(res.defenderId).toBe('away-DB2');
  });

  it('exposes the required tuning constants', () => {
    expect(PASS_TUNING.bulletHoldMs).toBe(180);
    expect(PASS_TUNING.catchRadius).toBeGreaterThan(0);
    expect(PASS_TUNING.interceptionRadius).toBeLessThan(PASS_TUNING.deflectionRadius);
  });
});
