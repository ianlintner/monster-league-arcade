/**
 * On-screen arcade controls — the DOM half of the existing shared `InputManager`.
 *
 * No new input model: every pad/face button calls `InputManager.setTouch` on the
 * same instance the match polls, so taps are indistinguishable from keyboard or
 * gamepad input and keep the manager's edge-buffered latch (a quick tap is
 * delivered exactly once). The overlay is a page-level concern, not a Phaser
 * scene concern; the page owns the manager and passes it to `bootFootball`.
 */
import type { InputManager, PlayerIndex } from './InputManager';

export type TouchControl = 'up' | 'down' | 'left' | 'right' | 'A' | 'B' | 'C' | 'START';

export interface TouchControlsOptions {
  /** The same manager the game polls (P1 by default). */
  input: InputManager;
  doc?: Document;
  win?: Window;
  player?: PlayerIndex;
  host?: HTMLElement;
}

/** Order matters: it is also the visual order in each cluster. */
const DPAD: TouchControl[] = ['up', 'left', 'right', 'down'];
const FACE: TouchControl[] = ['A', 'B', 'C', 'START'];

const LABELS: Record<TouchControl, string> = {
  up: 'Up — move north',
  down: 'Down — move south',
  left: 'Left — move west',
  right: 'Right — move east',
  A: 'A — call play, dive or throw',
  B: 'B — call play, switch defender or throw',
  C: 'C — call play, hike, turbo or throw',
  START: 'START — restart after the final whistle',
};

function makeButton(
  doc: Document,
  input: InputManager,
  player: PlayerIndex,
  control: TouchControl,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `gsn-touch-btn gsn-touch-btn--${control}`;
  button.dataset.control = control;
  button.setAttribute('data-testid', `touch-${control}`);
  button.setAttribute('aria-label', LABELS[control]);
  button.textContent = control === 'START' ? 'START' : control.toUpperCase();

  const press = (event: PointerEvent): void => {
    event.preventDefault();
    button.classList.add('is-pressed');
    // Pointer capture keeps the release on this button even if the finger drifts;
    // jsdom has no capture API, hence the guards.
    if (typeof button.setPointerCapture === 'function' && event.pointerId !== undefined) {
      button.setPointerCapture(event.pointerId);
    }
    input.setTouch(player, control, true);
  };
  const release = (event: PointerEvent): void => {
    button.classList.remove('is-pressed');
    input.setTouch(player, control, false);
    if (
      typeof button.releasePointerCapture === 'function' &&
      event.pointerId !== undefined &&
      typeof button.hasPointerCapture === 'function' &&
      button.hasPointerCapture(event.pointerId)
    ) {
      button.releasePointerCapture(event.pointerId);
    }
  };

  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
  button.addEventListener('lostpointercapture', release);
  return button;
}

/**
 * Build the pad + A/B/C/START overlay once and append it to `host` (body by
 * default). CSS shows it on coarse pointers and after the first real touch on a
 * hybrid device; desktop never sees it. Returns nothing by design — the manager
 * is the only state, so there is nothing to tear down explicitly.
 */
export function mountTouchControls(opts: TouchControlsOptions): HTMLElement {
  const { input, doc = document, win = window, player = 0 } = opts;
  const host = opts.host ?? doc.body;

  const root = doc.createElement('div');
  root.className = 'gsn-touch-controls';
  root.setAttribute('data-testid', 'touch-controls');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'On-screen game controls');

  const dpad = doc.createElement('div');
  dpad.className = 'gsn-touch-controls__dpad';
  for (const control of DPAD) dpad.append(makeButton(doc, input, player, control));

  const face = doc.createElement('div');
  face.className = 'gsn-touch-controls__face';
  for (const control of FACE) face.append(makeButton(doc, input, player, control));

  root.append(dpad, face);
  host.append(root);

  // Coarse pointers are already covered by CSS; this handles hybrids where the
  // first touch happens before any button is visible.
  const activate = (): void => doc.body.classList.add('gsn-touch-ready');
  win.addEventListener('touchstart', activate, { once: true, passive: true });
  if (typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches) {
    activate();
  }
  return root;
}
