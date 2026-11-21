/**
 * NastyFieldEffects — the on-field presentation of Nasty Audibles.
 *
 * Pure TypeScript, no Phaser. Reads the session's `NastyEffects` (already
 * computed by `GameSession.snap` from the play's valid actives) and produces
 * per-tick, per-actor field effects for the LivePlay loop:
 *   - Bat-Wing Jet Boost: +65% carrier speed, knockdown resistance (already a
 *     sim modifier; this module applies the *carrier speed* multiplier live).
 *   - Dynamite Pitch: up to 3 grenade throws (Button B) — each throw emits a
 *     `HazardHit`-shaped weapon hit at a chosen defender.
 *   - Ghoul Gas: a lingering cloud (Button B drops it); defenders inside take
 *     poison over time.
 *   - Hex of Confusion: invert the opponent carrier's controls for 3 s.
 *   - Phantom Shroud: defenders turn spectral (visual timer).
 *   - QB Crypt Blitz: DL speed up (defense-side live boost).
 *   - Kill Ref: the Necro-Ref becomes a tackle target (the other side steers him).
 *
 * The *damage* for grenades/gas is still committed through `GameSession.snap`
 * (which resolves DYNAMITE_PITCH/GHOUL_GAS weapon damage against the defense);
 * this module only drives what the player *sees and does* in the field.
 */
import type { NastyEffects } from '../sim/DirtyTricks';
import type { TeamId } from '../sim/Roster';

export interface NastyFieldInput {
  effects: NastyEffects;
  /** Elapsed live-down seconds. */
  t: number;
  /** Whether the player pressed Button B this tick (grenade/gas trigger). */
  pressedB: boolean;
  /** Whether the player pressed Button C this tick (punt/FG kick). */
  pressedC: boolean;
  /** Carrier team (the offense). */
  carrierTeam: TeamId;
  /** The carrier slot (for targeting grenades at a chosen defender). */
  carrierSlot: string;
}

export interface NastyFieldSnapshot {
  /** Carrier speed multiplier this tick (Bat-Wing boost). */
  carrierSpeedMult: number;
  /** Whether the carrier is knockdown-resistant (Bat-Wing). */
  knockdownResistant: boolean;
  /** Number of grenades thrown this tick (Dynamite Pitch on B). */
  grenadesThrown: number;
  /** Whether a Ghoul Gas cloud was dropped this tick (Button B). */
  gasDropped: boolean;
  /** Whether the gas cloud is currently active (lingers). */
  gasActive: boolean;
  /** Seconds remaining on the Hex input inversion. */
  hexRemaining: number;
  /** Seconds remaining on the Phantom Shroud. */
  shroudRemaining: number;
  /** True while the Necro-Ref is being hunted (Kill Ref). */
  killRefHunt: boolean;
  /** DL speed multiplier (QB Crypt Blitz defense-side). */
  dlSpeedMult: number;
}

const GAS_LINGER_SECONDS = 3;

/**
 * Advance the nasty field-effect clocks one 60 Hz tick. Deterministic: it only
 * reads the (already deterministic) `NastyEffects` and the monotonic `t`/button
 * flags, and tracks its own timers from `t`.
 */
export class NastyFieldEffects {
  private gasUntil = -1;
  private hexUntil = -1;
  private shroudUntil = -1;
  private grenadesLeft = 0;

  /** Call once per live down with this play's effects and remaining grenades. */
  begin(effects: NastyEffects): void {
    this.grenadesLeft = effects.grenades; // DYNAMITE_PITCH grants up to 3
    this.gasUntil = -1;
    this.hexUntil = -1;
    this.shroudUntil = -1;
    if (effects.gasCloud) this.gasUntil = 0; // armed, dropped on first B
    if (effects.shroudSeconds > 0) this.shroudUntil = effects.shroudSeconds;
    if (effects.invertControlsSeconds > 0) this.hexUntil = effects.invertControlsSeconds;
  }

  /** Advance one tick and return the current on-field effect snapshot. */
  tick(input: NastyFieldInput): NastyFieldSnapshot {
    const e = input.effects;

    let grenadesThrown = 0;
    if (input.pressedB && this.grenadesLeft > 0 && e.grenades > 0) {
      grenadesThrown = 1; // one grenade per press, up to 3 total
      this.grenadesLeft -= 1;
    }

    let gasDropped = false;
    if (input.pressedB && e.gasCloud && this.gasUntil <= input.t) {
      gasDropped = true;
      this.gasUntil = input.t + GAS_LINGER_SECONDS;
    }

    const hexRemaining = this.hexUntil > 0 ? Math.max(0, this.hexUntil - input.t) : 0;
    const shroudRemaining = this.shroudUntil > 0 ? Math.max(0, this.shroudUntil - input.t) : 0;
    const gasActive = this.gasUntil > 0 && input.t <= this.gasUntil;

    // Hex inverts the *carrier's* (opponent control) inputs for its duration.
    return {
      carrierSpeedMult: e.carrierSpeedMult,
      knockdownResistant: e.knockdownResistant,
      grenadesThrown,
      gasDropped,
      gasActive,
      hexRemaining,
      shroudRemaining,
      killRefHunt: false, // set by the session's hunt state, patched by MatchScene
      dlSpeedMult: e.dlSpeedMult,
    };
  }

  /** Whether the Hex should invert the carrier control right now. */
  invertsInput(hexRemaining: number): boolean {
    return hexRemaining > 0;
  }
}
