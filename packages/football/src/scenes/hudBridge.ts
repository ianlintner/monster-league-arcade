/**
 * hudBridge — DOM↔scene bridge for the broadcast HUD, huddle overlay and the
 * on-canvas prompt line.
 *
 * Everything here is pure DOM manipulation driven by an explicit state snapshot
 * — no Phaser, no back-reference to the scene — so the scorebug/huddle/control
 * bar wiring is unit-testable against a real (or jsdom) `document`. The scene
 * owns the snapshot; these functions only read it and mutate the DOM in place.
 */
import {
  buildHuddleOverlay,
  downDistanceLabel,
  factionName,
  formatClock,
  losLabel,
} from '../ui/hud';
import type { FactionId } from '@monster-league/shared-core';
import type { GameSession } from '../sim/index';

/** Play kind, mirroring MatchScene's `PlayKind` (kept local to avoid importing the
 *  scene just for a type). */
type PlayKind = 'RUN' | 'PASS' | 'PUNT' | 'FIELD_GOAL';

/** Everything the bridge needs about the current frame's game/presentation state. */
export interface HudState {
  session: GameSession;
  mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER';
  bannerText: string;
  isKickPlay: boolean;
  kickLocked: number | null;
  /** Fingerprint of the last huddle overlay build; mutated in place on rebuild. */
  huddleFingerprint: string;
}

/** The `readyText` prompt caption plus the composed control-bar line. */
export interface ReadyLine {
  readyText: string;
  controlLine: string;
}

/** Compose the on-canvas/football-promoted status line for the current frame. */
export function composeReadyLine(s: HudState): ReadyLine {
  const clock = `${String(Math.floor(s.session.clock / 60)).padStart(2, '0')}:${String(
    Math.floor(s.session.clock % 60),
  ).padStart(2, '0')}`;
  const down = `DOWN ${s.session.down} · ${s.session.yardsToGo} TO GO`;

  let prompt = '';
  switch (s.mode) {
    case 'PICK': {
      const cat = catalogForDown(s.session.down);
      prompt = `Call the play — [A=J] ${cat[0]!.label} · [B=K] ${cat[1]!.label} · [C=L] ${cat[2]!.label}`;
      break;
    }
    case 'PRE_SNAP':
      prompt = `Pre-Snap: [C=L] Snaps the ball · ${down}`;
      break;
    case 'LIVE':
      prompt = s.isKickPlay
        ? s.kickLocked === null
          ? `Hold [C=L] to sweep the kick meter, release to lock · ${down}`
          : `Kick locked · ${down}`
        : `Live: WASD run · [A=J] Dive · [C=L] Turbo · [B=K] Switch defender`;
      break;
    case 'BANNER':
      prompt =
        s.session.phase === 'GAME_OVER'
          ? 'FINAL · Press [START=P] or [C=L] to play again'
          : s.bannerText;
      break;
  }
  return { readyText: `${down}  ${clock}\n${prompt}`, controlLine: `${down}  ${clock}\n${prompt}` };
}

/** The play list in play for the current down (4th down → special teams). */
function catalogForDown(
  down: number,
): ReadonlyArray<{ id: string; label: string; kind: PlayKind }> {
  return down >= 4 ? FOURTH_DOWN_CATALOG : PLAY_CATALOG;
}

// These mirrors keep the bridge self-contained; the scene passes only `down`.
const PLAY_CATALOG: ReadonlyArray<{ id: string; label: string; kind: PlayKind }> = [
  { id: 'INSIDE_GORE_RUN', label: 'Inside Gore Run', kind: 'RUN' },
  { id: 'COFFIN_SWEEP', label: 'Coffin Sweep', kind: 'RUN' },
  { id: 'QUICK_SLANTS', label: 'Quick Slants (Pass)', kind: 'PASS' },
];
const FOURTH_DOWN_CATALOG: ReadonlyArray<{ id: string; label: string; kind: PlayKind }> = [
  { id: 'PUNT', label: 'Punt', kind: 'PUNT' },
  { id: 'FIELD_GOAL', label: 'Field Goal', kind: 'FIELD_GOAL' },
  { id: 'INSIDE_GORE_RUN', label: 'Go For It (Run)', kind: 'RUN' },
];

/** Update the scorebug value cells + meta + clock in place (never rebuild the
 *  component, which would destroy its team names/swatches). */
export function updateScorebug(doc: Document, session: GameSession): void {
  const scorebug = doc.querySelector('[data-testid="scorebug"]');
  if (scorebug) {
    const scores = scorebug.querySelectorAll('.gsn-scorebug__score');
    if (scores.length >= 2 && scores[0] && scores[1]) {
      scores[0].textContent = String(session.score.home);
      scores[1].textContent = String(session.score.away);
    }
    const meta = scorebug.querySelector('.gsn-scorebug__meta');
    if (meta) meta.textContent = `Q${session.quarter}`;
    const center = scorebug.querySelector('.gsn-scorebug__center');
    const clock = center?.children[1];
    if (clock) {
      clock.textContent = `${String(Math.floor(session.clock / 60)).padStart(2, '0')}:${String(
        Math.floor(session.clock % 60),
      ).padStart(2, '0')}`;
    }
  }
}

/** Clear the kinematic banner host when outside BANNER mode (kinematic banners own
 *  their children, so only the children are cleared, never the host element). */
export function clearBannerIfNotActive(doc: Document, mode: HudState['mode']): void {
  if (mode === 'BANNER') return;
  const banner = doc.getElementById('banner');
  if (banner && banner.children.length > 0) banner.replaceChildren();
}

/** Sync the broadcast HUD's game-state cells (casualty skulls, down & distance,
 *  play clock, ball position, bribed-ref badge) from `GameSession` in place. */
export function syncHud(doc: Document, session: GameSession): void {
  const root =
    doc.querySelector('.gsn-scorebug-shell') ?? doc.querySelector('[data-testid="scorebug"]');
  if (!root) return;
  const s = session;

  for (const side of ['home', 'away'] as const) {
    const row = root.querySelector(`[data-testid="skulls-${side}"]`);
    if (!row) continue;
    const count = s.roster[side].casualties;
    Array.from(row.children).forEach((skull, i) => {
      skull.setAttribute('data-lit', String(i < count));
    });
  }

  const playclock = root.querySelector('.gsn-scorebug__playclock');
  if (playclock) playclock.textContent = `PLAY ${formatClock(s.playClock)}`;
  const down = root.querySelector('.gsn-scorebug__down');
  if (down) down.textContent = downDistanceLabel(s.down, s.yardsToGo);
  const los = root.querySelector('.gsn-scorebug__los');
  if (los) los.textContent = losLabel(s.los, s.possession);

  const bribe = root.querySelector('[data-testid="bribe-badge"]');
  if (bribe) {
    const bribed = s.ref.isBribed ? s.ref.bribedBy : null;
    bribe.setAttribute('data-active', String(bribed !== null));
    if (bribed) {
      const id = (f: string): FactionId => f.toLowerCase() as FactionId;
      const briber = id(s.roster[bribed].faction);
      const victim = id(s.roster[bribed === 'home' ? 'away' : 'home'].faction);
      bribe.textContent = `BRIBED REF · ${factionName(briber)} paid · flags ${factionName(victim)}`;
    } else {
      bribe.textContent = '';
    }
  }
}

/** Render the Genesis huddle overlay into `#huddle` (or clear it) with a change
 *  fingerprint so a redundant frame does not rebuild the DOM. Mutates
 *  `hudState.huddleFingerprint` to the new fingerprint. */
export function syncHuddle(doc: Document, s: HudState): void {
  const host = doc.getElementById('huddle');
  if (!host) return;
  if (s.mode !== 'PICK') {
    host.replaceChildren();
    host.hidden = true;
    s.huddleFingerprint = '';
    return;
  }
  const cat = catalogForDown(s.session.down);
  const plays = cat.map((p, i) => ({
    label: (['A', 'B', 'C'] as const)[i]!,
    name: p.label,
    kind: p.kind,
    formation: p.kind === 'PASS' ? 'SHOTGUN' : 'I-FORM',
  }));
  const availableNasties = s.session.charges.remaining(s.session.possession, s.session.half);
  const formations = [...new Set(plays.map((p) => p.formation))];
  const fingerprint = JSON.stringify({
    down: s.session.down,
    plays: cat.map((p) => p.id),
    formations,
    nasties: availableNasties,
  });
  if (fingerprint === s.huddleFingerprint) return;
  s.huddleFingerprint = fingerprint;

  host.replaceChildren(buildHuddleOverlay({ formations, plays, availableNasties }));
  host.hidden = false;
}
