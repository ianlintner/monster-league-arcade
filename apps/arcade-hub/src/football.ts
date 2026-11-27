import { AudioManager } from '@monster-league/shared-core';
import { initChrome } from './chrome';
import { unlockOnFirstGesture, wireMuteControls } from './audioControls';
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

// One AudioManager for the page. No AudioContext exists until the first real
// gesture (keydown/pointer/gamepad) unlocks it, so autoplay policy is respected.
const audio = new AudioManager();
unlockOnFirstGesture(audio); // before the first-run card's capture handler
audio.attachAutoUnlock();
wireMuteControls(audio);

const host = document.getElementById('game');
if (host) bootFootball(host, { production: import.meta.env.PROD, audio });

// Integer-scale the 640×360 backing canvas to the largest nearest-neighbour
// multiple that fits the viewport (1x at ≤640, 2x at 1280, 3x at 1920, …). The
// CRT cup uses pixelated rendering, so non-integer CSS scaling would smear the
// 48×48 sprites; an integer scale keeps every backing pixel a crisp block. Phaser
// runs `Scale.NONE`, so it never touches the canvas style — only the 640 attribute
// size — and this routine owns the CSS dimensions. Re-run on resize so a widened
// window re-targets the next integer step.
//
// Width is primary so the scale matches the viewport examples exactly (2x at
// 1280 wide, 3x at 1920 wide); height only caps it so a very short viewport
// never renders the canvas larger than the window. `max-width: none` overrides
// the shared `.gsn-canvas-bezel canvas { max-width: 100% }` rule, which would
// otherwise clamp an integer-sized canvas back to the chrome's 1180px cap and
// re-smear the sprites.
const CANVAS_BACKING_W = 640;
const CANVAS_BACKING_H = 360;
function applyIntegerScale(): void {
  const canvas = host?.querySelector<HTMLCanvasElement>('canvas');
  if (!canvas) return;
  const availW = Math.min(window.innerWidth, document.documentElement.clientWidth);
  const availH = Math.min(window.innerHeight, document.documentElement.clientHeight);
  const widthScale = Math.floor(availW / CANVAS_BACKING_W);
  const heightScale = Math.floor(availH / CANVAS_BACKING_H);
  const scale = Math.max(1, Math.min(widthScale, Math.max(1, heightScale)));

  if (scale >= 1 && widthScale >= 1 && heightScale >= 1) {
    // Integer-scale to the largest nearest-neighbour multiple that fits. Reverts
    // the shared `max-width:100%` clamp so the integer-sized canvas isn't smeared.
    canvas.style.maxWidth = 'none';
    canvas.style.width = `${CANVAS_BACKING_W * scale}px`;
    canvas.style.height = `${CANVAS_BACKING_H * scale}px`;
    return;
  }

  // Narrow/short viewport (< 640 wide): an integer scale would overflow the
  // window, so fall back to the fluid `max-width:100%` clamp from
  // `.gsn-canvas-bezel canvas` and let the backing aspect ratio stretch down.
  canvas.style.maxWidth = '100%';
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
}
// The canvas mounts inside `#game` synchronously at `bootFootball` creation, but
// defer one frame so Phaser has the element in the DOM before we restyle it.
requestAnimationFrame(() => {
  applyIntegerScale();
  window.addEventListener('resize', applyIntegerScale);
});
