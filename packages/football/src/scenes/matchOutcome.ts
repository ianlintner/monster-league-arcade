/**
 * matchOutcome — the play-over result commit, banner and presentation helpers
 * for `MatchScene`'s live play. Extracted verbatim from the former scene
 * methods; these operate on the shared `MatchRuntime` surface (same names,
 * order and arithmetic) and are called by `matchSim` (whistle / pass landing /
 * kick) and `matchController.updateMode` (banner tick). Owns no state.
 */
import type { GameSession, HazardHit } from '../sim/index';
import { projectActor } from '../field/fieldMapper';
import { projectToScreen, toPhaserColor } from '@monster-league/shared-core';
import { detailForKind, type MatchRuntime } from './matchController';
import { bannerKindForText, buildBroadcastBanner, buildResultCard } from '../ui/hud';
import { resolveScrambleOutcome } from '../field/PlayOrchestrator';

/** Show the play-over banner and enter the BANNER presentation state. */
export function showBanner(s: MatchRuntime, text: string): void {
  s.bannerText = text;
  s.bannerKind = bannerKindForText(text);
  s.bannerTimer = 2.2;
  s.mode = 'BANNER';
  renderKineticBanner(s, text);
}

/** Rebuild the `#banner` node as an animated GSN 66.6 broadcast banner. */
function renderKineticBanner(s: MatchRuntime, text: string): void {
  const host = document.getElementById('banner');
  if (!host) return;
  host.replaceChildren(buildBroadcastBanner(s.bannerKind, detailForKind(s.bannerKind, text)));
}

/** Read the just-committed snap's damage/casualties into floating popups. */
export function collectDamageAndCasualties(s: MatchRuntime): void {
  const r = s.session.lastResult;
  if (!r) return;
  for (const d of r.damage) {
    const actor = s.live?.actors.find((a) => a.slot === d.slot && a.team === d.team);
    if (!actor) continue;
    const f = projectActor(actor.x, actor.y, s.liveLos);
    const p = projectToScreen(f.x, f.y);
    s.damagePopups.push({
      x: p.x,
      y: p.y - 22,
      text: `-${d.dealt}`,
      color: toPhaserColor('VAMPIRE_CRIMSON'),
      ttl: 1.4,
    });
  }
  for (const c of r.casualties) {
    const actor = s.live?.actors.find((a) => a.slot === c.slot && a.team === c.team);
    if (!actor) continue;
    const f = projectActor(actor.x, actor.y, s.liveLos);
    const p = projectToScreen(f.x, f.y);
    s.casualties.push({ id: actor.id, x: p.x, y: p.y, ttl: 2.0 });
    // Presentation: a casualty kills the victim — the sprite plays its death
    // pose while the red/bone bloom settles (Colour commentary handles the rest).
    // Key the presentation state by the resolved *actor id* (a slot id like
    // home-RB1), not the raw roster id (`c.playerId` is home-1), so drawActor's
    // lookup by actor id actually selects the victim's casualty_death animation.
    const pres = s.presentation.get(actor.id) ?? {};
    pres.dead = true;
    s.presentation.set(actor.id, pres);
  }
  if (r.fumble) {
    const carrier = s.live?.carrier;
    // A fumble knocks the ball loose: no field actor carries it, so the carried
    // sprite must vanish (the loose-ball overlay takes over in drawOverlays).
    s.ballHolderId = null;
    if (carrier) {
      const f = projectActor(carrier.x, carrier.y, s.liveLos);
      const p = projectToScreen(f.x, f.y);
      s.looseBall = { x: p.x, y: p.y, ttl: 2.0 };
    }
  }
}

/** Commit the live-play result into the session and show the play-over banner. */
export function commitOutcome(s: MatchRuntime): void {
  const r = s.liveResult!;
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
  if (s.isPassPlay && r.outcome.kind === 'WHISTLE') {
    const scramble = resolveScrambleOutcome({
      finalX: r.finalX,
      outOfBounds: r.outOfBounds,
      outcome: r.outcome,
    });
    if (scramble.sacked) snap.force.sacked = true;
    if (scramble.qbRun) snap.force.qbRun = true;
    snap.force.yards = scramble.yards;
  }

  if (s.pendingHazardHits.length > 0) snap.hazards = [...s.pendingHazardHits];
  const res = s.session.snap(snap as Parameters<GameSession['snap']>[0]);
  showBanner(s, res.banner);
  collectDamageAndCasualties(s);

  // Presentation for the play-over roll: the tackled carrier drops into a
  // knockdown, the scoring carrier celebrates, and the tackler celebrates the
  // stop. These persist only until the next down's formation is prepared.
  const carrierId = s.live?.carrier.id;
  if (carrierId) {
    const pres = s.presentation.get(carrierId) ?? {};
    if (r.touchdown) pres.celebrating = true;
    else if (r.tackler) pres.downed = true;
    s.presentation.set(carrierId, pres);
  }
  if (r.tackler) {
    // `r.tackler` is the tackler's *actor id* (`away-DL1`), not its slot:
    // `LivePlay` records `nearest.id` (LivePlay.ts:492). Match against `a.id`
    // so the tackler's stop celebration lands on the defender sprite.
    const tackler = s.live?.actors.find((a) => a.id === r.tackler && a.side === 'DEFENSE');
    if (tackler) {
      const tacklerPres = s.presentation.get(tackler.id) ?? {};
      tacklerPres.celebrating = true;
      s.presentation.set(tackler.id, tacklerPres);
    }
  }
}

export function updateBanner(s: MatchRuntime, dt: number): void {
  // Terminal game: the result card stays up; START (P) or C (L) starts a fresh
  // match once the short lockout lapses (so a stray tap from the final play
  // cannot skip the result).
  if (s.gameOver) {
    s.bannerTimer -= dt;
    if (s.bannerTimer <= 0 && (s.pressedBtn('START') || s.pressedBtn('C'))) s.restartMatch();
    return;
  }
  s.bannerTimer -= dt;
  if (s.bannerTimer > 0) return;

  // A carnage forfeit (or a final-play snap) may already have left the session in
  // GAME_OVER; `dismissBanner()` throws outside PLAY_OVER_BANNER, so only dismiss
  // when a play-over banner is actually pending.
  if (s.session.phase === 'PLAY_OVER_BANNER') s.session.dismissBanner();

  // Collapse extra-point / kickoff / period wind-downs to the next huddle. A
  // quarter-ending snap transitions to QUARTER_END or HALFTIME, which need an
  // explicit `advancePeriod()` (its halftime kickoff then resolves through this
  // same loop) before another play can be offered.
  let guard = 0;
  while (s.session.phase !== 'HUDDLE_PLAYCALL' && s.session.phase !== 'GAME_OVER' && guard++ < 12) {
    if (s.session.phase === 'EXTRA_POINT') s.session.extraPoint('KICK');
    else if (s.session.phase === 'KICKOFF') s.session.kickoff({ touchback: true });
    else if (s.session.phase === 'PLAY_OVER_BANNER') s.session.dismissBanner();
    else if (s.session.phase === 'QUARTER_END' || s.session.phase === 'HALFTIME') {
      s.session.advancePeriod();
    } else break;
  }

  // After a terminal snap the session is GAME_OVER and no further play can be
  // selected; leaving it in PICK would let `selectPlays()` throw on the next down.
  s.live = null;
  s.liveResult = null;
  s.gameOver = s.session.phase === 'GAME_OVER';
  s.mode = s.gameOver ? 'BANNER' : 'PICK';
  // A completed down must forget the CPU's call so the next CPU down re-runs the
  // AI coach fresh (correct PUNT/FIELD_GOAL on 4th, rebuilt "CPU OFFENSE"
  // overlay, restored huddle beat). Leaving `cpuPlayId` set would make
  // `updatePick` confirm the stale play id immediately on the next down.
  s.cpuPlayId = null;
  s.cpuHuddleClock = 0;
  s.cpuSnapClock = 0;
  s.cpuPassClock = 0;
  // A terminal game swaps the play banner for the final-result card (inside the
  // viewport) and pins it; a short lockout guards against an accidental restart.
  if (s.gameOver) {
    s.bannerTimer = RESTART_LOCKOUT_SECONDS;
    renderResultCard(s);
  }
}

/** Seconds the result card ignores restart input after it appears. */
const RESTART_LOCKOUT_SECONDS = 0.6;

/** Replace the `#banner` content with the final-result card. */
function renderResultCard(s: MatchRuntime): void {
  const host = document.getElementById('banner');
  if (!host) return;
  const { winner, endReason, forfeitLoser, score, roster } = s.session;
  host.replaceChildren(
    buildResultCard({
      winner,
      homeScore: score.home,
      awayScore: score.away,
      homeName: roster.home.faction,
      awayName: roster.away.faction,
      reason: endReason,
      forfeitLoser,
    }),
  );
}
