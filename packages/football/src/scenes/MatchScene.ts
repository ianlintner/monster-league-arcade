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
  type FactionId,
  projectToScreen,
  toPhaserColor,
} from '@monster-league/shared-core';
import { InputManager, type InputSnapshot, type ArcadeButton } from '@monster-league/shared-core';
import { GameSession, type Slot } from '../sim/index';
import { buildLivePlayInput, projectActor } from '../field/fieldMapper';
import { drawFieldSprites, drawField, drawHazards, hazardStateKey } from './fieldRenderer';
import type { DrawSurface } from './fieldRenderer';
import { stepCamera, clampFocus, INITIAL_CAMERA } from './cameraRig';
import type { CameraState } from './cameraRig';
import { LivePlay, type LiveActorState, type LivePlayResult } from '../field/LivePlay';
import { HazardManager } from '../field/HazardManager';
import { resolvePassAttempt, resolveScrambleOutcome } from '../field/PlayOrchestrator';
import { styleForHold } from '../field/Ballistics';
import { NastyFieldEffects } from '../field/NastyFieldEffects';
import { resolveKick, meterValue, KICK_METER } from '../field/KickMeter';
import { decideCoachPlay } from '../ai/AICoach';
import type { HazardHit } from '../sim/GameSession';
import {
  bannerKindForText,
  buildBroadcastBanner,
  buildHuddleOverlay,
  downDistanceLabel,
  factionName,
  formatClock,
  losLabel,
  type BannerKind,
} from '../ui/hud';
import {
  FACTION_SHEET,
  REF_SHEET_NECRO,
  REF_SHEET_DEMON,
  SPRITE_CELL,
  SPRITE_COLS,
  resolveActorCell,
  baseAnimation,
  sheetKey,
  type ActorAnimation,
  type ActorPresentationState,
} from './spriteRenderer';

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

type PlayKind = 'RUN' | 'PASS' | 'PUNT' | 'FIELD_GOAL';

/** Three human-selectable plays (A/B/C) — two runs and one pass. */
const PLAY_CATALOG: ReadonlyArray<{ id: string; label: string; kind: PlayKind }> = [
  { id: 'INSIDE_GORE_RUN', label: 'Inside Gore Run', kind: 'RUN' },
  { id: 'COFFIN_SWEEP', label: 'Coffin Sweep', kind: 'RUN' },
  { id: 'QUICK_SLANTS', label: 'Quick Slants (Pass)', kind: 'PASS' },
];
/**
 * On 4th down the play call swaps to special teams: punt, field goal, or a
 * desperation run ("go for it"). This is what makes the KickMeter reachable —
 * the punter/kicker face the C-button timing meter instead of a live play.
 */
const FOURTH_DOWN_CATALOG: ReadonlyArray<{ id: string; label: string; kind: PlayKind }> = [
  { id: 'PUNT', label: 'Punt', kind: 'PUNT' },
  { id: 'FIELD_GOAL', label: 'Field Goal', kind: 'FIELD_GOAL' },
  { id: 'INSIDE_GORE_RUN', label: 'Go For It (Run)', kind: 'RUN' },
];
const DEFAULT_DEFENSE = 'BONE_CRUSH_BASE';

/** Banner body line for a classified broadcast banner. */
function detailForKind(kind: BannerKind, raw: string): string {
  switch (kind) {
    case 'TOUCHDOWN':
    case 'TURNOVER':
    case 'FUMBLE':
    case 'PENALTY':
    case 'REF_LIQUIDATED':
      return raw;
    case 'NASTY':
      return 'A dirty trick is in play.';
    case 'FORFEIT':
      return raw.replace(/^FORFEIT BY CARNAGE[!]?\s*/, '');
    case 'CASUALTY':
      return raw;
    case 'NEUTRAL':
      return raw;
  }
}

/** The play list in play for the current down (4th down → special teams). */
function catalogForDown(
  down: number,
): ReadonlyArray<{ id: string; label: string; kind: PlayKind }> {
  return down >= 4 ? FOURTH_DOWN_CATALOG : PLAY_CATALOG;
}

/** Actor draw data cached per frame for y-sorting. */
interface RenderActor {
  state: LiveActorState;
  px: number;
  py: number;
  depth: number;
  scale: number;
  isCarrier: boolean;
  isHighlighted: boolean;
}

export class MatchScene extends Phaser.Scene {
  /** Set by `bootFootball(_, { production: true })` from the app entry; gates the
   *  on-canvas instruction/debug text overlay (game state lives in the HUD). */
  static isProduction = false;

  private session!: GameSession;
  private live: LivePlay | null = null;
  private liveResult: LivePlayResult | null = null;

  /** Presentation state machine layered over `GameSession`'s own phases. */
  private mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER' = 'PICK';
  private selectedPlayIndex = 0;
  private bannerText = '';
  private bannerKind: BannerKind = 'NEUTRAL';
  private bannerTimer = 0;
  /** Set once the session reaches GAME_OVER; disables play selection + dismiss. */
  private gameOver = false;
  private highlightDefender = -1;
  private inputPollTimer = 0;
  /** Fingerprint of the last huddle overlay build; skips redundant DOM rebuilds. */
  private huddleFingerprint = '';

  private fieldGfx!: Phaser.GameObjects.Graphics;
  private indicatorGfx!: Phaser.GameObjects.Graphics;
  private groundGfx!: Phaser.GameObjects.Graphics;
  private actorsLayer!: Phaser.GameObjects.Container;
  private readyText!: Phaser.GameObjects.Text;

  /** Home/away sheet id resolved once at create from the session rosters. */
  private homeSheet = '';
  private awaySheet = '';
  /** Per-actor accumulated distance travelled (run frames advance on it). */
  private runDist = new Map<string, number>();
  /** Previous fixed-step position per actor, for distance-based frame advance. */
  private lastPos = new Map<string, { x: number; y: number }>();
  /** Per-actor seconds since its *current* animation began (one-shots/loops). */
  private animClock = new Map<string, number>();
  /** Per-actor current animation (to detect transitions and restart the clock). */
  private animKind = new Map<string, ActorAnimation>();
  /** Scene-side terminal status per actor id (death/knockdown/celebration). */
  private presentation = new Map<string, ActorPresentationState>();
  /** The first-down target field-x captured at snap (survives `snap()` mutating
   *  `session.yardsToGo` during the banner). */
  private firstDownFieldX = 0;
  /** Count of sprite-backed actors (14 + referee) rendered last frame. */
  private spriteBackedActorCount = 0;
  /** Last-drawn carrier's projected screen-space position and depth scale, cached
   *  each frame in `drawActors` so the e2e suite can assert the controlled player's
   *  on-screen sprite is readable (≥48 CSS px tall) without bypassing input. */
  private carrierScreen: { px: number; py: number; scale: number } | null = null;
  /** Hazard terrain drawn on its own layer above the static field so mines that
   *  detonate/clear (and geysers that re-arm) can be redrawn without repainting. */
  private hazardGfx!: Phaser.GameObjects.Graphics;
  /** Cached arm-state signature of the last-drawn hazard snapshot. */
  private hazardStateKey = '';

  /** Hazard terrain for the arena, evaluated every live tick. */
  private hazardManager!: HazardManager;
  /** Nasty audible on-field effects (boost, grenades, gas, hex, shroud). */
  private nastyFields!: NastyFieldEffects;
  /** The latest nasty-field snapshot, refreshed each fixed step; consumed by
   *  movement, input inversion and the overlays (gas cloud, shroud, kill-ref). */
  private nastySnap: ReturnType<NastyFieldEffects['tick']> | null = null;
  /** Elapsed live-down seconds, fed to NastyFieldEffects (hex/gas/shroud timers). */
  private liveElapsed = 0;
  /** Wall-clock seconds since the last render frame (uncapped `update` delta, in
   *  contrast to `LIVE_TUNING.dt`'s fixed sim step); drives animation clocks so a
   *  run cycle advances by real time rather than once per rendered frame. */
  private renderDt = 0;
  /** Ghoul Gas cloud marker (field coords + expiry) for the render dim. */
  private gasCloud: { x: number; y: number; until: number } | null = null;
  /** Hazard hits accumulated over the current live down, committed at whistle. */
  private pendingHazardHits: HazardHit[] = [];
  /** The LOS at snap, captured when the live down begins. Live actor positions are
   *  relative to *this* LOS, but `session.snap()` mutates `session.los` before the
   *  banner frames draw, so all actor/overlay projections must use the unchanged
   *  starting LOS rather than the already-advanced one (else the formation shifts
   *  again by the gained yardage, or across the field after a turnover). */
  private liveLos = 0;
  /** Whether the current live play is a pass (QB drops back, A/B/C = receivers). */
  private isPassPlay = false;
  /** Whether the current play is a punt / field-goal attempt (C = kick meter). */
  private isKickPlay = false;
  /** Hold time on C during a kick play → meter sweep position. */
  private kickHoldMs = 0;
  /** Locked meter value (0..1) once the kicker taps C. */
  private kickLocked: number | null = null;
  /** True once the kick has been resolved and committed via snap. */
  private kickCommitted = false;
  /** Hold time for the current pass (ms) → lob vs bullet throw style. */
  private passHoldMs = 0;
  /** Which receiver button (A/B) is currently held pending a release throw. */
  private heldThrowKey: 'A' | 'B' | null = null;
  /** Whether the receiving windows are open (C toggles them behind the LOS). */
  private windowsOpen = false;
  /** True from the C press that opened the windows until a *fresh* C keydown, so
   *  that very same press never doubles as a throw to receiver C (the player must be
   *  able to choose A or B, or re-press C deliberately, after opening). */
  private windowOpenPressConsumed = false;
  /** Deterministic check used to trigger the first hazard for the e2e path. */
  private hazardArmedForDemo = true;
  /** Accumulates render time toward fixed 60 Hz sim steps (real-time pacing). */
  private simAccumulator = 0;
  /** Last terrain friction/slow from the hazard evaluator, applied to the carrier
   *  movement on the next fixed step (graveyard tombstones impede, swamp slows). */
  private lastFriction = 1;
  private lastSlow = 1;

  /** Presentation camera: frames a ~37-yard window around the ball and zooms out
   *  smoothly for deep passes and kicks. Focus/zoom math + arena clamp live in
   *  `cameraRig`; this holds only the owned `CameraState` between frames. */
  private camera: CameraState = { ...INITIAL_CAMERA };

  /** Ball in flight (pass animation) — null when no ball is airborne. */
  private ballFlight: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    t: number;
    dur: number;
    style: 'LOB' | 'BULLET';
    holdMs: number;
    onLand: () => void;
  } | null = null;

  /** Live-down time (seconds) until which the QB plays the one-shot throw release.
   *  Set on `commitPass`; the release frames (row 9, 0..3) play once while the ball
   *  is airborne, then resolve back to idle/run. This separates *aiming* (a cocked
   *  hold while the windows are open) from *throwing* (the release on launch). */
  private passingUntil = -1;

  /** Floating damage numbers + casualty/death animations, cleared per down. */
  private damagePopups: { x: number; y: number; text: string; color: number; ttl: number }[] = [];
  private casualties: { id: string; x: number; y: number; ttl: number }[] = [];

  private looseBall: { x: number; y: number; ttl: number } | null = null;
  /** Which actor *presentationally* holds the ball right now (actor id, not the
   *  roster id). `LivePlay.carrier` stays the QB through a whole pass play, so the
   *  carried-ball sprite must track possession independently: null while the ball
   *  is in flight or loose, the receiver on a completion, null on a pick/incomplete. */
  private ballHolderId: string | null = null;

  /** Unified Genesis 3-button + 360° input (keyboard/gamepad/touch). All game
   *  input flows through this one source of truth — no raw Phaser key polling. */
  private inputManager = new InputManager();
  /** Latest polled snapshot for the human player (P1, slot 0). */
  private playerInput: InputSnapshot = {
    x: 0,
    y: 0,
    buttons: { A: false, B: false, C: false, START: false },
    pressed: { A: false, B: false, C: false, START: false },
  };
  /** Snapshot as of the previous poll, for hold/release edge detection. */
  private prevInput: InputSnapshot = this.playerInput;

  constructor() {
    super('match');
    // Expose the e2e/dev handle as soon as the scene object exists, not in
    // `create()`: Phaser makes the canvas visible at the *start* of `preload`,
    // so gameplay specs that read `window.__mlf` right after the canvas appears
    // would otherwise race the (slow) atlas/sprite-sheet load. The getters below
    // are lazy and null-guarded, so they read correctly once `create()` populates
    // `session`/`live` and safely report null/'' before then.
    this.exposeDebugHandle();
  }

  // ------------------------------------------------------------- lifecycle

  preload(): void {
    this.load.json('atlas', '/assets/atlas.json');
    // Faction sprite sheets (home + away) and both referee sheets are loaded as
    // *sprite sheets* so Phaser registers a 48×48 texture frame per cell. Drawing
    // a cell as a real frame (not `setCrop` on the whole 288×672 sheet) keeps the
    // origin anchored to the selected cell's bottom-centre, so idle/run/terminal
    // frames stay put at the actor's feet instead of drifting with each frame.
    // Nearest-neighbour scaling comes from `pixelArt: true` (game config).
    const frame = { frameWidth: SPRITE_CELL, frameHeight: SPRITE_CELL };
    for (const sheet of [
      'boneyard_reapers',
      'rotting_deadskins',
      'transylvania_nightstalkers',
      'salem_bayou_ghouls',
    ]) {
      this.load.spritesheet(sheet, `/assets/sprites/${sheet}.png`, frame);
      this.load.spritesheet(`${sheet}-away`, `/assets/sprites/${sheet}-away.png`, frame);
      this.load.image(`crest_${sheet}`, `/assets/sprites/crest_${sheet}.png`);
    }
    this.load.spritesheet(REF_SHEET_NECRO, `/assets/sprites/${REF_SHEET_NECRO}.png`, frame);
    this.load.spritesheet(REF_SHEET_DEMON, `/assets/sprites/${REF_SHEET_DEMON}.png`, frame);
    // Arena tiles (home faction's arena): turf + end zone, tiled across the field.
    for (const arena of ['cursed_graveyard', 'brimstone_hellfire_pit', 'ectoplasm_swamp']) {
      this.load.image(`${arena}_turf`, `/assets/arenas/${arena}_turf.png`);
      this.load.image(`${arena}_endzone`, `/assets/arenas/${arena}_endzone.png`);
    }
  }

  create(): void {
    this.mode = 'PICK';
    this.live = null;
    this.liveResult = null;
    this.gameOver = false;

    // All game input routes through the shared InputManager (keyboard + gamepad +
    // touch) with edge-buffered presses. Attach here — not in the constructor —
    // so a single scene controls the window listener and detaches on shutdown.
    this.inputManager.attach(window);
    // Phaser does not call a method named `shutdown()` on the scene class; the
    // lifecycle event is what actually fires when the scene stops. Subscribe here
    // (rather than relying on an undocumented method name) so the window-level
    // listeners are released when the scene shuts down or restarts.
    this.events.once('shutdown', () => this.inputManager.detach());

    // Bootstrap a session to the first huddle: home receives the opening kick.
    this.session = new GameSession({
      seed: 1993,
      homeFaction: 'REAPERS',
      awayFaction: 'DEADSKINS',
    });
    this.session.coinToss('home');
    this.session.kickoff({ touchback: true });

    // Home wears home, away wears away. Resolve sheets once from the rosters.
    this.homeSheet = FACTION_SHEET[this.session.roster.home.faction];
    this.awaySheet = FACTION_SHEET[this.session.roster.away.faction];
    this.runDist.clear();

    // Hazard terrain derived from the home faction's arena; graveyard for now.
    this.hazardManager = new HazardManager('cursed-graveyard', 1993);

    this.fieldGfx = this.add.graphics();
    drawFieldSprites(this);
    drawField(this.fieldGfx as unknown as DrawSurface);
    this.hazardGfx = this.add.graphics();
    drawHazards(this.hazardGfx as unknown as DrawSurface, this.hazardManager);

    // Ground indicators (LOS/first-down lines, selection ring, stamina arc) are a
    // scene-level Graphics *below* the actor container in z-order. They must be
    // added BEFORE `actorsLayer` — a later scene object wins regardless of the
    // depths set on its children — so these lines render UNDER the sprites and
    // never cover one. Airborne ball, kick meter and pass reticles stay on
    // `indicatorGfx`, which is added AFTER the actors and therefore draws above.
    this.groundGfx = this.add.graphics();
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
      .setDepth(100)
      .setScrollFactor(0); // pinned to the viewport so the camera zoom/scroll never drags it off-screen
    // The on-canvas instruction/debug text is a dev convenience; in production
    // builds game state lives in the HUD scorebug (see `updateDom`), so the
    // overlay is hidden entirely.
    if (MatchScene.isProduction) this.readyText.setVisible(false);

    this.refreshUi();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.renderDt = dt;
    this.sampleInput(dt);

    // Advance the play clock (and, while running, the between-play game clock).
    // `GameSession.tickPlayClock` drives both: the 25s play clock counts down in
    // the huddle/pre-snap phases and triggers a Delay of Game at zero, while the
    // game clock runs down here on a running clock between plays. The game clock
    // is advanced by PLAY_SECONDS/STOPPED_PLAY_SECONDS inside `finishPlay`.
    const phase = this.session.phase;
    if (phase === 'HUDDLE_PLAYCALL' || phase === 'PRE_SNAP') {
      const penalty = this.session.tickPlayClock(dt);
      // A play clock that expires in the huddle costs 5 yards (Delay of Game) and
      // auto-picks the currently-selected play so the drive can't stall on an idle
      // huddle. The penalty is applied inside `tickPlayClock`; here we just force
      // the pick so the down proceeds.
      if (penalty?.kind === 'DELAY_OF_GAME') {
        if (this.mode === 'PICK') {
          this.confirmPlay(this.selectedPlayIndex);
        } else if (this.mode === 'PRE_SNAP') {
          // The penalty moved `session.los` back 5 yards, but the formation was
          // built at pick time from the old LOS. Rebuild it so the actors, ball
          // and first-down line sit at the penalised spot instead of the stale one.
          this.prepareLivePlay();
        }
      }
    }

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
    this.redrawHazardsIfDirty();
    this.updateCamera(dt);
    this.refreshUi();
  }

  /** Smoothly follow the ball and frame ~35–40 yards around it, zooming out for
   *  deep passes and kicks so the flight stays in frame. The target is computed in
   *  world (pre-zoom) screen space; the camera is applied as an integer-friendly
   *  zoom + scroll on `cameras.main` so every world object (turf, lines, actors,
   *  overlays) transforms together without a per-projection rewrite. */
  private updateCamera(dt: number): void {
    this.camera = stepCamera(this.camera, {
      dt,
      ballFlight: this.ballFlight,
      carrier: this.live?.carrier ?? null,
      los: this.liveLos,
      isPassPlay: this.isPassPlay,
    });

    const cam = this.cameras.main;
    cam.setZoom(this.camera.zoom);
    // Clamp the focus to the arena so the view never pans into the VOID_BLACK
    // surround at the end zones / sidelines (see cameraRig.clampFocus).
    const focus = clampFocus(this.camera);
    cam.centerOn(focus.x, focus.y);
  }

  // ------------------------------------------------------------- inputs

  private sampleInput(dt: number): void {
    // Poll at a fixed 60 Hz so edge presses and holds land on the same cadence
    // regardless of render refresh rate. `InputManager.poll` accumulates
    // keydown/touch/gamepad edges between polls, so a fast sub-frame tap is still
    // delivered exactly once (the root of the dropped-tap defect on the raw
    // `JustDown` path, which only saw a key if it was held across two frames).
    this.inputPollTimer -= dt;
    if (this.inputPollTimer > 0) {
      // We are between 60 Hz polls: keep the held-button level state for steering
      // and hold-to-throw, but zero the *edge* latches so a press is delivered
      // exactly once. Without this, the stale `pressed` flags would be re-read by
      // every consumer on each render frame — a single C tap would both confirm a
      // play (PICK) and snap it (PRE_SNAP) across two frames, skipping PRE_SNAP.
      this.playerInput = {
        ...this.playerInput,
        pressed: { A: false, B: false, C: false, START: false },
      };
      // Advance `prevInput` too so release/stick edges (releasedBtn /
      // steerLeftEdge / steerRightEdge) are not re-derived from the same stale
      // prev/current pair on every render frame — a release would otherwise fire
      // once per frame until the next real poll.
      this.prevInput = this.playerInput;
      return;
    }
    this.inputPollTimer = 1 / 60;

    this.prevInput = this.playerInput;
    this.playerInput = this.inputManager.poll(0);

    // A *fresh* C press re-arms the pass-window consume (and throw-to-C) latch: the
    // opening press consumed itself, and a genuinely new C keydown must be allowed
    // to throw to receiver C. Edge-detect here so the latch holds exactly one press.
    if (this.playerInput.pressed.C) this.windowOpenPressConsumed = false;
  }

  /** Button held this poll (level, for steering/turbo/hold-to-throw). */
  private buttonHeld(b: ArcadeButton): boolean {
    return this.playerInput.buttons[b];
  }
  /** Button freshly pressed this poll (edge — a tap, consumed exactly once). */
  private pressedBtn(b: ArcadeButton): boolean {
    return this.playerInput.pressed[b];
  }
  /** Button released this poll (level true → false, for hold-to-throw/kick lock). */
  private releasedBtn(b: ArcadeButton): boolean {
    return this.prevInput.buttons[b] && !this.playerInput.buttons[b];
  }

  private confirmPlay(index: number): void {
    this.selectedPlayIndex = index;
    this.session.selectPlays(catalogForDown(this.session.down)[index]!.id, DEFAULT_DEFENSE);
    this.mode = 'PRE_SNAP';
    // Build the live play at pick time so the PRE_SNAP formation renders its
    // 14 actors in idle stances (both teams in home/away colours, ball at the
    // line of scrimmage). The down's sim clock does not start until `snap()`.
    this.prepareLivePlay();
  }

  private updatePick(): void {
    if (this.gameOver) return;
    // The pick list depends on the down: 4th down offers special teams (punt/FG).
    const catalog = catalogForDown(this.session.down);
    if (this.pressedBtn('A')) this.selectedPlayIndex = 0;
    else if (this.pressedBtn('B')) this.selectedPlayIndex = 1;
    else if (this.pressedBtn('C')) this.selectedPlayIndex = 2;
    else if (this.steerLeftEdge())
      this.selectedPlayIndex = (this.selectedPlayIndex + catalog.length - 1) % catalog.length;
    else if (this.steerRightEdge())
      this.selectedPlayIndex = (this.selectedPlayIndex + 1) % catalog.length;
    else return;
    this.confirmPlay(this.selectedPlayIndex);
  }

  /** D-pad/stick left as a fresh edge (analog level crossing -0.5 from above). */
  private steerLeftEdge(): boolean {
    return this.prevInput.x > -0.5 && this.playerInput.x <= -0.5;
  }
  /** D-pad/stick right as a fresh edge. */
  private steerRightEdge(): boolean {
    return this.prevInput.x < 0.5 && this.playerInput.x >= 0.5;
  }

  private updatePreSnap(): void {
    if (this.pressedBtn('C')) this.beginLivePlay();
  }

  /** Build the 14-actor `LivePlay` and reset per-down presentation state. Safe to
   *  call again at snap time (idempotent: everything below is recomputed from the
   *  same unchanged session state, and the sim clock has not advanced yet). */
  private prepareLivePlay(): void {
    const play = catalogForDown(this.session.down)[this.selectedPlayIndex]!;
    this.isPassPlay = play.kind === 'PASS';
    this.isKickPlay = play.kind === 'PUNT' || play.kind === 'FIELD_GOAL';
    // Capture the starting LOS for this down; every projection below uses it even
    // after `snap()` advances `session.los`, and the PRE_SNAP formation needs it.
    this.liveLos = this.session.los;
    // Prime the nasty audible field effects for this play (boost, grenades, gas,
    // hex, shroud); the sim already computed `session.effects` from valid actives.
    this.nastyFields = new NastyFieldEffects();
    this.nastyFields.begin(this.session.effects);
    const input = buildLivePlayInput(this.session, play.id, DEFAULT_DEFENSE, 0x9e3779b9);
    this.live = new LivePlay(input);
    // Initialize ball presentation ownership at formation time too: the opening
    // PRE_SNAP formation is rendered before `beginLivePlay()` runs, and anchoring
    // the ball to the live carrier here means a prior down's holder can't leak
    // into (or vanish from) this formation.
    this.ballHolderId = this.live.carrier.id;
    this.liveResult = null;
    this.highlightDefender = -1;
    this.simAccumulator = 0;
    this.runDist.clear();
    this.lastPos.clear();
    // Reset per-down presentation state *before* the formation's first render so
    // a pass play that ended in a tackle (windows still open) never leaks its
    // throwing-QB / receiver-badge state into the next formation's idle actors.
    this.animClock.clear();
    this.animKind.clear();
    this.presentation.clear();
    this.windowsOpen = false;
    this.windowOpenPressConsumed = false;
    this.ballFlight = null;
    this.damagePopups = [];
    this.casualties = [];
    this.looseBall = null;
    // Reset the Ghoul Gas cloud with the other per-down presentation state: if the
    // previous down ended while gas was active, `liveElapsed` stays frozen through
    // the banner/PRE_SNAP, so a stale cloud would otherwise keep drawing over the
    // next formation until the snap (which resets it too).
    this.gasCloud = null;
    // Same for the throw-release window: a prior down's launch must not leave the
    // QB frozen in a wind-up while the next formation renders its idle stance.
    this.passingUntil = -1;
    // Capture the starting first-down target now; `snap()` mutates
    // `session.yardsToGo` when the result commits, which would otherwise drag the
    // amber line during the banner while the actors + LOS stay frozen. The
    // projector adds the 10-yard end-zone offset, so convert here as well.
    this.firstDownFieldX = this.liveLos + this.session.yardsToGo + 10;
  }

  private beginLivePlay(): void {
    // The actor list is already built in `prepareLivePlay()` at pick time; only
    // the transient *runtime* state that accumulates during a live down is reset
    // here, then the sim clock starts.
    this.kickHoldMs = 0;
    this.kickLocked = null;
    this.kickCommitted = false;
    this.passHoldMs = 0;
    this.heldThrowKey = null;
    this.windowsOpen = false;
    this.windowOpenPressConsumed = false;
    this.ballFlight = null;
    this.damagePopups = [];
    this.casualties = [];
    this.looseBall = null;
    // The center/QB holds the ball at the snap; presentation ownership reverts to
    // the live carrier until a pass launches it or a fumble knocks it loose.
    this.ballHolderId = this.live?.carrier.id ?? null;
    this.pendingHazardHits = [];
    this.liveElapsed = 0;
    this.nastySnap = null;
    this.gasCloud = null;
    this.passingUntil = -1;
    // Nasties are *selected* during PRE_SNAP (`session.callNasty`), after the pick
    // already primed the field effects at `prepareLivePlay()`. Reinitialize at snap
    // from the final pre-snap selection so a Dynamite Pitch arms its grenade count
    // and Hex/Shroud arm their timers instead of staying at their pick-time zeroes.
    this.nastyFields.begin(this.session.effects);
    // Entering the live down is part of building it: both the KeyC pre-snap path
    // and the e2e debug handle call `beginLivePlay()` directly, and both must land
    // in LIVE with a populated `this.live` (otherwise `updateLive` early-returns
    // forever and the whistle never fires).
    this.mode = 'LIVE';
  }

  // ------------------------------------------------------------- live loop

  private updateLive(dt: number): void {
    // Ball-in-flight animation runs to completion before further input lands.
    if (this.ballFlight) {
      this.advanceBallFlight(dt);
      return;
    }

    const live = this.live;
    if (!live) return;

    // Kick plays (punt / field goal) run a timing meter instead of a live down:
    // hold C to sweep the value, release C to lock it, then resolve and commit.
    if (this.isKickPlay) {
      this.updateKick(dt);
      return;
    }

    if (this.pressedBtn('B') && !this.isPassPlay) {
      // Defense: cycle which defender is the highlighted "user" pursuer.
      this.highlightDefender = (this.highlightDefender + 1) % 7;
    }

    // Pass plays: C opens the receiving windows (scope: behind LOS); A/B/C throw
    // to the matching receiver while the windows are open. Hold length sets style.
    if (this.isPassPlay) {
      const cHeld = this.buttonHeld('C');

      // The C press that opens the windows must NOT also throw to receiver C in
      // the same press: it is consumed once. Only a *fresh* subsequent C press (its
      // own keydown) — while windows are already open — is treated as a throw to C.
      // When windows are still closed, the same C press only opens them.
      if (this.pressedBtn('C') && !this.windowsOpen && !this.windowOpenPressConsumed) {
        // Windows may only open while the QB is behind (or on) the line of
        // scrimmage. Once the QB scrambles downfield the option is unavailable.
        const qb = live.snapshot().actors.find((a) => a.id === live.carrier.id);
        if (qb && qb.x <= 0) {
          this.windowsOpen = true;
          this.passHoldMs = 0;
          // Consume this C press so it cannot double as a throw, until a genuinely
          // new C keydown arrives (cleared on the next input edge).
          this.windowOpenPressConsumed = true;
        }
      }
      // A fresh C keydown re-arms the throw-to-C path (and window re-open); cleared
      // per-input-edge so holding C through several render frames never re-opens the
      // windows and never re-fires the opening consume.

      if (this.windowsOpen) {
        // A/B throw on *release*, so a held receiver button accumulates hold time
        // and only launches (lob vs bullet by duration) when the player lets go.
        if (this.buttonHeld('A')) {
          if (!this.heldThrowKey) this.heldThrowKey = 'A';
        } else if (this.buttonHeld('B')) {
          if (!this.heldThrowKey) this.heldThrowKey = 'B';
        }
        const aUp = this.releasedBtn('A');
        const bUp = this.releasedBtn('B');
        const released =
          this.heldThrowKey === 'A' && aUp ? 'A' : this.heldThrowKey === 'B' && bUp ? 'B' : null;
        // C throws to receiver C, but only on a deliberate press AFTER the window-
        // opening press (so opening the windows never instantly picks C).
        const cUp = this.releasedBtn('C');
        const cTarget = !this.windowOpenPressConsumed && cUp ? 'C' : null;

        // Accumulate hold time by *elapsed* time (seconds → ms), not a fixed 16 ms
        // per rendered frame: otherwise the same physical hold produces a lob or a
        // bullet depending on refresh rate and shorter air time on faster displays.
        if (this.heldThrowKey || (cHeld && !this.windowOpenPressConsumed)) {
          this.passHoldMs += dt * 1000;
        } else if (!released && !cTarget) {
          this.passHoldMs = 0;
        }

        const target = released ?? cTarget;
        if (target) {
          this.commitPass(target);
          this.heldThrowKey = null;
          return;
        }
      } else {
        this.passHoldMs = 0;
        this.heldThrowKey = null;
      }
    }

    // Feed the carrier command *inside* the fixed-step loop below, because the
    // nasty-field snapshot (hex inversion, Bat-Wing speed, grenade triggers) is
    // computed per step and must color the very same command that step consumes.
    const turboHeld = this.buttonHeld('C');
    const pressedBThisTick = this.pressedBtn('B') && this.isPassPlay === false;

    // Advance a fixed-timestep 60 Hz simulation: accumulate the elapsed render
    // time and consume exactly the fixed steps due, so the field runs at real time
    // on any refresh rate (with 4 as a catch-up cap under a janky RAF). Hazards are
    // evaluated on *these same* steps, not once per render frame.
    this.simAccumulator += dt;
    const fixedDt = 1 / 60;
    let steps = 0;
    while (this.simAccumulator >= fixedDt && steps < 4) {
      this.simAccumulator -= fixedDt;
      this.liveElapsed += fixedDt;
      steps++;

      // Advance the nasty-field clocks once per fixed step (hex/gas/shroud timers,
      // grenade/gas triggers) and capture the snapshot that movement, input and
      // overlays all read this step.
      const carrier0 = live.snapshot().actors.find((a) => a.id === live.carrier.id);
      this.nastySnap = this.nastyFields.tick({
        effects: this.session.effects,
        t: this.liveElapsed,
        pressedB: pressedBThisTick,
        pressedC: this.pressedBtn('C'),
        carrierTeam: carrier0?.team ?? this.session.possession,
        carrierSlot: carrier0?.slot ?? 'RB1',
      });

      // Hex of Confusion inverts the carrier's steering while its timer is live.
      let sx = this.playerInput.x;
      let sy = this.playerInput.y;
      if (this.nastySnap.hexRemaining > 0) {
        sx = -sx;
        sy = -sy;
      }

      live.command({
        steerX: sx,
        steerY: sy,
        dive: this.pressedBtn('A') && !this.isPassPlay,
        turbo: turboHeld,
        frictionMult: this.lastFriction,
        slowMult: this.lastSlow,
        // Bat-Wing Jet Boost (+65% carrier speed) threads through here.
        speedMult: this.nastySnap.carrierSpeedMult,
      });

      const outcome = live.advance();

      // Apply nasty on-field effects that mutate the play (grenade/gas damage is
      // still committed via snap at whistle; here we surface the visible trigger).
      this.applyNastyStep(fixedDt);

      // Hazard terrain: evaluate on each fixed step so hazard effects advance at the
      // same rate as ball flight and movement.
      this.hazardManager.tick(fixedDt);
      const carrier = live.snapshot().actors.find((a) => a.id === live.carrier.id);
      if (carrier) {
        const influence = this.hazardManager.evaluate(
          carrier.x + this.liveLos,
          carrier.y,
          { team: carrier.team, side: carrier.side, slot: carrier.slot as Slot },
          carrier.diving,
          fixedDt,
        );
        // Thread the terrain modifiers into the carrier's NEXT commanded step (bog
        // friction, sludge slow) so graveyard tombstones and swamp patches actually
        // impede the carrier rather than being inert.
        this.lastFriction = influence.frictionMult;
        this.lastSlow = influence.slowMult;
        for (const hit of influence.hits) {
          this.pendingHazardHits.push(hit);
          // Surface the first hazard hit as a floating damage popup at the victim.
          if (this.hazardArmedForDemo) {
            const f = projectActor(carrier.x, carrier.y, this.liveLos);
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
      if (outcome.kind === 'WHISTLE') break;

      // Accumulate actual distance travelled this fixed step (before the next
      // command overwrites positions) so run-frame playback advances with real
      // ground covered — not velocity × rendered frame, which runs fast at high
      // refresh and keeps counting during hit-stop/ball-flight/banner freezes.
      for (const a of live.snapshot().actors) {
        const prev = this.lastPos.get(a.id);
        if (prev) {
          const d = this.runDist.get(a.id) ?? 0;
          this.runDist.set(a.id, d + Math.hypot(a.x - prev.x, a.y - prev.y));
        }
        this.lastPos.set(a.id, { x: a.x, y: a.y });
      }
    }

    if (live.snapshot().outcome.kind === 'WHISTLE') {
      this.liveResult = live.result();
      this.commitOutcome();
    }
  }

  /**
   * Punt / field-goal timing meter (button C). Holding C sweeps the meter value;
   * releasing C locks it. On lock the kick resolves through `session.snap` with an
   * explicit `puntYards` / `fieldGoalGood`, so the KickMeter actually drives the
   * special-teams outcome instead of being dead code.
   */
  private updateKick(dt: number): void {
    const play = catalogForDown(this.session.down)[this.selectedPlayIndex]!;
    const cHeld = this.buttonHeld('C');

    if (this.kickLocked === null) {
      if (cHeld) {
        this.kickHoldMs += dt * 1000; // ms like the pass hold timer
      } else if (this.kickHoldMs > 0) {
        // Released after a hold → lock the current sweep position.
        this.kickLocked = meterValue(this.kickHoldMs / 1000);
      }
      return;
    }

    // Resolved: commit once, then the banner path advances the down as usual.
    if (this.kickCommitted) return;
    this.kickCommitted = true;

    const distanceToGoal = 100 - this.session.los;
    const outcome = resolveKick(this.kickLocked, distanceToGoal, play.kind === 'PUNT' ? 60 : 0);
    const force: { puntYards?: number; fieldGoalGood?: boolean } = {};
    if (play.kind === 'PUNT') force.puntYards = outcome.puntYards;
    else force.fieldGoalGood = outcome.fieldGoalGood;

    const res = this.session.snap({ force } as Parameters<GameSession['snap']>[0]);
    // A punt / field goal resolves instantly: the ball is away the moment the
    // kick is locked. Clear presentation ownership so the carrier doesn't keep a
    // carried-football sprite at its hands through the special-teams result
    // banner (there is no in-flight overlay on kicks to take over from it).
    this.ballHolderId = null;
    this.showBanner(res.banner);
    this.collectDamageAndCasualties();
  }

  /** Advance the airborne ball by elapsed real time; resolve on landing. */
  private advanceBallFlight(dt: number): void {
    const b = this.ballFlight;
    if (!b) return;
    // Advance by the elapsed frame time, not a fixed 1/60 s per rendered frame:
    // otherwise the ball lands sooner on faster displays (frame-rate coupling).
    b.t += dt;
    // The throw-release window (`passingUntil`) is measured on `liveElapsed`, but
    // `updateLive` returns early while the ball is in flight, so that clock would
    // otherwise freeze at launch time and a lob would hold the QB in the final
    // throw pose until landing (lobs routinely outlast the 0.6 s release window).
    // Advance it here too so the QB's release pose decays back to idle/run a fixed
    // 0.6 s after the launch, independent of how long the ball stays airborne.
    this.liveElapsed += dt;
    if (b.t >= b.dur) {
      this.ballFlight = null;
      b.onLand();
    }
  }

  /**
   * Surface the nasty-field effects produced this fixed step. Grenades and gas
   * damage are committed by the sim at the whistle (it resolves DYNAMITE_PITCH /
   * GHOUL_GAS weapon damage from the active play), so here we only render the
   * *visible* trigger — a flicker marker at the carrier and, for a grenade, a
   * popup at a nearby defender. Shroud (spectral alpha) and Kill Ref (hunt state)
   * are read live in the render pass from `this.nastySnap` + the session ref.
   */
  private applyNastyStep(_dt: number): void {
    const snap = this.nastySnap;
    if (!snap || !this.live) return;

    const carrier = this.live.snapshot().actors.find((a) => a.id === this.live!.carrier.id);
    if (!carrier) return;
    const c = projectActor(carrier.x, carrier.y, this.liveLos);

    // A grenade throw — a quick spark marker at the carrier and a damage popup on
    // the nearest defender (the sim records the actual damage at snap).
    if (snap.grenadesThrown > 0) {
      const defenders = this.live.snapshot().actors.filter((a) => a.side === 'DEFENSE');
      const target =
        defenders.sort(
          (a, b) =>
            (a.x - carrier.x) ** 2 +
            (a.y - carrier.y) ** 2 -
            ((b.x - carrier.x) ** 2 + (b.y - carrier.y) ** 2),
        )[0] ?? carrier;
      const tp = projectActor(target.x, target.y, this.liveLos);
      const ts = projectToScreen(tp.x, tp.y);
      this.damagePopups.push({
        x: ts.x,
        y: ts.y - 20,
        text: 'BOOM!',
        color: toPhaserColor('PUMPKIN_ORANGE'),
        ttl: 0.9,
      });
    }

    // Ghoul Gas drop — mark the cloud so the render pass dims defenders near it.
    if (snap.gasDropped) {
      this.gasCloud = { x: c.x, y: c.y, until: this.liveElapsed + 3 };
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
    // A forward pass is only legal while the QB is behind (or on) the LOS. Guard
    // here so the debug throw path cannot bypass the windows check and throw
    // downfield after a scramble.
    if (qb.x > 0) {
      this.windowsOpen = false;
      return;
    }

    const style = styleForHold(this.passHoldMs);
    const holdMs = this.passHoldMs;
    const dist = Math.hypot(receiver.x - qb.x, receiver.y - qb.y);
    const speed = style === 'BULLET' ? 22 : 13;
    // Keep the animation readable regardless of distance (min ~0.45s).
    const dur = Math.max(0.45, dist / speed);
    this.windowsOpen = false;
    // The ball leaves the QB's hands the moment the throw launches; carried-ball
    // rendering switches to the in-flight overlay (drawOverlays) for the duration.
    this.ballHolderId = null;
    // Arm the QB's one-shot throw release: play the row-9 release frames once while
    // the ball is airborne (a ~0.5 s window covers even the fastest bullet), instead
    // of snapping straight to idle the instant `windowsOpen` drops.
    this.passingUntil = this.liveElapsed + 0.6;
    this.ballFlight = {
      fromX: qb.x,
      fromY: qb.y,
      toX: receiver.x,
      toY: receiver.y,
      t: 0,
      dur,
      style,
      holdMs,
      onLand: () => this.resolvePassLanding(target, holdMs),
    };
  }

  private receiverFor(target: 'A' | 'B' | 'C'): LiveActorState | undefined {
    const live = this.live;
    if (!live) return undefined;
    const slotFor = { A: 'WR/TE', B: 'RB2/WR', C: 'RB1' } as const;
    const receiverId = `${this.session.possession}-${slotFor[target]}`;
    return live.snapshot().actors.find((a) => a.id === receiverId);
  }

  private resolvePassLanding(target: 'A' | 'B' | 'C', holdMs: number): void {
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
        holdMs,
        defenders: defs.map((d) => ({ id: d.id, x: d.x, y: d.y })),
      },
      target,
    );
    // Fold any accumulated hazard hits into the same snap.
    if (this.pendingHazardHits.length > 0) snap.hazards = [...this.pendingHazardHits];
    const res = this.session.snap(snap);
    this.showBanner(res.banner);
    // The receiver catches and holds the ball only on a completion; on a pick or
    // deflection/incompletion the down ends without any field actor carrying it
    // (the next down's snap re-initializes ownership). `live.carrier` still names
    // the passer, so ownership must NOT fall back to the QB here.
    this.ballHolderId = snap.force?.complete ? receiver.id : null;
    this.collectDamageAndCasualties();
    // A completed catch ends through `snap` (not `commitOutcome`), so the receiver's
    // presentation state never runs through the play-over roll. Mirror it here from
    // the committed result: a touchdown completion celebrates, an ordinary completion
    // is tackled (GameSession already applied the receiver's tackle damage above) and
    // drops into a knockdown. Death (a lethal hazard on the catch) still wins because
    // `collectDamageAndCasualties` set `dead` first and `baseAnimation` prefers it.
    if (snap.force?.complete) {
      const res = this.session.lastResult;
      const pres = this.presentation.get(receiver.id) ?? {};
      if (!pres.dead) pres.celebrating = res?.touchdown === true;
      if (!pres.dead && !pres.celebrating) pres.downed = true;
      this.presentation.set(receiver.id, pres);
    }
    void qb;
  }

  private endDownFromPass(): void {
    this.showBanner('INCOMPLETE');
    this.collectDamageAndCasualties();
  }

  /** Show the play-over banner and enter the BANNER presentation state. */
  private showBanner(text: string): void {
    this.bannerText = text;
    this.bannerKind = bannerKindForText(text);
    this.bannerTimer = 2.2;
    this.mode = 'BANNER';
    this.renderKineticBanner(text);
  }

  /** Rebuild the `#banner` node as an animated GSN 66.6 broadcast banner. */
  private renderKineticBanner(text: string): void {
    const host = document.getElementById('banner');
    if (!host) return;
    host.replaceChildren(
      buildBroadcastBanner(this.bannerKind, detailForKind(this.bannerKind, text)),
    );
  }

  /** Read the just-committed snap's damage/casualties into floating popups. */
  private collectDamageAndCasualties(): void {
    const r = this.session.lastResult;
    if (!r) return;
    for (const d of r.damage) {
      const actor = this.live?.actors.find((a) => a.slot === d.slot && a.team === d.team);
      if (!actor) continue;
      const f = projectActor(actor.x, actor.y, this.liveLos);
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
      const f = projectActor(actor.x, actor.y, this.liveLos);
      const s = projectToScreen(f.x, f.y);
      this.casualties.push({ id: actor.id, x: s.x, y: s.y, ttl: 2.0 });
      // Presentation: a casualty kills the victim — the sprite plays its death
      // pose while the red/bone bloom settles (Colour commentary handles the rest).
      // Key the presentation state by the resolved *actor id* (a slot id like
      // home-RB1), not the raw roster id (`c.playerId` is home-1), so drawActor's
      // lookup by actor id actually selects the victim's casualty_death animation.
      const pres = this.presentation.get(actor.id) ?? {};
      pres.dead = true;
      this.presentation.set(actor.id, pres);
    }
    if (r.fumble) {
      const carrier = this.live?.carrier;
      // A fumble knocks the ball loose: no field actor carries it, so the carried
      // sprite must vanish (the loose-ball overlay takes over in drawOverlays).
      this.ballHolderId = null;
      if (carrier) {
        const f = projectActor(carrier.x, carrier.y, this.liveLos);
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
      force: {
        yards: number;
        outOfBounds?: boolean;
        tackleDamage?: number;
        fumble?: boolean;
        sacked?: boolean;
        qbRun?: boolean;
      };
      hazards?: HazardHit[];
    } = {
      force: { yards, outOfBounds: r.outOfBounds },
    };
    // Tackle damage: the tackler's rating naively scales a base hit.
    if (r.tackler) snap.force.tackleDamage = 6 + Math.floor(8 * 0.5);

    // Pass plays that end at the whistle with no ball in flight are a QB scramble:
    // the QB never threw, so the down must be committed as a sack (tackled behind
    // the LOS), an incomplete (out of bounds behind the LOS, preserving the measured
    // loss so the next snap backs up the actual distance), or a run with the QB as
    // carrier (past the LOS, keeping the positive gain). Delegating to the pure
    // `resolveScrambleOutcome` keeps this scene→session mapping unit-testable.
    if (this.isPassPlay && r.outcome.kind === 'WHISTLE') {
      const scramble = resolveScrambleOutcome({
        finalX: r.finalX,
        outOfBounds: r.outOfBounds,
        outcome: r.outcome,
      });
      if (scramble.sacked) snap.force.sacked = true;
      if (scramble.qbRun) snap.force.qbRun = true;
      snap.force.yards = scramble.yards;
    }

    if (this.pendingHazardHits.length > 0) snap.hazards = [...this.pendingHazardHits];
    const res = this.session.snap(snap as Parameters<GameSession['snap']>[0]);
    this.showBanner(res.banner);
    this.collectDamageAndCasualties();

    // Presentation for the play-over roll: the tackled carrier drops into a
    // knockdown, the scoring carrier celebrates, and the tackler celebrates the
    // stop. These persist only until the next down's formation is prepared.
    const carrierId = this.live?.carrier.id;
    if (carrierId) {
      const pres = this.presentation.get(carrierId) ?? {};
      if (r.touchdown) pres.celebrating = true;
      else if (r.tackler) pres.downed = true;
      this.presentation.set(carrierId, pres);
    }
    if (r.tackler) {
      // `r.tackler` is the tackler's *actor id* (`away-DL1`), not its slot:
      // `LivePlay` records `nearest.id` (LivePlay.ts:492). Match against `a.id`
      // so the tackler's stop celebration lands on the defender sprite.
      const tackler = this.live?.actors.find((a) => a.id === r.tackler && a.side === 'DEFENSE');
      if (tackler) {
        const tacklerPres = this.presentation.get(tackler.id) ?? {};
        tacklerPres.celebrating = true;
        this.presentation.set(tackler.id, tacklerPres);
      }
    }
  }

  private updateBanner(dt: number): void {
    // Terminal game: keep showing the final banner; no dismiss/period logic runs.
    if (this.gameOver) return;
    this.bannerTimer -= dt;
    if (this.bannerTimer > 0) return;

    // A carnage forfeit (or a final-play snap) may already have left the session in
    // GAME_OVER; `dismissBanner()` throws outside PLAY_OVER_BANNER, so only dismiss
    // when a play-over banner is actually pending.
    if (this.session.phase === 'PLAY_OVER_BANNER') this.session.dismissBanner();

    // Collapse extra-point / kickoff / period wind-downs to the next huddle. A
    // quarter-ending snap transitions to QUARTER_END or HALFTIME, which need an
    // explicit `advancePeriod()` (its halftime kickoff then resolves through this
    // same loop) before another play can be offered.
    let guard = 0;
    while (
      this.session.phase !== 'HUDDLE_PLAYCALL' &&
      this.session.phase !== 'GAME_OVER' &&
      guard++ < 12
    ) {
      if (this.session.phase === 'EXTRA_POINT') this.session.extraPoint('KICK');
      else if (this.session.phase === 'KICKOFF') this.session.kickoff({ touchback: true });
      else if (this.session.phase === 'PLAY_OVER_BANNER') this.session.dismissBanner();
      else if (this.session.phase === 'QUARTER_END' || this.session.phase === 'HALFTIME') {
        this.session.advancePeriod();
      } else break;
    }

    // After a terminal snap the session is GAME_OVER and no further play can be
    // selected; leaving it in PICK would let `selectPlays()` throw on the next down.
    this.live = null;
    this.liveResult = null;
    this.gameOver = this.session.phase === 'GAME_OVER';
    this.mode = this.gameOver ? 'BANNER' : 'PICK';
    // A terminal game pins the banner: it no longer runs dismiss logic (the while
    // loop below is skipped), and refreshUi() mirrors the final phase/winners.
  }

  // ------------------------------------------------------------- rendering

  /** Redraw the hazard layer when armed state *or* a telegraphed geyser's
   *  countdown changes, so the telegraph fill animates as it approaches eruption
   *  instead of freezing on the arm-state transition alone. */
  private redrawHazardsIfDirty(): void {
    const key = hazardStateKey(this.hazardManager);
    if (key === this.hazardStateKey) return;
    this.hazardStateKey = key;
    this.hazardGfx.clear();
    drawHazards(this.hazardGfx as unknown as DrawSurface, this.hazardManager);
  }

  /** Rebuild the actor sprites each frame, y-sorted, with shadows + indicators. */
  private drawActors(): void {
    this.actorsLayer.removeAll(true);
    this.spriteBackedActorCount = 0;
    // The overlay Graphics is rebuilt every frame; clear it up front so pass
    // reticles and any previous frame's in-flight ball / bloom markers do not
    // accumulate into permanent trails (and a growing command buffer).
    this.indicatorGfx.clear();
    // The ground layer holds down-transient marks (LOS/first-down lines, carrier
    // ring/stamina arc) that must die with the play. It is normally cleared at the
    // top of `drawIndicators`, but that runs *after* the `!this.live` early return.
    // Clear it here too so a banner→huddle transition (`live = null`) cannot leave
    // the previous down's scrimmage line / carrier ring frozen on the field.
    this.groundGfx.clear();
    if (!this.live) return;

    const los = this.liveLos;
    // Resolve the highlighted defender's id once (B cycles index 0..6).
    const defenders = this.live.actors.filter((x) => x.side === 'DEFENSE');
    const hlId = this.highlightDefender >= 0 ? defenders[this.highlightDefender]?.id : undefined;
    const carrierId = this.live.carrier.id;

    const actors: RenderActor[] = this.live.actors.map((state) => {
      const f = projectActor(state.x, state.y, los);
      const s = projectToScreen(f.x, f.y);
      return {
        state,
        px: s.x,
        py: s.y,
        depth: s.y,
        scale: s.scale,
        isCarrier: state.id === carrierId,
        isHighlighted: hlId !== undefined && state.id === hlId,
      };
    });

    // Cache the controlled carrier's projected footprint for the e2e readability
    // assertion (read-only), so the spec can verify the on-screen sprite without
    // interrogating Phaser internals or bypassing input.
    const carrierActor = actors.find((a) => a.isCarrier) ?? null;
    this.carrierScreen = carrierActor
      ? { px: carrierActor.px, py: carrierActor.py, scale: carrierActor.scale }
      : null;

    // Ground indicators render under every actor. The LOS/first-down lines and
    // selection ring are drawn below the actors so they never cover a sprite.
    this.drawIndicators(actors);

    // Referee sprite: pure presentation, never part of `live.actors`.
    this.drawReferee(los);

    actors.sort((a, b) => a.depth - b.depth);
    for (const a of actors) this.drawActor(a);

    // Phaser Containers render children in insertion (list) order, ignoring the
    // `setDepth` calls made on individual children. The referee is drawn first and
    // each actor's ring/shadow/ball after its sprite, so without an explicit
    // re-sort a far player can cover the near-sideline referee and a defender's
    // ring can draw over its own sprite. Reorder the container's children by the
    // depth each was assigned once everything for this frame is in place — before
    // the gas cloud and pass-window overlays are appended on top.
    this.actorsLayer.sort('depth');

    // Ghoul Gas cloud: a translucent toxic ellipse at the drop spot, dimming any
    // defender who stands inside it (poison is committed by the sim at snap; this
    // is the on-field visual).
    if (this.gasCloud && this.liveElapsed <= this.gasCloud.until) {
      const f = this.gasCloud;
      const s = projectToScreen(f.x, f.y);
      const gas = this.add.ellipse(s.x, s.y, 40 * s.scale, 24 * s.scale, 0x22cc66, 0.25);
      gas.setDepth(50);
      this.actorsLayer.add(gas);
    }

    // Passing windows float over eligible receivers while open (pass play).
    if (this.isPassPlay && this.windowsOpen && !this.ballFlight) this.drawPassWindows();
  }

  /** Per-actor seconds since its current animation began, restarting the clock
   *  whenever the animation changes (a fresh dive/throw/knockdown starts on
   *  frame 0 rather than an arbitrary mid-animation frame). */
  private animTime(id: string, anim: ActorAnimation): number {
    const last = this.animKind.get(id);
    if (last !== anim) {
      this.animKind.set(id, anim);
      this.animClock.set(id, 0);
      return 0;
    }
    const t = (this.animClock.get(id) ?? 0) + this.renderDt;
    this.animClock.set(id, t);
    return t;
  }

  /** Draw one actor from its faction sprite sheet, nearest-neighbour, with a
   *  ground ellipse shadow. The ball is carried at the carrier's hands when the
   *  carrier has the ball (not airborne); the tiny offset keeps it visible. */
  private drawActor(a: RenderActor): void {
    const s = a.state;
    const baseSheet = s.team === 'home' ? this.homeSheet : this.awaySheet;
    // Offence wears home colours, defence away: the away sheet is the `-away`
    // texture (home faction roster uses the base sheet, away roster uses `-away`).
    const sheet = sheetKey(baseSheet, s.team !== 'home');
    const frameAccum = this.runDist.get(s.id) ?? 0;
    // Passing state: `'aim'` while the QB is behind the LOS with the receiving
    // windows open (cocked, ball in hand — holds frame 1 instead of cycling into
    // the release every 0.5 s); `'throw'` for the one-shot release frames that
    // follow a launched pass (armed until `passingUntil`). Every other actor runs
    // or idles by velocity.
    const passing: 'aim' | 'throw' | null = a.isCarrier
      ? this.isPassPlay && this.windowsOpen && !this.ballFlight
        ? 'aim'
        : this.isPassPlay && this.liveElapsed <= this.passingUntil && this.ballFlight
          ? 'throw'
          : null
      : null;
    const presentation = this.presentation.get(s.id) ?? {};
    const anim = baseAnimation(s, passing, presentation);
    const cell = resolveActorCell(
      s,
      sheet,
      frameAccum,
      this.animTime(s.id, anim),
      passing,
      presentation,
    );

    // Select the 48×48 cell as a registered texture frame (row-major index) and
    // size *only that cell* to the projected footprint; `pixelArt: true` keeps the
    // nearest-neighbour scale crisp. The origin is the cell's bottom-centre, so the
    // sprite's feet sit exactly at the projected position (and stay there across
    // frame changes instead of drifting with the full sheet's 288×672 bounds).
    const frameIndex = cell.row * SPRITE_COLS + cell.col;
    // Anchor the artwork's baseline (row-44 feet) to the projected ground point:
    // a bottom-centre origin plus a small downward offset keeps the feet in the
    // ground shadow instead of floating 13 scaled pixels above it.
    const sp = this.add.image(a.px, a.py + 4 * a.scale, cell.sheet, frameIndex);
    sp.setOrigin(0.5, 1);
    sp.setScale(a.scale);
    sp.setDepth(a.depth);
    if (cell.flipX) sp.setFlipX(true);
    this.actorsLayer.add(sp);
    this.spriteBackedActorCount++;

    // Highlighted defender keeps its existing cyan outline cue (drawn under).
    if (a.isHighlighted) {
      const ring = this.add
        .ellipse(a.px, a.py, 22 * a.scale, 22 * a.scale, undefined, 0)
        .setStrokeStyle(1, toPhaserColor('SPECTRAL_CYAN'), 1)
        .setDepth(a.depth - 0.5);
      this.actorsLayer.add(ring);
    }

    // Ground ellipse shadow under every actor.
    const shadow = this.add.ellipse(a.px, a.py, 18 * a.scale, 6 * a.scale, 0x000000, 0.35);
    shadow.setDepth(a.depth - 0.5);
    this.actorsLayer.add(shadow);

    // Carried ball at the holder's hands (offsets so it reads as carried, not
    // dropped); in flight or after a fumble the ball is drawn separately in
    // drawOverlays. Ownership is tracked apart from `live.carrier` so a pass
    // completing to a receiver shows it in the receiver's hands, not the QB's.
    // The QB's wind-up frames draw the ball in the sheet artwork, so skip the
    // extra procedural ellipse for those cells (keep the ground shadow) to avoid
    // a doubled ball right at the carrier's hands. Applies to the cocked aim pose
    // (frame 1) and the throw-release wind-up frames (0..2); frame 3 is the
    // release, after which the ball is already in flight (this branch is skipped).
    if (s.id === this.ballHolderId && !this.ballFlight) {
      const windupHoldsBall =
        (cell.animation === 'pass_aim' && cell.col < 3) ||
        (cell.animation === 'pass_aim_throw' && cell.col < 3);
      // Ball at the holder's hands; its shadow sits on the *ground* under the
      // holder (`a.py`), not under the elevated ball, so pass both in.
      this.drawCarriedBall(a.px, a.py - 12 * a.scale, a.py, a.scale, a.depth, windupHoldsBall);
    }
  }

  /** The referee — a presentation-only sprite standing outside the play. Picks
   *  the current ref sheet (necro vs demon, from `session.ref.kind`). */
  private drawReferee(los: number): void {
    const sheet = this.session.ref.kind === 'DEMON_REF' ? REF_SHEET_DEMON : REF_SHEET_NECRO;
    if (!this.textures.exists(sheet)) return;

    // Stand on the near sideline, just behind the line of scrimmage. `projectActor`
    // centres the field at lateral 26.5, so a *positive* offset puts the referee on
    // the near (bottom) sideline; negative would push the 48px frame off the far edge.
    const f = projectActor(-3, 24, los);
    const s = projectToScreen(f.x, f.y);
    // Idle stance (row 0); cycle the idle frames slowly on the sim clock. The
    // selected cell is a registered 48×48 frame (row-major index), origin anchored
    // to the cell's bottom-centre just like every field actor.
    const idleCol = Math.floor(this.liveElapsed * 4) % 4;
    const ref = this.add.image(s.x, s.y + 4 * s.scale, sheet, idleCol);
    ref.setOrigin(0.5, 1);
    ref.setScale(s.scale);
    ref.setDepth(s.y);
    this.actorsLayer.add(ref);
    this.spriteBackedActorCount++;

    const shadow = this.add.ellipse(s.x, s.y, 18 * s.scale, 6 * s.scale, 0x000000, 0.35);
    shadow.setDepth(s.y - 0.5);
    this.actorsLayer.add(shadow);
  }

  /** A small procedurally-drawn football (brown ellipse + white stitching) at the
   *  carrier's hands, with its own ground shadow *under the holder*. `px`/`py` is
   *  the elevated ball position (the carrier's hands); `groundPy` is the holder's
   *  projected ground y, where the ball's shadow belongs — never under the
   *  elevated ball, which would float the shadow ~5px above the turf.
   *  `ballInArtwork` suppresses the ellipse (the sprite sheet already drew it,
   *  e.g. the QB's throw windup) while still laying down the ground shadow. */
  private drawCarriedBall(
    px: number,
    py: number,
    groundPy: number,
    scale: number,
    depth: number,
    ballInArtwork = false,
  ): void {
    // `fillEllipse(x, y, width, height)` takes *full* dimensions (not radii), so
    // size the ball by half-extents and pass `2*hw/2*hh` for the fill. The seam
    // and laces then use the same half-extents so they stay inset within the
    // 6×4 ball instead of extending 12px/8px outside it as radii would.
    const hw = 3 * scale; // half-width  → 6px ball at scale 1
    const hh = 2 * scale; // half-height → 4px ball at scale 1
    if (!ballInArtwork) {
      const g = this.add.graphics();
      g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
      g.fillEllipse(px, py, hw * 2, hh * 2);
      // Seam stripe + laces, kept minimal so the ball is instantly identifiable.
      g.lineStyle(1, toPhaserColor('BONE_WHITE'), 0.9);
      g.lineBetween(px - hw, py, px + hw, py);
      g.lineBetween(px - hw * 0.4, py - hh, px - hw * 0.4, py + hh);
      g.lineBetween(px + hw * 0.4, py - hh, px + hw * 0.4, py + hh);
      g.setDepth(depth + 0.2);
      this.actorsLayer.add(g);
    }

    // The ball's shadow grounds it *under the holder* (at the player's feet),
    // matching the actor's own ground ellipse rather than sitting up at the hands.
    const shadow = this.add.ellipse(px, groundPy, hw, 2 * scale, 0x000000, 0.3);
    shadow.setDepth(depth - 0.5);
    this.actorsLayer.add(shadow);
  }

  private drawIndicators(actors: RenderActor[]): void {
    const g = this.groundGfx;
    g.clear();

    // Line of scrimmage (cyan) and first-down (amber) lines across the field.
    // These render under the actors so they never cover a sprite. Field x is
    // `10 + los` (10-yard end zone), matching `projectActor`'s offset.
    const losFieldX = 10 + this.liveLos;
    const losTop = projectToScreen(losFieldX, 0);
    const losBot = projectToScreen(losFieldX, 53);
    g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
    g.lineBetween(losTop.x, losTop.y, losBot.x, losBot.y);

    // First-down target captured at snap (field-x, survives `snap()` rewriting
    // `session.yardsToGo` during the banner).
    if (this.firstDownFieldX > losFieldX && this.firstDownFieldX < 110) {
      const fdTop = projectToScreen(this.firstDownFieldX, 0);
      const fdBot = projectToScreen(this.firstDownFieldX, 53);
      g.lineStyle(2, toPhaserColor('HELLFIRE_AMBER'), 0.9);
      g.lineBetween(fdTop.x, fdTop.y, fdBot.x, fdBot.y);
    }

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
      const f = projectActor(actor.x, actor.y, this.liveLos);
      const s = projectToScreen(f.x, f.y);

      // Turf lead reticle: a dashed-ish cyan diamond ahead of the receiver.
      const g = this.indicatorGfx;
      g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
      const rx = 7 * s.scale;
      g.lineBetween(s.x - rx, s.y, s.x, s.y - rx);
      g.lineBetween(s.x, s.y - rx, s.x + rx, s.y);
      g.lineBetween(s.x + rx, s.y, s.x, s.y + rx);
      g.lineBetween(s.x, s.y + rx, s.x - rx, s.y);

      // Badge label floats ~20px above the receiver's head. The actor sprite is
      // bottom-centre anchored at `s.y` (its feet), `SPRITE_CELL` tall, so its
      // top sits `s.y - 44*scale` (the `+4*scale` baseline offset already landed
      // the artwork's feet at the ground point). Place the badge above that top
      // edge with 20px of clearance — not `26*scale`, which lands on the sprite's
      // helmet/shoulder row and hides the receiver artwork.
      const badge = this.add
        .text(s.x, s.y - (SPRITE_CELL - 4) * s.scale - 20, `[${key}]`, {
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
      const f = projectActor(px, py, this.liveLos);
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

    // Kick meter: a horizontal sweep bar with a centre sweet band, shown during
    // punt / field-goal attempts while sweeping (and frozen at the lock).
    if (this.isKickPlay && this.kickLocked === null) {
      const val = meterValue(this.kickHoldMs / 1000);
      const x0 = CANVAS_WIDTH / 2 - 80;
      const x1 = CANVAS_WIDTH / 2 + 80;
      const y = CANVAS_HEIGHT - 44;
      const { sweetBandMin, sweetBandMax } = KICK_METER;
      g.lineStyle(2, toPhaserColor('IRON_BEZEL'), 1);
      g.lineBetween(x0, y, x1, y);
      g.fillStyle(toPhaserColor('ECTO_GREEN'), 0.4);
      g.fillRect(
        x0 + (x1 - x0) * sweetBandMin,
        y - 4,
        (x1 - x0) * (sweetBandMax - sweetBandMin),
        8,
      );
      const mx = x0 + (x1 - x0) * val;
      g.fillStyle(toPhaserColor('PUMPKIN_ORANGE'), 1);
      g.fillRect(mx - 2, y - 6, 4, 12);
    } else if (this.isKickPlay && this.kickLocked !== null) {
      const x0 = CANVAS_WIDTH / 2 - 80;
      const x1 = CANVAS_WIDTH / 2 + 80;
      const y = CANVAS_HEIGHT - 44;
      const mx = x0 + (x1 - x0) * this.kickLocked;
      g.fillStyle(toPhaserColor('BONE_WHITE'), 1);
      g.fillRect(mx - 3, y - 7, 6, 14);
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
      case 'PICK': {
        const cat = catalogForDown(this.session.down);
        prompt = `Call the play — [A=J] ${cat[0]!.label} · [B=K] ${cat[1]!.label} · [C=L] ${cat[2]!.label}`;
        break;
      }
      case 'PRE_SNAP':
        prompt = `Pre-Snap: [C=L] Snaps the ball · ${down}`;
        break;
      case 'LIVE':
        prompt = this.isKickPlay
          ? this.kickLocked === null
            ? `Hold [C=L] to sweep the kick meter, release to lock · ${down}`
            : `Kick locked · ${down}`
          : `Live: WASD run · [A=J] Dive · [C=L] Turbo · [B=K] Switch defender`;
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
    this.syncHud();
    this.syncHuddle();
    const prompt = document.querySelector('.gsn-control-bar__prompt');
    if (prompt) prompt.textContent = line;

    const banner = document.getElementById('banner');
    if (banner) {
      if (this.mode !== 'BANNER') {
        // Kinematic banners own their children; clear without touching the host.
        if (banner.children.length > 0) banner.replaceChildren();
      }
    }
  }

  /**
   * Sync the broadcast HUD's game-state cells (casualty skulls, down & distance,
   * play clock, ball position, bribed-ref badge) from `GameSession` in place.
   * Idempotent and null-guarded so it is safe to call every rendered frame.
   */
  private syncHud(): void {
    const root =
      document.querySelector('.gsn-scorebug-shell') ??
      document.querySelector('[data-testid="scorebug"]');
    if (!root) return;
    const s = this.session;

    // Casualty skulls.
    for (const side of ['home', 'away'] as const) {
      const row = root.querySelector(`[data-testid="skulls-${side}"]`);
      if (!row) continue;
      const count = s.roster[side].casualties;
      Array.from(row.children).forEach((skull, i) => {
        skull.setAttribute('data-lit', String(i < count));
      });
    }

    // Play clock + down/distance + ball position (added by the enriched scorebug).
    const playclock = root.querySelector('.gsn-scorebug__playclock');
    if (playclock) playclock.textContent = `PLAY ${formatClock(s.playClock)}`;
    const down = root.querySelector('.gsn-scorebug__down');
    if (down) down.textContent = downDistanceLabel(s.down, s.yardsToGo);
    const los = root.querySelector('.gsn-scorebug__los');
    if (los) los.textContent = losLabel(s.los, s.possession);

    // Bribed-ref badge (text + active flag, so a change of briber re-syncs the label).
    const bribe = root.querySelector('[data-testid="bribe-badge"]');
    if (bribe) {
      const bribed = s.ref.isBribed ? s.ref.bribedBy : null;
      bribe.setAttribute('data-active', String(bribed !== null));
      if (bribed) {
        // `roster[x].faction` is the Roster's uppercase Faction enum; the shared
        // `factionName`/FACTIONS lookup key is the lowercase `FactionId`.
        const id = (f: string): FactionId => f.toLowerCase() as FactionId;
        const briber = id(s.roster[bribed].faction);
        const victim = id(s.roster[bribed === 'home' ? 'away' : 'home'].faction);
        bribe.textContent = `BRIBED REF · ${factionName(briber)} paid · flags ${factionName(victim)}`;
      } else {
        bribe.textContent = '';
      }
    }
  }

  /**
   * Render the Genesis huddle overlay (formation + A/B/C play cards) into the
   * `#huddle` node while the scene is in PICK, and clear it otherwise. The play
   * cards mirror `catalogForDown` so the overlay and the control bar agree.
   */
  private syncHuddle(): void {
    const host = document.getElementById('huddle');
    if (!host) return;
    if (this.mode !== 'PICK') {
      host.replaceChildren();
      host.hidden = true;
      this.huddleFingerprint = '';
      return;
    }
    const cat = catalogForDown(this.session.down);
    const plays = cat.map((p, i) => ({
      label: (['A', 'B', 'C'] as const)[i]!,
      name: p.label,
      kind: p.kind,
      formation: p.kind === 'PASS' ? 'SHOTGUN' : 'I-FORM',
    }));
    const availableNasties = this.session.charges.remaining(
      this.session.possession,
      this.session.half,
    );
    const formations = [...new Set(plays.map((p) => p.formation))];
    const fingerprint = JSON.stringify({
      down: this.session.down,
      plays: cat.map((p) => p.id),
      formations,
      nasties: availableNasties,
    });
    if (fingerprint === this.huddleFingerprint) return; // nothing changed this frame
    this.huddleFingerprint = fingerprint;

    host.replaceChildren(buildHuddleOverlay({ formations, plays, availableNasties }));
    host.hidden = false;
  }

  // ------------------------------------------------------------- debug handle

  private exposeDebugHandle(): void {
    // `session`/`hazardManager`/`lastResult` are populated in `create()`, which
    // runs *after* `preload`; this handle is installed in the constructor (before
    // the canvas is even on screen). Null-guard every session-backed getter so a
    // spec that reads `window.__mlf.phase` mid-preload gets a calm `null`/`''`
    // instead of a TypeError, then the real value once the scene boots.
    const session = () => this.session ?? null;
    const live = () => this.live;
    const mode = () => this.mode;
    const isPassPlay = () => this.isPassPlay;
    const windowsOpen = () => this.windowsOpen;
    const selectedPlay = () => this.selectedPlayIndex;
    const lastResult = () => this.session?.lastResult ?? null;
    const hazardManager = () => this.hazardManager;
    const spriteBackedActors = () => this.spriteBackedActorCount;
    const carrierScreen = () => this.carrierScreen;
    const camZoom = () => this.camera.zoom;
    const bannerKind = () => this.bannerKind;
    const aiDecision = () => {
      // Debug probe only: "what would the AI coach call for the team currently in
      // possession on offense?" This is NOT live gameplay wiring — the human
      // offense still calls its own play via `selectPlays`, and no `callNasty` is
      // driven from here. Wiring a 1P-vs-AI opponent loop is deferred (see PR note).
      const s = this.session;
      if (!s) return null;
      const team = s.possession;
      return decideCoachPlay({
        down: s.down,
        yardsToGo: s.yardsToGo,
        los: s.los,
        quarter: s.quarter,
        clockSeconds: s.clock,
        score: s.score,
        team,
        aiIsOffense: true,
        ownCasualties: s.roster[team].casualties,
        refBribedAgainst: s.ref.isBribed && s.ref.bribedBy !== team,
        demonRefActive: s.ref.kind === 'DEMON_REF',
        availableNasties: s.charges.remaining(team, s.half),
      });
    };
    (window as unknown as Record<string, unknown>).__mlf = {
      session: session(),
      get phase() {
        return session()?.phase ?? '';
      },
      get mode() {
        return mode();
      },
      get score() {
        return session()?.score ?? null;
      },
      get los() {
        return session()?.los ?? null;
      },
      get down() {
        return session()?.down ?? null;
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
        return hazardManager()?.snapshot() ?? [];
      },
      get bannerKind() {
        return bannerKind();
      },
      get aiDecision() {
        return aiDecision();
      },
      get actors() {
        return (
          live()?.actors.map((a) => ({ id: a.id, side: a.side, slot: a.slot, x: a.x, y: a.y })) ??
          []
        );
      },
      // Count of sprite-backed actors rendered last frame (14 field players +
      // 1 referee). The e2e suite asserts this equals 15 so no actor ever regresses
      // to a flat rectangle.
      get spriteBackedActors() {
        return spriteBackedActors();
      },
      // Read-only render seam for the readability acceptance: the controlled
      // player's projected screen-space footprint plus the live camera zoom, so
      // a spec can compute the on-screen sprite height (48 backing px × depth
      // scale × camera zoom × integer CSS scale) and assert it stays readable.
      get carrierScreen() {
        const c = carrierScreen();
        if (!c) return null;
        return { px: c.px, py: c.py, scale: c.scale, camZoom: camZoom() };
      },
      pick: (i: number) => {
        this.selectedPlayIndex = Math.max(0, Math.min(2, Number(i) || 0));
        this.confirmPlay(this.selectedPlayIndex);
      },
      snap: () => {
        // Build the live play *and* enter LIVE, matching the on-screen flow; a bare
        // mode flip leaves `this.live` null so the down can never run to the whistle.
        if (this.mode === 'PRE_SNAP') this.beginLivePlay();
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
