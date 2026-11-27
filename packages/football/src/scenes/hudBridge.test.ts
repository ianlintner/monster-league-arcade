import { describe, expect, it } from 'vitest';
import type { GameSession } from '../sim/index';
import { composeReadyLine, type HudState } from './hudBridge';

function hudState(yardsToGo: number): HudState {
  return {
    session: { down: 4, yardsToGo, clock: 96, possession: 'home' } as unknown as GameSession,
    mode: 'PICK',
    bannerText: '',
    isKickPlay: false,
    kickLocked: null,
    cpuPlayId: null,
    huddleFingerprint: '',
  };
}

describe('composeReadyLine', () => {
  it('formats fractional yards to go as a whole number, never a raw float', () => {
    const line = composeReadyLine(hudState(9.086010663204098)).readyText;
    expect(line).toContain('DOWN 4 · 9 TO GO');
    expect(line).not.toContain('9.086');
  });

  it('shows INCHES for less than a yard, matching the scorebug label', () => {
    expect(composeReadyLine(hudState(0.4)).readyText).toContain('DOWN 4 · INCHES TO GO');
  });
});
