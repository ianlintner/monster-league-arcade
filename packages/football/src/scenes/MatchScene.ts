/**
 * MatchScene — the live-play field experience for Halloween Monster League
 * Football. Replaces the static preview gridiron: it boots a full `GameSession`,
 * drives a 60 Hz `LivePlay` down in the Phaser update loop (snap → whistle),
 * commits the outcome via `session.snap({ force: { yards } })`, and renders a
 * 2.5D gridiron with y-sorted actors, ellipse shadows and carrier indicators.
 *
 * Scope for this card: offense/carrier is human-controlled; defense is
 * lightweight (B cycles the highlighted pursuer). The play pick is three run
 * plays on A/B/C. `window.__mlf` exposes the session + phase for e2e/Playwright.
 */
import * as Phaser from 'phaser';
import {
  HALLOWEEN_MIDNIGHT_PALETTE as P,
  projectToScreen,
  toPhaserColor,
} from '@monster-league/shared-core';
import { GameSession } from '../sim/index';
import { buildLivePlayInput, projectActor } from '../field/fieldMapper';
import { LivePlay, type LiveActorState, type LivePlayResult } from '../field/LivePlay';

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

/** Three human-selectable run plays (A/B/C), each with its own formation. */
const RUN_PLAYS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'INSIDE_GORE_RUN', label: 'Inside Gore Run' },
  { id: 'COFFIN_SWEEP', label: 'Coffin Sweep' },
  { id: 'OPTION_PITCH', label: 'Option Pitch' },
];
const DEFAULT_DEFENSE = 'BONE_CRUSH_BASE';

/** Phaser 4 Graphics draw surface (narrowed to the methods the renderer uses). */
interface DrawSurface {
  fillStyle(color: number, alpha?: number): unknown;
  lineStyle(width: number, color: number, alpha?: number): unknown;
  fillRect(x: number, y: number, w: number, h: number): unknown;
  fillEllipse(x: number, y: number, rx: number, ry: number): unknown;
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): unknown;
  strokeEllipse(x: number, y: number, rx: number, ry: number): unknown;
  arc(
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    anticlockwise?: boolean,
  ): unknown;
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
}

/** Actor draw data cached per frame for y-sorting. */
interface RenderActor {
  state: LiveActorState;
  px: number;
  py: number;
  depth: number;
  isCarrier: boolean;
  isHighlighted: boolean;
}

export class MatchScene extends Phaser.Scene {
  private session!: GameSession;
  private live: LivePlay | null = null;
  private liveResult: LivePlayResult | null = null;

  /** Presentation state machine layered over `GameSession`'s own phases. */
  private mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER' = 'PICK';
  private selectedPlayIndex = 0;
  private bannerText = '';
  private bannerTimer = 0;
  private highlightDefender = -1;
  private inputPollTimer = 0;
  private steer = { x: 0, y: 0 };
  /** Accumulated real time (s) not yet consumed by fixed 60 Hz sim ticks. */
  private simAccumulator = 0;
  /** Snap-time LOS, captured when the live play is built, for stable rendering. */
  private snapLos = 0;

  private fieldGfx!: Phaser.GameObjects.Graphics;
  private indicatorGfx!: Phaser.GameObjects.Graphics;
  private actorsLayer!: Phaser.GameObjects.Container;
  private readyText!: Phaser.GameObjects.Text;

  private pressed = new Set<number>();

  constructor() {
    super('match');
  }

  // ------------------------------------------------------------- lifecycle

  create(): void {
    this.mode = 'PICK';
    this.live = null;
    this.liveResult = null;

    // Bootstrap a session to the first huddle: home receives the opening kick.
    this.session = new GameSession({
      seed: 1993,
      homeFaction: 'REAPERS',
      awayFaction: 'DEADSKINS',
    });
    this.session.coinToss('home');
    this.session.kickoff({ touchback: true });

    this.fieldGfx = this.add.graphics();
    this.drawField(this.fieldGfx as unknown as DrawSurface);

    // Actors render as small tinted rectangles on a container rebuilt each frame.
    this.actorsLayer = this.add.container(0, 0);
    this.indicatorGfx = this.add.graphics();

    this.readyText = this.add
      .text(8, 8, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '8px',
        color: P.ECTO_GREEN,
        backgroundColor: 'rgba(11,7,17,0.6)',
      })
      .setOrigin(0, 0)
      .setDepth(100);

    this.exposeDebugHandle();
    this.refreshUi();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.sampleInput(dt);

    switch (this.mode) {
      case 'PICK':
        this.updatePick();
        break;
      case 'PRE_SNAP':
        this.updatePreSnap();
        break;
      case 'LIVE':
        this.updateLive(dt);
        break;
      case 'BANNER':
        this.updateBanner(dt);
        break;
    }
    this.drawActors();
    this.refreshUi();
  }

  // ------------------------------------------------------------- inputs

  private sampleInput(dt: number): void {
    this.inputPollTimer -= dt;
    if (this.inputPollTimer > 0) {
      // A skipped poll must not leak the previous frame's edge presses into the
      // next mode handler, or one press can re-fire (e.g. C both picks *and*
      // snaps when a poll is skipped between them). Clear now.
      this.pressed.clear();
      return;
    }
    this.inputPollTimer = 1 / 60;

    const kb = this.input.keyboard!;
    const left = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT).isDown;
    const right = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT).isDown;
    const up = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP).isDown;
    const down = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN).isDown;
    this.steer.x = (right ? 1 : 0) - (left ? 1 : 0);
    this.steer.y = (down ? 1 : 0) - (up ? 1 : 0);

    this.pressed.clear();
    for (const code of [KeyA, KeyB, KeyC] as const) {
      if (Phaser.Input.Keyboard.JustDown(kb.addKey(code))) this.pressed.add(code);
    }
  }

  private wasPressed(code: number): boolean {
    return this.pressed.has(code);
  }

  // --------------------------------------------------------- pick / presnap

  private updatePick(): void {
    if (this.wasPressed(KeyA)) this.selectedPlayIndex = 0;
    else if (this.wasPressed(KeyB)) this.selectedPlayIndex = 1;
    else if (this.wasPressed(KeyC)) this.selectedPlayIndex = 2;
    else if (this.justLeft()) this.selectedPlayIndex = (this.selectedPlayIndex + 2) % 3;
    else if (this.justRight()) this.selectedPlayIndex = (this.selectedPlayIndex + 1) % 3;
    else return;
    this.confirmPlay(this.selectedPlayIndex);
  }

  private justLeft(): boolean {
    return Phaser.Input.Keyboard.JustDown(
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
    );
  }
  private justRight(): boolean {
    return Phaser.Input.Keyboard.JustDown(
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
    );
  }

  private confirmPlay(index: number): void {
    this.selectedPlayIndex = index;
    this.session.selectPlays(RUN_PLAYS[index]!.id, DEFAULT_DEFENSE);
    // Build the live-play state now so the formation renders during pre-snap;
    // it is only *advanced* once the ball is snapped.
    this.buildLivePlay();
    this.mode = 'PRE_SNAP';
  }

  private buildLivePlay(): void {
    const input = buildLivePlayInput(
      this.session,
      RUN_PLAYS[this.selectedPlayIndex]!.id,
      DEFAULT_DEFENSE,
      0x9e3779b9,
    );
    this.live = new LivePlay(input);
    this.snapLos = this.session.los;
    this.liveResult = null;
    this.highlightDefender = -1;
    this.simAccumulator = 0;
  }

  private updatePreSnap(): void {
    if (this.wasPressed(KeyC)) {
      this.mode = 'LIVE';
    }
  }

  // ------------------------------------------------------------- live loop

  private updateLive(dt: number): void {
    const live = this.live;
    if (!live) return;

    if (this.wasPressed(KeyB)) {
      // Defense: cycle which defender is the highlighted "user" pursuer.
      this.highlightDefender = (this.highlightDefender + 1) % 7;
    }

    // Feed the carrier command, then advance one 60 Hz step per 1/60 s of real
    // elapsed time (catch-up capped at 4 steps so a stalled frame doesn't burst).
    const turboHeld = this.input.keyboard!.addKey(KeyC).isDown;
    live.command({
      steerX: this.steer.x,
      steerY: this.steer.y,
      dive: this.wasPressed(KeyA),
      turbo: turboHeld,
    });

    this.simAccumulator += dt;
    const tick = 1 / 60;
    const maxSteps = 4;
    let steps = 0;
    while (this.simAccumulator >= tick && steps < maxSteps) {
      this.simAccumulator -= tick;
      const outcome = live.advance();
      steps += 1;
      if (outcome.kind === 'WHISTLE') break;
    }
    if (steps === maxSteps) this.simAccumulator = 0; // drop excess, stay near real time

    if (live.snapshot().outcome.kind === 'WHISTLE') {
      this.liveResult = live.result();
      this.commitOutcome();
    }
  }

  /** Commit the live-play result into the session and show the play-over banner. */
  private commitOutcome(): void {
    const r = this.liveResult!;
    // The live carrier's final downfield position IS the gain from scrimmage;
    // keep it fractional so GameSession classifies TDs/safeties exactly.
    const yards = r.finalX;
    const res = this.session.snap({ force: { yards } });
    this.bannerText = res.banner;
    this.bannerTimer = 2.2;
    this.mode = 'BANNER';
  }

  private updateBanner(dt: number): void {
    this.bannerTimer -= dt;
    if (this.bannerTimer > 0) return;

    const phase = this.session.phase;
    if (phase === 'PLAY_OVER_BANNER') this.session.dismissBanner();
    else if (phase === 'QUARTER_END' || phase === 'HALFTIME') this.session.advancePeriod();
    else if (phase === 'GAME_OVER') {
      // Noninteractive: stay on the final banner; there is no next play to pick.
      return;
    }

    // Collapse extra-point / kickoff wind-downs to the next huddle for this card.
    let guard = 0;
    while (
      this.session.phase !== 'HUDDLE_PLAYCALL' &&
      this.session.phase !== 'GAME_OVER' &&
      guard++ < 8
    ) {
      if (this.session.phase === 'EXTRA_POINT') this.session.extraPoint('KICK');
      else if (this.session.phase === 'KICKOFF') this.session.kickoff({ touchback: true });
      else if (this.session.phase === 'PLAY_OVER_BANNER') this.session.dismissBanner();
      else if (this.session.phase === 'QUARTER_END' || this.session.phase === 'HALFTIME')
        this.session.advancePeriod();
      else break;
    }

    // Remain on the final banner for GAME_OVER; otherwise return to play-calling.
    if (this.session.phase === 'GAME_OVER') {
      this.liveResult = null;
      return;
    }

    this.live = null;
    this.liveResult = null;
    this.mode = 'PICK';
  }

  // ------------------------------------------------------------- rendering

  /** Draw the static 2.5D gridiron backdrop once. */
  private drawField(g: DrawSurface): void {
    g.fillStyle(toPhaserColor('VOID_BLACK'), 1);
    g.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // End zones + field of play as perspective quads.
    this.perspectiveQuad(g, 0, 10, toPhaserColor('PUMPKIN_ORANGE'), 0.85);
    this.perspectiveQuad(g, 10, 110, 0x2a4d3e, 0.95);
    this.perspectiveQuad(g, 110, 120, toPhaserColor('VAMPIRE_CRIMSON'), 0.85);

    // Yard lines every 5 yards; heavier at 10s; hash marks on minors.
    for (let x = 10; x <= 110; x += 5) {
      const major = x % 10 === 0;
      const a = projectToScreen(x, 0);
      const b = projectToScreen(x, 53);
      g.lineStyle(major ? 2 : 1, toPhaserColor('BONE_WHITE'), major ? 0.9 : 0.5);
      g.lineBetween(a.x, a.y, b.x, b.y);
      if (!major) this.drawHashes(g, x);
    }

    // Yard numbers on the major lines (skip goal lines).
    for (let x = 20; x <= 100; x += 10) {
      this.drawYardNumber(g, x);
    }

    // Midfield crest at the 50.
    const c = projectToScreen(60, 26.5);
    this.drawCrest(g, c.x, c.y, c.scale);

    // Goalposts at each end.
    this.drawGoalpost(g, projectToScreen(1, 26.5));
    this.drawGoalpost(g, projectToScreen(119, 26.5));
  }

  private perspectiveQuad(
    g: DrawSurface,
    x0: number,
    x1: number,
    color: number,
    alpha: number,
  ): void {
    const tl = projectToScreen(x0, 0);
    const tr = projectToScreen(x1, 0);
    const br = projectToScreen(x1, 53);
    const bl = projectToScreen(x0, 53);
    g.fillStyle(color, alpha);
    g.fillTriangle(tl.x, tl.y, tr.x, tr.y, br.x, br.y);
    g.fillTriangle(tl.x, tl.y, br.x, br.y, bl.x, bl.y);
  }

  private drawHashes(g: DrawSurface, x: number): void {
    g.lineStyle(1, toPhaserColor('AGED_PARCHMENT'), 0.6);
    for (const cy of [20.5, 32.5]) {
      const a = projectToScreen(x, cy - 1);
      const b = projectToScreen(x, cy + 1);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private drawYardNumber(g: DrawSurface, x: number): void {
    // Yardage from the nearer goal line (field x=10 and x=110), so x=20 is the
    // 10-yard line (not 40) and midfield x=60 is 50 (not 0).
    const label = String(Math.min(x - 10, 110 - x));
    const top = projectToScreen(x, 14);
    const bot = projectToScreen(x, 39);
    this.drawBlockText(g, label, top.x, top.y, top.scale);
    this.drawBlockText(g, label, bot.x, bot.y, bot.scale);
  }

  /** A cheap 3x5 pixel digit drawn as filled cells (only 0..9 needed). */
  private drawBlockText(g: DrawSurface, text: string, cx: number, cy: number, s: number): void {
    const glyphs: Record<string, number> = {
      '0': 0x7b6f,
      '1': 0x1249,
      '2': 0x73e7,
      '3': 0x73cf,
      '4': 0x5bc9,
      '5': 0x79cf,
      '6': 0x79ef,
      '7': 0x7249,
      '8': 0x7bef,
      '9': 0x7bcf,
    };
    const cw = Math.max(3, 4 * s);
    const ch = Math.max(5, 6 * s);
    const gap = Math.max(1, s);
    // Render every digit, offsetting each glyph to the right, so "10"/"40" show
    // both characters instead of only the leading one.
    const total = text.length * (cw * 3) + (text.length - 1) * gap;
    const xBase = cx - total / 2;
    const y0 = cy - ch / 2;
    g.fillStyle(toPhaserColor('BONE_WHITE'), 0.85);
    for (let i = 0; i < text.length; i++) {
      const bits = glyphs[text[i] ?? '0'] ?? 0;
      const x0 = xBase + i * (cw * 3 + gap);
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (bits & (1 << (row * 3 + col))) g.fillRect(x0 + col * cw, y0 + row * ch, cw, ch);
        }
      }
    }
  }

  private drawCrest(g: DrawSurface, cx: number, cy: number, s: number): void {
    const r = Math.max(8, 16 * s);
    g.fillStyle(toPhaserColor('IRON_BEZEL'), 0.8);
    g.fillEllipse(cx, cy, r, r);
    g.lineStyle(Math.max(1, 2 * s), toPhaserColor('BONE_WHITE'), 0.9);
    g.strokeEllipse(cx, cy, r, r);
    g.fillStyle(toPhaserColor('BONE_WHITE'), 1);
    g.fillRect(cx - r * 0.4, cy - r * 0.3, r * 0.2, r * 0.3);
    g.fillRect(cx + r * 0.2, cy - r * 0.3, r * 0.2, r * 0.3);
  }

  private drawGoalpost(g: DrawSurface, base: { x: number; y: number; scale: number }): void {
    const h = 26 * base.scale;
    const w = 9 * base.scale;
    g.lineStyle(2, toPhaserColor('IRON_BEZEL'), 1);
    g.lineBetween(base.x - w, base.y, base.x - w, base.y - h);
    g.lineBetween(base.x + w, base.y, base.x + w, base.y - h);
    g.lineBetween(base.x - w, base.y - h * 0.55, base.x + w, base.y - h * 0.55);
  }

  /** Rebuild the actor sprites each frame, y-sorted, with shadows + indicators. */
  private drawActors(): void {
    this.actorsLayer.removeAll(true);
    if (!this.live) return;

    const los = this.snapLos;
    // Resolve the highlighted defender's id once (B cycles index 0..6).
    const defenders = this.live.actors.filter((x) => x.side === 'DEFENSE');
    const hlId = this.highlightDefender >= 0 ? defenders[this.highlightDefender]?.id : undefined;
    const actors: RenderActor[] = this.live.actors.map((state) => {
      const f = projectActor(state.x, state.y, los);
      const s = projectToScreen(f.x, f.y);
      return {
        state,
        px: s.x,
        py: s.y,
        depth: s.y,
        isCarrier: state.id === this.live!.carrier.id,
        isHighlighted: hlId !== undefined && state.id === hlId,
      };
    });

    // Ground indicators render under every actor.
    this.drawIndicators(actors);

    actors.sort((a, b) => a.depth - b.depth);
    for (const a of actors) this.drawActor(a);
  }

  private drawActor(a: RenderActor): void {
    const s = a.state;
    const w = 12;
    const h = 18;
    const color = s.team === 'home' ? toPhaserColor('BONE_WHITE') : toPhaserColor('ECTO_GREEN');

    const sp = this.add.rectangle(a.px, a.py - h / 2, w, h, color, 1);
    sp.setDepth(a.depth);
    if (a.isCarrier) sp.setFillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
    if (a.isHighlighted) sp.setStrokeStyle(1, toPhaserColor('SPECTRAL_CYAN'), 1);
    this.actorsLayer.add(sp);

    const shadow = this.add.ellipse(a.px, a.py, w * 1.2, 5, 0x000000, 0.35);
    shadow.setDepth(a.depth - 0.5);
    this.actorsLayer.add(shadow);
  }

  private drawIndicators(actors: RenderActor[]): void {
    const g = this.indicatorGfx;
    g.clear();
    const carrier = actors.find((a) => a.isCarrier);
    if (!carrier) return;

    const { state, px, py } = carrier;
    // Amber star under the carrier.
    this.drawStar(g, px, py + 4);

    // Cyan ring + velocity arrow + stamina arc around the carrier.
    const r = 16;
    g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
    g.strokeEllipse(px, py - 8, r, r * 0.7);

    const mag = Math.hypot(state.vx, state.vy);
    if (mag > 0.1) {
      const nx = state.vx / mag;
      const ny = state.vy / mag;
      g.lineBetween(px, py - 8, px + nx * 18, py - 8 + ny * 8);
    }

    // Stamina arc: partial circle from 12 o'clock clockwise proportional to 0..1.
    // `Graphics.arc` only appends to the path; start a fresh path and stroke it
    // explicitly so the arc actually renders (otherwise it is cleared next frame).
    const frac = Math.max(0, Math.min(1, state.stamina));
    g.lineStyle(2, toPhaserColor('ECTO_GREEN'), 0.85);
    g.beginPath();
    g.arc(px, py - 8, r + 3, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
    g.strokePath();
  }

  private drawStar(g: DrawSurface, cx: number, cy: number): void {
    const r = 4;
    g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
    g.fillTriangle(cx, cy - r, cx + r * 0.7, cy, cx, cy + r);
    g.fillTriangle(cx, cy - r, cx - r * 0.7, cy, cx, cy + r);
    g.fillTriangle(cx - r, cy, cx + r, cy, cx, cy - r * 1.6);
  }

  // ------------------------------------------------------------- HUD / dom

  private refreshUi(): void {
    const clock = `${String(Math.floor(this.session.clock / 60)).padStart(2, '0')}:${String(
      Math.floor(this.session.clock % 60),
    ).padStart(2, '0')}`;
    const down = `DOWN ${this.session.down} · ${this.session.yardsToGo} TO GO`;

    let prompt = '';
    switch (this.mode) {
      case 'PICK':
        prompt = `Call the play — [A] ${RUN_PLAYS[0]!.label} · [B] ${RUN_PLAYS[1]!.label} · [C] ${RUN_PLAYS[2]!.label}`;
        break;
      case 'PRE_SNAP':
        prompt = `Pre-Snap: [C] Snaps the ball · ${down}`;
        break;
      case 'LIVE':
        prompt = `Live: arrows run · [A] Dive · [C] Turbo · [B] Switch defender`;
        break;
      case 'BANNER':
        prompt = this.bannerText;
        break;
    }
    const line = `${down}  ${clock}\n${prompt}`;
    this.readyText.setText(line);
    this.updateDom(line);
  }

  private updateDom(line: string): void {
    // Update the scorebug's value cells in place rather than overwriting the
    // component's `textContent`, which would destroy its team names/swatches.
    const scorebug = document.querySelector('[data-testid="scorebug"]');
    if (scorebug) {
      const scores = scorebug.querySelectorAll('.gsn-scorebug__score');
      if (scores.length >= 2 && scores[0] && scores[1]) {
        scores[0].textContent = String(this.session.score.home);
        scores[1].textContent = String(this.session.score.away);
      }
      const meta = scorebug.querySelector('.gsn-scorebug__meta');
      if (meta) meta.textContent = `Q${this.session.quarter}`;
      const center = scorebug.querySelector('.gsn-scorebug__center');
      const clock = center?.children[1];
      if (clock) {
        clock.textContent = `${String(Math.floor(this.session.clock / 60)).padStart(2, '0')}:${String(
          Math.floor(this.session.clock % 60),
        ).padStart(2, '0')}`;
      }
    }
    const prompt = document.querySelector('.gsn-control-bar__prompt');
    if (prompt) prompt.textContent = line;

    const banner = document.getElementById('banner');
    if (banner) banner.textContent = this.mode === 'BANNER' ? this.bannerText : '';
  }

  // ------------------------------------------------------------- debug handle

  private exposeDebugHandle(): void {
    const session = () => this.session;
    const live = () => this.live;
    const mode = () => this.mode;
    (window as unknown as Record<string, unknown>).__mlf = {
      session: session(),
      get phase() {
        return session().phase;
      },
      get mode() {
        return mode();
      },
      get score() {
        return session().score;
      },
      get los() {
        return session().los;
      },
      get down() {
        return session().down;
      },
      get carrierId() {
        return live()?.carrier.id ?? null;
      },
      pick: (i: number) => {
        this.selectedPlayIndex = Math.max(0, Math.min(2, Number(i) || 0));
        this.confirmPlay(this.selectedPlayIndex);
      },
      snap: () => {
        if (this.mode === 'PRE_SNAP') this.mode = 'LIVE';
      },
    };
  }
}

const KeyA = Phaser.Input.Keyboard.KeyCodes.A;
const KeyB = Phaser.Input.Keyboard.KeyCodes.B;
const KeyC = Phaser.Input.Keyboard.KeyCodes.C;
