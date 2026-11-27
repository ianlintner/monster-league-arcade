import { AudioManager, InputManager, mountTouchControls } from '@monster-league/shared-core';
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
if (host) {
  // One manager per page: the scene polls it, the on-screen pad presses it, and
  // the keyboard listener the scene attaches feeds the same instance.
  const input = new InputManager();
  mountTouchControls({ input });
  bootFootball(host, { production: import.meta.env.PROD, audio, input });
}

// Integer-scale the 640×360 backing canvas to the largest nearest-neighbour
// multiple that fits both viewport and bezel (e.g. 2x at a roomy 1280-wide
// stage); the CRT cup uses pixelated rendering, so non-integer CSS scaling would
// smear the 48×48 sprites. When the integer step would overflow the bezel —
// 2x = 1280px inside a ~1100px bezel at a 1280px viewport — fall back to a
// fluid fit; a smeared field is better than a document horizontal scrollbar.
// Phaser runs `Scale.NONE`, so it never touches the canvas style — only the
// 640 attribute size — and this routine owns the CSS dimensions. Re-run on
// resize so a widened window re-targets the next integer step.
const CANVAS_BACKING_W = 640;
const CANVAS_BACKING_H = 360;
function applyIntegerScale(): void {
  const canvas = host?.querySelector<HTMLCanvasElement>('canvas');
  if (!canvas || !host) return;
  const availW = Math.min(window.innerWidth, document.documentElement.clientWidth);
  const availH = Math.min(window.innerHeight, document.documentElement.clientHeight);
  const widthScale = Math.floor(availW / CANVAS_BACKING_W);
  const heightScale = Math.floor(availH / CANVAS_BACKING_H);
  const scale = Math.max(1, Math.min(widthScale, Math.max(1, heightScale)));

  // The bezel is a shrink-to-fit flex item: without an explicit width it collapses
  // to the canvas's 640px intrinsic size. Fill the stage so a fluid canvas has room.
  host.style.width = '100%';
  const bezelStyle = getComputedStyle(host);
  const bezelInnerW =
    host.clientWidth - parseFloat(bezelStyle.paddingLeft) - parseFloat(bezelStyle.paddingRight);

  if (
    scale >= 1 &&
    widthScale >= 1 &&
    heightScale >= 1 &&
    CANVAS_BACKING_W * scale <= bezelInnerW
  ) {
    // Integer-scale to the largest nearest-neighbour multiple that fits. Reverts
    // the shared `max-width:100%` clamp so the integer-sized canvas isn't smeared.
    host.style.width = '';
    canvas.style.maxWidth = 'none';
    canvas.style.width = `${CANVAS_BACKING_W * scale}px`;
    canvas.style.height = `${CANVAS_BACKING_H * scale}px`;
    return;
  }

  // Narrow/short viewport (< 640 wide), or an integer scale that would overflow
  // the bezel: fit the bezel's content width exactly.
  canvas.style.maxWidth = '100%';
  canvas.style.width = bezelInnerW > 0 ? `${bezelInnerW}px` : '100%';
  canvas.style.height = 'auto';
}
// The canvas mounts inside `#game` synchronously at `bootFootball` creation, but
// defer one frame so Phaser has the element in the DOM before we restyle it.
requestAnimationFrame(() => {
  applyIntegerScale();
  window.addEventListener('resize', applyIntegerScale);
});
