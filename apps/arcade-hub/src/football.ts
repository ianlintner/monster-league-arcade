import { initChrome } from './chrome';
import { buildScorebug } from '@monster-league/shared-core/ui';
import { bootFootball } from '@monster-league/football';

initChrome();
document.getElementById('scorebug')?.append(
  buildScorebug('reapers', 'deadskins', {
    homeScore: 0,
    awayScore: 0,
    quarter: 1,
    clockSeconds: 180,
  }),
);
const host = document.getElementById('game');
if (host) bootFootball(host);
