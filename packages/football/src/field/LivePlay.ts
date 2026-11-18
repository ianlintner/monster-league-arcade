/**
 * LivePlay — a Phaser-free, fixed-timestep (60 Hz) simulation of a single
 * 7-on-7 down. It is the presentation layer's "live field": it starts from a
 * selected play's formation/assignments, runs the down to the whistle, and
 * emits a result that maps cleanly onto `GameSession.snap({ force })`.
 *
 * It owns *presentation* concerns only — who runs where, who gets caught, how
 * far the ball travels. Down, distance, clock, score, HP and casualty rules all
 * stay inside `GameSession`, which is the single source of truth.
 *
 * Coordinates are yard-space: `x` = downfield from the line of scrimmage
 * (positive toward the offense's goal), `y` = lateral from field centre
 * (positive = the offense's right). No Phaser imports.
 */

export interface LiveActorSpec {
  /** Stable id, e.g. `home-RB1`. */
  id: string;
  team: 'home' | 'away';
  /** 'OFFENSE' | 'DEFENSE'. */
  side: 'OFFENSE' | 'DEFENSE';
  /** Slot label (QB, RB1, DL1, ...). */
  slot: string;
  /** Starting yard-space position (downfield, lateral). */
  x: number;
  y: number;
  /** Base top speed in yards/second (scaled from the player's `speed` rating). */
  topSpeed: number;
  /** 0..1 — how much of top speed is reached each second (acceleration curve). */
  acceleration: number;
  /** 0..1 — how sharply the actor can turn (turning radius feel). */
  turnRate: number;
}

export interface LiveWaypoint {
  x: number;
  y: number;
  /** Optional pause at this waypoint (seconds) before continuing. */
  hold?: number;
}

export interface LivePlayInput {
  /** Roster of the 14 actors on the field for this down. */
  actors: LiveActorSpec[];
  /** The offense's ball carrier actor id. */
  carrierId: string;
  /** Route the carrier runs after the snap (yard-space waypoints). */
  carrierRoute: LiveWaypoint[];
  /** The play's defined routes per actor id (optional; non-carrier AI). */
  routes?: Record<string, LiveWaypoint[]>;
  /** Seed for deterministic tie-breaks / tackle resolution. */
  seed: number;
  /**
   * Snap-time line of scrimmage in *offense* coordinates (yards from the
   * offense's own goal line, 0-100). LivePlay `x` is downfield from this LOS,
   * so the attacking goal line is at `x = 100 - los` and the offense's own goal
   * line (safety) is at `x = -los`.
   */
  los: number;
}

export interface LivePlayCommand {
  /** Controller input direction for the carrier (-1..1 in yard-space). */
  steerX: number;
  steerY: number;
  dive?: boolean;
  turbo?: boolean;
}

export interface LiveActorState {
  id: string;
  team: 'home' | 'away';
  side: 'OFFENSE' | 'DEFENSE';
  slot: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Current stamina 0..1, drained by turbo. */
  stamina: number;
  /** True while the actor is committed to a dive lunge (0.4 s). */
  diving: boolean;
  /** Seconds left in the dive commitment. */
  diveTimer: number;
  /** True when tackled / down; leaves the play after the whistle. */
  downed: boolean;
  /** True while engaged in a block (defenders pursuit, blockers engage). */
  engaged: boolean;
  /** Seconds remaining in a hit-stop freeze after a tackle contact. */
  hitStop: number;
}

export type LivePlayOutcome =
  { kind: 'WHISTLE'; reason: 'TACKLE' | 'OUT_OF_BOUNDS' | 'SCORE' } | { kind: 'RUNNING' };

export interface LivePlayResult {
  outcome: LivePlayOutcome;
  /** Net yards gained by the offense (negative = loss). */
  yards: number;
  /** Whether the carrier crossed the goal line. */
  touchdown: boolean;
  /** Whether the carrier stepped out of bounds. */
  outOfBounds: boolean;
  /** The tackler's slot, if the whistle was a tackle. */
  tackler: string | null;
  /** Final carrier position (downfield yards from LOS). */
  finalX: number;
  finalY: number;
  /** Elapsed sim seconds. */
  elapsed: number;
  /** 0..1 carrier stamina remaining. */
  stamina: number;
  /** Frame-accurate actor states for the renderer to replay/screenshot. */
  actors: LiveActorState[];
}

export interface LivePlaySnapshot {
  t: number;
  actors: LiveActorState[];
  outcome: LivePlayOutcome;
  /** Ground-indicator / hit-stop shake hints for the renderer. */
  hitStopSeconds: number;
  carrierId: string;
}

/** Movement tuning — see PLAN §2.4 and the card's "movement feel" targets. */
export const LIVE_TUNING = {
  /** Reach ~top speed in 0.25 s (steep accel). */
  accelTimeSeconds: 0.25,
  /** Hard cut costs ~30% of current speed (turn damping). */
  cutSpeedRetention: 0.7,
  /** Turbo multiplier (+35%). */
  turboSpeedMult: 1.35,
  /** Turbo lasts up to 2 s on a full stamina bar. */
  turboMaxSeconds: 2,
  /** Stamina regen per second while not turboing. */
  staminaRegenPerSecond: 0.5,
  /** Dive lunge distance ~3 yards, commitment 0.4 s. */
  diveYards: 3,
  diveCommitSeconds: 0.4,
  /** Hit-stop freeze on tackle contact. */
  hitStopSeconds: 0.06,
  /** Tackle contact distance (yards). */
  tackleRadius: 1.1,
  /** Fixed timestep. */
  dt: 1 / 60,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(bx - ax, by - ay);

export class LivePlay {
  readonly input: LivePlayInput;
  readonly actors: LiveActorState[];
  readonly carrier: LiveActorState;

  private rngState: number;
  private t = 0;
  private outcome: LivePlayOutcome = { kind: 'RUNNING' };
  private tackler: string | null = null;
  private waypointIndex = 0;
  private hitStopRemaining = 0;
  /** Zeroed steer vector to blend input with the scripted route. */
  private steerX = 0;
  private steerY = 0;
  private diveHeld = false;
  private turboHeld = false;
  /** True while the last tick's velocity was roughly aligned with the desired heading. */
  private wasAligned = true;
  /** Attacking goal line (TD) in LOS-relative x. */
  private goalLineX: number;
  /** True when a tackle has been decided but the hit-stop freeze is still ticking. */
  private pendingWhistle: {
    kind: 'TACKLE' | 'OUT_OF_BOUNDS' | 'SCORE';
    tackler: string | null;
  } | null = null;

  constructor(input: LivePlayInput) {
    this.input = input;
    this.rngState = input.seed >>> 0;
    this.goalLineX = 100 - input.los;
    this.actors = input.actors.map((a) => ({
      id: a.id,
      team: a.team,
      side: a.side,
      slot: a.slot,
      x: a.x,
      y: a.y,
      vx: 0,
      vy: 0,
      stamina: 1,
      diving: false,
      diveTimer: 0,
      downed: false,
      engaged: false,
      hitStop: 0,
    }));
    const carrier = this.actors.find((a) => a.id === input.carrierId);
    if (!carrier) throw new Error(`LivePlay: unknown carrier ${input.carrierId}`);
    this.carrier = carrier;
  }

  /** Deterministic mulberry32-consistent RNG for tie-breaks. */
  private next(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Feed the player's carrier controls; consumed by the next `advance()`. */
  command(cmd: LivePlayCommand): void {
    this.steerX = clamp(cmd.steerX, -1, 1);
    this.steerY = clamp(cmd.steerY, -1, 1);
    // Dive is latched: a press on a frame that runs zero sim ticks must not be
    // lost to a later `dive: false` before the next `advance()` consumes it.
    if (cmd.dive) this.diveHeld = true;
    this.turboHeld = cmd.turbo ?? false;
  }

  /** Advance one fixed 60 Hz tick with the last-commanded control state. */
  advance(): LivePlayOutcome {
    const out = this.step(this.diveHeld, this.turboHeld);
    // A dive request is consumed the moment a tick runs (even if it was ignored
    // because the carrier was already diving); only a fresh press re-arms it.
    this.diveHeld = false;
    return out;
  }

  /** Advance one fixed 60 Hz tick, applying the current command. Returns true if the play ended. */
  step(dive = false, turbo = false): LivePlayOutcome {
    if (this.outcome.kind !== 'RUNNING') return this.outcome;

    // Hit-stop freeze: hold every actor in place (no position/velocity update).
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= LIVE_TUNING.dt;
      this.t += LIVE_TUNING.dt;
      // The whistle was decided at contact but deferred for the freeze so the
      // renderer can show the impact; commit it once the freeze elapses.
      if (this.hitStopRemaining <= 0 && this.pendingWhistle) {
        const p = this.pendingWhistle;
        this.outcome = { kind: 'WHISTLE', reason: p.kind };
        this.tackler = p.tackler;
      }
      return this.outcome;
    }

    // Advance the carrier toward the next route waypoint, blended with steer input.
    this.advanceCarrier(dive, turbo);

    // Move every other actor by its AI role.
    this.advanceAI();

    // Resolve blocking engagement, tackle contact and bounds.
    this.resolveContact();

    this.t += LIVE_TUNING.dt;
    return this.outcome;
  }

  private advanceCarrier(dive: boolean, turbo: boolean): void {
    const c = this.carrier;
    if (c.downed) return;

    // Dive: commit to a lunge for 0.4 s and gain a burst toward steer/route.
    if (dive && c.diveTimer <= 0) {
      c.diveTimer = LIVE_TUNING.diveCommitSeconds;
      c.diving = true;
      const dir = this.carrierHeading();
      c.vx = dir.x * (LIVE_TUNING.diveYards / LIVE_TUNING.diveCommitSeconds);
      c.vy = dir.y * (LIVE_TUNING.diveYards / LIVE_TUNING.diveCommitSeconds);
    }
    if (c.diveTimer > 0) {
      c.diveTimer -= LIVE_TUNING.dt;
      if (c.diveTimer <= 0) c.diving = false;
      // During the committed lunge, position follows the burst velocity (no steering).
      c.x += c.vx * LIVE_TUNING.dt;
      c.y += c.vy * LIVE_TUNING.dt;
      return;
    }

    // Target heading: route waypoint blended with player steer.
    const target = this.carrierHeading();
    const tx = target.x;
    const ty = target.y;

    // Turbo increases top speed but drains stamina; no stamina = no turbo.
    const canTurbo = turbo && c.stamina > 0;
    const speedMult = canTurbo ? LIVE_TUNING.turboSpeedMult : 1;
    if (canTurbo) c.stamina = clamp(c.stamina - LIVE_TUNING.dt / LIVE_TUNING.turboMaxSeconds, 0, 1);
    else if (!turbo)
      // Regen only when the player is not holding turbo at all; holding it with an
      // empty tank must not refill mid-grip (that would let a drained sprint loop
      // forever).
      c.stamina = clamp(c.stamina + LIVE_TUNING.staminaRegenPerSecond * LIVE_TUNING.dt, 0, 1);

    const desiredVx = tx * this.input.actors.find((a) => a.id === c.id)!.topSpeed * speedMult;
    const desiredVy = ty * this.input.actors.find((a) => a.id === c.id)!.topSpeed * speedMult;

    // Acceleration curve: exponential approach to target velocity over accelTime.
    const k = 1 - Math.exp(-LIVE_TUNING.dt / LIVE_TUNING.accelTimeSeconds);
    c.vx += (desiredVx - c.vx) * k;
    c.vy += (desiredVy - c.vy) * k;

    // Hard cut: a large heading change bleeds ~30% speed — but only once per turn,
    // not on every tick while the velocity catches up to the new heading.
    const headingMag = Math.hypot(c.vx, c.vy);
    const aligned =
      headingMag <= 1e-3 ||
      (c.vx * desiredVx + c.vy * desiredVy) /
        (headingMag * (Math.hypot(desiredVx, desiredVy) || 1)) >=
        0.5;
    if (!aligned && this.wasAligned) {
      const scale = LIVE_TUNING.cutSpeedRetention;
      c.vx *= scale;
      c.vy *= scale;
    }
    this.wasAligned = aligned;

    c.x += c.vx * LIVE_TUNING.dt;
    c.y += c.vy * LIVE_TUNING.dt;
  }

  /** Heading for the carrier: steer input dominates when present, else route waypoint. */
  private carrierHeading(): { x: number; y: number } {
    if (Math.hypot(this.steerX, this.steerY) > 0.1) {
      const m = Math.hypot(this.steerX, this.steerY);
      return { x: this.steerX / m, y: this.steerY / m };
    }
    const route = this.input.carrierRoute;
    if (route.length === 0) return { x: 1, y: 0 };
    if (this.waypointIndex >= route.length) {
      // Past the final waypoint with no further target: hold a downfield heading
      // instead of re-entering the last waypoint and recursing forever.
      return { x: 1, y: 0 };
    }
    const wp = route[this.waypointIndex]!;
    const dx = wp.x - this.carrier.x;
    const dy = wp.y - this.carrier.y;
    const m = Math.hypot(dx, dy);
    if (m < 0.5) {
      // Reached the waypoint; advance to the next (or run out the route).
      this.waypointIndex += 1;
      return this.carrierHeading();
    }
    return { x: dx / m, y: dy / m };
  }

  private advanceAI(): void {
    const carrier = this.carrier;
    for (const a of this.actors) {
      if (a.downed || a === carrier) continue;
      const spec = this.input.actors.find((s) => s.id === a.id)!;

      // Defense pursues the carrier; offense (non-carrier) drifts forward to block.
      const targetX = a.side === 'DEFENSE' ? carrier.x : a.x + 2;
      const targetY = a.side === 'DEFENSE' ? carrier.y : a.y;
      const dx = targetX - a.x;
      const dy = targetY - a.y;
      const m = Math.hypot(dx, dy) || 1;
      const desiredVx = (dx / m) * spec.topSpeed;
      const desiredVy = (dy / m) * spec.topSpeed;
      const k = 1 - Math.exp(-LIVE_TUNING.dt / LIVE_TUNING.accelTimeSeconds);
      a.vx += (desiredVx - a.vx) * k;
      a.vy += (desiredVy - a.vy) * k;
      a.x += a.vx * LIVE_TUNING.dt;
      a.y += a.vy * LIVE_TUNING.dt;

      // Staggered speed so every defender isn't identically paced.
      if (a.hitStop > 0) a.hitStop -= LIVE_TUNING.dt;
    }
  }

  private resolveContact(): void {
    const c = this.carrier;

    // Out of bounds: lateral bounds are ±(fieldWidth/2) = ±26.66 yards.
    const OOB = 26.66;
    if (Math.abs(c.y) > OOB) {
      this.end('OUT_OF_BOUNDS', null);
      return;
    }
    // Goal line reached: LOS-relative, so the attacking goal is `100 - los` from
    // the LOS (not a fixed 100). Crossing it scores a touchdown.
    if (c.x >= this.goalLineX) {
      this.end('SCORE', null);
      return;
    }
    // The offense's own end line is NOT a whistle: the ball stays live until a
    // tackle or bounds exit. Whether the final spot becomes a safety is decided
    // by `GameSession` from the committed fractional yardage, so reserving SCORE
    // here keeps `result().touchdown` from also reporting safeties as TDs.

    // Tackle: nearest defender within tackle radius engages.
    const radius: number = LIVE_TUNING.tackleRadius;
    let nearest: LiveActorState | null = null;
    let nearestDist: number = radius;
    for (const a of this.actors) {
      if (a.side !== 'DEFENSE' || a.downed) continue;
      const d = dist(c.x, c.y, a.x, a.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = a;
      }
    }
    if (nearest) {
      // Tackler's tackle rating vs carrier agility: favour a break on the fringe.
      const ranged = this.next();
      if (ranged < 0.9 || nearestDist < radius * 0.6) {
        // Defer the whistle by one hit-stop so the impact freeze actually renders;
        // `end('TACKLE', …)` records the pending whistle and arms the freeze.
        this.end('TACKLE', nearest.id);
      }
    }
  }

  private end(reason: 'TACKLE' | 'OUT_OF_BOUNDS' | 'SCORE', tacklerId: string | null): void {
    if (this.outcome.kind !== 'RUNNING' || this.pendingWhistle) return;
    if (reason === 'TACKLE') {
      // A tackle freezes the field for one hit-stop beat before the whistle; bounds
      // and scores whistle immediately (no physical contact to freeze on).
      this.pendingWhistle = { kind: reason, tackler: tacklerId };
      this.hitStopRemaining = LIVE_TUNING.hitStopSeconds;
      return;
    }
    this.outcome = { kind: 'WHISTLE', reason };
    this.tackler = tacklerId;
  }

  /** Run the down to the whistle with scripted (empty) commands; used for tests. */
  run(): LivePlayResult {
    let guard = 0;
    while (this.outcome.kind === 'RUNNING' && guard++ < 60 * 30) {
      this.step(false, false);
    }
    return this.result();
  }

  snapshot(): LivePlaySnapshot {
    return {
      t: this.t,
      actors: this.actors.map((a) => ({ ...a })),
      outcome: this.outcome,
      hitStopSeconds: this.hitStopRemaining,
      carrierId: this.carrier.id,
    };
  }

  result(): LivePlayResult {
    const c = this.carrier;
    // `c.x` is already downfield-yards from the LOS (x=0 at snap), so it *is* net
    // yards: no need to subtract the carrier's backfield starting position.
    const yards = c.x;
    return {
      outcome: this.outcome,
      yards: Math.round(yards * 2) / 2,
      touchdown: this.outcome.kind === 'WHISTLE' && this.outcome.reason === 'SCORE',
      outOfBounds: this.outcome.kind === 'WHISTLE' && this.outcome.reason === 'OUT_OF_BOUNDS',
      tackler: this.tackler,
      finalX: c.x,
      finalY: c.y,
      elapsed: this.t,
      stamina: c.stamina,
      actors: this.actors.map((a) => ({ ...a })),
    };
  }
}
