import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MatchController, DEFAULT_DEFENSE, type MatchRuntime } from './matchController';
import { updateBanner } from './matchOutcome';
import { GameSession } from '../sim/GameSession';
import { getOffensePlay } from '../sim/Playbook';
import { cpuOnOffense } from './cpuOpponent';

/**
 * Regression guard for the CPU-opponent state machine (PR #18 review finding):
 * `s.cpuPlayId` must be cleared when a down ends, or the away team re-runs its
 * FIRST call for the whole drive, skipping the huddle beat and replaying a
 * RUN/PASS on 4th down instead of PUNT/FIELD_GOAL.
 *
 * These tests drive the real `MatchController.updateMode` PICK→PRE_SNAP cycle
 * across two consecutive CPU downs using a hand-rolled `MatchRuntime` over a
 * real `GameSession`, and assert the coach is asked fresh each down.
 */

/** A `MatchRuntime` narrowed to the fields the PICK/PRE_SNAP/`updateBanner` path
 *  touches. The live-sim surface is stubbed because these tests never enter LIVE. */
function makeRuntime(session: GameSession): MatchRuntime {
  return {
    session,
    live: null,
    liveResult: null,
    mode: 'PICK',
    selectedPlayIndex: 0,
    cpuPlayId: null,
    cpuHuddleClock: 0,
    cpuSnapClock: 0,
    cpuPassClock: 0,
    bannerText: '',
    bannerKind: 'NEUTRAL',
    bannerTimer: 0,
    gameOver: false,
    highlightDefender: -1,
    runDist: new Map(),
    lastPos: new Map(),
    animClock: new Map(),
    animKind: new Map(),
    presentation: new Map(),
    firstDownFieldX: 0,
    hazardManager: undefined as unknown as MatchRuntime['hazardManager'],
    nastyFields: undefined as unknown as MatchRuntime['nastyFields'],
    nastySnap: null,
    liveElapsed: 0,
    gasCloud: null,
    pendingHazardHits: [],
    liveLos: session.los,
    isPassPlay: false,
    isKickPlay: false,
    kickHoldMs: 0,
    kickLocked: null,
    kickCommitted: false,
    passHoldMs: 0,
    heldThrowKey: null,
    windowsOpen: false,
    windowOpenPressConsumed: false,
    hazardArmedForDemo: true,
    simAccumulator: 0,
    lastFriction: 1,
    lastSlow: 1,
    ballFlight: null,
    passingUntil: -1,
    damagePopups: [],
    casualties: [],
    looseBall: null,
    ballHolderId: null,
    playerInput: {
      x: 0,
      y: 0,
      buttons: { A: false, B: false, C: false, START: false },
      pressed: { A: false, B: false, C: false, START: false },
    },
    buttonHeld: () => false,
    pressedBtn: () => false,
    releasedBtn: () => false,
    steerLeftEdge: () => false,
    steerRightEdge: () => false,
    restartMatch: () => {},
  };
}

/** An away-possession session placed mid-drive (already past coin toss/kickoff). */
function awaySession(over: { down?: number; los?: number; yardsToGo?: number } = {}): GameSession {
  const g = new GameSession({ seed: 7 });
  g.possession = 'away';
  g.phase = 'HUDDLE_PLAYCALL';
  g.down = over.down ?? 1;
  g.los = over.los ?? 30;
  g.yardsToGo = over.yardsToGo ?? 10;
  return g;
}

describe('MatchController CPU offense cycle', () => {
  let now = 0;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    now = 0;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('clears the CPU call when a down ends (the review bug)', () => {
    const s = makeRuntime(awaySession());
    // A stale CPU call left over from the previous down, with the banner about
    // to dismiss into the next huddle — the exact state the bug left behind.
    s.cpuPlayId = 'INSIDE_GORE_RUN';
    s.cpuHuddleClock = 999; // in the past → would be re-confirmed if not cleared
    s.cpuSnapClock = 123;
    s.cpuPassClock = 456;
    s.mode = 'BANNER';
    s.bannerTimer = 0; // already elapsed
    s.session.phase = 'PLAY_OVER_BANNER'; // the just-committed down's banner

    updateBanner(s, 0.1);

    expect(s.mode).toBe('PICK');
    expect(s.cpuPlayId).toBeNull();
    expect(s.cpuHuddleClock).toBe(0);
    expect(s.cpuSnapClock).toBe(0);
    expect(s.cpuPassClock).toBe(0);
  });

  it('re-runs the coach fresh on each consecutive CPU down', () => {
    const s = makeRuntime(awaySession());
    const c = new MatchController(s);

    // Down 1: PICK beat arms the call, then the huddle clock elapses → PRE_SNAP.
    c.updateMode(0);
    expect(s.mode).toBe('PICK');
    expect(s.cpuPlayId).not.toBeNull();
    expect(s.cpuHuddleClock).toBeGreaterThan(now);

    now = s.cpuHuddleClock + 1;
    c.updateMode(0);
    expect(s.mode).toBe('PRE_SNAP');
    expect(s.session.phase).toBe('PRE_SNAP');

    // Down 1 ends: back to the huddle after the banner dismisses.
    s.mode = 'BANNER';
    s.bannerTimer = 0;
    s.session.phase = 'PLAY_OVER_BANNER';
    updateBanner(s, 0.1);
    expect(s.mode).toBe('PICK');
    expect(s.session.phase).toBe('HUDDLE_PLAYCALL');
    expect(s.cpuPlayId).toBeNull();

    // Down 2: a NEW call is armed, not the stale first call re-confirmed.
    c.updateMode(0);
    expect(cpuOnOffense(s.session)).toBe(true);
    expect(s.cpuPlayId).not.toBeNull();
    // The huddle beat is re-armed in the future (not instantly confirmed).
    expect(s.cpuHuddleClock).toBeGreaterThan(now);
    // The coach was asked again (fresh `cpuPlayId`), with the CPU still in PICK
    // naming the play before select.
    expect(s.mode).toBe('PICK');
  });

  it('picks PUNT on 4th down instead of re-running a stale 1st-down run', () => {
    const s = makeRuntime(awaySession({ down: 4, los: 20, yardsToGo: 5 }));
    const c = new MatchController(s);

    // A stale 1st-down run call with the huddle clock already elapsed. The
    // previous down's banner dismisses (the fix clears the stale call), then the
    // next PICK re-runs the coach, which on 4th & 5 at the 20 returns PUNT.
    s.cpuPlayId = 'INSIDE_GORE_RUN';
    s.cpuHuddleClock = 0;
    s.mode = 'BANNER';
    s.bannerTimer = 0;
    s.session.phase = 'PLAY_OVER_BANNER';
    updateBanner(s, 0.1); // down ends → clears cpuPlayId, mode → PICK
    expect(s.mode).toBe('PICK');
    expect(s.cpuPlayId).toBeNull();

    c.updateMode(0);
    // Re-run of the coach arms a fresh 4th-down call (not the stale run).
    expect(s.cpuPlayId).not.toBe('INSIDE_GORE_RUN');
    expect(getOffensePlay(s.cpuPlayId!).kind).toBe('PUNT');

    // Elapse the huddle beat → the CPU selects the punt and enters PRE_SNAP.
    now = s.cpuHuddleClock + 1;
    c.updateMode(0);
    expect(s.mode).toBe('PRE_SNAP');
    expect(s.session.phase).toBe('PRE_SNAP');
    expect(s.isKickPlay).toBe(true);
  });

  it('advances the period when the between-plays clock expires in the huddle (QA freeze)', () => {
    // QA gate defect: tickPlayClock ends the quarter with no banner to carry it, so the
    // session sat in QUARTER_END and the scene kept running a dead down forever.
    const g = awaySession();
    g.clockRunning = true;
    g.clock = 1;
    const s = makeRuntime(g);
    const c = new MatchController(s);

    g.tickPlayClock(2);
    expect(g.phase).toBe('QUARTER_END');

    c.updateMode(0);
    expect(g.quarter).toBe(2);
    expect(g.phase).toBe('HUDDLE_PLAYCALL');
    expect(s.mode).toBe('PICK');
    expect(s.gameOver).toBe(false);
  });

  it('winds through halftime (kickoff included) when the clock expires in Q2', () => {
    const g = awaySession();
    g.quarter = 2;
    g.clockRunning = true;
    g.clock = 1;
    const s = makeRuntime(g);
    g.tickPlayClock(2);
    expect(g.phase).toBe('HALFTIME');

    new MatchController(s).updateMode(0);
    expect(g.quarter).toBe(3);
    expect(g.phase).toBe('HUDDLE_PLAYCALL');
    expect(s.mode).toBe('PICK');
  });

  it('shows the result card when the final clock expires between plays', () => {
    const g = awaySession();
    g.quarter = 4;
    g.clockRunning = true;
    g.clock = 1;
    const s = makeRuntime(g);
    g.tickPlayClock(2);
    expect(g.phase).toBe('GAME_OVER');

    new MatchController(s).updateMode(0);
    expect(s.gameOver).toBe(true);
    expect(s.mode).toBe('BANNER');
    // Idempotent: a second frame must not re-run the wind-down.
    s.bannerTimer = 5;
    new MatchController(s).updateMode(0.1);
    expect(s.bannerTimer).toBeLessThan(5);
  });

  it('the human A/B/C never calls the CPU play (CPU path ignores pressed buttons)', () => {
    const s = makeRuntime(awaySession());
    const c = new MatchController(s);
    // Jam every human button: on a CPU down the pick path reads none of them.
    const pressed = vi.spyOn(s, 'pressedBtn');
    c.updateMode(0);
    // Still armed the coach's call (PICK, not a human-catalog pick). The CPU
    // plays its own id; A/B/C are never consulted, so pressedBtn is not called.
    expect(s.mode).toBe('PICK');
    expect(s.cpuPlayId).not.toBeNull();
    expect(pressed).not.toHaveBeenCalled();

    const called = s.cpuPlayId!;
    now = s.cpuHuddleClock + 1;
    c.updateMode(0);
    expect(s.session.phase).toBe('PRE_SNAP');
    expect(s.cpuPlayId).toBe(called);
    expect(getOffensePlay(called).kind).toBe('PASS'); // 1st & 10 open field
    expect(DEFAULT_DEFENSE).toBe('BONE_CRUSH_BASE');
  });
});
