/**
 * debugHandle — the `window.__mlf` e2e/dev seam for the match scene.
 *
 * Extracted verbatim from `MatchScene.exposeDebugHandle`. It owns no state: the
 * scene passes a read/write surface (getters for the fields the specs read, and
 * primitives the specs' driver callbacks invoke) and this module only assembles
 * the public object and attaches it to `window`. The read getters are lazy and
 * null-guarded exactly as the originals were, so reading `__mlf.phase` mid-preload
 * returns a calm `null`/`''` instead of throwing; the driver callbacks reproduce
 * the originals' mode/pass guards verbatim.
 */
import type { GameSession } from '../sim/index';
import { decideCoachPlay } from '../ai/AICoach';
import type { LivePlay } from '../field/LivePlay';
import type { HazardManager } from '../field/HazardManager';

/** Read/write surface the scene satisfies to expose its debug seam. */
export interface DebugHandleSurface {
  session: () => GameSession | null;
  live: () => LivePlay | null;
  mode: () => 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER';
  isPassPlay: () => boolean;
  windowsOpen: () => boolean;
  ballInFlight: () => boolean;
  selectedPlayIndex: () => number;
  cpuPlayId: () => string | null;
  lastResult: () => GameSession['lastResult'] | null;
  hazardManager: () => HazardManager | null;
  spriteBackedActorCount: () => number;
  carrierScreen: () => { px: number; py: number; scale: number } | null;
  camZoom: () => number;
  bannerKind: () => string;
  confirmPlay: (index: number) => void;
  beginLivePlay: () => void;
  openPassWindows: () => void;
  commitPassTo: (t: 'A' | 'B' | 'C') => void;
  relocateCarrier: (x: number, y: number) => void;
}

/**
 * Install `window.__mlf` from the scene surface. Faithful port of
 * `MatchScene.exposeDebugHandle()`.
 */
export function installDebugHandle(s: DebugHandleSurface): void {
  const session = () => s.session();
  const live = () => s.live();
  const mode = () => s.mode();
  const isPassPlay = () => s.isPassPlay();
  const windowsOpen = () => s.windowsOpen();
  const selectedPlay = () => s.selectedPlayIndex();
  const lastResult = () => s.lastResult();
  const hazardManager = () => s.hazardManager();
  const spriteBackedActors = () => s.spriteBackedActorCount();
  const carrierScreen = () => s.carrierScreen();
  const camZoom = () => s.camZoom();
  const bannerKind = () => s.bannerKind();
  const aiDecision = () => {
    // Debug probe only: "what would the AI coach call for the team currently in
    // possession on offense?" This is NOT live gameplay wiring — the human
    // offense still calls its own play via `selectPlays`, and no `callNasty` is
    // driven from here. Wiring a 1P-vs-AI opponent loop is deferred (see PR note).
    const sess = s.session();
    if (!sess) return null;
    const team = sess.possession;
    return decideCoachPlay({
      down: sess.down,
      yardsToGo: sess.yardsToGo,
      los: sess.los,
      quarter: sess.quarter,
      clockSeconds: sess.clock,
      score: sess.score,
      team,
      aiIsOffense: true,
      ownCasualties: sess.roster[team].casualties,
      refBribedAgainst: sess.ref.isBribed && sess.ref.bribedBy !== team,
      demonRefActive: sess.ref.kind === 'DEMON_REF',
      availableNasties: sess.charges.remaining(team, sess.half),
    });
  };
  (window as unknown as Record<string, unknown>).__mlf = {
    session: session(),
    get phase() {
      return session()?.phase ?? '';
    },
    get mode() {
      return mode();
    },
    get score() {
      return session()?.score ?? null;
    },
    get quarter() {
      return session()?.quarter ?? null;
    },
    get los() {
      return session()?.los ?? null;
    },
    get down() {
      return session()?.down ?? null;
    },
    get possession() {
      return session()?.possession ?? null;
    },
    get cpuPlayId() {
      return s.cpuPlayId();
    },
    get carrierId() {
      return live()?.carrier.id ?? null;
    },
    get isPassPlay() {
      return isPassPlay();
    },
    get windowsOpen() {
      return windowsOpen();
    },
    get playIndex() {
      return selectedPlay();
    },
    get lastDamage() {
      return lastResult()?.damage.length ?? 0;
    },
    get lastCasualties() {
      return lastResult()?.casualties.length ?? 0;
    },
    get hazards() {
      return hazardManager()?.snapshot() ?? [];
    },
    get bannerKind() {
      return bannerKind();
    },
    get aiDecision() {
      return aiDecision();
    },
    get actors() {
      return (
        live()?.actors.map((a) => ({ id: a.id, side: a.side, slot: a.slot, x: a.x, y: a.y })) ?? []
      );
    },
    // Count of sprite-backed actors rendered last frame (14 field players +
    // 1 referee). The e2e suite asserts this equals 15 so no actor ever regresses
    // to a flat rectangle.
    get spriteBackedActors() {
      return spriteBackedActors();
    },
    // Read-only render seam for the readability acceptance: the controlled
    // player's projected screen-space footprint plus the live camera zoom, so
    // a spec can compute the on-screen sprite height (48 backing px × depth
    // scale × camera zoom × integer CSS scale) and assert it stays readable.
    get carrierScreen() {
      const c = carrierScreen();
      if (!c) return null;
      return { px: c.px, py: c.py, scale: c.scale, camZoom: camZoom() };
    },
    pick: (i: number) => {
      const clamped = Math.max(0, Math.min(2, Number(i) || 0));
      s.confirmPlay(clamped);
    },
    snap: () => {
      // Build the live play *and* enter LIVE, matching the on-screen flow; a bare
      // mode flip leaves `this.live` null so the down can never run to the whistle.
      if (mode() === 'PRE_SNAP') s.beginLivePlay();
    },
    openWindows: () => {
      if (mode() === 'LIVE' && isPassPlay()) s.openPassWindows();
    },
    throwTo: (t: 'A' | 'B' | 'C') => {
      if (mode() === 'LIVE' && isPassPlay() && windowsOpen() && !s.ballInFlight()) {
        s.commitPassTo(t);
      }
    },
    // Test seam: relocate the live carrier to an absolute field-of-play cell so
    // the real hazard→damage/casualty pipeline fires deterministically.
    forceCarrierTo: (x: number, y: number) => {
      s.relocateCarrier(x, y);
    },
  };
}
