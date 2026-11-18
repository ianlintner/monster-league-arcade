import { type Rng } from './Rng';

export type TeamId = 'home' | 'away';
export type Side = 'OFFENSE' | 'DEFENSE';
export type Faction = 'REAPERS' | 'DEADSKINS' | 'NIGHTSTALKERS' | 'GHOULS';

export const OFFENSE_SLOTS = ['QB', 'RB1', 'RB2/WR', 'WR/TE', 'OL1', 'OL2', 'OL3'] as const;
export const DEFENSE_SLOTS = ['DL1', 'DL2', 'DL3', 'LB1', 'LB2', 'DB1', 'DB2'] as const;
export type OffenseSlot = (typeof OFFENSE_SLOTS)[number];
export type DefenseSlot = (typeof DEFENSE_SLOTS)[number];
export type Slot = OffenseSlot | DefenseSlot;

export const ACTIVE_COUNT = 7;
export const BENCH_COUNT = 4;
export const ROSTER_SIZE = ACTIVE_COUNT + BENCH_COUNT;
/** Casualties that trigger an immediate Forfeit by Carnage. */
export const CARNAGE_LIMIT = 4;

export type DamageSource = 'TACKLE' | 'HAZARD' | 'WEAPON' | 'POISON' | 'EXPLOSION';
export type PlayerStatus = 'ACTIVE' | 'BENCH' | 'DEAD';

export interface Player {
  id: string;
  name: string;
  faction: Faction;
  speed: number;
  strength: number;
  agility: number;
  throwPower: number;
  accuracy: number;
  tackle: number;
  maxHp: number;
  currentHp: number;
  /** Percent damage reduction (0-40). */
  armor: number;
  status: PlayerStatus;
}

type Attrs = Pick<
  Player,
  'speed' | 'strength' | 'agility' | 'throwPower' | 'accuracy' | 'tackle' | 'maxHp' | 'armor'
>;

/** Faction-tuned base attributes. */
export const FACTION_BASE: Record<Faction, Attrs> = {
  // Fast and bendy but brittle.
  REAPERS: {
    speed: 74,
    strength: 56,
    agility: 72,
    throwPower: 60,
    accuracy: 62,
    tackle: 58,
    maxHp: 70,
    armor: 8,
  },
  // Slow bruisers with huge HP pools.
  DEADSKINS: {
    speed: 52,
    strength: 78,
    agility: 50,
    throwPower: 58,
    accuracy: 54,
    tackle: 74,
    maxHp: 105,
    armor: 18,
  },
  // Precise, armored passers.
  NIGHTSTALKERS: {
    speed: 66,
    strength: 64,
    agility: 66,
    throwPower: 76,
    accuracy: 78,
    tackle: 64,
    maxHp: 85,
    armor: 14,
  },
  // Slippery hex-tacklers.
  GHOULS: {
    speed: 64,
    strength: 62,
    agility: 76,
    throwPower: 62,
    accuracy: 64,
    tackle: 72,
    maxHp: 80,
    armor: 10,
  },
};

const NAMES: Record<Faction, readonly string[]> = {
  REAPERS: [
    'Rib Rattler',
    'Skully Mac',
    'Bonesaw',
    'Femur Fred',
    'Marrow Jack',
    'Tibia Tim',
    'Crypt Keeper',
    'Ossie',
    'Jaw Breaker',
    'Clavicle Kid',
    'Pelvis Pete',
  ],
  DEADSKINS: [
    'Gutsy Gus',
    'Rotten Ron',
    'Moldy Mo',
    'Slime Sal',
    'Brain Drain',
    'Lurch',
    'Putrid Pat',
    'Drool Dan',
    'Gravy Dig',
    'Shamblin Sam',
    'Zed',
  ],
  NIGHTSTALKERS: [
    'Count Cutback',
    'Vlad Impaler',
    'Fang Fargo',
    'Nosferatu Ned',
    'Bela',
    'Dracu-Lance',
    'Crimson Carl',
    'Bat Boy',
    'Drac Jr',
    'Sir Sunburn',
    'Cape Cooper',
  ],
  GHOULS: [
    'Hexy Hank',
    'Bayou Bess',
    'Wicked Wanda',
    'Cauldron Cal',
    'Swamp Sue',
    'Moss Mike',
    'Lantern Lou',
    'Voodoo Vic',
    'Gator Gail',
    'Mojo Mo',
    'Wisp',
  ],
};

/** Per-lineup-index position bonuses (index matches OFFENSE_SLOTS / DEFENSE_SLOTS order). */
const POSITION_BONUS: readonly Partial<Attrs>[] = [
  { throwPower: 12, accuracy: 12 }, // QB / DL1
  { speed: 8, agility: 6, strength: 4 }, // RB1 / DL2
  { speed: 10, agility: 8 }, // RB2/WR / DL3
  { speed: 6, accuracy: 6 }, // WR/TE / LB1
  { strength: 10 }, // OL1 / LB2
  { strength: 10 }, // OL2 / DB1
  { strength: 10 }, // OL3 / DB2
];

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

export function createPlayer(teamId: TeamId, faction: Faction, index: number, rng: Rng): Player {
  const base = FACTION_BASE[faction];
  const bonus = index < ACTIVE_COUNT ? (POSITION_BONUS[index] ?? {}) : {};
  const stat = (k: keyof Attrs): number => (base[k] ?? 0) + (bonus[k] ?? 0) + rng.int(-4, 4);
  const maxHp = clamp(stat('maxHp'), 40, 140);
  const names = NAMES[faction];
  return {
    id: `${teamId}-${index}`,
    name: names[index % names.length] ?? `Monster ${index}`,
    faction,
    speed: clamp(stat('speed'), 20, 99),
    strength: clamp(stat('strength'), 20, 99),
    agility: clamp(stat('agility'), 20, 99),
    throwPower: clamp(stat('throwPower'), 20, 99),
    accuracy: clamp(stat('accuracy'), 20, 99),
    tackle: clamp(stat('tackle'), 20, 99),
    maxHp,
    currentHp: maxHp,
    armor: clamp(stat('armor'), 0, 40),
    status: index < ACTIVE_COUNT ? 'ACTIVE' : 'BENCH',
  };
}

export interface DamageResult {
  victim: Player;
  slot: Slot;
  dealt: number;
  casualty: boolean;
  replacement: Player | null;
  /** True when this casualty brought the team to the carnage limit. */
  forfeit: boolean;
}

/**
 * Eleven-monster roster. Seven play ironman both ways: lineup index i fills
 * OFFENSE_SLOTS[i] on offense and DEFENSE_SLOTS[i] on defense. Four bench reserves
 * auto-sub into a casualty's lineup spot.
 */
export class TeamRoster {
  readonly players: Player[];
  /** lineup[i] = index into `players` of the monster currently holding lineup spot i. */
  readonly lineup: number[];
  casualties = 0;

  constructor(
    readonly teamId: TeamId,
    readonly faction: Faction,
    rng: Rng,
  ) {
    this.players = Array.from({ length: ROSTER_SIZE }, (_, i) =>
      createPlayer(teamId, faction, i, rng),
    );
    this.lineup = Array.from({ length: ACTIVE_COUNT }, (_, i) => i);
  }

  private index(side: Side, slot: Slot): number {
    const slots: readonly string[] = side === 'OFFENSE' ? OFFENSE_SLOTS : DEFENSE_SLOTS;
    const i = slots.indexOf(slot);
    if (i < 0) throw new Error(`Slot ${slot} does not belong to ${side}`);
    return i;
  }

  player(side: Side, slot: Slot): Player {
    const p = this.players[this.lineup[this.index(side, slot)] ?? -1];
    if (!p) throw new Error(`No player in slot ${slot}`);
    return p;
  }

  get bench(): Player[] {
    return this.players.filter((p) => p.status === 'BENCH');
  }

  get active(): Player[] {
    return this.lineup.map((i) => this.players[i]).filter((p): p is Player => p !== undefined);
  }

  /** Armor-mitigated damage; always at least 1. Lethal damage triggers a casualty + bench sub. */
  damage(side: Side, slot: Slot, amount: number): DamageResult {
    const idx = this.index(side, slot);
    const victim = this.player(side, slot);
    const dealt = Math.max(1, Math.round(amount * (1 - victim.armor / 100)));
    victim.currentHp = Math.max(0, victim.currentHp - dealt);
    let casualty = false;
    let replacement: Player | null = null;
    if (victim.currentHp <= 0) {
      casualty = true;
      victim.status = 'DEAD';
      this.casualties += 1;
      const subIdx = this.players.findIndex((p) => p.status === 'BENCH');
      if (subIdx >= 0) {
        replacement = this.players[subIdx] ?? null;
        if (replacement) replacement.status = 'ACTIVE';
        this.lineup[idx] = subIdx;
      }
    }
    return {
      victim,
      slot,
      dealt,
      casualty,
      replacement,
      forfeit: this.casualties >= CARNAGE_LIMIT,
    };
  }
}
