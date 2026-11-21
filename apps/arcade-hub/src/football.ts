import { initChrome } from './chrome';
import { bootFootball, buildScorebug } from '@monster-league/football';
import type { HudState } from '@monster-league/football';

initChrome();

// Mount the enriched GSN 66.6 scorebug once; MatchScene syncs its live value
// cells (score, clock, play clock, down/distance, casualty skulls, bribe badge)
// in place every frame via the debug-handle session state.
const initial: HudState = {
  home: { faction: 'reapers', score: 0, casualties: 0 },
  away: { faction: 'deadskins', score: 0, casualties: 0 },
  quarter: 1,
  clockSeconds: 180,
  playClockSeconds: 25,
  possession: 'home',
  down: 1,
  yardsToGo: 10,
  los: 25,
  bribedRefTeam: null,
  demonRefActive: false,
  availableNasties: ['PUMPKIN_BOMB_PASS', 'DYNAMITE_PITCH', 'BRIBE_REF'],
  banner: '',
};

document.getElementById('scorebug')?.append(buildScorebug(initial));

const host = document.getElementById('game');
if (host) bootFootball(host, { production: import.meta.env.PROD });