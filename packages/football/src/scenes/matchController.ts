/**
 * MatchController — the live-play mode state machine for `MatchScene`.
 * Extracted verbatim from the scene so the scene class shrinks under the
 * ~400-line ceiling (ARCHITECTURE.md) without any behaviour change: the
 * controller owns no state itself; it reads and writes the scene through the
 * typed `MatchRuntime` surface below, with the same names, order and arithmetic.
 * The frame-by-frame sim loop (matchSim), outcome commit/banner (matchOutcome)
 * and this state machine together replace the former scene methods.
 */
import type { GameSession, HazardHit } from '../sim/index';
import { getOffensePlay } from '../sim/index';
import { buildLivePlayInput } from '../field/fieldMapper';
import type { ArcadeButton, InputSnapshot } from '@monster-league/shared-core';
import { LivePlay, type LivePlayResult } from '../field/LivePlay';
import type { HazardManager } from '../field/HazardManager';
import { NastyFieldEffects } from '../field/NastyFieldEffects';
import type { BannerKind } from '../ui/hud';
import type { ActorAnimation, ActorPresentationState } from './spriteRenderer';
import { updateLive, commitPass } from './matchSim';
import { updateBanner } from './matchOutcome';
import { cpuOnOffense, cpuCallOffense } from './cpuOpponent';
import { assignDefaultDefender } from './defenseInput';

export type PlayKind = 'RUN' | 'PASS' | 'PUNT' | 'FIELD_GOAL';

/** Three human-selectable plays (A/B/C) — two runs and one pass. */
export const PLAY_CATALOG: ReadonlyArray<{ id: string; label: string; kind: PlayKind }> = [
  { id: 'INSIDE_GORE_RUN', label: 'Inside Gore Run', kind: 'RUN' },
  { id: 'COFFIN_SWEEP', label: 'Coffin Sweep', kind: 'RUN' },
  { id: 'QUICK_SLANTS', label: 'Quick Slants (Pass)', kind: 'PASS' },
];
/**
 * On 4th down the play call swaps to special teams: punt, field goal, or a
 * desperation run ("go for it"). This is what makes the KickMeter reachable —
 * the punter/kicker face the C-button timing meter instead of a live play.
 */
export const FOURTH_DOWN_CATALOG: ReadonlyArray<{ id: string; label: string; kind: PlayKind }> = [
  { id: 'PUNT', label: 'Punt', kind: 'PUNT' },
  { id: 'FIELD_GOAL', label: 'Field Goal', kind: 'FIELD_GOAL' },
  { id: 'INSIDE_GORE_RUN', label: 'Go For It (Run)', kind: 'RUN' },
];
export const DEFAULT_DEFENSE = 'BONE_CRUSH_BASE';

/** Banner body line for a classified broadcast banner. */
export function detailForKind(kind: BannerKind, raw: string): string {
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
export function catalogForDown(
  down: number,
): ReadonlyArray<{ id: string; label: string; kind: PlayKind }> {
  return down >= 4 ? FOURTH_DOWN_CATALOG : PLAY_CATALOG;
}

/**
 * The read/write surface `MatchController` operates on. `MatchScene` declares
 * every one of these fields (now non-private) and satisfies the interface
 * structurally; the controller owns no state, so this is a faithful port of the
 * former scene methods with `this.` replaced by `s` (the runtime surface).
 */
export interface MatchRuntime {
  session: GameSession;
  live: LivePlay | null;
  liveResult: LivePlayResult | null;

  mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER';
  selectedPlayIndex: number;
  /** CPU offense override: the away team's chosen offense play id this down (null
   *  while the human calls its own play). Overrides the A/B/C catalog in
   *  `prepareLivePlay`. Set the moment the CPU calls its play, so the CPU-huddle
   *  overlay can name it before the play is actually selected. */
  cpuPlayId: string | null;
  /** When the CPU finishes its huddle and selects the play (wall-clock reference),
   *  set at CPU pick time while the "CPU OFFENSE" overlay is showing. */
  cpuHuddleClock: number;
  /** When the CPU snaps (scene-elapsed wall-clock reference), set at CPU pick time. */
  cpuSnapClock: number;
  /** CPU pass beat counter: open windows at ~0.5 s, throw ~0.4 s later. */
  cpuPassClock: number;
  bannerText: string;
  bannerKind: BannerKind;
  bannerTimer: number;
  gameOver: boolean;
  highlightDefender: number;

  runDist: Map<string, number>;
  lastPos: Map<string, { x: number; y: number }>;
  animClock: Map<string, number>;
  animKind: Map<string, ActorAnimation>;
  presentation: Map<string, ActorPresentationState>;
  firstDownFieldX: number;

  hazardManager: HazardManager;
  nastyFields: NastyFieldEffects;
  nastySnap: ReturnType<NastyFieldEffects['tick']> | null;
  liveElapsed: number;
  gasCloud: { x: number; y: number; until: number } | null;
  pendingHazardHits: HazardHit[];
  liveLos: number;
  isPassPlay: boolean;
  isKickPlay: boolean;
  kickHoldMs: number;
  kickLocked: number | null;
  kickCommitted: boolean;
  passHoldMs: number;
  heldThrowKey: 'A' | 'B' | null;
  windowsOpen: boolean;
  windowOpenPressConsumed: boolean;
  hazardArmedForDemo: boolean;
  simAccumulator: number;
  lastFriction: number;
  lastSlow: number;

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
  } | null;
  passingUntil: number;

  damagePopups: { x: number; y: number; text: string; color: number; ttl: number }[];
  casualties: { id: string; x: number; y: number; ttl: number }[];
  looseBall: { x: number; y: number; ttl: number } | null;
  ballHolderId: string | null;

  playerInput: InputSnapshot;

  /** Input-level helpers retained on the scene; the controller reads them here. */
  buttonHeld(b: ArcadeButton): boolean;
  pressedBtn(b: ArcadeButton): boolean;
  releasedBtn(b: ArcadeButton): boolean;
  steerLeftEdge(): boolean;
  steerRightEdge(): boolean;
  /** Start a fresh match from the terminal result screen. */
  restartMatch(): void;
}

/** The live-play mode state machine, operating on a `MatchRuntime`. */
export class MatchController {
  constructor(private readonly s: MatchRuntime) {}

  /** Faithful port of `MatchScene.confirmPlay`. */
  confirmPlay(index: number): void {
    this.s.selectedPlayIndex = index;
    this.s.cpuPlayId = null;
    this.s.session.selectPlays(catalogForDown(this.s.session.down)[index]!.id, DEFAULT_DEFENSE);
    this.s.mode = 'PRE_SNAP';
    // Build the live play at pick time so the PRE_SNAP formation renders its
    // 14 actors in idle stances (both teams in home/away colours, ball at the
    // line of scrimmage). The down's sim clock does not start until `snap()`.
    this.prepareLivePlay();
  }

  /**
   * CPU offense call: ask the AI coach for the away team's play and feed it to
   * `selectPlays` (defense stays `DEFAULT_DEFENSE` for the human side). No human
   * A/B/C enters this path — the CPU plays itself. Called after the CPU-huddle
   * overlay has shown the play name for a readable beat.
   */
  private confirmCpuPlay(): void {
    if (this.s.gameOver) return;
    if (!this.s.cpuPlayId) return;
    const playId = this.s.cpuPlayId;
    this.s.session.selectPlays(playId, DEFAULT_DEFENSE);
    this.s.mode = 'PRE_SNAP';
    // Readable beat before the CPU snaps: ~0.8–1.2 s in PRE_SNAP.
    this.s.cpuSnapClock = performance.now() + 800 + (playId.length % 5) * 100;
    this.prepareLivePlay();
  }

  private updatePick(): void {
    if (this.s.gameOver) return;
    // CPU offense: the away team calls its own play without any human A/B/C. It
    // runs a two-phase huddle — first name the play in the "CPU OFFENSE" overlay
    // for a beat, then select it and move to PRE_SNAP.
    if (cpuOnOffense(this.s.session)) {
      if (this.s.cpuPlayId === null) {
        const decision = cpuCallOffense(this.s.session);
        this.s.cpuPlayId = decision.offensePlayId;
        this.s.cpuHuddleClock = performance.now() + 800 + (decision.offensePlayId.length % 5) * 100;
        // Stay in PICK so the CPU-offense overlay renders before the snap beat.
      } else if (performance.now() >= this.s.cpuHuddleClock) {
        this.confirmCpuPlay();
      }
      return;
    }
    // Human offense: clear any stale CPU override before the A/B/C pick list.
    this.s.cpuPlayId = null;
    // The pick list depends on the down: 4th down offers special teams (punt/FG).
    const catalog = catalogForDown(this.s.session.down);
    if (this.s.pressedBtn('A')) this.s.selectedPlayIndex = 0;
    else if (this.s.pressedBtn('B')) this.s.selectedPlayIndex = 1;
    else if (this.s.pressedBtn('C')) this.s.selectedPlayIndex = 2;
    else if (this.s.steerLeftEdge())
      this.s.selectedPlayIndex = (this.s.selectedPlayIndex + catalog.length - 1) % catalog.length;
    else if (this.s.steerRightEdge())
      this.s.selectedPlayIndex = (this.s.selectedPlayIndex + 1) % catalog.length;
    else return;
    this.confirmPlay(this.s.selectedPlayIndex);
  }

  private updatePreSnap(): void {
    // CPU offense: snap after the readable beat; the human C must not snap for it.
    if (cpuOnOffense(this.s.session)) {
      if (performance.now() >= this.s.cpuSnapClock) this.beginLivePlay();
      return;
    }
    if (this.s.pressedBtn('C')) this.beginLivePlay();
  }

  /** Build the 14-actor `LivePlay` and reset per-down presentation state. Safe to
   *  call again at snap time (idempotent: everything below is recomputed from the
   *  same unchanged session state, and the sim clock has not advanced yet). */
  prepareLivePlay(): void {
    // CPU offense: use the coach's chosen play id (bypassing the human A/B/C
    // catalog, which never contains punts/FGs/deep routes); otherwise the human
    // catalog index.
    const play = this.s.cpuPlayId
      ? { id: this.s.cpuPlayId, kind: getOffensePlay(this.s.cpuPlayId).kind }
      : catalogForDown(this.s.session.down)[this.s.selectedPlayIndex]!;
    this.s.isPassPlay = play.kind === 'PASS';
    this.s.isKickPlay = play.kind === 'PUNT' || play.kind === 'FIELD_GOAL';
    // Capture the starting LOS for this down; every projection below uses it even
    // after `snap()` advances `session.los`, and the PRE_SNAP formation needs it.
    this.s.liveLos = this.s.session.los;
    // Prime the nasty audible field effects for this play (boost, grenades, gas,
    // hex, shroud); the sim already computed `session.effects` from valid actives.
    this.s.nastyFields = new NastyFieldEffects();
    this.s.nastyFields.begin(this.s.session.effects);
    const input = buildLivePlayInput(this.s.session, play.id, DEFAULT_DEFENSE, 0x9e3779b9);
    this.s.live = new LivePlay(input);
    // Initialize ball presentation ownership at formation time too: the opening
    // PRE_SNAP formation is rendered before `beginLivePlay()` runs, and anchoring
    // the ball to the live carrier here means a prior down's holder can't leak
    // into (or vanish from) this formation.
    this.s.ballHolderId = this.s.live.carrier.id;
    this.s.liveResult = null;
    this.s.highlightDefender = -1;
    this.s.simAccumulator = 0;
    this.s.runDist.clear();
    this.s.lastPos.clear();
    // Reset per-down presentation state *before* the formation's first render so
    // a pass play that ended in a tackle (windows still open) never leaks its
    // throwing-QB / receiver-badge state into the next formation's idle actors.
    this.s.animClock.clear();
    this.s.animKind.clear();
    this.s.presentation.clear();
    this.s.windowsOpen = false;
    this.s.windowOpenPressConsumed = false;
    this.s.ballFlight = null;
    this.s.damagePopups = [];
    this.s.casualties = [];
    this.s.looseBall = null;
    // Reset the Ghoul Gas cloud with the other per-down presentation state: if the
    // previous down ended while gas was active, `liveElapsed` stays frozen through
    // the banner/PRE_SNAP, so a stale cloud would otherwise keep drawing over the
    // next formation until the snap (which resets it too).
    this.s.gasCloud = null;
    // Same for the throw-release window: a prior down's launch must not leave the
    // QB frozen in a wind-up while the next formation renders its idle stance.
    this.s.passingUntil = -1;
    // Capture the starting first-down target now; `snap()` mutates
    // `session.yardsToGo` when the result commits, which would otherwise drag the
    // amber line during the banner while the actors + LOS stay frozen. The
    // projector adds the 10-yard end-zone offset, so convert here as well.
    this.s.firstDownFieldX = this.s.liveLos + this.s.session.yardsToGo + 10;
  }

  beginLivePlay(): void {
    // The actor list is already built in `prepareLivePlay()` at pick time; only
    // the transient *runtime* state that accumulates during a live down is reset
    // here, then the sim clock starts.
    this.s.kickHoldMs = 0;
    this.s.kickLocked = null;
    this.s.kickCommitted = false;
    this.s.passHoldMs = 0;
    this.s.heldThrowKey = null;
    this.s.windowsOpen = false;
    this.s.windowOpenPressConsumed = false;
    this.s.cpuPassClock = 0;
    this.s.ballFlight = null;
    this.s.damagePopups = [];
    this.s.casualties = [];
    this.s.looseBall = null;
    // The center/QB holds the ball at the snap; presentation ownership reverts to
    // the live carrier until a pass launches it or a fumble knocks it loose.
    this.s.ballHolderId = this.s.live?.carrier.id ?? null;
    this.s.pendingHazardHits = [];
    this.s.liveElapsed = 0;
    this.s.nastySnap = null;
    this.s.gasCloud = null;
    this.s.passingUntil = -1;
    // Nasties are *selected* during PRE_SNAP (`session.callNasty`), after the pick
    // already primed the field effects at `prepareLivePlay()`. Reinitialize at snap
    // from the final pre-snap selection so a Dynamite Pitch arms its grenade count
    // and Hex/Shroud arm their timers instead of staying at their pick-time zeroes.
    this.s.nastyFields.begin(this.s.session.effects);
    // Entering the live down is part of building it: both the KeyC pre-snap path
    // and the e2e debug handle call `beginLivePlay()` directly, and both must land
    // in LIVE with a populated `this.s.live` (otherwise `updateLive` early-returns
    // forever and the whistle never fires).
    this.s.mode = 'LIVE';
    // CPU has the ball: P1 defends — start on the defender nearest the ball.
    if (this.s.live && cpuOnOffense(this.s.session)) assignDefaultDefender(this.s, this.s.live);
  }

  /**
   * Launch a pass throw to receiver A/B/C. Re-exported from `matchSim` so the
   * scene's debug handle surface (`commitPassTo`) can keep reaching it.
   */
  commitPass(target: 'A' | 'B' | 'C'): void {
    commitPass(this.s, target);
  }

  /** Route the update loop's mode switch into the correct state-machine handler. */
  updateMode(dt: number): void {
    switch (this.s.mode) {
      case 'PICK':
        this.updatePick();
        break;
      case 'PRE_SNAP':
        this.updatePreSnap();
        break;
      case 'LIVE':
        updateLive(this.s, dt);
        break;
      case 'BANNER':
        updateBanner(this.s, dt);
        break;
    }
  }
}
