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
import { GameSession, type Slot } from '../sim/index';
import { buildLivePlayInput, projectActor } from '../field/fieldMapper';
import { LivePlay, type LiveActorState, type LivePlayResult } from '../field/LivePlay';
import { HazardManager } from '../field/HazardManager';
import { resolvePassAttempt } from '../field/PlayOrchestrator';
import { styleForHold } from '../field/Ballistics';
import type { HazardHit } from '../sim/GameSession';

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

/** Three human-selectable plays (A/B/C) — two runs and one pass. */
const PLAY_CATALOG: ReadonlyArray<{ id: string; label: string; kind: 'RUN' | 'PASS' }> = [
  { id: 'INSIDE_GORE_RUN', label: 'Inside Gore Run', kind: 'RUN' },
  { id: 'COFFIN_SWEEP', label: 'Coffin Sweep', kind: 'RUN' },
  { id: 'QUICK_SLANTS', label: 'Quick Slants (Pass)', kind: 'PASS' },
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

  /** Hazard terrain for the arena, evaluated every live tick. */
  private hazardManager!: HazardManager;
  /** Hazard hits accumulated over the current live down, committed at whistle. */
  private pendingHazardHits: HazardHit[] = [];
  /** Whether the current live play is a pass (QB drops back, A/B/C = receivers). */
  private isPassPlay = false;
  /** Hold time for the current pass (ms) → lob vs bullet throw style. */
  private passHoldMs = 0;
  /** Whether the receiving windows are open (C toggles them behind the LOS). */
  private windowsOpen = false;
  /** Deterministic check used to trigger the first hazard for the e2e path. */
  private hazardArmedForDemo = true;

  /** Ball in flight (pass animation) — null when no ball is airborne. */
  private ballFlight: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    t: number;
    dur: number;
    style: 'LOB' | 'BULLET';
    onLand: () => void;
  } | null = null;

  /** Floating damage numbers + casualty/death animations, cleared per down. */
  private damagePopups: { x: number; y: number; text: string; color: number; ttl: number }[] = [];
  private casualties: { id: string; x: number; y: number; ttl: number }[] = [];

  private looseBall: { x: number; y: number; ttl: number } | null = null;

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

    // Hazard terrain derived from the home faction's arena; graveyard for now.
    this.hazardManager = new HazardManager('cursed-graveyard', 1993);

    this.fieldGfx = this.add.graphics();
    this.drawField(this.fieldGfx as unknown as DrawSurface);
    this.drawHazards(this.fieldGfx as unknown as DrawSurface);

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
    this.drawOverlays(dt);
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
    this.session.selectPlays(PLAY_CATALOG[index]!.id, DEFAULT_DEFENSE);
    this.mode = 'PRE_SNAP';
  }

  private updatePreSnap(): void {
    if (this.wasPressed(KeyC)) this.beginLivePlay();
  }

  private beginLivePlay(): void {
    const play = PLAY_CATALOG[this.selectedPlayIndex]!;
    this.isPassPlay = play.kind === 'PASS';
    this.passHoldMs = 0;
    this.windowsOpen = false;
    this.ballFlight = null;
    this.damagePopups = [];
    this.casualties = [];
    this.looseBall = null;
    this.pendingHazardHits = [];
    const input = buildLivePlayInput(this.session, play.id, DEFAULT_DEFENSE, 0x9e3779b9);
    this.live = new LivePlay(input);
    this.snapLos = this.session.los;
    this.liveResult = null;
    this.highlightDefender = -1;
    this.simAccumulator = 0;
  }

  // ------------------------------------------------------------- live loop

  private updateLive(dt: number): void {
    // Ball-in-flight animation runs to completion before further input lands.
    if (this.ballFlight) {
      this.advanceBallFlight();
      return;
    }

    const live = this.live;
    if (!live) return;

    if (this.wasPressed(KeyB) && !this.isPassPlay) {
      // Defense: cycle which defender is the highlighted "user" pursuer.
      this.highlightDefender = (this.highlightDefender + 1) % 7;
    }

    // Pass plays: C opens the receiving windows (scope: behind LOS); A/B/C throw
    // to the matching receiver while the windows are open. Hold length sets style.
    if (this.isPassPlay) {
      if (this.wasPressed(KeyC)) {
        this.windowsOpen = !this.windowsOpen;
        this.passHoldMs = 0;
      }
      // Track button hold for lob vs bullet on the throw keys (A/B/C).
      const holdKey =
        this.input.keyboard!.addKey(KeyA).isDown && this.input.keyboard!.addKey(KeyB).isDown
          ? null
          : this.input.keyboard!.addKey(KeyA).isDown
            ? KeyA
            : this.input.keyboard!.addKey(KeyB).isDown
              ? KeyB
              : this.input.keyboard!.addKey(KeyC).isDown
                ? KeyC
                : null;
      if (holdKey) this.passHoldMs += 16;
      else this.passHoldMs = 0;

      if (this.windowsOpen) {
        const throwTarget = this.wasPressed(KeyA) ? 'A' : this.wasPressed(KeyB) ? 'B' : null;
        // C both opens windows and (held) throws to C; a tap toggles. To throw
        // to C, require a hold — a fresh tap just toggles windows off/on.
        const cHeld = this.input.keyboard!.addKey(KeyC).isDown;
        const cTarget = cHeld && this.passHoldMs >= 180 ? 'C' : null;
        const target = throwTarget ?? cTarget;
        if (target) {
          this.commitPass(target);
          return;
        }
      }
    }

    // Feed the carrier command, then advance a full 60 Hz frame. Turbo (C) and
    // dive (A) are edge-detected so they re-fire on each press; steering is held.
    const turboHeld = this.input.keyboard!.addKey(KeyC).isDown;
    live.command({
      steerX: this.steer.x,
      steerY: this.steer.y,
      dive: this.wasPressed(KeyA) && !this.isPassPlay,
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

    // Hazard terrain: evaluate the carrier's absolute field cell; accumulate hits.
    // NOTE: hazards are laid out in absolute field-of-play coords (x∈[0,100]),
    // so the carrier's LOS-relative x must be offset by the line of scrimmage.
    this.hazardManager.tick(1 / 60);
    const carrier = live.snapshot().actors.find((a) => a.id === live.carrier.id);
    if (carrier) {
      const influence = this.hazardManager.evaluate(
        carrier.x + this.session.los,
        carrier.y,
        { team: carrier.team, side: carrier.side, slot: carrier.slot as Slot },
        this.wasPressed(KeyA) && !this.isPassPlay,
        1 / 60,
      );
      for (const hit of influence.hits) {
        this.pendingHazardHits.push(hit);
        // Surface the first hazard hit as a floating damage popup at the victim.
        if (this.hazardArmedForDemo) {
          const f = projectActor(carrier.x, carrier.y, this.session.los);
          const s = projectToScreen(f.x, f.y);
          this.damagePopups.push({
            x: s.x,
            y: s.y - 20,
            text: `-${hit.amount}`,
            color: toPhaserColor('PUMPKIN_ORANGE'),
            ttl: 1.2,
          });
          this.hazardArmedForDemo = false;
        }
      }
    }

    if (live.snapshot().outcome.kind === 'WHISTLE') {
      this.liveResult = live.result();
      this.commitOutcome();
    }
  }

  /** Advance the airborne ball each frame; resolve on landing. */
  private advanceBallFlight(): void {
    const b = this.ballFlight;
    if (!b) return;
    b.t += 1 / 60;
    if (b.t >= b.dur) {
      this.ballFlight = null;
      b.onLand();
    }
  }

  /**
   * Launch a pass throw to receiver A/B/C. The ball flies a closed-form arc
   * (lob or bullet by hold length) and only resolves catch vs interception on
   * landing, giving the shadow/z flight its on-field moment.
   */
  private commitPass(target: 'A' | 'B' | 'C'): void {
    const live = this.live;
    if (!live) return;
    const qb = live.snapshot().actors.find((a) => a.id === live.carrier.id);
    const receiver = this.receiverFor(target);
    if (!qb || !receiver) {
      console.warn(
        'commitPass: missing qb or receiver',
        !!qb,
        !!receiver,
        'carrier',
        live.carrier.id,
        'receiver',
        target,
      );
      return;
    }

    const style = styleForHold(this.passHoldMs);
    const dist = Math.hypot(receiver.x - qb.x, receiver.y - qb.y);
    const speed = style === 'BULLET' ? 22 : 13;
    // Keep the animation readable regardless of distance (min ~0.45s).
    const dur = Math.max(0.45, dist / speed);
    this.windowsOpen = false;
    this.ballFlight = {
      fromX: qb.x,
      fromY: qb.y,
      toX: receiver.x,
      toY: receiver.y,
      t: 0,
      dur,
      style,
      onLand: () => this.resolvePassLanding(target),
    };
  }

  private receiverFor(target: 'A' | 'B' | 'C'): LiveActorState | undefined {
    const live = this.live;
    if (!live) return undefined;
    const slotFor = { A: 'WR/TE', B: 'RB2/WR', C: 'RB1' } as const;
    const receiverId = `${this.session.possession}-${slotFor[target]}`;
    return live.snapshot().actors.find((a) => a.id === receiverId);
  }

  private resolvePassLanding(target: 'A' | 'B' | 'C'): void {
    const live = this.live;
    if (!live) return;
    const qb = live.snapshot().actors.find((a) => a.id === live.carrier.id);
    const receiver = this.receiverFor(target);
    const defs = live.snapshot().actors.filter((a) => a.side === 'DEFENSE');
    if (!qb || !receiver) return this.endDownFromPass();

    const snap = resolvePassAttempt(
      {
        fromX: qb.x,
        fromY: qb.y,
        toX: receiver.x,
        toY: receiver.y,
        holdMs: this.passHoldMs,
        defenders: defs.map((d) => ({ id: d.id, x: d.x, y: d.y })),
      },
      target,
    );
    // Fold any accumulated hazard hits into the same snap.
    if (this.pendingHazardHits.length > 0) snap.hazards = [...this.pendingHazardHits];
    const res = this.session.snap(snap);
    this.showBanner(res.banner);
    this.collectDamageAndCasualties();
    void qb;
  }

  private endDownFromPass(): void {
    this.showBanner('INCOMPLETE');
    this.collectDamageAndCasualties();
  }

  /** Show the play-over banner and enter the BANNER presentation state. */
  private showBanner(text: string): void {
    this.bannerText = text;
    this.bannerTimer = 2.2;
    this.mode = 'BANNER';
  }

  /** Read the just-committed snap's damage/casualties into floating popups. */
  private collectDamageAndCasualties(): void {
    const r = this.session.lastResult;
    if (!r) return;
    for (const d of r.damage) {
      const actor = this.live?.actors.find((a) => a.slot === d.slot && a.team === d.team);
      if (!actor) continue;
      const f = projectActor(actor.x, actor.y, this.session.los);
      const s = projectToScreen(f.x, f.y);
      this.damagePopups.push({
        x: s.x,
        y: s.y - 22,
        text: `-${d.dealt}`,
        color: toPhaserColor('VAMPIRE_CRIMSON'),
        ttl: 1.4,
      });
    }
    for (const c of r.casualties) {
      const actor = this.live?.actors.find((a) => a.slot === c.slot && a.team === c.team);
      if (!actor) continue;
      const f = projectActor(actor.x, actor.y, this.session.los);
      const s = projectToScreen(f.x, f.y);
      this.casualties.push({ id: c.playerId, x: s.x, y: s.y, ttl: 2.0 });
    }
    if (r.fumble) {
      const carrier = this.live?.carrier;
      if (carrier) {
        const f = projectActor(carrier.x, carrier.y, this.session.los);
        const s = projectToScreen(f.x, f.y);
        this.looseBall = { x: s.x, y: s.y, ttl: 2.0 };
      }
    }
  }

  /** Commit the live-play result into the session and show the play-over banner. */
  private commitOutcome(): void {
    const r = this.liveResult!;
    // The live carrier's final downfield position IS the gain from scrimmage;
    // keep it fractional so GameSession classifies TDs/safeties exactly. Pass the
    // out-of-bounds whistle through so the session stops the clock and skips
    // tackle damage / contact fumbles on an untouched sideline exit.
    const yards = r.finalX;
    const snap: {
      force: { yards: number; outOfBounds?: boolean; tackleDamage?: number; fumble?: boolean };
      hazards?: HazardHit[];
    } = {
      force: { yards, outOfBounds: r.outOfBounds },
    };
    // Tackle damage: the tackler's rating naively scales a base hit.
    if (r.tackler) snap.force.tackleDamage = 6 + Math.floor(8 * 0.5);
    if (this.pendingHazardHits.length > 0) snap.hazards = [...this.pendingHazardHits];
    const res = this.session.snap(snap as Parameters<GameSession['snap']>[0]);
    this.showBanner(res.banner);
    this.collectDamageAndCasualties();
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

  /** Render the seeded arena hazards (tombstones, graves, mines, geysers…). */
  private drawHazards(g: DrawSurface): void {
    // Hazard coords are absolute field-of-play (x∈[0,100], y lat. ±26.66); the
    // 10-yard end zone offset maps them into projection space.
    for (const h of this.hazardManager.snapshot()) {
      if (!h.armed) continue;
      const s = projectToScreen(10 + h.x, 26.5 + h.y);
      switch (h.kind) {
        case 'TOMBSTONE':
          g.fillStyle(toPhaserColor('TOMBSTONE_GRAY'), 1);
          g.fillRect(s.x - 5 * s.scale, s.y - 9 * s.scale, 10 * s.scale, 12 * s.scale);
          g.lineStyle(1, toPhaserColor('BONE_WHITE'), 0.9);
          g.lineBetween(s.x - 5 * s.scale, s.y - 9 * s.scale, s.x - 5 * s.scale, s.y - 2 * s.scale);
          break;
        case 'OPEN_GRAVE':
          g.fillStyle(toPhaserColor('VOID_BLACK'), 1);
          g.fillEllipse(s.x, s.y, 11 * s.scale, 7 * s.scale);
          g.lineStyle(1, toPhaserColor('TOMBSTONE_GRAY'), 0.9);
          g.strokeEllipse(s.x, s.y, 11 * s.scale, 7 * s.scale);
          break;
        case 'MINE':
          g.fillStyle(toPhaserColor('PUMPKIN_ORANGE'), 1);
          g.fillEllipse(s.x, s.y, 6 * s.scale, 6 * s.scale);
          g.fillStyle(toPhaserColor('ECTO_GREEN'), 1);
          g.fillRect(s.x - 2 * s.scale, s.y - 3 * s.scale, 4 * s.scale, 2 * s.scale);
          break;
        case 'LAVA_GEYSER':
          g.fillStyle(toPhaserColor('VAMPIRE_CRIMSON'), h.telegraphSeconds > 0 ? 0.4 : 0.9);
          g.fillEllipse(s.x, s.y, 8 * s.scale, 8 * s.scale);
          break;
        case 'BOG':
        case 'SLUDGE':
          g.fillStyle(
            h.kind === 'BOG' ? toPhaserColor('ECTO_GREEN') : toPhaserColor('IRON_BEZEL'),
            0.4,
          );
          g.fillEllipse(s.x, s.y, 12 * s.scale, 9 * s.scale);
          break;
      }
    }
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

    // Passing windows float over eligible receivers while open (pass play).
    if (this.isPassPlay && this.windowsOpen && !this.ballFlight) this.drawPassWindows();
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

  // -------------------------------------------------------- overlays (frame)

  /** Cyan [A][B][C] badges over receivers + lead reticle on the turf. */
  private drawPassWindows(): void {
    const live = this.live;
    if (!live) return;
    const keys = ['A', 'B', 'C'] as const;
    const slotFor = { A: 'WR/TE', B: 'RB2/WR', C: 'RB1' } as const;
    for (const key of keys) {
      const id = `${this.session.possession}-${slotFor[key]}`;
      const actor = live.actors.find((a) => a.id === id);
      if (!actor) continue;
      const f = projectActor(actor.x, actor.y, this.session.los);
      const s = projectToScreen(f.x, f.y);

      // Turf lead reticle: a dashed-ish cyan diamond ahead of the receiver.
      const g = this.indicatorGfx;
      g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
      const rx = 7 * s.scale;
      g.lineBetween(s.x - rx, s.y, s.x, s.y - rx);
      g.lineBetween(s.x, s.y - rx, s.x + rx, s.y);
      g.lineBetween(s.x + rx, s.y, s.x, s.y + rx);
      g.lineBetween(s.x, s.y + rx, s.x - rx, s.y);

      // Badge label floats ~20px above the receiver's head.
      const badge = this.add
        .text(s.x, s.y - 26 * s.scale, `[${key}]`, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '8px',
          color: P.SPECTRAL_CYAN,
          backgroundColor: 'rgba(11,7,17,0.7)',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(200);
      this.actorsLayer.add(badge);
    }
  }

  /** Draw the airborne ball with its ground shadow, plus popups/death/loose ball. */
  private drawOverlays(dt: number): void {
    const g = this.indicatorGfx;

    // Ball in flight: ellipse shadow on the turf + ball offset up by z.
    if (this.ballFlight) {
      const b = this.ballFlight;
      const tt = Math.max(0, Math.min(1, b.t / b.dur));
      const px = b.fromX + (b.toX - b.fromX) * tt;
      const py = b.fromY + (b.toY - b.fromY) * tt;
      // Closed-form apex (parabola) matches Ballistics.sampleFlight.
      const apex = b.style === 'BULLET' ? 1.0 : 1.8;
      const z = apex * 4 * tt * (1 - tt);
      const f = projectActor(px, py, this.session.los);
      const s = projectToScreen(f.x, f.y, z);
      g.fillStyle(0x000000, 0.35);
      g.fillEllipse(s.x, s.y + z, 7 * s.scale, 4 * s.scale);
      g.fillStyle(toPhaserColor('PUMPKIN_ORANGE'), 1);
      g.fillEllipse(s.x, s.y, 4 * s.scale, 4 * s.scale);
    }

    // Damage numbers, rising and fading (x/y are cached screen coords).
    for (const p of this.damagePopups) {
      const rise = 20 * (1 - p.ttl / 1.4);
      const a = Math.max(0, p.ttl / 1.4);
      const t = this.add
        .text(p.x, p.y - rise, p.text, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '9px',
          color: `#${p.color.toString(16).padStart(6, '0')}`,
        })
        .setOrigin(0.5, 0.5)
        .setAlpha(a)
        .setDepth(300);
      this.actorsLayer.add(t);
      p.ttl -= dt;
    }
    this.damagePopups = this.damagePopups.filter((p) => p.ttl > 0);

    // Casualties: the victim shatters into a red/bone bloom then vanishes.
    for (const c of this.casualties) {
      const a = Math.max(0, c.ttl / 2.0);
      g.fillStyle(toPhaserColor('VAMPIRE_CRIMSON'), a);
      g.fillEllipse(c.x, c.y, 18 * (1 - c.ttl / 2.0), 18 * (1 - c.ttl / 2.0));
      g.fillStyle(toPhaserColor('BONE_WHITE'), a);
      g.fillEllipse(c.x, c.y, 8, 8);
      c.ttl -= dt;
    }
    this.casualties = this.casualties.filter((c) => c.ttl > 0);

    // Loose ball: a bouncing amber orb at the recovery spot.
    if (this.looseBall) {
      const lb = this.looseBall;
      const bounce = Math.abs(Math.sin(lb.ttl * 8)) * 6;
      g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
      g.fillEllipse(lb.x, lb.y - bounce, 5, 5);
      lb.ttl -= dt;
      if (lb.ttl <= 0) this.looseBall = null;
    }
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
        prompt = `Call the play — [A] ${PLAY_CATALOG[0]!.label} · [B] ${PLAY_CATALOG[1]!.label} · [C] ${PLAY_CATALOG[2]!.label}`;
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
    const isPassPlay = () => this.isPassPlay;
    const windowsOpen = () => this.windowsOpen;
    const selectedPlay = () => this.selectedPlayIndex;
    const lastResult = () => this.session.lastResult;
    const hazardManager = () => this.hazardManager;
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
      get isPassPlay() {
        return isPassPlay();
      },
      get windowsOpen() {
        return windowsOpen();
      },
      get playIndex() {
        return selectedPlay();
      },
      get lastDamage() {
        return lastResult()?.damage.length ?? 0;
      },
      get lastCasualties() {
        return lastResult()?.casualties.length ?? 0;
      },
      get hazards() {
        return hazardManager().snapshot();
      },
      get actors() {
        return (
          live()?.actors.map((a) => ({ id: a.id, side: a.side, slot: a.slot, x: a.x, y: a.y })) ??
          []
        );
      },
      pick: (i: number) => {
        this.selectedPlayIndex = Math.max(0, Math.min(2, Number(i) || 0));
        this.confirmPlay(this.selectedPlayIndex);
      },
      snap: () => {
        if (this.mode === 'PRE_SNAP') this.mode = 'LIVE';
      },
      openWindows: () => {
        if (this.mode === 'LIVE' && this.isPassPlay) this.windowsOpen = true;
      },
      throwTo: (t: 'A' | 'B' | 'C') => {
        if (this.mode === 'LIVE' && this.isPassPlay && this.windowsOpen && !this.ballFlight) {
          this.commitPass(t);
        }
      },
      // Test seam: relocate the live carrier to an absolute field-of-play cell so
      // the real hazard→damage/casualty pipeline fires deterministically.
      forceCarrierTo: (x: number, y: number) => {
        const l = this.live;
        if (!l) return;
        const c = l.carrier;
        c.x = Number(x) - this.session.los;
        c.y = Number(y);
      },
    };
  }
}

const KeyA = Phaser.Input.Keyboard.KeyCodes.A;
const KeyB = Phaser.Input.Keyboard.KeyCodes.B;
const KeyC = Phaser.Input.Keyboard.KeyCodes.C;
