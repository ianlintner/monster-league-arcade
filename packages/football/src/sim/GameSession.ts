import {
  CRYPT_BLITZ_MULT,
  DYNAMITE_GRENADES,
  GAS_POISON_DAMAGE,
  GRENADE_DAMAGE,
  NastyCharges,
  PUMPKIN_BLAST_DAMAGE,
  computeEffects,
} from './DirtyTricks';
import type { NastyEffects } from './DirtyTricks';
import { AudibleController, NASTY_SIDE, getDefensePlay, getOffensePlay } from './Playbook';
import type { AudibleSelection, Button, NastyKind } from './Playbook';
import { Referee, makePenalty, opponentOf } from './Referee';
import type { Penalty } from './Referee';
import { Rng } from './Rng';
import { CARNAGE_LIMIT, DEFENSE_SLOTS, TeamRoster } from './Roster';
import type { DamageSource, DefenseSlot, Faction, OffenseSlot, Side, Slot, TeamId } from './Roster';

export type Phase =
  | 'COIN_TOSS'
  | 'KICKOFF'
  | 'HUDDLE_PLAYCALL'
  | 'PRE_SNAP'
  | 'LIVE_PLAY'
  | 'PLAY_OVER_BANNER'
  | 'EXTRA_POINT'
  | 'QUARTER_END'
  | 'HALFTIME'
  | 'GAME_OVER';

export type EndReason = 'SCORE' | 'TIE' | 'FORFEIT_BY_CARNAGE';

export interface GameConfig {
  seed: number;
  /** Seconds per quarter (arcade: 120-180). */
  quarterSeconds: number;
  playClockSeconds: number;
  timeoutsPerHalf: number;
  homeFaction: Faction;
  awayFaction: Faction;
}

export const DEFAULT_CONFIG: GameConfig = {
  seed: 1993,
  quarterSeconds: 150,
  playClockSeconds: 25,
  timeoutsPerHalf: 3,
  homeFaction: 'REAPERS',
  awayFaction: 'DEADSKINS',
};

export const FIELD_LENGTH = 100;
export const ENDZONE_LENGTH = 10;
export const YARDS_FOR_FIRST_DOWN = 10;
export const POINTS = {
  TOUCHDOWN: 6,
  EXTRA_KICK: 1,
  CONVERSION: 2,
  FIELD_GOAL: 3,
  SAFETY: 2,
} as const;
export const DELAY_OF_GAME_YARDS = 5;
/** Seconds burned by a snap-to-whistle play and by the unstopped clock between plays. */
export const PLAY_SECONDS = 6;
export const STOPPED_PLAY_SECONDS = 3;
export const RUNOFF_SECONDS = 10;

export interface Score {
  home: number;
  away: number;
}

export interface CasualtyEvent {
  team: TeamId;
  slot: Slot;
  side: Side;
  playerId: string;
  name: string;
  replacementId: string | null;
  source: DamageSource;
  /** Victim was carrying the ball and dropped it. */
  fumbled: boolean;
}

export interface DamageEvent {
  team: TeamId;
  slot: Slot;
  playerId: string;
  dealt: number;
  hp: number;
  source: DamageSource;
}

export interface HazardHit {
  team: TeamId;
  side: Side;
  slot: Slot;
  amount: number;
  source?: DamageSource;
}

export type PlayKind =
  | 'RUN'
  | 'PASS_COMPLETE'
  | 'PASS_INCOMPLETE'
  | 'SACK'
  | 'INTERCEPTION'
  | 'PUNT'
  | 'FIELD_GOAL'
  | 'FORFEIT';

export interface AppliedPenalty extends Penalty {
  appliedYards: number;
}

export interface PlayResult {
  playNumber: number;
  kind: PlayKind;
  offense: TeamId;
  defense: TeamId;
  offensePlayId: string;
  defensePlayId: string;
  /** Net yards gained by the offense (negative = loss). */
  yards: number;
  down: number;
  yardsToGo: number;
  touchdown: boolean;
  safety: boolean;
  touchback: boolean;
  firstDown: boolean;
  turnover: boolean;
  turnoverOnDowns: boolean;
  fumble: boolean;
  fieldGoalGood: boolean;
  scoringTeam: TeamId | null;
  points: number;
  damage: DamageEvent[];
  casualties: CasualtyEvent[];
  penalties: AppliedPenalty[];
  effects: NastyEffects;
  /** Nasties that were active but invalid for the called play. */
  fizzled: NastyKind[];
  refKilled: boolean;
  banner: string;
}

export interface SnapOptions {
  /** Which of the pass targets (A/B/C) the QB throws to. */
  target?: 'A' | 'B' | 'C';
  /** Live-play hazard / weapon hits supplied by the presentation layer. */
  hazards?: HazardHit[];
  /** Deterministic overrides, primarily for tests and replays. */
  force?: {
    yards?: number;
    complete?: boolean;
    intercepted?: boolean;
    sacked?: boolean;
    fumble?: boolean;
    tackleDamage?: number;
    fieldGoalGood?: boolean;
    puntYards?: number;
    refKilled?: boolean;
  };
}

export type NastyRejection =
  | 'WRONG_PHASE'
  | 'NO_PLAY_SELECTED'
  | 'ALREADY_USED_THIS_HALF'
  | 'WRONG_SIDE'
  | 'WRONG_PLAY_TYPE'
  | 'DEMON_REF_PRESENT';

export type NastyResult =
  { ok: true; effects: NastyEffects } | { ok: false; reason: NastyRejection };

interface RawPlay {
  kind: PlayKind;
  gain: number;
  fumble: boolean;
  carrier: OffenseSlot | null;
  intercepted: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class GameSession {
  readonly cfg: GameConfig;
  readonly rng: Rng;
  readonly roster: Record<TeamId, TeamRoster>;
  readonly charges = new NastyCharges();
  readonly ref = new Referee();

  phase: Phase = 'COIN_TOSS';
  quarter = 1;
  clock: number;
  playClock: number;
  clockRunning = false;
  readonly score: Score = { home: 0, away: 0 };
  readonly timeouts: Record<TeamId, number>;

  possession: TeamId = 'home';
  /** Line of scrimmage, yards from the offense's own goal line (0-100). */
  los = 25;
  down = 1;
  yardsToGo = YARDS_FOR_FIRST_DOWN;
  playNumber = 0;

  winner: TeamId | null = null;
  endReason: EndReason | null = null;
  forfeitLoser: TeamId | null = null;
  lastResult: PlayResult | null = null;

  private receiver: TeamId = 'away';
  private openingReceiver: TeamId = 'away';
  private offensePlayId: string | null = null;
  private defensePlayId: string | null = null;
  private active: { team: TeamId; kind: NastyKind }[] = [];
  private nextPhase: Phase = 'HUDDLE_PLAYCALL';
  private clockExpired = false;
  private resumeAfterPeriod: Phase = 'HUDDLE_PLAYCALL';
  private pendingCasualties: CasualtyEvent[] = [];
  private pendingDamage: DamageEvent[] = [];
  private carrier: { team: TeamId; slot: Slot } | null = null;
  private carrierFumbled = false;

  constructor(config: Partial<GameConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.rng = new Rng(this.cfg.seed);
    this.roster = {
      home: new TeamRoster('home', this.cfg.homeFaction, this.rng),
      away: new TeamRoster('away', this.cfg.awayFaction, this.rng),
    };
    this.clock = this.cfg.quarterSeconds;
    this.playClock = this.cfg.playClockSeconds;
    this.timeouts = { home: this.cfg.timeoutsPerHalf, away: this.cfg.timeoutsPerHalf };
  }

  get half(): 1 | 2 {
    return this.quarter <= 2 ? 1 : 2;
  }
  get defense(): TeamId {
    return opponentOf(this.possession);
  }
  get effects(): NastyEffects {
    return computeEffects(this.validActive().valid);
  }

  private requirePhase(...phases: Phase[]): void {
    if (!phases.includes(this.phase)) throw new Error(`Invalid in phase ${this.phase}`);
  }

  // ---------------------------------------------------------------- opening

  coinToss(receiver: TeamId): void {
    this.requirePhase('COIN_TOSS');
    this.receiver = receiver;
    this.openingReceiver = receiver;
    this.phase = 'KICKOFF';
  }

  /** Receiving team takes over after the kick: touchback to the 25 or a return. */
  kickoff(opts: { touchback?: boolean; returnTo?: number } = {}): void {
    this.requirePhase('KICKOFF');
    const touchback = opts.touchback ?? this.rng.chance(0.45);
    this.possession = this.receiver;
    this.los = touchback ? 25 : (opts.returnTo ?? this.rng.int(15, 40));
    this.down = 1;
    this.yardsToGo = YARDS_FOR_FIRST_DOWN;
    this.beginHuddle();
  }

  private beginHuddle(): void {
    this.offensePlayId = null;
    this.defensePlayId = null;
    this.playClock = this.cfg.playClockSeconds;
    this.phase = 'HUDDLE_PLAYCALL';
  }

  // ---------------------------------------------------------------- pre-snap

  selectPlays(offensePlayId: string, defensePlayId: string): void {
    this.requirePhase('HUDDLE_PLAYCALL');
    getOffensePlay(offensePlayId);
    getDefensePlay(defensePlayId);
    this.offensePlayId = offensePlayId;
    this.defensePlayId = defensePlayId;
    this.phase = 'PRE_SNAP';
  }

  /** Genesis audible combo: `A -> A/B` swaps the play; `A -> C -> A/B/C` fires a Nasty Audible. */
  audible(team: TeamId, buttons: Button[]): AudibleSelection | null {
    this.requirePhase('PRE_SNAP');
    const side: Side = team === this.possession ? 'OFFENSE' : 'DEFENSE';
    const playId = side === 'OFFENSE' ? this.offensePlayId : this.defensePlayId;
    if (!playId) throw new Error('No play selected');
    const kind = side === 'OFFENSE' ? getOffensePlay(playId).kind : null;
    const ctl = new AudibleController(side, playId, kind);
    let sel: AudibleSelection | null = null;
    for (const b of buttons) sel = ctl.press(b) ?? sel;
    if (sel?.kind === 'STANDARD') {
      if (side === 'OFFENSE') this.offensePlayId = sel.playId;
      else this.defensePlayId = sel.playId;
    } else if (sel?.kind === 'NASTY') {
      this.callNasty(team, sel.nasty);
    }
    return sel;
  }

  /** Spend a once-per-half Nasty Audible charge (including Bribe Ref / Kill Ref). */
  callNasty(team: TeamId, kind: NastyKind): NastyResult {
    if (this.phase !== 'PRE_SNAP')
      return {
        ok: false,
        reason: this.phase === 'HUDDLE_PLAYCALL' ? 'NO_PLAY_SELECTED' : 'WRONG_PHASE',
      };
    const need = NASTY_SIDE[kind];
    const mySide: Side = team === this.possession ? 'OFFENSE' : 'DEFENSE';
    if (need !== 'ANY' && need !== mySide) return { ok: false, reason: 'WRONG_SIDE' };
    if ((kind === 'BRIBE_REF' || kind === 'KILL_REF') && this.ref.kind === 'DEMON_REF') {
      return { ok: false, reason: 'DEMON_REF_PRESENT' };
    }
    if (!this.charges.available(team, kind, this.half))
      return { ok: false, reason: 'ALREADY_USED_THIS_HALF' };
    this.charges.consume(team, kind, this.half);
    if (kind === 'BRIBE_REF') this.ref.bribe(team);
    else if (kind === 'KILL_REF') this.ref.startHunt(team);
    else this.active.push({ team, kind });
    return { ok: true, effects: this.effects };
  }

  /** Active Nasties filtered to those valid for the currently selected plays. */
  private validActive(): { valid: NastyKind[]; fizzled: NastyKind[] } {
    const play = this.offensePlayId ? getOffensePlay(this.offensePlayId) : null;
    const valid: NastyKind[] = [];
    const fizzled: NastyKind[] = [];
    for (const { kind } of this.active) {
      const bad =
        (kind === 'PUMPKIN_BOMB_PASS' && play?.kind !== 'PASS') ||
        (kind === 'DYNAMITE_PITCH' && play?.kind !== 'RUN') ||
        ((kind === 'BAT_WING_JET_BOOST' || kind === 'GHOUL_GAS') &&
          (play?.kind === 'PUNT' || play?.kind === 'FIELD_GOAL')) ||
        (kind === 'QB_CRYPT_BLITZ' && (play?.kind === 'PUNT' || play?.kind === 'FIELD_GOAL'));
      (bad ? fizzled : valid).push(kind);
    }
    return { valid, fizzled };
  }

  callTimeout(team: TeamId): boolean {
    if (this.phase !== 'HUDDLE_PLAYCALL' && this.phase !== 'PRE_SNAP') return false;
    if (this.timeouts[team] <= 0) return false;
    this.timeouts[team] -= 1;
    this.clockRunning = false;
    this.playClock = this.cfg.playClockSeconds;
    return true;
  }

  /** Tick the 25-second play clock; expiry costs the offense 5 yards (Delay of Game). */
  tickPlayClock(seconds: number): Penalty | null {
    if (this.phase !== 'HUDDLE_PLAYCALL' && this.phase !== 'PRE_SNAP') return null;
    this.playClock -= seconds;
    if (this.playClock > 0) return null;
    this.playClock = this.cfg.playClockSeconds;
    const p = makePenalty('DELAY_OF_GAME', this.possession, DELAY_OF_GAME_YARDS, 'Delay of Game');
    this.applyPenalty(p);
    return p;
  }

  // -------------------------------------------------------------------- snap

  /** Snap the ball and resolve the whole play; leaves the session in PLAY_OVER_BANNER (or GAME_OVER). */
  snap(opts: SnapOptions = {}): PlayResult {
    this.requirePhase('PRE_SNAP');
    if (!this.offensePlayId || !this.defensePlayId) throw new Error('No play selected');
    const off = getOffensePlay(this.offensePlayId);
    const def = getDefensePlay(this.defensePlayId);
    const offense = this.possession;
    const defense = this.defense;
    const force = opts.force ?? {};
    const { valid, fizzled } = this.validActive();
    const fx = computeEffects(valid);
    const has = (k: NastyKind): boolean => valid.includes(k);

    this.phase = 'LIVE_PLAY';
    this.playNumber += 1;
    this.pendingCasualties = [];
    this.pendingDamage = [];
    this.carrierFumbled = false;
    if (this.clockRunning) this.clock = Math.max(1, this.clock - RUNOFF_SECONDS);

    const startDown = this.down;
    const startToGo = this.yardsToGo;
    const startLos = this.los;
    const res: PlayResult = {
      playNumber: this.playNumber,
      kind: 'RUN',
      offense,
      defense,
      offensePlayId: off.id,
      defensePlayId: def.id,
      yards: 0,
      down: startDown,
      yardsToGo: startToGo,
      touchdown: false,
      safety: false,
      touchback: false,
      firstDown: false,
      turnover: false,
      turnoverOnDowns: false,
      fumble: false,
      fieldGoalGood: false,
      scoringTeam: null,
      points: 0,
      damage: [],
      casualties: [],
      penalties: [],
      effects: fx,
      fizzled,
      refKilled: false,
      banner: '',
    };

    // ---- special teams
    if (off.kind === 'PUNT' || off.kind === 'FIELD_GOAL') {
      this.resolveKick(off.kind, res, force);
      return this.finishPlay(res, startLos);
    }

    // ---- scrimmage plays
    const raw = this.rawPlay(off, def, fx, has, opts);
    res.kind = raw.kind;
    this.carrier = raw.carrier ? { team: offense, slot: raw.carrier } : null;

    // Live-play hazard / weapon hits (may kill the ball carrier).
    for (const h of opts.hazards ?? []) {
      this.inflictDamage(h.team, h.side, h.slot, h.amount, h.source ?? 'HAZARD');
      if (this.winner !== null) return this.finishForfeit(res);
    }
    if (this.carrierFumbled) raw.fumble = true;

    // Nasty weapons resolved against the defenders.
    if (has('DYNAMITE_PITCH') && raw.kind === 'RUN') {
      for (let i = 0; i < DYNAMITE_GRENADES; i++) {
        this.inflictDamage(
          defense,
          'DEFENSE',
          this.rng.pick(DEFENSE_SLOTS),
          GRENADE_DAMAGE,
          'WEAPON',
        );
        if (this.winner !== null) return this.finishForfeit(res);
      }
    }
    if (has('GHOUL_GAS') && (raw.kind === 'RUN' || raw.kind === 'PASS_COMPLETE')) {
      for (const slot of this.pickDefenders(2)) {
        this.inflictDamage(defense, 'DEFENSE', slot, GAS_POISON_DAMAGE, 'POISON');
        if (this.winner !== null) return this.finishForfeit(res);
      }
    }
    if (has('PUMPKIN_BOMB_PASS') && (raw.kind === 'PASS_COMPLETE' || raw.kind === 'INTERCEPTION')) {
      this.pumpkinBlast(raw, offense, defense, opts.target);
      if (this.winner !== null) return this.finishForfeit(res);
    }

    // QB takes the Crypt Blitz hit (+50%) on every pass play; sacks hurt on any blitz.
    if (off.kind === 'PASS') {
      const hit =
        this.rng.int(6, 12) *
        (raw.kind === 'SACK' ? 1.5 : 1) *
        (has('QB_CRYPT_BLITZ') ? CRYPT_BLITZ_MULT : 1);
      if (raw.kind === 'SACK' || has('QB_CRYPT_BLITZ')) {
        this.inflictDamage(offense, 'OFFENSE', 'QB', hit, 'TACKLE');
        if (this.winner !== null) return this.finishForfeit(res);
        if (this.carrierFumbled && raw.carrier === 'QB') raw.fumble = true;
      }
    }

    // Ball movement.
    const newLos = startLos + raw.gain;
    if (raw.intercepted) {
      this.resolveInterception(res, startLos, raw.gain);
    } else if (newLos >= FIELD_LENGTH) {
      res.touchdown = true;
      res.yards = FIELD_LENGTH - startLos;
      this.score[offense] += POINTS.TOUCHDOWN;
      res.scoringTeam = offense;
      res.points = POINTS.TOUCHDOWN;
      this.los = FIELD_LENGTH;
    } else if (newLos <= 0) {
      res.safety = true;
      res.yards = -startLos;
      this.score[defense] += POINTS.SAFETY;
      res.scoringTeam = defense;
      res.points = POINTS.SAFETY;
      this.los = 0;
    } else {
      res.yards = raw.gain;
      this.los = Math.round(newLos * 10) / 10;
      // Tackle damage on the ball carrier (not on scores).
      if (
        raw.carrier &&
        (raw.kind === 'RUN' || raw.kind === 'PASS_COMPLETE' || raw.kind === 'SACK')
      ) {
        const base =
          force.tackleDamage ?? this.rng.int(6, 14) * (1 + this.avgTackle(defense) / 200);
        const mult = has('BAT_WING_JET_BOOST') && raw.kind !== 'SACK' ? fx.carrierDamageMult : 1;
        this.inflictDamage(offense, 'OFFENSE', raw.carrier, base * mult, 'TACKLE');
        if (this.winner !== null) return this.finishForfeit(res);
        if (this.carrierFumbled) raw.fumble = true;
      }
      if (raw.fumble) {
        res.fumble = true;
        // A lethal hit leaves the defense with the ball; ordinary fumbles are a coin flip.
        const lost =
          this.carrierFumbled || force.fumble !== undefined ? true : this.rng.chance(0.5);
        if (lost) {
          res.turnover = true;
          this.flipPossession(FIELD_LENGTH - this.los);
        }
      }
    }
    if (!res.touchdown && !res.safety && !res.turnover) this.advanceDown(res, startDown, startToGo);
    return this.finishPlay(res, startLos);
  }

  private avgTackle(team: TeamId): number {
    const act = this.roster[team].active;
    return act.reduce((s, p) => s + p.tackle, 0) / Math.max(1, act.length);
  }

  private pickDefenders(n: number): DefenseSlot[] {
    return Array.from({ length: n }, () => this.rng.pick(DEFENSE_SLOTS));
  }

  private rawPlay(
    off: ReturnType<typeof getOffensePlay>,
    def: ReturnType<typeof getDefensePlay>,
    fx: NastyEffects,
    has: (k: NastyKind) => boolean,
    opts: SnapOptions,
  ): RawPlay {
    const force = opts.force ?? {};
    const offense = this.roster[this.possession];
    const hex = has('HEX_OF_CONFUSION');
    const shroud = has('PHANTOM_SHROUD');
    const boost = (g: number): number =>
      (g > 0 ? g * fx.carrierSpeedMult : g) +
      (has('GHOUL_GAS') ? 2 : 0) +
      (has('DYNAMITE_PITCH') ? DYNAMITE_GRENADES : 0);
    const fumbleChance = has('BAT_WING_JET_BOOST') ? 0 : off.risk * 0.5 + (hex ? 0.04 : 0);

    if (off.kind === 'RUN') {
      let g = off.avgYards * (1.2 - def.runStop * 0.5) + (this.rng.next() * 2 - 1) * off.spread;
      if (hex) g *= 0.7;
      if (shroud) g *= 0.85;
      const gain = force.yards ?? Math.round(Math.max(-3, boost(g)));
      return {
        kind: 'RUN',
        gain,
        fumble: force.fumble ?? this.rng.chance(fumbleChance),
        carrier: off.carrier as OffenseSlot,
        intercepted: false,
      };
    }

    // Pass play.
    const qb = offense.player('OFFENSE', 'QB');
    const sackChance = clamp(
      0.04 + def.pressure * 0.2 + (has('QB_CRYPT_BLITZ') ? 0.25 : 0),
      0,
      0.7,
    );
    const sacked = force.sacked ?? this.rng.chance(sackChance);
    if (sacked) {
      const loss = force.yards ?? -this.rng.int(4, 9);
      return {
        kind: 'SACK',
        gain: loss,
        fumble: force.fumble ?? false,
        carrier: 'QB',
        intercepted: false,
      };
    }
    let p = off.completion + (qb.accuracy - 65) * 0.004 - (def.passCover - 0.5) * 0.35;
    if (shroud) p -= 0.12;
    if (hex) p -= 0.15;
    const complete = force.complete ?? this.rng.chance(clamp(p, 0.05, 0.92));
    const air = Math.round(Math.max(1, off.avgYards + (this.rng.next() * 2 - 1) * off.spread));
    if (complete) {
      const slot = off.receivers[opts.target ?? 'A'] ?? (off.carrier as OffenseSlot);
      return {
        kind: 'PASS_COMPLETE',
        gain: force.yards ?? Math.round(boost(air)),
        fumble: force.fumble ?? this.rng.chance(fumbleChance),
        carrier: slot as OffenseSlot,
        intercepted: false,
      };
    }
    const intChance = clamp(0.04 + def.passCover * 0.06 + off.risk * 0.5, 0.02, 0.4);
    const intercepted = force.intercepted ?? this.rng.chance(intChance);
    if (intercepted)
      return {
        kind: 'INTERCEPTION',
        gain: force.yards ?? air,
        fumble: false,
        carrier: null,
        intercepted: true,
      };
    return { kind: 'PASS_INCOMPLETE', gain: 0, fumble: false, carrier: null, intercepted: false };
  }

  private pumpkinBlast(
    raw: RawPlay,
    offense: TeamId,
    defense: TeamId,
    target: 'A' | 'B' | 'C' | undefined,
  ): void {
    void target;
    if (raw.kind === 'PASS_COMPLETE' && raw.carrier) {
      // Rigged ball detonates on the catch: receiver takes half, nearby defenders full.
      this.inflictDamage(offense, 'OFFENSE', raw.carrier, PUMPKIN_BLAST_DAMAGE / 2, 'EXPLOSION');
      for (const slot of this.pickDefenders(2))
        this.inflictDamage(defense, 'DEFENSE', slot, PUMPKIN_BLAST_DAMAGE, 'EXPLOSION');
      if (this.carrierFumbled) raw.fumble = true;
    } else if (raw.kind === 'INTERCEPTION') {
      // Intercepting defender holds the bomb; two chasing offensive players are caught in the blast.
      this.inflictDamage(
        defense,
        'DEFENSE',
        this.rng.pick(['DB1', 'DB2'] as const),
        PUMPKIN_BLAST_DAMAGE / 2,
        'EXPLOSION',
      );
      const offSlots: OffenseSlot[] = ['QB', 'RB1', 'RB2/WR', 'WR/TE'];
      for (let i = 0; i < 2; i++)
        this.inflictDamage(
          offense,
          'OFFENSE',
          this.rng.pick(offSlots),
          PUMPKIN_BLAST_DAMAGE,
          'EXPLOSION',
        );
    }
  }

  private resolveInterception(res: PlayResult, startLos: number, air: number): void {
    res.turnover = true;
    const spotOff = startLos + air; // offense coordinates
    if (spotOff >= FIELD_LENGTH) {
      res.touchback = true;
      this.flipPossession(20);
    } else {
      res.yards = 0;
      this.flipPossession(FIELD_LENGTH - spotOff);
    }
  }

  private resolveKick(
    kind: 'PUNT' | 'FIELD_GOAL',
    res: PlayResult,
    force: NonNullable<SnapOptions['force']>,
  ): void {
    const offense = this.possession;
    const defense = this.defense;
    res.kind = kind;
    this.clockRunning = false;
    if (kind === 'PUNT') {
      const dist = force.puntYards ?? this.rng.int(34, 50);
      const landing = this.los + dist;
      res.turnover = true;
      if (landing >= FIELD_LENGTH) {
        res.touchback = true;
        this.flipPossession(20);
      } else {
        this.flipPossession(clamp(FIELD_LENGTH - landing + this.rng.int(0, 8), 1, 99));
      }
      return;
    }
    const dist = FIELD_LENGTH - this.los + 17;
    const make = clamp(0.97 - Math.max(0, dist - 30) * 0.018, 0.05, 0.97);
    const good = force.fieldGoalGood ?? this.rng.chance(make);
    if (good) {
      res.fieldGoalGood = true;
      this.score[offense] += POINTS.FIELD_GOAL;
      res.scoringTeam = offense;
      res.points = POINTS.FIELD_GOAL;
      this.receiver = defense;
      this.nextPhase = 'KICKOFF';
    } else {
      // Missed: defense takes over from the kick spot (7 yards behind the LOS), no worse than its own 20.
      res.turnover = true;
      this.flipPossession(clamp(FIELD_LENGTH - (this.los - 7), 1, 80));
      if (FIELD_LENGTH - this.los < 20) this.los = 20;
    }
  }

  /** Hand the ball to the other team at `newLos` (that team's own-goal coordinates). */
  private flipPossession(newLos: number): void {
    this.possession = this.defense;
    this.los = newLos;
    this.down = 1;
    this.yardsToGo = Math.min(YARDS_FOR_FIRST_DOWN, FIELD_LENGTH - newLos);
  }

  private advanceDown(res: PlayResult, startDown: number, startToGo: number): void {
    const gained = res.yards;
    if (res.kind !== 'PASS_INCOMPLETE' && gained >= startToGo) {
      res.firstDown = true;
      this.down = 1;
      this.yardsToGo = Math.min(YARDS_FOR_FIRST_DOWN, FIELD_LENGTH - this.los);
      return;
    }
    this.yardsToGo = Math.max(1, startToGo - gained);
    this.down = startDown + 1;
    if (this.down > 4) {
      res.turnoverOnDowns = true;
      res.turnover = true;
      this.flipPossession(FIELD_LENGTH - this.los);
    }
  }

  private finishPlay(res: PlayResult, startLos: number): PlayResult {
    void startLos;
    const stops =
      res.kind === 'PASS_INCOMPLETE' ||
      res.touchdown ||
      res.fieldGoalGood ||
      res.kind === 'PUNT' ||
      res.kind === 'FIELD_GOAL';
    this.clockRunning = !stops;
    this.clock = Math.max(0, this.clock - (stops ? STOPPED_PLAY_SECONDS : PLAY_SECONDS));
    this.clockExpired = this.clock <= 0;

    // Ref chaos resolves after the whistle: Kill Ref hunt first, then any bribed flags.
    const hunted = this.ref.huntedBy !== null;
    const killed = hunted ? (this.lastForceRefKilled ?? this.rng.chance(0.65)) : false;
    this.lastForceRefKilled = undefined;
    res.refKilled = killed;
    const scored = res.touchdown || res.safety || res.fieldGoalGood;
    const penalties = this.ref.endPlay(this.rng, killed);
    for (const p of penalties) {
      // Flags never take points off the board; they are declined on scoring plays.
      const applied = scored ? 0 : this.applyPenalty(p);
      res.penalties.push({ ...p, appliedYards: applied });
    }

    res.casualties = this.pendingCasualties;
    res.damage = this.pendingDamage;
    res.down = this.down;
    res.yardsToGo = this.yardsToGo;
    this.active = [];
    this.carrier = null;
    res.banner = this.bannerFor(res);

    if (res.touchdown) {
      this.nextPhase = 'EXTRA_POINT';
    } else if (res.safety) {
      this.receiver = res.scoringTeam ?? this.receiver;
      this.nextPhase = 'KICKOFF';
    } else if (!res.fieldGoalGood) {
      this.nextPhase = 'HUDDLE_PLAYCALL';
    }
    this.lastResult = res;
    this.phase = 'PLAY_OVER_BANNER';
    return res;
  }

  private lastForceRefKilled: boolean | undefined;

  /** Optional deterministic override for whether the hunted ref is slain on the next snap. */
  setRefKilledOverride(killed: boolean): void {
    this.lastForceRefKilled = killed;
  }

  private finishForfeit(res: PlayResult): PlayResult {
    res.kind = 'FORFEIT';
    res.casualties = this.pendingCasualties;
    res.damage = this.pendingDamage;
    res.banner = `FORFEIT BY CARNAGE! ${this.winner === 'home' ? 'HOME' : 'AWAY'} wins!`;
    this.active = [];
    this.lastResult = res;
    return res;
  }

  private bannerFor(res: PlayResult): string {
    if (res.touchdown) return 'TOUCHDOWN!';
    if (res.safety) return 'SAFETY!';
    if (res.fieldGoalGood) return 'FIELD GOAL IS GOOD!';
    if (res.kind === 'FIELD_GOAL') return 'FIELD GOAL NO GOOD';
    if (res.kind === 'PUNT') return res.touchback ? 'PUNT — TOUCHBACK' : 'PUNT';
    if (res.kind === 'INTERCEPTION') return 'INTERCEPTED!';
    if (res.fumble && res.turnover) return 'FUMBLE LOST!';
    if (res.turnoverOnDowns) return 'TURNOVER ON DOWNS';
    if (res.kind === 'SACK') return 'SACKED!';
    if (res.kind === 'PASS_INCOMPLETE') return 'INCOMPLETE';
    if (res.firstDown) return 'FIRST DOWN!';
    return `${res.yards >= 0 ? '+' : ''}${res.yards} YARDS`;
  }

  // --------------------------------------------------------------- penalties

  /** Spot-foul enforcement with the half-the-distance rule. Returns the yards actually moved. */
  private applyPenalty(p: Penalty): number {
    const against = p.against;
    const ball = this.possession === against ? this.los : FIELD_LENGTH - this.los;
    const yards = Math.min(p.yards, Math.floor(ball / 2));
    const newBall = ball - yards;
    this.los = this.possession === against ? newBall : FIELD_LENGTH - newBall;
    if (this.possession === against) {
      this.yardsToGo += yards;
    } else {
      this.yardsToGo -= yards;
      if (this.yardsToGo <= 0) {
        this.down = 1;
        this.yardsToGo = Math.min(YARDS_FOR_FIRST_DOWN, FIELD_LENGTH - this.los);
      }
    }
    return yards;
  }

  // ------------------------------------------------------- damage & carnage

  /**
   * Armor-mitigated damage. Lethal damage triggers a casualty: carrier fumbles, the monster is
   * removed for the game, a bench reserve subs in, and 4 casualties force a Forfeit by Carnage.
   */
  inflictDamage(
    team: TeamId,
    side: Side,
    slot: Slot,
    amount: number,
    source: DamageSource,
  ): CasualtyEvent | null {
    if (this.winner !== null) return null;
    const r = this.roster[team].damage(side, slot, amount);
    this.pendingDamage.push({
      team,
      slot,
      playerId: r.victim.id,
      dealt: r.dealt,
      hp: r.victim.currentHp,
      source,
    });
    if (!r.casualty) return null;
    const fumbled =
      this.carrier !== null && this.carrier.team === team && this.carrier.slot === slot;
    if (fumbled) this.carrierFumbled = true;
    const ev: CasualtyEvent = {
      team,
      slot,
      side,
      playerId: r.victim.id,
      name: r.victim.name,
      replacementId: r.replacement?.id ?? null,
      source,
      fumbled,
    };
    this.pendingCasualties.push(ev);
    if (this.roster[team].casualties >= CARNAGE_LIMIT) this.forfeit(team);
    return ev;
  }

  private forfeit(loser: TeamId): void {
    this.forfeitLoser = loser;
    this.winner = opponentOf(loser);
    this.endReason = 'FORFEIT_BY_CARNAGE';
    this.phase = 'GAME_OVER';
  }

  // ------------------------------------------------------ post-play flow

  /** Dismiss the play-over banner and move to the next phase. */
  dismissBanner(): Phase {
    this.requirePhase('PLAY_OVER_BANNER');
    this.proceed(this.nextPhase);
    return this.phase;
  }

  /** Try after a touchdown: kick (1) or two-point conversion (2). */
  extraPoint(kind: 'KICK' | 'CONVERSION', forceGood?: boolean): { good: boolean; points: number } {
    this.requirePhase('EXTRA_POINT');
    const team = this.possession;
    const good = forceGood ?? this.rng.chance(kind === 'KICK' ? 0.94 : 0.47);
    const points = good ? (kind === 'KICK' ? POINTS.EXTRA_KICK : POINTS.CONVERSION) : 0;
    this.score[team] += points;
    this.receiver = opponentOf(team);
    this.proceed('KICKOFF');
    return { good, points };
  }

  private proceed(next: Phase): void {
    if (this.winner !== null) return;
    if (next === 'EXTRA_POINT') {
      this.phase = 'EXTRA_POINT';
      return;
    }
    if (this.clockExpired) {
      this.resumeAfterPeriod = next;
      this.endPeriod();
      return;
    }
    if (next === 'KICKOFF') this.phase = 'KICKOFF';
    else this.beginHuddle();
  }

  private endPeriod(): void {
    this.clockExpired = false;
    if (this.quarter === 4) {
      this.phase = 'GAME_OVER';
      if (this.score.home === this.score.away) {
        this.winner = null;
        this.endReason = 'TIE';
      } else {
        this.winner = this.score.home > this.score.away ? 'home' : 'away';
        this.endReason = 'SCORE';
      }
      return;
    }
    this.phase = this.quarter === 2 ? 'HALFTIME' : 'QUARTER_END';
  }

  /** Leave QUARTER_END / HALFTIME. Halftime resets timeouts and kicks to the other team. */
  advancePeriod(): Phase {
    this.requirePhase('QUARTER_END', 'HALFTIME');
    this.quarter += 1;
    this.clock = this.cfg.quarterSeconds;
    this.clockRunning = false;
    if (this.quarter === 3) {
      this.timeouts.home = this.cfg.timeoutsPerHalf;
      this.timeouts.away = this.cfg.timeoutsPerHalf;
      this.receiver = opponentOf(this.openingReceiver);
      this.phase = 'KICKOFF';
    } else if (this.resumeAfterPeriod === 'KICKOFF') {
      this.phase = 'KICKOFF';
    } else {
      this.beginHuddle();
    }
    return this.phase;
  }
}
