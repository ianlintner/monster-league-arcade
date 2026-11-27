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
  buildNastyDrawer,
  type NastyDrawerEntry,
  buildCpuHuddleOverlay,
  downDistanceLabel,
  factionName,
  formatClock,
  formatYards,
  losLabel,
} from '../ui/hud';
import type { FactionId } from '@monster-league/shared-core';
import type { GameSession, NastyKind } from '../sim/index';
import { CARNAGE_LIMIT } from '../sim/Roster';
import { NASTY_INFO, getOffensePlay, nastyMenu } from '../sim/index';
import { HUMAN_TEAM } from './preSnapRouter';

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
  /** The CPU's chosen offense play id while the away team has the ball in its
   *  huddle (null on human downs and on defense). Drives the CPU-offense overlay. */
  cpuPlayId: string | null;
  /** The nasty the CPU coach armed with its play (named in the CPU huddle overlay). */
  cpuNasty?: NastyKind | null;
  /** Fingerprint of the last huddle overlay build; mutated in place on rebuild. */
  huddleFingerprint: string;
  /** Live pass play / receiving windows open (optional: absent = false). */
  isPassPlay?: boolean;
  windowsOpen?: boolean;
  /** Nasty callout line (empty = hidden) and its kind. */
  nastyNotice?: string;
  nastyNoticeKind?: 'call' | 'refuse' | null;
}

/** The `readyText` prompt caption plus the composed control-bar line. */
export interface ReadyLine {
  readyText: string;
  controlLine: string;
  /** Just the instruction, for the in-viewport prompt overlay. */
  promptLine: string;
}

/** Compose the on-canvas/football-promoted status line for the current frame. */
export function composeReadyLine(s: HudState): ReadyLine {
  const clock = `${String(Math.floor(s.session.clock / 60)).padStart(2, '0')}:${String(
    Math.floor(s.session.clock % 60),
  ).padStart(2, '0')}`;
  const down = `DOWN ${s.session.down} · ${formatYards(s.session.yardsToGo)} TO GO`;

  const prompt = composePrompt(s, down);
  const line = `${down}  ${clock}\n${prompt}`;
  return { readyText: line, controlLine: line, promptLine: prompt };
}

/** The per-mode instruction line. Only lists inputs the scene actually handles. */
function composePrompt(s: HudState, down: string): string {
  const onDefense = s.session.possession === 'away';
  switch (s.mode) {
    case 'PICK': {
      if (s.cpuPlayId) {
        // CPU offense: no human pick list — name the AI's called play.
        return `CPU OFFENSE — ${getOffensePlay(s.cpuPlayId).name}`;
      }
      if (onDefense) return 'CPU has the ball — it is calling its play';
      const cat = catalogForDown(s.session.down);
      return `Call the play — [A=J] ${cat[0]!.label} · [B=K] ${cat[1]!.label} · [C=L] ${cat[2]!.label}`;
    }
    case 'PRE_SNAP':
      return onDefense
        ? `Defense: CPU snaps shortly — [A=J] Audible · [A→C → A/B/C] Nasty · [B=K → A/B] Ref · ${down}`
        : `Pre-Snap: [C=L] Hike · [A=J] Audible · [A→C → A/B/C] Nasty · [B=K → A/B] Ref · ${down}`;
    case 'LIVE':
      if (s.isKickPlay) {
        return s.kickLocked === null
          ? `Hold [C=L] to sweep the kick meter, release to lock · ${down}`
          : `Kick locked · ${down}`;
      }
      if (onDefense) return 'Defense: WASD steer defender · [B=K] switch · [A=J] dive tackle';
      if (s.isPassPlay) {
        return s.windowsOpen
          ? 'Passing: [A=J] [B=K] [C=L] throw to receiver (hold = bullet)'
          : 'Passing: [C=L] open receiver windows · WASD move';
      }
      return 'Live: WASD run · [A=J] Dive · [C=L] Turbo';
    case 'BANNER':
      return s.session.phase === 'GAME_OVER'
        ? 'FINAL · Press [START=P] or [C=L] to play again'
        : s.bannerText;
  }
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
    const warning = count === CARNAGE_LIMIT - 1;
    if (warning) row.setAttribute('data-warning', 'forfeit');
    else row.removeAttribute('data-warning');
    row.setAttribute(
      'aria-label',
      warning ? `${count} casualties — 1 more = forfeit` : `${count} casualties`,
    );
    row.querySelectorAll('.gsn-skull').forEach((skull, i) => {
      skull.setAttribute('data-lit', String(i < count));
    });
    const label = row.querySelector<HTMLElement>('.gsn-skulls__warning');
    if (label) label.hidden = !warning;
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
      bribe.removeAttribute('data-kind');
      const id = (f: string): FactionId => f.toLowerCase() as FactionId;
      const briber = id(s.roster[bribed].faction);
      const victim = id(s.roster[bribed === 'home' ? 'away' : 'home'].faction);
      bribe.textContent = `BRIBED REF · ${factionName(briber)} paid · flags ${factionName(victim)}`;
    } else if (s.ref.huntedBy) {
      // Kill Ref: the hunt is visible on the same badge until the whistle resolves it.
      const hunter = s.roster[s.ref.huntedBy].faction.toLowerCase() as FactionId;
      bribe.setAttribute('data-active', 'true');
      bribe.setAttribute('data-kind', 'hunt');
      bribe.textContent = `REF HUNT · ${factionName(hunter)} is hunting the Necro-Ref`;
    } else {
      bribe.removeAttribute('data-kind');
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
  // CPU offense: show a single non-interactive card naming the called play. The
  // fingerprint is keyed on the play id so a new down's play rebuilds the overlay.
  if (s.cpuPlayId) {
    const play = getOffensePlay(s.cpuPlayId);
    const nasty = s.cpuNasty ? NASTY_INFO[s.cpuNasty].name : undefined;
    const fingerprint = `cpu:${s.cpuPlayId}:${s.cpuNasty ?? ''}`;
    if (fingerprint === s.huddleFingerprint) return;
    s.huddleFingerprint = fingerprint;
    host.replaceChildren(
      buildCpuHuddleOverlay({
        playName: play.name,
        kind: play.kind,
        formation: play.formation,
        ...(nasty ? { nasty } : {}),
      }),
    );
    host.hidden = false;
    return;
  }
  const cat = catalogForDown(s.session.down);
  const plays = cat.map((p, i) => ({
    label: (['A', 'B', 'C'] as const)[i]!,
    name: p.label,
    kind: p.kind,
    formation: p.kind === 'PASS' ? 'SHOTGUN' : 'I-FORM',
  }));
  const availableNasties = huddleDrawerEntries(s.session);
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

/** Drawer rows for the human side: one per menu slot with its remaining half charge.
 *  `playKind` null = play not chosen yet (huddle) → list both Pumpkin (pass) and Dynamite (run). */
export function drawerEntries(session: GameSession, playKind: PlayKind | null): NastyDrawerEntry[] {
  const team = HUMAN_TEAM;
  const side = session.possession === team ? 'OFFENSE' : 'DEFENSE';
  const rows: NastyDrawerEntry[] = [];
  const menus =
    side === 'OFFENSE' && playKind === null
      ? [nastyMenu('OFFENSE', 'PASS'), nastyMenu('OFFENSE', 'RUN')]
      : [nastyMenu(side, playKind)];
  for (const menu of menus) {
    menu.forEach((kind, i) => {
      if (rows.some((r) => r.kind === kind)) return;
      const note =
        playKind === null && i === 0 ? (kind === 'PUMPKIN_BOMB_PASS' ? 'pass' : 'run') : undefined;
      rows.push({
        kind,
        slot: (['A', 'B', 'C'] as const)[i]!,
        charges: session.charges.available(team, kind, session.half) ? 1 : 0,
        ...(note ? { note } : {}),
      });
    });
  }
  return rows;
}

function huddleDrawerEntries(session: GameSession): NastyDrawerEntry[] {
  return drawerEntries(session, null);
}

/** In-canvas NASTY callout + pre-snap dirty-tricks drawer (hidden outside PRE_SNAP). */
export function syncNastyOverlay(doc: Document, s: HudState): void {
  const callout = doc.getElementById('nasty-callout');
  if (callout) {
    const text = s.nastyNotice ?? '';
    callout.hidden = text === '';
    callout.textContent = text;
    callout.setAttribute('data-kind', s.nastyNoticeKind ?? '');
  }
  const host = doc.getElementById('nasty-presnap-drawer');
  if (!host) return;
  if (s.mode !== 'PRE_SNAP') {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  const id = s.session.possession === HUMAN_TEAM ? s.session.selectedOffensePlayId : null;
  const kind = id ? getOffensePlay(id).kind : null;
  const entries = drawerEntries(s.session, kind);
  const fp = JSON.stringify(entries);
  if (host.getAttribute('data-fp') === fp && !host.hidden) return;
  host.setAttribute('data-fp', fp);
  host.replaceChildren(buildNastyDrawer(entries, 'nasty-presnap-drawer-list'));
  host.hidden = false;
}
