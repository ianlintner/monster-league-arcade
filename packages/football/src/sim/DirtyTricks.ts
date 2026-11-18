import type { NastyKind } from './Playbook';
import { NASTY_SIDE } from './Playbook';
import type { Side, TeamId } from './Roster';

export type Half = 1 | 2;

export interface NastyInfo {
  kind: NastyKind;
  name: string;
  side: Side | 'ANY';
  blurb: string;
}

export const NASTY_INFO: Record<NastyKind, NastyInfo> = {
  PUMPKIN_BOMB_PASS: {
    kind: 'PUMPKIN_BOMB_PASS',
    name: 'Pumpkin Bomb Pass',
    side: 'OFFENSE',
    blurb: 'Rigged ball explodes on catch or interception.',
  },
  DYNAMITE_PITCH: {
    kind: 'DYNAMITE_PITCH',
    name: 'Dynamite Pitch',
    side: 'OFFENSE',
    blurb: "RB gets 3 jack-o'-lantern grenades (Button B).",
  },
  BAT_WING_JET_BOOST: {
    kind: 'BAT_WING_JET_BOOST',
    name: 'Bat-Wing Jet Boost',
    side: 'OFFENSE',
    blurb: '+65% carrier speed and knockdown resistance.',
  },
  GHOUL_GAS: {
    kind: 'GHOUL_GAS',
    name: 'Ghoul Gas',
    side: 'OFFENSE',
    blurb: 'Toxic cloud stuns and poisons tacklers (Button B).',
  },
  QB_CRYPT_BLITZ: {
    kind: 'QB_CRYPT_BLITZ',
    name: 'QB Crypt Blitz',
    side: 'DEFENSE',
    blurb: '+50% DL speed and hit damage targeting the QB.',
  },
  PHANTOM_SHROUD: {
    kind: 'PHANTOM_SHROUD',
    name: 'Phantom Shroud',
    side: 'DEFENSE',
    blurb: 'Defenders turn spectral for 4 seconds.',
  },
  HEX_OF_CONFUSION: {
    kind: 'HEX_OF_CONFUSION',
    name: 'Hex of Confusion',
    side: 'DEFENSE',
    blurb: 'Inverts opponent controls for 3 seconds.',
  },
  BRIBE_REF: {
    kind: 'BRIBE_REF',
    name: 'Bribe Ref',
    side: 'ANY',
    blurb: 'Necro-Ref flags the opponent for 3 plays.',
  },
  KILL_REF: {
    kind: 'KILL_REF',
    name: 'Kill Ref',
    side: 'ANY',
    blurb: 'Hunt the Necro-Ref; slay him and the Demon Ref flags you.',
  },
};

export const ALL_NASTIES = Object.keys(NASTY_INFO) as NastyKind[];

/** Once-per-half charge tracking, per team and per Nasty. */
export class NastyCharges {
  private used = new Set<string>();

  private key(team: TeamId, kind: NastyKind, half: Half): string {
    return `${team}:${kind}:${half}`;
  }

  available(team: TeamId, kind: NastyKind, half: Half): boolean {
    return !this.used.has(this.key(team, kind, half));
  }

  /** Spend a charge; returns false if already spent this half. */
  consume(team: TeamId, kind: NastyKind, half: Half): boolean {
    if (!this.available(team, kind, half)) return false;
    this.used.add(this.key(team, kind, half));
    return true;
  }

  remaining(team: TeamId, half: Half): NastyKind[] {
    return ALL_NASTIES.filter((k) => this.available(team, k, half));
  }
}

export const JET_BOOST_SPEED_MULT = 1.65;
export const JET_BOOST_DAMAGE_MULT = 0.65;
export const CRYPT_BLITZ_MULT = 1.5;
export const SHROUD_SECONDS = 4;
export const HEX_SECONDS = 3;
export const DYNAMITE_GRENADES = 3;
export const GRENADE_DAMAGE = 14;
export const GAS_POISON_DAMAGE = 6;
export const PUMPKIN_BLAST_DAMAGE = 18;
export const PUMPKIN_BLAST_TARGETS = 2;

/** Modifiers the sim and presentation layer read for the current play. */
export interface NastyEffects {
  carrierSpeedMult: number;
  /** Multiplier on damage taken by the ball carrier. */
  carrierDamageMult: number;
  knockdownResistant: boolean;
  grenades: number;
  gasCloud: boolean;
  pumpkinBomb: boolean;
  dlSpeedMult: number;
  qbHitDamageMult: number;
  shroudSeconds: number;
  invertControlsSeconds: number;
  /** Which side's Nasties are in play, for HUD flashes. */
  active: NastyKind[];
}

export function computeEffects(active: readonly NastyKind[]): NastyEffects {
  const has = (k: NastyKind): boolean => active.includes(k);
  return {
    carrierSpeedMult: has('BAT_WING_JET_BOOST') ? JET_BOOST_SPEED_MULT : 1,
    carrierDamageMult: has('BAT_WING_JET_BOOST') ? JET_BOOST_DAMAGE_MULT : 1,
    knockdownResistant: has('BAT_WING_JET_BOOST'),
    grenades: has('DYNAMITE_PITCH') ? DYNAMITE_GRENADES : 0,
    gasCloud: has('GHOUL_GAS'),
    pumpkinBomb: has('PUMPKIN_BOMB_PASS'),
    dlSpeedMult: has('QB_CRYPT_BLITZ') ? CRYPT_BLITZ_MULT : 1,
    qbHitDamageMult: has('QB_CRYPT_BLITZ') ? CRYPT_BLITZ_MULT : 1,
    shroudSeconds: has('PHANTOM_SHROUD') ? SHROUD_SECONDS : 0,
    invertControlsSeconds: has('HEX_OF_CONFUSION') ? HEX_SECONDS : 0,
    active: [...active],
  };
}

export function nastySide(kind: NastyKind): Side | 'ANY' {
  return NASTY_SIDE[kind];
}
