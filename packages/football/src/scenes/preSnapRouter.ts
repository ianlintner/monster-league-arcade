/**
 * preSnapRouter — the human pre-snap combo router (ML-NEXT D1).
 *
 * One `AudibleController` per PRE_SNAP for the human side. From IDLE a bare C
 * still hikes; A opens the audible menu; while any menu is open C is a menu
 * choice and never snaps. A menu that is not resolved within `MENU_TIMEOUT_S`
 * falls back to IDLE. Resolved selections go through the sim layer only
 * (`session.audible` / `session.callNasty`) — this module never touches charges.
 */
import { AudibleController, NASTY_INFO, getOffensePlay } from '../sim/index';
import type { Button, GameSession, NastyKind, NastyRejection, TeamId, Side } from '../sim/index';
import type { ArcadeButton } from '@monster-league/shared-core';
import type { NastyFieldEffects } from '../field/NastyFieldEffects';

/** The human always plays the home team. */
export const HUMAN_TEAM: TeamId = 'home';
export const MENU_TIMEOUT_S = 1.5;
export const NOTICE_SECONDS = 1.8;

export type NastyNoticeKind = 'call' | 'refuse';

/** Scene fields the router reads/writes (a subset of `MatchRuntime`). */
export interface PreSnapRuntime {
  session: GameSession;
  nastyFields: NastyFieldEffects;
  audible: AudibleController | null;
  audibleClock: number;
  /** Buttons fed to the open menu this combo (replayed through `session.audible`). */
  audibleCombo: Button[];
  /** Standard-audible play override (null = use the A/B/C catalog pick). */
  audiblePlayId: string | null;
  nastyNotice: string;
  nastyNoticeKind: NastyNoticeKind | null;
  nastyNoticeTimer: number;
  pressedBtn(b: ArcadeButton): boolean;
}

export type RouteResult = 'HIKE' | 'HANDLED';

const REFUSAL: Partial<Record<NastyRejection, string>> = {
  ALREADY_USED_THIS_HALF: 'ALREADY USED THIS HALF',
  WRONG_SIDE: 'WRONG SIDE OF THE BALL',
  WRONG_PLAY_TYPE: 'WRONG PLAY TYPE',
  DEMON_REF_PRESENT: 'THE DEMON REF CANNOT BE BOUGHT',
  WRONG_PHASE: 'NOT ALLOWED NOW',
  NO_PLAY_SELECTED: 'CALL A PLAY FIRST',
};

/** Reset the combo state (leaving PRE_SNAP, restart, resolution). */
export function resetRouter(s: PreSnapRuntime): void {
  s.audible = null;
  s.audibleClock = 0;
  s.audibleCombo = [];
}

/** Clear the callout too (match restart). */
export function resetNotice(s: PreSnapRuntime): void {
  s.nastyNotice = '';
  s.nastyNoticeKind = null;
  s.nastyNoticeTimer = 0;
}

export function menuOpen(s: PreSnapRuntime): boolean {
  return (
    s.audible !== null &&
    (s.audible.state === 'AUDIBLE_MENU' ||
      s.audible.state === 'NASTY_MENU' ||
      s.audible.state === 'REF_MENU')
  );
}

function setNotice(s: PreSnapRuntime, text: string, kind: NastyNoticeKind): void {
  s.nastyNotice = text;
  s.nastyNoticeKind = kind;
  s.nastyNoticeTimer = NOTICE_SECONDS;
}

function ensureController(s: PreSnapRuntime): AudibleController | null {
  if (s.audible) return s.audible;
  const sess = s.session;
  const offense = HUMAN_TEAM === sess.possession;
  const side: Side = offense ? 'OFFENSE' : 'DEFENSE';
  const playId = offense ? sess.selectedOffensePlayId : sess.selectedDefensePlayId;
  if (!playId) return null;
  s.audible = new AudibleController(side, playId, offense ? getOffensePlay(playId).kind : null);
  return s.audible;
}

/**
 * Feed one button edge. Returns 'HIKE' only for a bare C from IDLE (the caller
 * snaps); everything else is consumed by the combo menu or ignored.
 * `rebuild` re-renders the pre-snap formation after a standard audible swaps the play.
 */
export function routePreSnapButton(
  s: PreSnapRuntime,
  button: ArcadeButton,
  rebuild: () => void,
): RouteResult {
  if (button === 'START') return 'HANDLED';
  const wasOpen = menuOpen(s);
  if (button === 'C' && !wasOpen) return 'HIKE';
  // From IDLE: A opens the audible menu, B opens the ref menu (D2).
  if (!wasOpen && button !== 'A' && button !== 'B') return 'HANDLED';
  const ctl = ensureController(s);
  if (!ctl) return 'HANDLED';
  const sel = ctl.press(button);
  s.audibleCombo.push(button as Button);
  if (!sel) {
    s.audibleClock = MENU_TIMEOUT_S;
    return 'HANDLED';
  }
  const combo = s.audibleCombo;
  resetRouter(s);
  if (sel.kind === 'STANDARD') {
    const offense = HUMAN_TEAM === s.session.possession;
    s.session.audible(HUMAN_TEAM, combo);
    if (offense) {
      s.audiblePlayId = s.session.selectedOffensePlayId;
      rebuild();
    }
    setNotice(s, `AUDIBLE! ${getPlayName(s.session, offense)}`, 'call');
  } else if (sel.kind === 'NASTY') {
    resolveNasty(s, sel.nasty);
  }
  // CANCEL (ref menu C) simply closes the menu: resetRouter already ran.
  return 'HANDLED';
}

function getPlayName(session: GameSession, offense: boolean): string {
  const id = offense ? session.selectedOffensePlayId : session.selectedDefensePlayId;
  return (offense && id ? getOffensePlay(id).name : (id ?? '')).toUpperCase();
}

/** Spend the charge through the sim layer and report the outcome on the callout. */
function resolveNasty(s: PreSnapRuntime, kind: NastyKind): void {
  const res = s.session.callNasty(HUMAN_TEAM, kind);
  const name = NASTY_INFO[kind].name.toUpperCase();
  if (!res.ok) {
    setNotice(s, `NASTY REFUSED — ${REFUSAL[res.reason] ?? res.reason}`, 'refuse');
    return;
  }
  // Re-prime the field effects from the final selection (they also re-run at snap).
  s.nastyFields.begin(s.session.effects);
  const live =
    kind === 'BRIBE_REF' || kind === 'KILL_REF' || s.session.effects.active.includes(kind);
  if (live) setNotice(s, `NASTY! ${name}`, 'call');
  else setNotice(s, `${name} FIZZLED — WRONG PLAY TYPE`, 'refuse');
}

/**
 * The CPU coach arms its nasty through the same sim path (and the same once-per-half
 * charges) as the human, then announces it on the callout. Returns true if accepted.
 * The caller re-primes the field effects (`prepareLivePlay`) after selecting plays.
 */
export function cpuCallNasty(s: PreSnapRuntime, team: TeamId, kind: NastyKind): boolean {
  const res = s.session.callNasty(team, kind);
  if (!res.ok) return false;
  setNotice(s, `CPU NASTY! ${NASTY_INFO[kind].name.toUpperCase()}`, 'call');
  return true;
}

/** Per-frame PRE_SNAP update: count the menu timeout, then route this frame's edges. */
export function updateRouter(s: PreSnapRuntime, dt: number, rebuild: () => void): RouteResult {
  if (menuOpen(s)) {
    s.audibleClock -= dt;
    if (s.audibleClock <= 0) resetRouter(s);
  }
  for (const b of ['A', 'B', 'C'] as const) {
    if (!s.pressedBtn(b)) continue;
    if (routePreSnapButton(s, b, rebuild) === 'HIKE') return 'HIKE';
  }
  return 'HANDLED';
}

/** Per-frame callout countdown (runs in every mode so the callout survives the snap). */
export function tickNotice(s: PreSnapRuntime, dt: number): void {
  if (s.nastyNoticeTimer <= 0) return;
  s.nastyNoticeTimer -= dt;
  if (s.nastyNoticeTimer <= 0) resetNotice(s);
}
