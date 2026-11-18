import type { Rng } from './Rng';
import type { TeamId } from './Roster';

export type PenaltyKind = 'BRIBE' | 'REF_BASHING' | 'DELAY_OF_GAME';

export interface Penalty {
  kind: PenaltyKind;
  against: TeamId;
  yards: number;
  label: string;
  /** Broadcast banner text, e.g. "5 Yards — Excessive Whining!". */
  text: string;
}

export const BRIBE_PENALTY_TABLE: readonly { yards: number; label: string }[] = [
  { yards: 5, label: 'Excessive Whining!' },
  { yards: 5, label: 'Breathing on the Zombie!' },
  { yards: 10, label: 'Unsportsmanlike Pulse!' },
];

export const BRIBE_DURATION_PLAYS = 3;
export const REF_BASHING_YARDS = 5;

export const opponentOf = (t: TeamId): TeamId => (t === 'home' ? 'away' : 'home');

export function makePenalty(
  kind: PenaltyKind,
  against: TeamId,
  yards: number,
  label: string,
): Penalty {
  return { kind, against, yards, label, text: `${yards} Yards — ${label}` };
}

export type RefKind = 'NECRO_REF' | 'DEMON_REF';

/** The Necro-Ref (and his backup Demon Ref): bribable, huntable, spectacularly corrupt. */
export class Referee {
  kind: RefKind = 'NECRO_REF';
  bribedBy: TeamId | null = null;
  bribePlaysLeft = 0;
  /** Team that called Kill Ref this play (its players are the would-be killers). */
  huntedBy: TeamId | null = null;

  get isBribed(): boolean {
    return this.bribedBy !== null && this.bribePlaysLeft > 0;
  }

  /** Corrupt the Necro-Ref. The Demon Ref is incorruptible. */
  bribe(team: TeamId): boolean {
    if (this.kind === 'DEMON_REF') return false;
    this.bribedBy = team;
    this.bribePlaysLeft = BRIBE_DURATION_PLAYS;
    return true;
  }

  /** Mark the ref as the hunted target for the upcoming play. */
  startHunt(team: TeamId): boolean {
    if (this.kind === 'DEMON_REF') return false;
    this.huntedBy = team;
    return true;
  }

  clearBribe(): void {
    this.bribedBy = null;
    this.bribePlaysLeft = 0;
  }

  /**
   * Called once at the end of every play. `refKilled` says whether the hunted ref was
   * tackled/slain. Returns penalties to assess (Ref Bashing first, then bribe flags).
   */
  endPlay(rng: Rng, refKilled: boolean): Penalty[] {
    const out: Penalty[] = [];
    if (this.huntedBy !== null) {
      if (refKilled) {
        this.clearBribe();
        this.kind = 'DEMON_REF';
        out.push(makePenalty('REF_BASHING', this.huntedBy, REF_BASHING_YARDS, 'Ref Bashing'));
      }
      this.huntedBy = null;
    }
    if (this.isBribed && this.bribedBy) {
      const pick = rng.pick(BRIBE_PENALTY_TABLE);
      out.push(makePenalty('BRIBE', opponentOf(this.bribedBy), pick.yards, pick.label));
      this.bribePlaysLeft -= 1;
      if (this.bribePlaysLeft <= 0) this.clearBribe();
    }
    return out;
  }
}
