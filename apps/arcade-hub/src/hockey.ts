import { initChrome } from './chrome';
import { buildScorebug } from '@monster-league/shared-core/ui';
import { bootHockey } from '@monster-league/hockey';

initChrome();
document.getElementById('scorebug')?.append(
  buildScorebug('nightstalkers', 'ghouls', {
    homeScore: 0,
    awayScore: 0,
    quarter: 1,
    clockSeconds: 300,
  }),
);
const host = document.getElementById('game');
if (host) bootHockey(host);
