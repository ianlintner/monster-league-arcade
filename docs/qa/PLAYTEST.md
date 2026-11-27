# Playtest QA gate — exhibition football on `main` (efe4523)

Card `t_88754238`. Build under test: local `npm run build` of `main` @ `efe4523`
(PRs #18 CPU offense, #19 human defense, #20 onboarding merged). Browser: Playwright
Chromium, 1280×720. Production URL is
`https://games.cat-herding.net/monster-league-arcade/football/`; defects were
reproduced on a local build of the same commit.

Specs added by this gate (all drive the game with real input; `window.__mlf` is read
for assertions only):

| Spec                                                   | What it proves                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `e2e/playtest-exhibition.spec.ts`                      | One full quarter with real `page.keyboard` events (`?quarter=120`)                                    |
| `e2e/gamepad.spec.ts`                                  | pick → snap → run, and pick → snap → open windows → throw, through a mocked `navigator.getGamepads()` |
| `packages/football/src/scenes/matchController.test.ts` | 3 regression tests for defect D1                                                                      |

## What worked

Real keyboard, full quarter (`docs/qa/` screenshots in order):

| #   | Moment                                                                                     | Evidence                                                           |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | Huddle at kickoff, 1ST & 10                                                                | `01-huddle-kickoff.png`                                            |
| 2   | **Run** — A pick, C snap, hold D                                                           | `02-run-live.png`, `03-run-result-banner.png`                      |
| 3   | **Completed pass** — C pick, C snap, hold C ≈100 ms opens windows, A held 220 ms (bullet)  | `04-pass-windows-open.png`, `05-pass-completed-banner.png`         |
| 4   | **Punt** on 4th down — A pick, C snap, hold C on the kick meter, release; possession flips | `06-…`, `07-punt-meter.png`, `08-punt-result-banner.png`           |
| 5   | **Hazard hit + casualty**                                                                  | `09-hazard-hit.png`, `10-casualty.png` (same moment, two captures) |
| 6   | **Touchdown + extra point** (extra point is automatic, see D4)                             | `11-touchdown-banner.png`, `12-after-touchdown-extra-point.png`    |
| 7   | **Quarter change**                                                                         | `13-quarter-change.png`                                            |

Mocked gamepad: a standard-mapping pad at `navigator.getGamepads()[0]` completes
pick (A) → snap (C) → steer (left stick) → run, and the pass flow (C pick, C snap, C hold
opens windows, A hold throws → BANNER). Stable over 3 consecutive runs.

The CPU opponent calls and runs its own downs; the human defends. `console` stayed
free of errors for the whole quarter (`trackErrors`).

**Honest limits of the keyboard run.**

- The hazard hit, casualty and touchdown are placed with the existing
  `__mlf.forceCarrierTo(x, y)` test seam (the merged `football-pass-hazard` and
  `visual-coherence` specs use it the same way). It relocates the carrier; it cannot pick, snap
  or throw. Everything else is real key input. Scoring or dying on a given seed by steering alone
  is not deterministic.
- "Completed pass" is judged from the banner text (not INCOMPLETE / SACK / INTERCEPT /
  FUMBLE), not from a structured `__mlf` field.
- Screenshots were captured at the named moments by the spec; they were checked by the
  spec's state assertions, not by eye.

## Defects

Severity: **blocks play** / **confusing** / **cosmetic**.

### D1 — Match freezes forever when the clock runs out between plays — blocks play — FIXED here

- **Repro** (on `main` @ efe4523, deterministic): open `/football/?quarter=60`. Repeat J
  (pick) → L (snap) → hold D for 0.5 s on every home down, and just wait on CPU downs. At
  ≈21 s the clock expires; `__mlf.phase` becomes `QUARTER_END` and never leaves it
  (`__mlf.mode` flips to `LIVE`/`PRE_SNAP` on a dead session). Same freeze at `?quarter=90`.
  `?quarter=30` and `?quarter=45` happened not to hit it.
- **Screenshot:** `defect-01-quarter-end-freeze-prefix.png` (captured before the fix).
- **Cause:** `GameSession.tickPlayClock()` runs the between-plays game clock during
  huddle/pre-snap and calls `endPeriod()` (QUARTER_END / HALFTIME / GAME_OVER). Only
  `updateBanner` called `advancePeriod()`, and no banner follows that path.
  A Q4 expiry this way would also never show the result card.
- **Fix:** `settleExpiredPeriod()` in `matchOutcome.ts` (reuses the existing wind-down,
  extracted as `settleToNextHuddle`), called first in `MatchController.updateMode`.
  No change to `MatchScene.ts`.
- **Verified:** the 3 new unit tests fail on unfixed code and pass with it; the
  `?quarter=60`/`90` runs that froze now reach `GAME_OVER`.

### D2 — Monster Bowl cannot be started — blocks the "start a Monster Bowl" goal — DEFERRED (ML-LEAGUE)

`createMonsterBowl` (`packages/football/src/modes/MonsterBowl.ts`) has zero callers; no scene,
route or hub entry reaches it. There is nothing to play, so "start a Monster Bowl and reach
the second game" is **not met by this gate**. Per the board decision (planner audit
`PLAYABLE.md`, card comment 2026-11-27) it is recorded, not implemented, here.

### D3 — Nasty Audible and Bribe Ref cannot be triggered — blocks those two moments — DEFERRED (ML-NEXT)

No scene calls `session.callNasty`. Pre-snap J/K do nothing. The control bar was made
truthful in #20 (it no longer advertises them), so this is a missing feature, not a lying UI.
The two required moments are therefore **not covered**.

### D4 — Extra point is automatic — confusing

After a TD the extra point is kicked inside the banner tick (`matchOutcome.ts`,
`extraPoint('KICK')`); the player gets no input and no 2-point option. The game proceeds
correctly, but the "extra point" moment has no player action to test.

### D5 — Gamepad presses are not edge-latched — cosmetic (low)

Keyboard taps are latched between polls; a gamepad press is only seen if the button is down
on a poll. A ≈30 ms synthetic pulse was missed in headless Chromium (the keyboard equivalent
works). Real controller presses last far longer, so this is unlikely to bite a human; the
mock holds ≥3 animation frames to be deterministic.

## Acceptance coverage

| Criterion                                                                                     | Status                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full quarter, real keys: run, completed pass, punt, hazard, casualty, TD + XP, quarter change | Met (see limits above)                                           |
| Nasty Audible, Bribe Ref                                                                      | **Not met** — D3, deferred                                       |
| pick → snap → run with mocked gamepad                                                         | Met                                                              |
| Monster Bowl started, second game reached                                                     | **Not met** — D2, deferred                                       |
| Screenshots under `docs/qa/`                                                                  | Met                                                              |
| All "blocks play" defects fixed                                                               | D1 fixed. D2/D3 are missing features, deferred by board decision |
