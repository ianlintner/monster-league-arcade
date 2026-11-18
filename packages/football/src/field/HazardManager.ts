/**
 * HazardManager — seeded per-arena hazard layout for the live field.
 *
 * Pure TypeScript, no Phaser, so hazards are unit-testable and replayable. A
 * single `HazardManager` instance covers one field/arena: its layout is
 * deterministic under a seed (PLAN.md §3.4 — Cursed Graveyard, Brimstone
 * Hellfire Pit, Ectoplasm Swamp). The LivePlay loop feeds it actors; it emits
 * `HazardHit[]` compatible with `GameSession.snap({ hazards })` and player
 * effects (slow-down, friction, damage-over-time, telegraphs, mine/sludge
 * clearing by a dive).
 *
 * Coordinates are LivePlay yard-space: `x` downfield from the LOS, `y` lateral
 * (centre 0, bounds ±26.66). Hazards occupy the field of play between the
 * goal lines (x ∈ [0, 100]).
 */
import type { DamageSource, Side, Slot, TeamId } from '../sim/Roster';
import type { HazardHit } from '../sim/GameSession';

export type ArenaId = 'cursed-graveyard' | 'brimstone-hellfire-pit' | 'ectoplasm-swamp';

export type HazardKind =
  | 'TOMBSTONE' // solid obstacle: blocks/bounces carrier, no damage
  | 'OPEN_GRAVE' // stepping in = instant casualty
  | 'MINE' // jack-o'-lantern landmine: damaging blast, cleared by dive
  | 'LAVA_GEYSER' // 1 s telegraph then damaging eruption
  | 'BOG' // low friction (momentum slide)
  | 'SLUDGE'; // slow + damage-over-time, cleared by dive;

export interface Hazard {
  id: string;
  kind: HazardKind;
  /** Centre in yard-space. */
  x: number;
  y: number;
  /** Effective radius for collision (yards). */
  radius: number;
  /** Damage per activation (0 for pass-through obstacles / pure slow). */
  damage: number;
  /** 'HAZARD' | 'POISON' | 'EXPLOSION' | 'WEAPON' — matches DamageSource. */
  source: DamageSource;
  /** Seconds remaining before a telegraphed hazard (geyser) fires. */
  telegraphSeconds: number;
  /** Whether a dive clears this hazard (mines, sludge). */
  clearable: boolean;
  armed: boolean;
}

/** Per-frame hazard influence on the carrier returned each tick. */
export interface HazardInfluence {
  /** 0..1 friction factor applied to the carrier's speed (bog/passing contact). */
  frictionMult: number;
  /** 0..1 speed factor from slow effects (sludge). */
  slowMult: number;
  /** Damage-over-time per second (sludge). */
  dotPerSecond: number;
  /** Instant hits resolved this tick (grave, mine, geyser eruption). */
  hits: HazardHit[];
  /** Hazards cleared by a dive this tick. */
  cleared: string[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Mulberry32 — same family as the sim's Rng, self-contained here for zero deps. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const HAZARD_FIELD_Y_MIN = -26.66;
export const HAZARD_FIELD_Y_MAX = 26.66;

export class HazardManager {
  readonly arena: ArenaId;
  readonly hazards: Hazard[];
  private rng: () => number;
  private elapsed = 0;
  /** Fractional poison (sludge) DoT not yet quantized to a full HP, per hazard. */
  private dotAcc = new Map<string, number>();

  constructor(arena: ArenaId, seed: number) {
    this.arena = arena;
    this.rng = mulberry32(seed);
    this.hazards = this.buildLayout(arena);
  }

  /** Advance hazard timers (geyser telegraphs / eruption cycles). */
  tick(dt: number): void {
    this.elapsed += dt;
    for (const h of this.hazards) {
      if (h.kind !== 'LAVA_GEYSER') continue;
      if (h.armed) {
        // Erupting: count down the eruption window, then re-arm the telegraph.
        h.telegraphSeconds -= dt;
        if (h.telegraphSeconds <= 0) {
          h.armed = false;
          h.telegraphSeconds = 1 + this.rng();
        }
      } else {
        // Telegraphed: count down to eruption.
        h.telegraphSeconds -= dt;
        if (h.telegraphSeconds <= 0) {
          h.armed = true;
          h.telegraphSeconds = 0.5; // eruption window
        }
      }
    }
    void this.elapsed;
  }

  private at(x: number, y: number, radius: number, id: string): Hazard {
    const isGeyser = id.startsWith('G');
    return {
      id,
      kind: isGeyser ? 'LAVA_GEYSER' : this.kindFor(id),
      x,
      y,
      radius,
      damage: 0,
      source: 'HAZARD',
      telegraphSeconds: isGeyser ? 1 : 0,
      clearable: false,
      armed: !isGeyser,
    };
  }

  private kindFor(id: string): HazardKind {
    const c = id[0];
    if (c === 'T') return 'TOMBSTONE';
    if (c === 'O') return 'OPEN_GRAVE';
    if (c === 'M') return 'MINE';
    if (c === 'G') return 'LAVA_GEYSER';
    if (c === 'B') return 'BOG';
    return 'SLUDGE';
  }

  private buildLayout(arena: ArenaId): Hazard[] {
    switch (arena) {
      case 'cursed-graveyard':
        return this.buildGraveyard();
      case 'brimstone-hellfire-pit':
        return this.buildHellfire();
      case 'ectoplasm-swamp':
        return this.buildSwamp();
      default:
        return this.buildGraveyard();
    }
  }

  /** Tombstones (solid), open graves (instant casualty), jack-o'-lantern mines (blast). */
  private buildGraveyard(): Hazard[] {
    const out: Hazard[] = [];
    // Tombstones: a diagonal spine so carriers must route around them.
    for (let i = 0; i < 5; i++) {
      const x = 18 + i * 16 + (this.rng() - 0.5) * 4;
      const y = -14 + i * 7 + (this.rng() - 0.5) * 3;
      const h = this.at(clamp(x, 5, 95), clamp(y, -22, 22), 1.4, `T${i}`);
      out.push(h);
    }
    // Open graves: two instant-casualty pits.
    for (let i = 0; i < 2; i++) {
      const x = 30 + i * 35;
      const y = (i === 0 ? -1 : 1) * (10 + this.rng() * 6);
      const h = this.at(clamp(x, 5, 95), clamp(y, -24, 24), 1.8, `O${i}`);
      h.damage = 9999; // instant casualty resolved by the caller as lethal
      h.source = 'HAZARD';
      out.push(h);
    }
    // Jack-o'-lantern mines: clearable by dive.
    for (let i = 0; i < 3; i++) {
      const x = 45 + i * 14 + (this.rng() - 0.5) * 6;
      const y = (i % 2 === 0 ? 1 : -1) * (6 + this.rng() * 8);
      const h = this.at(clamp(x, 5, 95), clamp(y, -24, 24), 1.5, `M${i}`);
      h.damage = 12;
      h.source = 'EXPLOSION';
      h.clearable = true;
      out.push(h);
    }
    return out;
  }

  /** Lava geysers with a 1 s telegraph before erupting. */
  private buildHellfire(): Hazard[] {
    const out: Hazard[] = [];
    for (let i = 0; i < 4; i++) {
      const x = 20 + i * 20 + (this.rng() - 0.5) * 5;
      const y = (i % 2 === 0 ? -1 : 1) * (8 + this.rng() * 10);
      const h = this.at(clamp(x, 5, 95), clamp(y, -24, 24), 1.7, `G${i}`);
      h.kind = 'LAVA_GEYSER';
      h.damage = 18;
      h.source = 'EXPLOSION';
      h.telegraphSeconds = 1 + this.rng();
      h.armed = false;
      out.push(h);
    }
    return out;
  }

  /** Bog (low friction), sludge (slow + DoT, clearable by dive). */
  private buildSwamp(): Hazard[] {
    const out: Hazard[] = [];
    for (let i = 0; i < 3; i++) {
      const x = 22 + i * 24 + (this.rng() - 0.5) * 6;
      const y = (i % 2 === 0 ? -1 : 1) * (12 + this.rng() * 6);
      const h = this.at(clamp(x, 5, 95), clamp(y, -24, 24), 2.8, `B${i}`);
      h.kind = 'BOG';
      h.damage = 0;
      h.source = 'HAZARD';
      out.push(h);
    }
    for (let i = 0; i < 3; i++) {
      const x = 38 + i * 16 + (this.rng() - 0.5) * 5;
      const y = (i % 2 === 0 ? 1 : -1) * (5 + this.rng() * 7);
      const h = this.at(clamp(x, 5, 95), clamp(y, -24, 24), 1.6, `S${i}`);
      h.kind = 'SLUDGE';
      h.damage = 4; // applied as DoT (damage/sec), not instant
      h.source = 'POISON';
      h.clearable = true;
      out.push(h);
    }
    return out;
  }

  /**
   * Evaluate the hazards against a single actor position this tick, resolving
   * contact. `dive` clears mines/sludge within reach. `actor` = the victim
   * (team/side/slot) for any emitted hits.
   */
  evaluate(
    x: number,
    y: number,
    actor: { team: TeamId; side: Side; slot: Slot },
    dive: boolean,
    dt: number,
  ): HazardInfluence {
    const inf: HazardInfluence = {
      frictionMult: 1,
      slowMult: 1,
      dotPerSecond: 0,
      hits: [],
      cleared: [],
    };
    for (const h of this.hazards) {
      if (!h.armed) continue;
      const d = Math.hypot(x - h.x, y - h.y);
      if (d > h.radius) continue;

      switch (h.kind) {
        case 'TOMBSTONE':
          // Solid: hard stop the carrier's forward motion (friction). No damage.
          inf.frictionMult = Math.min(inf.frictionMult, 0.05);
          break;
        case 'OPEN_GRAVE':
          // Instant casualty: a single lethal hit. Falling in is a death sentence.
          inf.hits.push({
            team: actor.team,
            side: actor.side,
            slot: actor.slot,
            amount: h.damage,
            source: h.source,
          });
          break;
        case 'MINE':
          // A dive clears it safely; otherwise it detonates.
          if (dive) {
            inf.cleared.push(h.id);
            h.armed = false;
          } else {
            inf.hits.push({
              team: actor.team,
              side: actor.side,
              slot: actor.slot,
              amount: h.damage,
              source: h.source,
            });
            h.armed = false; // single-use
          }
          break;
        case 'LAVA_GEYSER':
          // Erupting: heavy blast damage.
          inf.hits.push({
            team: actor.team,
            side: actor.side,
            slot: actor.slot,
            amount: h.damage,
            source: h.source,
          });
          break;
        case 'BOG':
          // Low friction: momentum slide.
          inf.frictionMult = Math.min(inf.frictionMult, 0.55);
          break;
        case 'SLUDGE':
          // Slow + damage-over-time; cleared by a dive.
          if (dive) {
            inf.cleared.push(h.id);
            h.armed = false;
            this.dotAcc.delete(h.id);
          } else {
            inf.slowMult = Math.min(inf.slowMult, 0.6);
            inf.dotPerSecond += h.damage;
            // Accumulate fractional poison; emit a full-HP hit once >= 1.
            const acc = (this.dotAcc.get(h.id) ?? 0) + h.damage * dt;
            this.dotAcc.set(h.id, acc);
            if (acc >= 1) {
              const whole = Math.floor(acc);
              this.dotAcc.set(h.id, acc - whole);
              inf.hits.push({
                team: actor.team,
                side: actor.side,
                slot: actor.slot,
                amount: whole,
                source: 'POISON',
              });
            }
          }
          break;
      }
    }
    return inf;
  }

  /** Remove a hazard by id (dive-cleared mines/sludge). */
  isCleared(id: string): boolean {
    const h = this.hazards.find((x) => x.id === id);
    return h ? !h.armed : true;
  }

  /** Snapshot for the renderer (positions, kinds, telegraph/arm state). */
  snapshot(): ReadonlyArray<{
    id: string;
    kind: HazardKind;
    x: number;
    y: number;
    radius: number;
    telegraphSeconds: number;
    armed: boolean;
  }> {
    return this.hazards.map((h) => ({
      id: h.id,
      kind: h.kind,
      x: h.x,
      y: h.y,
      radius: h.radius,
      telegraphSeconds: h.telegraphSeconds,
      armed: h.armed,
    }));
  }
}
