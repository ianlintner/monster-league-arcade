/**
 * actorPresenter — frame-by-frame drawing of the live-play actors, referee and
 * ball, plus ground indicators and frame overlays (in-flight ball, pass windows,
 * kick meter, damage popups, casualties, loose ball).
 *
 * Extracted verbatim from `MatchScene`. Unlike the *pure* helpers
 * (`spriteRenderer`, `fieldTextures`), this presenter imports Phaser: it spawns
 * image/graphics/text objects into the scene's layers. It owns **no state** — it
 * draws through a `PresentScene` surface, reading (and, for the few fields the
 * originals mutated in place, writing) exactly the same members the original
 * methods touched. The animation-distance (`runDist`/`lastPos`), clock
 * (`animClock`/`animKind`) and terminal-status (`presentation`) maps stay on the
 * scene because the sim block also reads/writes them between frames; the
 * presenter sees them through the surface.
 *
 * The methods are faithful ports — same names, same order, same arithmetic. The
 * public entry points `renderActors()` / `renderOverlays(dt)` mirror the original
 * `drawActors()` / `drawOverlays(dt)` call sites in `update()`.
 */
import {
  HALLOWEEN_MIDNIGHT_PALETTE as P,
  projectToScreen,
  toPhaserColor,
} from '@monster-league/shared-core';
import type * as Phaser from 'phaser';
import { projectActor } from '../field/fieldMapper';
import { meterValue, KICK_METER } from '../field/KickMeter';
import type { LivePlay, LiveActorState } from '../field/LivePlay';
import {
  REF_SHEET_NECRO,
  REF_SHEET_DEMON,
  SPRITE_CELL,
  SPRITE_COLS,
  baseAnimation,
  resolveActorCell,
  sheetKey,
  type ActorAnimation,
  type ActorPresentationState,
} from './spriteRenderer';
import type { DrawSurface } from './fieldRenderer';

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

/** Actor draw data cached per frame for y-sorting. */
export interface RenderActor {
  state: LiveActorState;
  px: number;
  py: number;
  depth: number;
  scale: number;
  isCarrier: boolean;
  isHighlighted: boolean;
}

/**
 * The scene surface the presenter draws through. Typed read/write so the ports
 * keep the exact `this.x` accesses and in-place mutations of the originals. The
 * scene (MatchScene) declares every one of these fields and satisfies the
 * interface structurally.
 */
export interface PresentScene {
  // -- Phaser factory + layers (stable, written at create) --------------------
  add: Phaser.GameObjects.GameObjectFactory;
  textures: Phaser.Textures.TextureManager;
  actorsLayer: Phaser.GameObjects.Container;
  indicatorGfx: Phaser.GameObjects.Graphics;
  groundGfx: Phaser.GameObjects.Graphics;
  // -- once-per-session resolution (read-only to the presenter) ---------------
  homeSheet: string;
  awaySheet: string;
  // -- live-play state ---------------------------------------------------------
  live: LivePlay | null;
  liveLos: number;
  liveElapsed: number;
  renderDt: number; // animTime reads it; the scene sets it each update()
  session: { ref: { kind: 'NECRO_REF' | 'DEMON_REF' }; possession: 'home' | 'away' };
  isPassPlay: boolean;
  windowsOpen: boolean;
  passingUntil: number;
  ballHolderId: string | null;
  highlightDefender: number;
  gasCloud: { x: number; y: number; until: number } | null;
  firstDownFieldX: number;
  isKickPlay: boolean;
  kickHoldMs: number;
  kickLocked: number | null;
  ballFlight: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    t: number;
    dur: number;
    style: 'LOB' | 'BULLET';
  } | null;
  // -- presentation maps shared with the sim block (read/write where noted) ----
  runDist: Map<string, number>;
  animClock: Map<string, number>;
  animKind: Map<string, ActorAnimation>;
  presentation: Map<string, ActorPresentationState>;
  // -- transient lists (MUTATED in place / re-assigned by renderOverlays) -----
  damagePopups: { x: number; y: number; text: string; color: number; ttl: number }[];
  casualties: { id: string; x: number; y: number; ttl: number; label?: string }[];
  looseBall: { x: number; y: number; ttl: number } | null;
}

/** Render counters the presenter hands back for the scene to store. */
export interface ActorRenderResult {
  spriteBackedActorCount: number;
  carrierScreen: { px: number; py: number; scale: number } | null;
}

/** Transient overlays the presenter re-assigns (ttl filter / loose-ball clear). */
export interface OverlayRenderResult {
  damagePopups: PresentScene['damagePopups'];
  casualties: PresentScene['casualties'];
  looseBall: PresentScene['looseBall'];
}

export class ActorPresenter {
  /** Rebuild actor sprites + ground indicators + referee for the current frame.
   *  Faithful port of MatchScene.drawActors(). */
  renderActors(scene: PresentScene): ActorRenderResult {
    scene.actorsLayer.removeAll(true);
    let spriteBackedActorCount = 0;
    // The overlay Graphics is rebuilt every frame; clear it up front so pass
    // reticles and any previous frame's in-flight ball / bloom markers do not
    // accumulate into permanent trails (and a growing command buffer).
    scene.indicatorGfx.clear();
    // The ground layer holds down-transient marks (LOS/first-down lines, carrier
    // ring/stamina arc) that must die with the play. It is normally cleared at the
    // top of `drawIndicators`, but that runs *after* the `!scene.live` early return.
    // Clear it here too so a banner→huddle transition (`live = null`) cannot leave
    // the previous down's scrimmage line / carrier ring frozen on the field.
    scene.groundGfx.clear();
    if (!scene.live) return { spriteBackedActorCount: 0, carrierScreen: null };

    const los = scene.liveLos;
    // Resolve the highlighted defender's id once (B cycles index 0..6).
    const defenders = scene.live.actors.filter((x) => x.side === 'DEFENSE');
    const hlId = scene.highlightDefender >= 0 ? defenders[scene.highlightDefender]?.id : undefined;
    const carrierId = scene.live.carrier.id;

    const actors: RenderActor[] = scene.live.actors.map((state) => {
      const f = projectActor(state.x, state.y, los);
      const s = projectToScreen(f.x, f.y);
      return {
        state,
        px: s.x,
        py: s.y,
        depth: s.y,
        scale: s.scale,
        isCarrier: state.id === carrierId,
        isHighlighted: hlId !== undefined && state.id === hlId,
      };
    });

    // Cache the controlled carrier's projected footprint for the e2e readability
    // assertion (read-only), so the spec can verify the on-screen sprite without
    // interrogating Phaser internals or bypassing input.
    const carrierActor = actors.find((a) => a.isCarrier) ?? null;
    const carrierScreen = carrierActor
      ? { px: carrierActor.px, py: carrierActor.py, scale: carrierActor.scale }
      : null;

    // Ground indicators render under every actor. The LOS/first-down lines and
    // selection ring are drawn below the actors so they never cover a sprite.
    this.drawIndicators(scene, actors);

    // Referee sprite: pure presentation, never part of `live.actors`.
    spriteBackedActorCount += this.drawReferee(scene, los);

    actors.sort((a, b) => a.depth - b.depth);
    for (const a of actors) spriteBackedActorCount += this.drawActor(scene, a);

    // Phaser Containers render children in insertion (list) order, ignoring the
    // `setDepth` calls made on individual children. The referee is drawn first and
    // each actor's ring/shadow/ball after its sprite, so without an explicit
    // re-sort a far player can cover the near-sideline referee and a defender's
    // ring can draw over its own sprite. Reorder the container's children by the
    // depth each was assigned once everything for this frame is in place — before
    // the gas cloud and pass-window overlays are appended on top.
    scene.actorsLayer.sort('depth');

    // Ghoul Gas cloud: a translucent toxic ellipse at the drop spot, dimming any
    // defender who stands inside it (poison is committed by the sim at snap; this
    // is the on-field visual).
    if (scene.gasCloud && scene.liveElapsed <= scene.gasCloud.until) {
      const f = scene.gasCloud;
      const s = projectToScreen(f.x, f.y);
      const gas = scene.add.ellipse(s.x, s.y, 40 * s.scale, 24 * s.scale, 0x22cc66, 0.25);
      gas.setDepth(50);
      scene.actorsLayer.add(gas);
    }

    // Passing windows float over eligible receivers while open (pass play).
    if (scene.isPassPlay && scene.windowsOpen && !scene.ballFlight) this.drawPassWindows(scene);
    return { spriteBackedActorCount, carrierScreen };
  }

  /** Draw the frame overlays (in-flight ball, popups, casualties, loose ball,
   *  kick meter). Faithful port of MatchScene.drawOverlays(dt). */
  renderOverlays(scene: PresentScene, dt: number): OverlayRenderResult {
    const g = scene.indicatorGfx;

    // Ball in flight: ellipse shadow on the turf + ball offset up by z.
    if (scene.ballFlight) {
      const b = scene.ballFlight;
      const tt = Math.max(0, Math.min(1, b.t / b.dur));
      const px = b.fromX + (b.toX - b.fromX) * tt;
      const py = b.fromY + (b.toY - b.fromY) * tt;
      // Closed-form apex (parabola) matches Ballistics.sampleFlight.
      const apex = b.style === 'BULLET' ? 1.0 : 1.8;
      const z = apex * 4 * tt * (1 - tt);
      const f = projectActor(px, py, scene.liveLos);
      const s = projectToScreen(f.x, f.y, z);
      g.fillStyle(0x000000, 0.35);
      g.fillEllipse(s.x, s.y + z, 7 * s.scale, 4 * s.scale);
      g.fillStyle(toPhaserColor('PUMPKIN_ORANGE'), 1);
      g.fillEllipse(s.x, s.y, 4 * s.scale, 4 * s.scale);
    }

    // Damage numbers, rising and fading (x/y are cached screen coords).
    for (const p of scene.damagePopups) {
      const rise = 20 * (1 - p.ttl / 1.4);
      const a = Math.max(0, p.ttl / 1.4);
      const t = scene.add
        .text(p.x, p.y - rise, p.text, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '9px',
          color: `#${p.color.toString(16).padStart(6, '0')}`,
        })
        .setOrigin(0.5, 0.5)
        .setAlpha(a)
        .setDepth(300);
      scene.actorsLayer.add(t);
      p.ttl -= dt;
    }
    const damagePopups = scene.damagePopups.filter((p) => p.ttl > 0);

    // Casualties: the victim shatters into a red/bone bloom then vanishes.
    for (const c of scene.casualties) {
      const a = Math.max(0, c.ttl / 2.0);
      g.fillStyle(toPhaserColor('VAMPIRE_CRIMSON'), a);
      g.fillEllipse(c.x, c.y, 18 * (1 - c.ttl / 2.0), 18 * (1 - c.ttl / 2.0));
      g.fillStyle(toPhaserColor('BONE_WHITE'), a);
      g.fillEllipse(c.x, c.y, 8, 8);
      // In-canvas callout: the broadcast banner names the event globally, this
      // one names the victim at the spot they went down. Clamped inside the
      // 640x360 canvas so it stays readable at 1280x720 (2x integer scale).
      if (c.label) {
        const hex = `#${toPhaserColor('VAMPIRE_CRIMSON').toString(16).padStart(6, '0')}`;
        const t = scene.add
          .text(
            Math.max(112, Math.min(CANVAS_WIDTH - 112, c.x)),
            Math.max(48, c.y - 26),
            c.label,
            {
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '10px',
              color: hex,
              stroke: '#0B0711',
              strokeThickness: 3,
            },
          )
          .setOrigin(0.5, 1)
          .setAlpha(a)
          .setDepth(301);
        scene.actorsLayer.add(t);
      }
      c.ttl -= dt;
    }
    const casualties = scene.casualties.filter((c) => c.ttl > 0);

    // Loose ball: a bouncing amber orb at the recovery spot.
    let looseBall = scene.looseBall;
    if (looseBall) {
      const lb = looseBall;
      const bounce = Math.abs(Math.sin(lb.ttl * 8)) * 6;
      g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
      g.fillEllipse(lb.x, lb.y - bounce, 5, 5);
      lb.ttl -= dt;
      if (lb.ttl <= 0) looseBall = null;
    }

    // Kick meter: a horizontal sweep bar with a centre sweet band, shown during
    // punt / field-goal attempts while sweeping (and frozen at the lock).
    if (scene.isKickPlay && scene.kickLocked === null) {
      const val = meterValue(scene.kickHoldMs / 1000);
      const x0 = CANVAS_WIDTH / 2 - 80;
      const x1 = CANVAS_WIDTH / 2 + 80;
      const y = CANVAS_HEIGHT - 44;
      const { sweetBandMin, sweetBandMax } = KICK_METER;
      g.lineStyle(2, toPhaserColor('IRON_BEZEL'), 1);
      g.lineBetween(x0, y, x1, y);
      g.fillStyle(toPhaserColor('ECTO_GREEN'), 0.4);
      g.fillRect(
        x0 + (x1 - x0) * sweetBandMin,
        y - 4,
        (x1 - x0) * (sweetBandMax - sweetBandMin),
        8,
      );
      const mx = x0 + (x1 - x0) * val;
      g.fillStyle(toPhaserColor('PUMPKIN_ORANGE'), 1);
      g.fillRect(mx - 2, y - 6, 4, 12);
    } else if (scene.isKickPlay && scene.kickLocked !== null) {
      const x0 = CANVAS_WIDTH / 2 - 80;
      const x1 = CANVAS_WIDTH / 2 + 80;
      const y = CANVAS_HEIGHT - 44;
      const mx = x0 + (x1 - x0) * scene.kickLocked;
      g.fillStyle(toPhaserColor('BONE_WHITE'), 1);
      g.fillRect(mx - 3, y - 7, 6, 14);
    }
    return { damagePopups, casualties, looseBall };
  }

  // ------------------------------------------------------------ private draw

  /** Per-actor seconds since its current animation began, restarting the clock
   *  whenever the animation changes (a fresh dive/throw/knockdown starts on frame
   *  0 rather than an arbitrary mid-animation frame). */
  private animTime(scene: PresentScene, id: string, anim: ActorAnimation): number {
    const last = scene.animKind.get(id);
    if (last !== anim) {
      scene.animKind.set(id, anim);
      scene.animClock.set(id, 0);
      return 0;
    }
    const t = (scene.animClock.get(id) ?? 0) + scene.renderDt;
    scene.animClock.set(id, t);
    return t;
  }

  private drawActor(scene: PresentScene, a: RenderActor): number {
    const s = a.state;
    const baseSheet = s.team === 'home' ? scene.homeSheet : scene.awaySheet;
    const sheet = sheetKey(baseSheet, s.team !== 'home');
    const frameAccum = scene.runDist.get(s.id) ?? 0;
    const passing: 'aim' | 'throw' | null = a.isCarrier
      ? scene.isPassPlay && scene.windowsOpen && !scene.ballFlight
        ? 'aim'
        : scene.isPassPlay && scene.liveElapsed <= scene.passingUntil && scene.ballFlight
          ? 'throw'
          : null
      : null;
    const presentation = scene.presentation.get(s.id) ?? {};
    const anim = baseAnimation(s, passing, presentation);
    const cell = resolveActorCell(
      s,
      sheet,
      frameAccum,
      this.animTime(scene, s.id, anim),
      passing,
      presentation,
    );

    const frameIndex = cell.row * SPRITE_COLS + cell.col;
    const sp = scene.add.image(a.px, a.py + 4 * a.scale, cell.sheet, frameIndex);
    sp.setOrigin(0.5, 1);
    sp.setScale(a.scale);
    sp.setDepth(a.depth);
    if (cell.flipX) sp.setFlipX(true);
    scene.actorsLayer.add(sp);

    const shadow = scene.add.ellipse(a.px, a.py, 18 * a.scale, 6 * a.scale, 0x000000, 0.35);
    shadow.setDepth(a.depth - 0.5);
    scene.actorsLayer.add(shadow);

    if (s.id === scene.ballHolderId && !scene.ballFlight) {
      const windupHoldsBall =
        (cell.animation === 'pass_aim' && cell.col < 3) ||
        (cell.animation === 'pass_aim_throw' && cell.col < 3);
      this.drawCarriedBall(
        scene,
        a.px,
        a.py - 12 * a.scale,
        a.py,
        a.scale,
        a.depth,
        windupHoldsBall,
      );
    }
    return 1;
  }

  private drawReferee(scene: PresentScene, los: number): number {
    const sheet = scene.session.ref.kind === 'DEMON_REF' ? REF_SHEET_DEMON : REF_SHEET_NECRO;
    if (!scene.textures.exists(sheet)) return 0;

    const f = projectActor(-3, 24, los);
    const s = projectToScreen(f.x, f.y);
    const idleCol = Math.floor(scene.liveElapsed * 4) % 4;
    const ref = scene.add.image(s.x, s.y + 4 * s.scale, sheet, idleCol);
    ref.setOrigin(0.5, 1);
    ref.setScale(s.scale);
    ref.setDepth(s.y);
    scene.actorsLayer.add(ref);

    const shadow = scene.add.ellipse(s.x, s.y, 18 * s.scale, 6 * s.scale, 0x000000, 0.35);
    shadow.setDepth(s.y - 0.5);
    scene.actorsLayer.add(shadow);
    return 1;
  }

  private drawCarriedBall(
    scene: PresentScene,
    px: number,
    py: number,
    groundPy: number,
    scale: number,
    depth: number,
    ballInArtwork = false,
  ): void {
    const hw = 3 * scale;
    const hh = 2 * scale;
    if (!ballInArtwork) {
      const g = scene.add.graphics();
      g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
      g.fillEllipse(px, py, hw * 2, hh * 2);
      g.lineStyle(1, toPhaserColor('BONE_WHITE'), 0.9);
      g.lineBetween(px - hw, py, px + hw, py);
      g.lineBetween(px - hw * 0.4, py - hh, px - hw * 0.4, py + hh);
      g.lineBetween(px + hw * 0.4, py - hh, px + hw * 0.4, py + hh);
      g.setDepth(depth + 0.2);
      scene.actorsLayer.add(g);
    }

    const shadow = scene.add.ellipse(px, groundPy, hw, 2 * scale, 0x000000, 0.3);
    shadow.setDepth(depth - 0.5);
    scene.actorsLayer.add(shadow);
  }

  private drawIndicators(scene: PresentScene, actors: RenderActor[]): void {
    const g = scene.groundGfx;
    g.clear();

    const losFieldX = 10 + scene.liveLos;
    const losTop = projectToScreen(losFieldX, 0);
    const losBot = projectToScreen(losFieldX, 53);
    g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
    g.lineBetween(losTop.x, losTop.y, losBot.x, losBot.y);

    if (scene.firstDownFieldX > losFieldX && scene.firstDownFieldX < 110) {
      const fdTop = projectToScreen(scene.firstDownFieldX, 0);
      const fdBot = projectToScreen(scene.firstDownFieldX, 53);
      g.lineStyle(2, toPhaserColor('HELLFIRE_AMBER'), 0.9);
      g.lineBetween(fdTop.x, fdTop.y, fdBot.x, fdBot.y);
    }

    // The user-controlled defender (CPU has the ball) gets the same ring/arrow.
    const controlled = actors.find((a) => a.isHighlighted);
    if (controlled) this.drawControlRing(g, controlled);

    const carrier = actors.find((a) => a.isCarrier);
    if (!carrier) return;
    this.drawStar(g, carrier.px, carrier.py + 4);
    this.drawControlRing(g, carrier);
  }

  /** Ground ring, heading arrow and stamina arc for a user-controlled actor. */
  private drawControlRing(g: PresentScene['groundGfx'], a: RenderActor): void {
    const { state, px, py } = a;
    const r = 16;
    g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
    g.strokeEllipse(px, py - 8, r, r * 0.7);

    const mag = Math.hypot(state.vx, state.vy);
    if (mag > 0.1) {
      const nx = state.vx / mag;
      const ny = state.vy / mag;
      g.lineBetween(px, py - 8, px + nx * 18, py - 8 + ny * 8);
    }

    const frac = Math.max(0, Math.min(1, state.stamina));
    g.lineStyle(2, toPhaserColor('ECTO_GREEN'), 0.85);
    g.beginPath();
    g.arc(px, py - 8, r + 3, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
    g.strokePath();
  }

  private drawStar(g: DrawSurface, cx: number, cy: number): void {
    const r = 4;
    g.fillStyle(toPhaserColor('HELLFIRE_AMBER'), 1);
    g.fillTriangle(cx, cy - r, cx + r * 0.7, cy, cx, cy + r);
    g.fillTriangle(cx, cy - r, cx - r * 0.7, cy, cx, cy + r);
    g.fillTriangle(cx - r, cy, cx + r, cy, cx, cy - r * 1.6);
  }

  private drawPassWindows(scene: PresentScene): void {
    const live = scene.live;
    if (!live) return;
    const keys = ['A', 'B', 'C'] as const;
    const slotFor = { A: 'WR/TE', B: 'RB2/WR', C: 'RB1' } as const;
    for (const key of keys) {
      const id = `${scene.session.possession}-${slotFor[key]}`;
      const actor = live.actors.find((a) => a.id === id);
      if (!actor) continue;
      const f = projectActor(actor.x, actor.y, scene.liveLos);
      const s = projectToScreen(f.x, f.y);

      const g = scene.indicatorGfx;
      g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 0.9);
      const rx = 7 * s.scale;
      g.lineBetween(s.x - rx, s.y, s.x, s.y - rx);
      g.lineBetween(s.x, s.y - rx, s.x + rx, s.y);
      g.lineBetween(s.x + rx, s.y, s.x, s.y + rx);
      g.lineBetween(s.x, s.y + rx, s.x - rx, s.y);

      const badge = scene.add
        .text(s.x, s.y - (SPRITE_CELL - 4) * s.scale - 20, `[${key}]`, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '8px',
          color: P.SPECTRAL_CYAN,
          backgroundColor: 'rgba(11,7,17,0.7)',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(200);
      scene.actorsLayer.add(badge);
    }
  }
}
