/**
 * matchSim — the live-play fixed-timestep simulation loop, kick/pass resolution
 * and the airborne-ball / nasty-field stepping for `MatchScene`. Extracted
 * verbatim from the former scene methods; operates on the shared `MatchRuntime`
 * surface (same names, order and arithmetic) and is driven by
 * `matchController.updateMode`'s LIVE branch. Owns no state.
 */
import type { GameSession, Slot } from '../sim/index';
import { getOffensePlay } from '../sim/index';
import { projectActor } from '../field/fieldMapper';
import { projectToScreen, toPhaserColor } from '@monster-league/shared-core';
import type { LiveActorState } from '../field/LivePlay';
import { resolvePassAttempt } from '../field/PlayOrchestrator';
import { styleForHold } from '../field/Ballistics';
import { resolveKick, meterValue } from '../field/KickMeter';
import { catalogForDown, type MatchRuntime } from './matchController';
import { showBanner, collectDamageAndCasualties, commitOutcome } from './matchOutcome';
import { cpuOnOffense, cpuDrivePass } from './cpuOpponent';
import { updateHumanPassInput } from './humanPassInput';
import { updateDefenseButtons } from './defenseInput';

export function updateLive(s: MatchRuntime, dt: number): void {
  // Ball-in-flight animation runs to completion before further input lands.
  if (s.ballFlight) {
    advanceBallFlight(s, dt);
    return;
  }

  const live = s.live;
  if (!live) return;

  // Kick plays (punt / field goal) run a timing meter instead of a live down:
  // hold C to sweep the value, release C to lock it, then resolve and commit.
  if (s.isKickPlay) {
    updateKick(s, dt);
    return;
  }

  // Defense (CPU has the ball): B switches defender, A dives the controlled one.
  if (cpuOnOffense(s.session)) updateDefenseButtons(s, live);

  // Pass plays: C opens the receiving windows (scope: behind LOS); A/B/C throw
  // to the matching receiver while the windows are open. Hold length sets style.
  if (s.isPassPlay) {
    // CPU offense: the away QB opens its windows on a beat, then throws to the
    // receiver the existing pass-window logic scores best. No human key feeds it.
    if (cpuOnOffense(s.session)) {
      cpuDrivePass(
        s,
        dt,
        live.carrier.x,
        (a) => {
          const r = receiverFor(s, a);
          return r ? { id: r.id, x: r.x, y: r.y } : undefined;
        },
        (target) => commitPass(s, target),
        live,
      );
      // Fall through to the fixed-step loop with zero steer (below). A throw that
      // launched sets `ballFlight`, which the in-flight guard eats next frame.
    } else {
      updateHumanPassInput(s, dt, live, (target) => commitPass(s, target));
    }
  }

  // Feed the carrier command *inside* the fixed-step loop below, because the
  // nasty-field snapshot (hex inversion, Bat-Wing speed, grenade triggers) is
  // computed per step and must color the very same command that step consumes.
  const cpuOff = cpuOnOffense(s.session);
  const turboHeld = cpuOff ? false : s.buttonHeld('C');
  // B fires the carried weapon (grenades / Ghoul Gas). On a pass play B is the throw key
  // while receiver windows are open, so it only fires the weapon outside that window.
  // One press edge is consumed by the first fixed step so a frame running several steps
  // cannot throw every grenade at once.
  let pressedBThisTick = (cpuOff ? false : s.pressedBtn('B')) && !(s.isPassPlay && s.windowsOpen);

  // Advance a fixed-timestep 60 Hz simulation: accumulate the elapsed render
  // time and consume exactly the fixed steps due, so the field runs at real time
  // on any refresh rate (with 4 as a catch-up cap under a janky RAF). Hazards are
  // evaluated on *these same* steps, not once per render frame.
  s.simAccumulator += dt;
  const fixedDt = 1 / 60;
  let steps = 0;
  while (s.simAccumulator >= fixedDt && steps < 4) {
    s.simAccumulator -= fixedDt;
    s.liveElapsed += fixedDt;
    steps++;

    // Advance the nasty-field clocks once per fixed step (hex/gas/shroud timers,
    // grenade/gas triggers) and capture the snapshot that movement, input and
    // overlays all read this step.
    const carrier0 = live.snapshot().actors.find((a) => a.id === live.carrier.id);
    s.nastySnap = s.nastyFields.tick({
      effects: s.session.effects,
      t: s.liveElapsed,
      pressedB: pressedBThisTick,
      pressedC: s.pressedBtn('C'),
      carrierTeam: carrier0?.team ?? s.session.possession,
      carrierSlot: carrier0?.slot ?? 'RB1',
    });
    pressedBThisTick = false;

    // Hex of Confusion inverts the carrier's steering while its timer is live.
    let sx = cpuOff ? 0 : s.playerInput.x;
    let sy = cpuOff ? 0 : s.playerInput.y;
    if (s.nastySnap.hexRemaining > 0) {
      sx = -sx;
      sy = -sy;
    }

    live.command({
      steerX: sx,
      steerY: sy,
      dive: (cpuOff ? false : s.pressedBtn('A')) && !s.isPassPlay,
      turbo: turboHeld,
      defenderSteerX: cpuOff ? s.playerInput.x : 0,
      defenderSteerY: cpuOff ? s.playerInput.y : 0,
      frictionMult: s.lastFriction,
      slowMult: s.lastSlow,
      // Bat-Wing Jet Boost (+65% carrier speed) threads through here.
      speedMult: s.nastySnap.carrierSpeedMult,
    });

    const outcome = live.advance();

    // Apply nasty on-field effects that mutate the play (grenade/gas damage is
    // still committed via snap at whistle; here we surface the visible trigger).
    applyNastyStep(s, fixedDt);

    // Hazard terrain: evaluate on each fixed step so hazard effects advance at the
    // same rate as ball flight and movement.
    s.hazardManager.tick(fixedDt);
    const carrier = live.snapshot().actors.find((a) => a.id === live.carrier.id);
    if (carrier) {
      const influence = s.hazardManager.evaluate(
        carrier.x + s.liveLos,
        carrier.y,
        { team: carrier.team, side: carrier.side, slot: carrier.slot as Slot },
        carrier.diving,
        fixedDt,
      );
      // Thread the terrain modifiers into the carrier's NEXT commanded step (bog
      // friction, sludge slow) so graveyard tombstones and swamp patches actually
      // impede the carrier rather than being inert.
      s.lastFriction = influence.frictionMult;
      s.lastSlow = influence.slowMult;
      for (const hit of influence.hits) {
        s.pendingHazardHits.push(hit);
        // Surface the first hazard hit as a floating damage popup at the victim.
        if (s.hazardArmedForDemo) {
          const f = projectActor(carrier.x, carrier.y, s.liveLos);
          const p = projectToScreen(f.x, f.y);
          s.damagePopups.push({
            x: p.x,
            y: p.y - 20,
            text: `-${hit.amount}`,
            color: toPhaserColor('PUMPKIN_ORANGE'),
            ttl: 1.2,
          });
          s.hazardArmedForDemo = false;
        }
      }
    }
    if (outcome.kind === 'WHISTLE') break;

    // Accumulate actual distance travelled this fixed step (before the next
    // command overwrites positions) so run-frame playback advances with real
    // ground covered — not velocity × rendered frame, which runs fast at high
    // refresh and keeps counting during hit-stop/ball-flight/banner freezes.
    for (const a of live.snapshot().actors) {
      const prev = s.lastPos.get(a.id);
      if (prev) {
        const d = s.runDist.get(a.id) ?? 0;
        s.runDist.set(a.id, d + Math.hypot(a.x - prev.x, a.y - prev.y));
      }
      s.lastPos.set(a.id, { x: a.x, y: a.y });
    }
  }

  if (live.snapshot().outcome.kind === 'WHISTLE') {
    s.liveResult = live.result();
    commitOutcome(s);
  }
}

/**
 * Punt / field-goal timing meter (button C). Holding C sweeps the meter value;
 * releasing C locks it. On lock the kick resolves through `session.snap` with an
 * explicit `puntYards` / `fieldGoalGood`, so the KickMeter actually drives the
 * special-teams outcome instead of being dead code.
 */
function updateKick(s: MatchRuntime, dt: number): void {
  const play = s.cpuPlayId
    ? { id: s.cpuPlayId, kind: getOffensePlay(s.cpuPlayId).kind }
    : catalogForDown(s.session.down)[s.selectedPlayIndex]!;
  const cHeld = cpuOnOffense(s.session) ? true : s.buttonHeld('C');

  if (s.kickLocked === null) {
    if (cHeld) {
      s.kickHoldMs += dt * 1000; // ms like the pass hold timer
      // CPU kicks: lock at a fair middle-of-the-meter value after a short sweep.
      if (cpuOnOffense(s.session) && s.kickHoldMs >= 450) {
        s.kickLocked = meterValue(s.kickHoldMs / 1000);
      }
    } else if (s.kickHoldMs > 0) {
      // Released after a hold → lock the current sweep position.
      s.kickLocked = meterValue(s.kickHoldMs / 1000);
    }
    return;
  }

  // Resolved: commit once, then the banner path advances the down as usual.
  if (s.kickCommitted) return;
  s.kickCommitted = true;

  const distanceToGoal = 100 - s.session.los;
  const outcome = resolveKick(s.kickLocked, distanceToGoal, play.kind === 'PUNT' ? 60 : 0);
  const force: { puntYards?: number; fieldGoalGood?: boolean } = {};
  if (play.kind === 'PUNT') force.puntYards = outcome.puntYards;
  else force.fieldGoalGood = outcome.fieldGoalGood;

  const res = s.session.snap({ force } as Parameters<GameSession['snap']>[0]);
  // A punt / field goal resolves instantly: the ball is away the moment the
  // kick is locked. Clear presentation ownership so the carrier doesn't keep a
  // carried-football sprite at its hands through the special-teams result
  // banner (there is no in-flight overlay on kicks to take over from it).
  s.ballHolderId = null;
  showBanner(s, res.banner);
  collectDamageAndCasualties(s);
}

/** Advance the airborne ball by elapsed real time; resolve on landing. */
function advanceBallFlight(s: MatchRuntime, dt: number): void {
  const b = s.ballFlight;
  if (!b) return;
  // Advance by the elapsed frame time, not a fixed 1/60 s per rendered frame:
  // otherwise the ball lands sooner on faster displays (frame-rate coupling).
  b.t += dt;
  // The throw-release window (`passingUntil`) is measured on `liveElapsed`, but
  // `updateLive` returns early while the ball is in flight, so that clock would
  // otherwise freeze at launch time and a lob would hold the QB in the final
  // throw pose until landing (lobs routinely outlast the 0.6 s release window).
  // Advance it here too so the QB's release pose decays back to idle/run a fixed
  // 0.6 s after the launch, independent of how long the ball stays airborne.
  s.liveElapsed += dt;
  if (b.t >= b.dur) {
    s.ballFlight = null;
    b.onLand();
  }
}

/**
 * Surface the nasty-field effects produced this fixed step. Grenades and gas
 * damage are committed by the sim at the whistle (it resolves DYNAMITE_PITCH /
 * GHOUL_GAS weapon damage from the active play), so here we only render the
 * *visible* trigger — a flicker marker at the carrier and, for a grenade, a
 * popup at a nearby defender. Shroud (spectral alpha) and Kill Ref (hunt state)
 * are read live in the render pass from `s.nastySnap` + the session ref.
 */
function applyNastyStep(s: MatchRuntime, _dt: number): void {
  const snap = s.nastySnap;
  if (!snap || !s.live) return;

  const carrier = s.live.snapshot().actors.find((a) => a.id === s.live!.carrier.id);
  if (!carrier) return;
  const c = projectActor(carrier.x, carrier.y, s.liveLos);

  // A grenade throw — a quick spark marker at the carrier and a damage popup on
  // the nearest defender (the sim records the actual damage at snap).
  if (snap.grenadesThrown > 0) {
    const defenders = s.live.snapshot().actors.filter((a) => a.side === 'DEFENSE');
    const target =
      defenders.sort(
        (a, b) =>
          (a.x - carrier.x) ** 2 +
          (a.y - carrier.y) ** 2 -
          ((b.x - carrier.x) ** 2 + (b.y - carrier.y) ** 2),
      )[0] ?? carrier;
    const tp = projectActor(target.x, target.y, s.liveLos);
    const ts = projectToScreen(tp.x, tp.y);
    s.damagePopups.push({
      x: ts.x,
      y: ts.y - 20,
      text: 'BOOM!',
      color: toPhaserColor('PUMPKIN_ORANGE'),
      ttl: 0.9,
    });
  }

  // Ghoul Gas drop — mark the cloud so the render pass dims defenders near it.
  if (snap.gasDropped) {
    s.gasCloud = { x: c.x, y: c.y, until: s.liveElapsed + 3 };
  }
}

/**
 * Launch a pass throw to receiver A/B/C. The ball flies a closed-form arc
 * (lob or bullet by hold length) and only resolves catch vs interception on
 * landing, giving the shadow/z flight its on-field moment.
 */
export function commitPass(s: MatchRuntime, target: 'A' | 'B' | 'C'): void {
  const live = s.live;
  if (!live) return;
  const qb = live.snapshot().actors.find((a) => a.id === live.carrier.id);
  const receiver = receiverFor(s, target);
  if (!qb || !receiver) {
    console.warn(
      'commitPass: missing qb or receiver',
      !!qb,
      !!receiver,
      'carrier',
      live.carrier.id,
      'receiver',
      target,
    );
    return;
  }
  // A forward pass is only legal while the QB is behind (or on) the LOS. Guard
  // here so the debug throw path cannot bypass the windows check and throw
  // downfield after a scramble.
  if (qb.x > 0) {
    s.windowsOpen = false;
    return;
  }

  const style = styleForHold(s.passHoldMs);
  const holdMs = s.passHoldMs;
  const dist = Math.hypot(receiver.x - qb.x, receiver.y - qb.y);
  const speed = style === 'BULLET' ? 22 : 13;
  // Keep the animation readable regardless of distance (min ~0.45s).
  const dur = Math.max(0.45, dist / speed);
  s.windowsOpen = false;
  // The ball leaves the QB's hands the moment the throw launches; carried-ball
  // rendering switches to the in-flight overlay (drawOverlays) for the duration.
  s.ballHolderId = null;
  // Arm the QB's one-shot throw release: play the row-9 release frames once while
  // the ball is airborne (a ~0.5 s window covers even the fastest bullet), instead
  // of snapping straight to idle the instant `windowsOpen` drops.
  s.passingUntil = s.liveElapsed + 0.6;
  s.ballFlight = {
    fromX: qb.x,
    fromY: qb.y,
    toX: receiver.x,
    toY: receiver.y,
    t: 0,
    dur,
    style,
    holdMs,
    onLand: () => resolvePassLanding(s, target, holdMs),
  };
}

function receiverFor(s: MatchRuntime, target: 'A' | 'B' | 'C'): LiveActorState | undefined {
  const live = s.live;
  if (!live) return undefined;
  const slotFor = { A: 'WR/TE', B: 'RB2/WR', C: 'RB1' } as const;
  const receiverId = `${s.session.possession}-${slotFor[target]}`;
  return live.snapshot().actors.find((a) => a.id === receiverId);
}

function resolvePassLanding(s: MatchRuntime, target: 'A' | 'B' | 'C', holdMs: number): void {
  const live = s.live;
  if (!live) return;
  const qb = live.snapshot().actors.find((a) => a.id === live.carrier.id);
  const receiver = receiverFor(s, target);
  const defs = live.snapshot().actors.filter((a) => a.side === 'DEFENSE');
  if (!qb || !receiver) return endDownFromPass(s);

  const snap = resolvePassAttempt(
    {
      fromX: qb.x,
      fromY: qb.y,
      toX: receiver.x,
      toY: receiver.y,
      holdMs,
      defenders: defs.map((d) => ({ id: d.id, x: d.x, y: d.y })),
    },
    target,
  );
  // Fold any accumulated hazard hits into the same snap.
  if (s.pendingHazardHits.length > 0) snap.hazards = [...s.pendingHazardHits];
  const res = s.session.snap(snap);
  showBanner(s, res.banner);
  // The receiver catches and holds the ball only on a completion; on a pick or
  // deflection/incompletion the down ends without any field actor carrying it
  // (the next down's snap re-initializes ownership). `live.carrier` still names
  // the passer, so ownership must NOT fall back to the QB here.
  s.ballHolderId = snap.force?.complete ? receiver.id : null;
  collectDamageAndCasualties(s);
  // A completed catch ends through `snap` (not `commitOutcome`), so the receiver's
  // presentation state never runs through the play-over roll. Mirror it here from
  // the committed result: a touchdown completion celebrates, an ordinary completion
  // is tackled (GameSession already applied the receiver's tackle damage above) and
  // drops into a knockdown. Death (a lethal hazard on the catch) still wins because
  // `collectDamageAndCasualties` set `dead` first and `baseAnimation` prefers it.
  if (snap.force?.complete) {
    const lastRes = s.session.lastResult;
    const pres = s.presentation.get(receiver.id) ?? {};
    if (!pres.dead) pres.celebrating = lastRes?.touchdown === true;
    if (!pres.dead && !pres.celebrating) pres.downed = true;
    s.presentation.set(receiver.id, pres);
  }
  void qb;
}

function endDownFromPass(s: MatchRuntime): void {
  showBanner(s, 'INCOMPLETE');
  collectDamageAndCasualties(s);
}
