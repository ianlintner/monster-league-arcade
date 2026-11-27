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
import { HALLOWEEN_MIDNIGHT_PALETTE as P } from '@monster-league/shared-core';
import {
  InputManager,
  assetUrl,
  type InputSnapshot,
  type ArcadeButton,
} from '@monster-league/shared-core';
import { GameSession } from '../sim/index';
import { drawFieldSprites, drawField, drawHazards, hazardStateKey } from './fieldRenderer';
import type { DrawSurface } from './fieldRenderer';
import { stepCamera, clampFocus, INITIAL_CAMERA } from './cameraRig';
import type { CameraState } from './cameraRig';
import {
  composeReadyLine,
  updateScorebug,
  clearBannerIfNotActive,
  syncHud,
  syncHuddle,
} from './hudBridge';
import type { LivePlay, LivePlayResult } from '../field/LivePlay';
import { HazardManager } from '../field/HazardManager';
import type { NastyFieldEffects } from '../field/NastyFieldEffects';
import type { HazardHit } from '../sim/GameSession';
import type { BannerKind } from '../ui/hud';
import {
  FACTION_SHEET,
  REF_SHEET_NECRO,
  REF_SHEET_DEMON,
  SPRITE_CELL,
  type ActorAnimation,
  type ActorPresentationState,
} from './spriteRenderer';
import { ActorPresenter, type PresentScene } from './actorPresenter';
import { installDebugHandle, type DebugHandleSurface } from './debugHandle';
import { MatchController } from './matchController';
import { cpuOnOffense } from './cpuOpponent';
import { quarterSecondsFromSearch } from './matchConfig';
import { mountOnboarding, type Onboarding } from '../ui/onboarding';

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

export class MatchScene extends Phaser.Scene {
  /** Set by `bootFootball(_, { production: true })` from the app entry; gates the
   *  on-canvas instruction/debug text overlay (game state lives in the HUD). */
  static isProduction = false;

  /** The live-play mode state machine + sim loop, extracted to `matchController`.
   *  It owns no state: it reads/writes this scene through the `MatchRuntime`
   *  surface. Constructed lazily because it holds a back-reference to `this`. */
  private match!: MatchController;

  session!: GameSession;
  live: LivePlay | null = null;
  liveResult: LivePlayResult | null = null;

  /** Presentation state machine layered over `GameSession`'s own phases. */
  mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER' = 'PICK';
  selectedPlayIndex = 0;
  bannerText = '';
  bannerKind: BannerKind = 'NEUTRAL';
  bannerTimer = 0;
  /** Set once the session reaches GAME_OVER; disables play selection + dismiss. */
  gameOver = false;
  highlightDefender = -1;
  private inputPollTimer = 0;
  /** Fingerprint of the last huddle overlay build; skips redundant DOM rebuilds. */
  private huddleFingerprint = '';

  private fieldGfx!: Phaser.GameObjects.Graphics;
  private indicatorGfx!: Phaser.GameObjects.Graphics;
  private groundGfx!: Phaser.GameObjects.Graphics;
  private actorsLayer!: Phaser.GameObjects.Container;
  private readyText!: Phaser.GameObjects.Text;
  /** In-viewport prompt strip + first-run controls card (DOM). */
  private onboarding: Onboarding | null = null;

  /** Home/away sheet id resolved once at create from the session rosters. */
  private homeSheet = '';
  private awaySheet = '';
  /** Per-actor accumulated distance travelled (run frames advance on it). */
  runDist = new Map<string, number>();
  /** Previous fixed-step position per actor, for distance-based frame advance. */
  lastPos = new Map<string, { x: number; y: number }>();
  /** Per-actor seconds since its *current* animation began (one-shots/loops). */
  animClock = new Map<string, number>();
  /** Per-actor current animation (to detect transitions and restart the clock). */
  animKind = new Map<string, ActorAnimation>();
  /** Scene-side terminal status per actor id (death/knockdown/celebration). */
  presentation = new Map<string, ActorPresentationState>();
  /** Frame-by-frame actor/overlay rendering extracted to a presenter (owns no
   *  state; it draws through the scene surface below). */
  private actorPresenter = new ActorPresenter();
  /** The first-down target field-x captured at snap (survives `snap()` mutating
   *  `session.yardsToGo` during the banner). */
  firstDownFieldX = 0;
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
  hazardManager!: HazardManager;
  /** Nasty audible on-field effects (boost, grenades, gas, hex, shroud). */
  nastyFields!: NastyFieldEffects;
  /** The latest nasty-field snapshot, refreshed each fixed step; consumed by
   *  movement, input inversion and the overlays (gas cloud, shroud, kill-ref). */
  nastySnap: ReturnType<NastyFieldEffects['tick']> | null = null;
  /** Elapsed live-down seconds, fed to NastyFieldEffects (hex/gas/shroud timers). */
  liveElapsed = 0;
  /** Wall-clock seconds since the last render frame (uncapped `update` delta, in
   *  contrast to `LIVE_TUNING.dt`'s fixed sim step); drives animation clocks so a
   *  run cycle advances by real time rather than once per rendered frame. */
  private renderDt = 0;
  /** Ghoul Gas cloud marker (field coords + expiry) for the render dim. */
  gasCloud: { x: number; y: number; until: number } | null = null;
  /** Hazard hits accumulated over the current live down, committed at whistle. */
  pendingHazardHits: HazardHit[] = [];
  /** The LOS at snap, captured when the live down begins. Live actor positions are
   *  relative to *this* LOS, but `session.snap()` mutates `session.los` before the
   *  banner frames draw, so all actor/overlay projections must use the unchanged
   *  starting LOS rather than the already-advanced one (else the formation shifts
   *  again by the gained yardage, or across the field after a turnover). */
  liveLos = 0;
  /** Whether the current play is a pass (QB drops back, A/B/C = receivers). */
  isPassPlay = false;
  /** Whether the current play is a punt / field-goal attempt (C = kick meter). */
  isKickPlay = false;
  /** CPU offense override: the away team's chosen play id this down (null while
   *  the human calls its own play). See `matchController.MatchRuntime`. */
  cpuPlayId: string | null = null;
  /** Wall-clock reference for when the CPU finishes its huddle and selects the play. */
  cpuHuddleClock = 0;
  /** Wall-clock reference for when the CPU snaps after its PRE_SNAP beat. */
  cpuSnapClock = 0;
  /** Elapsed seconds into the CPU's live pass play (open windows → throw). */
  cpuPassClock = 0;
  /** Hold time on C during a kick play → meter sweep position. */
  kickHoldMs = 0;
  /** Locked meter value (0..1) once the kicker taps C. */
  kickLocked: number | null = null;
  /** True once the kick has been resolved and committed via snap. */
  kickCommitted = false;
  /** Hold time for the current pass (ms) → lob vs bullet throw style. */
  passHoldMs = 0;
  /** Which receiver button (A/B) is currently held pending a release throw. */
  heldThrowKey: 'A' | 'B' | null = null;
  /** Whether the receiving windows are open (C toggles them behind the LOS). */
  windowsOpen = false;
  /** True from the C press that opened the windows until a *fresh* C keydown, so
   *  that very same press never doubles as a throw to receiver C (the player must be
   *  able to choose A or B, or re-press C deliberately, after opening). */
  windowOpenPressConsumed = false;
  /** Deterministic check used to trigger the first hazard for the e2e path. */
  hazardArmedForDemo = true;
  /** Accumulates render time toward fixed 60 Hz sim steps (real-time pacing). */
  simAccumulator = 0;
  /** Last terrain friction/slow from the hazard evaluator, applied to the carrier
   *  movement on the next fixed step (graveyard tombstones impede, swamp slows). */
  lastFriction = 1;
  lastSlow = 1;

  /** Presentation camera: frames a ~37-yard window around the ball and zooms out
   *  smoothly for deep passes and kicks. Focus/zoom math + arena clamp live in
   *  `cameraRig`; this holds only the owned `CameraState` between frames. */
  private camera: CameraState = { ...INITIAL_CAMERA };

  /** Ball in flight (pass animation) — null when no ball is airborne. */
  ballFlight: {
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
  passingUntil = -1;

  /** Floating damage numbers + casualty/death animations, cleared per down. */
  damagePopups: { x: number; y: number; text: string; color: number; ttl: number }[] = [];
  casualties: { id: string; x: number; y: number; ttl: number }[] = [];

  looseBall: { x: number; y: number; ttl: number } | null = null;
  /** Which actor *presentationally* holds the ball right now (actor id, not the
   *  roster id). `LivePlay.carrier` stays the QB through a whole pass play, so the
   *  carried-ball sprite must track possession independently: null while the ball
   *  is in flight or loose, the receiver on a completion, null on a pick/incomplete. */
  ballHolderId: string | null = null;

  /** Unified Genesis 3-button + 360° input (keyboard/gamepad/touch). All game
   *  input flows through this one source of truth — no raw Phaser key polling. */
  private inputManager = new InputManager();
  /** Latest polled snapshot for the human player (P1, slot 0). */
  playerInput: InputSnapshot = {
    x: 0,
    y: 0,
    buttons: { A: false, B: false, C: false, START: false },
    pressed: { A: false, B: false, C: false, START: false },
  };
  /** Snapshot as of the previous poll, for hold/release edge detection. */
  private prevInput: InputSnapshot = this.playerInput;

  constructor() {
    super('match');
    // The controller holds a back-reference to this scene through `MatchRuntime`;
    // construct it before exposing the debug handle (which drives the same surface).
    this.match = new MatchController(this);
    // Expose the e2e/dev handle as soon as the scene object exists, not in
    // `create()`: Phaser makes the canvas visible at the *start* of `preload`,
    // so gameplay specs that read `window.__mlf` right after the canvas appears
    // would otherwise race the (slow) atlas/sprite-sheet load. The getters below
    // are lazy and null-guarded, so they read correctly once `create()` populates
    // `session`/`live` and safely report null/'' before then.
    installDebugHandle(this.debugSurface());
  }

  // ------------------------------------------------------------- lifecycle

  preload(): void {
    this.load.json('atlas', assetUrl('assets/atlas.json'));
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
      this.load.spritesheet(sheet, assetUrl(`assets/sprites/${sheet}.png`), frame);
      this.load.spritesheet(`${sheet}-away`, assetUrl(`assets/sprites/${sheet}-away.png`), frame);
      this.load.image(`crest_${sheet}`, assetUrl(`assets/sprites/crest_${sheet}.png`));
    }
    this.load.spritesheet(
      REF_SHEET_NECRO,
      assetUrl(`assets/sprites/${REF_SHEET_NECRO}.png`),
      frame,
    );
    this.load.spritesheet(
      REF_SHEET_DEMON,
      assetUrl(`assets/sprites/${REF_SHEET_DEMON}.png`),
      frame,
    );
    // Arena tiles (home faction's arena): turf + end zone, tiled across the field.
    for (const arena of ['cursed_graveyard', 'brimstone_hellfire_pit', 'ectoplasm_swamp']) {
      this.load.image(`${arena}_turf`, assetUrl(`assets/arenas/${arena}_turf.png`));
      this.load.image(`${arena}_endzone`, assetUrl(`assets/arenas/${arena}_endzone.png`));
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

    this.session = this.newSession();

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

    // Mount once (the scene may be restarted): the prompt strip + first-run card.
    this.onboarding ??= mountOnboarding();
    this.refreshUi();
  }

  /** Bootstrap a session to the first huddle: home receives the opening kick.
   *  `?quarter=<seconds>` (clamped 10..180) is a test seam for short matches. */
  private newSession(): GameSession {
    const session = new GameSession({
      seed: 1993,
      homeFaction: 'REAPERS',
      awayFaction: 'DEADSKINS',
      quarterSeconds: quarterSecondsFromSearch(window.location.search),
    });
    session.coinToss('home');
    session.kickoff({ touchback: true });
    return session;
  }

  /** Start a fresh match from the result screen: new session, presentation state
   *  cleared, huddle shown. Stays in the same scene, so `InputManager` keeps its
   *  single window listener (nothing to detach/reattach, no doubled handlers). */
  restartMatch(): void {
    this.session = this.newSession();
    this.mode = 'PICK';
    this.live = null;
    this.liveResult = null;
    this.gameOver = false;
    this.selectedPlayIndex = 0;
    this.bannerText = '';
    this.bannerKind = 'NEUTRAL';
    this.bannerTimer = 0;
    this.highlightDefender = -1;
    this.isPassPlay = false;
    this.isKickPlay = false;
    this.cpuPlayId = null;
    this.cpuHuddleClock = 0;
    this.cpuSnapClock = 0;
    this.cpuPassClock = 0;
    this.kickLocked = null;
    this.windowsOpen = false;
    this.ballFlight = null;
    this.ballHolderId = null;
    this.gasCloud = null;
    this.passingUntil = -1;
    this.pendingHazardHits = [];
    this.damagePopups = [];
    this.casualties = [];
    this.looseBall = null;
    this.liveLos = this.session.los;
    this.runDist.clear();
    this.lastPos.clear();
    this.animClock.clear();
    this.animKind.clear();
    this.presentation.clear();
    this.camera = { ...INITIAL_CAMERA };
    // Force the huddle overlay to rebuild and drop the result card.
    this.huddleFingerprint = '';
    document.getElementById('banner')?.replaceChildren();
  }

  override update(_time: number, delta: number): void {
    // The first-run controls card pauses the match (play clock included) until dismissed.
    if (this.onboarding?.isOpen()) {
      this.refreshUi();
      return;
    }
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
          // CPU offense: a delay-of-game during the CPU huddle must NOT force a
          // human-catalog pick — the CPU calls its own play on its own beat. The
          // penalty yards are already applied by `tickPlayClock`; the AI coach will
          // call the next down from the backed-up spot.
          if (!cpuOnOffense(this.session)) {
            this.match.confirmPlay(this.selectedPlayIndex);
          }
        } else if (this.mode === 'PRE_SNAP') {
          // The penalty moved `session.los` back 5 yards, but the formation was
          // built at pick time from the old LOS. Rebuild it so the actors, ball
          // and first-down line sit at the penalised spot instead of the stale one.
          this.match.prepareLivePlay();
        }
      }
    }

    this.match.updateMode(dt);
    const actors = this.actorPresenter.renderActors(this.renderContext());
    this.spriteBackedActorCount = actors.spriteBackedActorCount;
    this.carrierScreen = actors.carrierScreen;
    const overlays = this.actorPresenter.renderOverlays(this.renderContext(), dt);
    this.damagePopups = overlays.damagePopups;
    this.casualties = overlays.casualties;
    this.looseBall = overlays.looseBall;
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
  buttonHeld(b: ArcadeButton): boolean {
    return this.playerInput.buttons[b];
  }
  /** Button freshly pressed this poll (edge — a tap, consumed exactly once). */
  pressedBtn(b: ArcadeButton): boolean {
    return this.playerInput.pressed[b];
  }
  /** Button released this poll (level true → false, for hold-to-throw/kick lock). */
  releasedBtn(b: ArcadeButton): boolean {
    return this.prevInput.buttons[b] && !this.playerInput.buttons[b];
  }

  /** D-pad/stick left as a fresh edge (analog level crossing -0.5 from above). */
  steerLeftEdge(): boolean {
    return this.prevInput.x > -0.5 && this.playerInput.x <= -0.5;
  }
  /** D-pad/stick right as a fresh edge. */
  steerRightEdge(): boolean {
    return this.prevInput.x < 0.5 && this.playerInput.x >= 0.5;
  }

  // ------------------------------------------------------------- rendering

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

  // --------------------------------------------------------------------------
  // Actor/overlay rendering now lives in `actorPresenter.ts`; `update()` builds
  // the read/write surface below and calls `renderActors`/`renderOverlays`.
  // Every field the presenter reads through `PresentScene` is referenced here so
  // it stays "used" for the compiler; the presenter mutates the shared maps and
  // lists in place and returns the reassigned scalars/lists for the scene to store.

  private renderContext(): PresentScene {
    return {
      add: this.add,
      textures: this.textures,
      actorsLayer: this.actorsLayer,
      indicatorGfx: this.indicatorGfx,
      groundGfx: this.groundGfx,
      homeSheet: this.homeSheet,
      awaySheet: this.awaySheet,
      live: this.live,
      liveLos: this.liveLos,
      liveElapsed: this.liveElapsed,
      renderDt: this.renderDt,
      session: this.session as PresentScene['session'],
      isPassPlay: this.isPassPlay,
      windowsOpen: this.windowsOpen,
      passingUntil: this.passingUntil,
      ballHolderId: this.ballHolderId,
      highlightDefender: this.highlightDefender,
      gasCloud: this.gasCloud,
      firstDownFieldX: this.firstDownFieldX,
      isKickPlay: this.isKickPlay,
      kickHoldMs: this.kickHoldMs,
      kickLocked: this.kickLocked,
      ballFlight: this.ballFlight,
      runDist: this.runDist,
      animClock: this.animClock,
      animKind: this.animKind,
      presentation: this.presentation,
      damagePopups: this.damagePopups,
      casualties: this.casualties,
      looseBall: this.looseBall,
    };
  }

  // ------------------------------------------------------------- HUD / dom

  private refreshUi(): void {
    const hudState = {
      session: this.session,
      mode: this.mode,
      bannerText: this.bannerText,
      isKickPlay: this.isKickPlay,
      kickLocked: this.kickLocked,
      cpuPlayId: this.cpuPlayId,
      huddleFingerprint: this.huddleFingerprint,
      isPassPlay: this.isPassPlay,
      windowsOpen: this.windowsOpen,
    };
    const { readyText, controlLine, promptLine } = composeReadyLine(hudState);
    this.huddleFingerprint = hudState.huddleFingerprint;
    this.readyText.setText(readyText);
    this.onboarding?.setPrompt(promptLine);
    this.updateDom(controlLine);
  }

  private updateDom(line: string): void {
    const hudState = {
      session: this.session,
      mode: this.mode,
      bannerText: this.bannerText,
      isKickPlay: this.isKickPlay,
      kickLocked: this.kickLocked,
      cpuPlayId: this.cpuPlayId,
      huddleFingerprint: this.huddleFingerprint,
    };
    updateScorebug(document, this.session);
    syncHud(document, this.session);
    syncHuddle(document, hudState); // mutates hudState.huddleFingerprint in place
    this.huddleFingerprint = hudState.huddleFingerprint;
    const prompt = document.querySelector('.gsn-control-bar__prompt');
    if (prompt) prompt.textContent = line;
    clearBannerIfNotActive(document, this.mode);
  }

  // --------------------------------------------------------------------------
  // `syncHud` / `syncHuddle` DOM wiring now lives in `hudBridge.ts`; see
  // `refreshUi`/`updateDom` above for the delegation.

  // ------------------------------------------------------------- debug handle

  /** Build the read/write surface `debugHandle.installDebugHandle` assembles into
   *  `window.__mlf`. Faithful port of the former `exposeDebugHandle`: same lazy
   *  null-guarded reads, same driver guards (mode/pass/windows), same carrier
   *  relocation arithmetic. */
  private debugSurface(): DebugHandleSurface {
    return {
      session: () => this.session ?? null,
      live: () => this.live,
      mode: () => this.mode,
      isPassPlay: () => this.isPassPlay,
      windowsOpen: () => this.windowsOpen,
      ballInFlight: () => this.ballFlight !== null,
      selectedPlayIndex: () => this.selectedPlayIndex,
      cpuPlayId: () => this.cpuPlayId,
      lastResult: () => this.session?.lastResult ?? null,
      hazardManager: () => this.hazardManager,
      spriteBackedActorCount: () => this.spriteBackedActorCount,
      carrierScreen: () => this.carrierScreen,
      camZoom: () => this.camera.zoom,
      bannerKind: () => this.bannerKind,
      confirmPlay: (index) => this.match.confirmPlay(index),
      beginLivePlay: () => this.match.beginLivePlay(),
      openPassWindows: () => {
        if (this.mode === 'LIVE' && this.isPassPlay) this.windowsOpen = true;
      },
      commitPassTo: (t) => this.match.commitPass(t),
      relocateCarrier: (x, y) => {
        const l = this.live;
        if (!l) return;
        const c = l.carrier;
        c.x = Number(x) - this.session.los;
        c.y = Number(y);
      },
    };
  }
}
