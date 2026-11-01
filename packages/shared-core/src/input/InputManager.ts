/**
 * Unified Genesis 3-button arcade input: A, B, C, Start + 8-way/360° direction.
 * Sources: keyboard (P1 WASD/JKL, P2 Arrows/Z-X-C), Gamepad API, on-screen touch.
 */
export type ArcadeButton = 'A' | 'B' | 'C' | 'START';
export type PlayerIndex = 0 | 1;

export interface InputSnapshot {
  /** Normalised direction vector, magnitude 0..1 (360° analog, 8-way digital). */
  x: number;
  y: number;
  buttons: Record<ArcadeButton, boolean>;
}

export interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  A: string[];
  B: string[];
  C: string[];
  START: string[];
}

export const KEY_MAPS: Record<PlayerIndex, KeyMap> = {
  0: {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    A: ['KeyJ', 'Space'],
    B: ['KeyK'],
    C: ['KeyL'],
    START: ['KeyP'],
  },
  1: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    A: ['KeyZ'],
    B: ['KeyX'],
    C: ['KeyC'],
    START: ['Enter'],
  },
};

/** Standard-mapping gamepad: South=A, East=B, West=C, Start=9. */
export const GAMEPAD_BUTTONS: Record<ArcadeButton, number> = { A: 0, B: 1, C: 2, START: 9 };
const STICK_DEADZONE = 0.25;

const BUTTONS: ArcadeButton[] = ['A', 'B', 'C', 'START'];

export function emptySnapshot(): InputSnapshot {
  return { x: 0, y: 0, buttons: { A: false, B: false, C: false, START: false } };
}

/** Normalise a raw vector: apply deadzone and clamp magnitude to 1. */
export function normalizeDirection(x: number, y: number, deadzone = STICK_DEADZONE) {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { x: 0, y: 0 };
  const k = mag > 1 ? 1 / mag : 1;
  return { x: x * k, y: y * k };
}

/** Digital 8-way vector from four direction flags (diagonals normalised). */
export function digitalDirection(up: boolean, down: boolean, left: boolean, right: boolean) {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  const mag = Math.hypot(x, y);
  return mag === 0 ? { x: 0, y: 0 } : { x: x / mag, y: y / mag };
}

const ALL_MAPPED_CODES = new Set(Object.values(KEY_MAPS).flatMap((m) => Object.values(m).flat()));

export class InputManager {
  private keys = new Set<string>();
  private touch: Record<PlayerIndex, Set<string>> = { 0: new Set(), 1: new Set() };
  private target: Window | null = null;

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ALL_MAPPED_CODES.has(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onBlur = (): void => {
    this.keys.clear();
  };

  attach(target: Window = window): void {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.keys.clear();
  }

  /** Drive from on-screen touch controls: names are 'up','down','left','right','A','B','C','START'. */
  setTouch(player: PlayerIndex, control: string, pressed: boolean): void {
    if (pressed) this.touch[player].add(control);
    else this.touch[player].delete(control);
  }

  /** Inject a key state directly (tests / synthetic input). */
  setKey(code: string, pressed: boolean): void {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
  }

  private held(player: PlayerIndex, control: keyof KeyMap): boolean {
    return (
      KEY_MAPS[player][control].some((c) => this.keys.has(c)) || this.touch[player].has(control)
    );
  }

  private gamepadFor(player: PlayerIndex): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function')
      return null;
    const pads = navigator.getGamepads();
    return pads?.[player] ?? null;
  }

  poll(player: PlayerIndex): InputSnapshot {
    const snap = emptySnapshot();
    const dir = digitalDirection(
      this.held(player, 'up'),
      this.held(player, 'down'),
      this.held(player, 'left'),
      this.held(player, 'right'),
    );
    let { x, y } = dir;
    for (const b of BUTTONS) snap.buttons[b] = this.held(player, b);

    const pad = this.gamepadFor(player);
    if (pad) {
      const dx = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const dy = (pad.buttons[13]?.pressed ? 1 : 0) - (pad.buttons[12]?.pressed ? 1 : 0);
      const stick = normalizeDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      const padDir =
        dx !== 0 || dy !== 0 ? digitalDirection(dy < 0, dy > 0, dx < 0, dx > 0) : stick;
      if (padDir.x !== 0 || padDir.y !== 0) {
        x = padDir.x;
        y = padDir.y;
      }
      for (const b of BUTTONS) {
        if (pad.buttons[GAMEPAD_BUTTONS[b]]?.pressed) snap.buttons[b] = true;
      }
    }
    snap.x = x;
    snap.y = y;
    return snap;
  }
}
