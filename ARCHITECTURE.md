# Monster League Arcade — Architecture

Lock for the MVP and the upcoming _Monster League Hockey_ expansion. The art/UI
contract lives in [`PLAN.md`](./PLAN.md) §2 and §4; this document defines module
boundaries and repository conventions only.

## Module boundaries

| Module        | Path                   | Owns                                                                                                                                                                                                                          | Must not own                                    |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `shared-core` | `packages/shared-core` | GSN 66.6 palette/CSS/UI primitives, input manager (keyboard/gamepad/touch), 2.5D projection math, seeded PRNG, faction + arena data, FM synth + Crypt Announcer voice manager, shared asset URL registry (`src/ui/assets.ts`) | Sport rules, sport scenes, route wiring         |
| `football`    | `packages/football`    | 7v7 sim engine, playbook, hazards, AI coach, Phaser match scene, football HUD/banners                                                                                                                                         | Hockey rules, hub navigation, global CSS        |
| `hockey`      | `packages/hockey`      | Rink preview scene; imports `shared-core` only                                                                                                                                                                                | Football sim, its own input/palette/audio stack |
| `arcade-hub`  | `apps/arcade-hub`      | Vite multi-page build for `/`, `/football/`, `/hockey/`, HTML shells and route entrypoints                                                                                                                                    | Game rules or engine logic                      |

Cross-imports are one-way: `arcade-hub → {football, hockey, shared-core}`,
`{football, hockey} → shared-core`, never the reverse. New sports must follow the
same shape: a `packages/<sport>` package exporting a `boot<Sport>(host)` entry,
plus one HTML shell under `apps/arcade-hub/<sport>/index.html` and one entrypoint
under `apps/arcade-hub/src/<sport>.ts`.

## File-size ceiling

Target **~400 LOC per source file**, 450 as a hard review trigger. Files that
exceed it today (`MatchScene.ts`, `GameSession.ts`, `Playbook.ts`,
`GenesisSynth.ts`, `AudioManager.ts`, `LivePlay.ts`) are grandfathered MVP cores;
split them along existing seams when touched, not in a speculative rewrite.
Tests are exempt from the ceiling.

## Asset & audio pipeline

- Generated art lives under `public/assets/` (`sprites/`, `portraits/`,
  `arenas/`, `atlas.json`). `scripts/validate-assets.mjs` is the gate: exact
  frame dimensions, `#0B0711` 1px silhouette outlines, Midnight Palette only,
  per-file byte budget. `npm run check` runs it.
- Sprites are 48×48 cells, portraits/crests/tiles 64×64. Animation row order is
  defined once in `scripts/asset-spec.mjs` and mirrored in `public/assets/atlas.json`.
- Crypt Announcer clips live under `apps/arcade-hub/public/assets/audio/announcer/`
  and are addressed by `voiceManifest.ts` ids; Web Speech / formant synthesis is
  a same-manager fallback, never a second code path in game code.
- All three routes reference assets under the same `/assets` tree; the hub's
  registry in `apps/arcade-hub/src/hub.ts` and the game spritesheets resolve to
  the same normalized PNGs. Vite's `serve-repo-assets` plugin serves and
  copies the repository-root `public/assets` tree into `dist/assets` for both
  dev and production; audio is copied from the app's public dir.
- Spend manifests (`.asset-manifest.json`) and worktrees are gitignored.

## Hockey expansion path

`packages/hockey` already shares the palette, input manager and UI primitives.
To move from rink preview to playable game: add a `GameSession`-equivalent sim
package-local, a Phaser scene registered through `bootHockey(host)`, and reuse
the existing shared asset registry (factions, crests, portraits, arena tiles).
Do not fork the football sim or duplicate the GSN chrome.

## Hosting & delivery

The game is hosted by the Cat Herding Games hub
(<https://games.cat-herding.net/monster-league-arcade/>), which builds `main`
with `--base=/monster-league-arcade/` into a shared Azure Static Web App. This
repo has no deploy workflow; the hub owns routing, caching and security headers.

Sub-path safety contract: every URL resolves from `import.meta.env.BASE_URL`
(`assetUrl()` in shared-core for TypeScript; relative `href`s in HTML), never
root-absolute. CI enforces it with `playwright.subpath.config.ts`, which builds
with the hub's base and serves under that prefix (404 elsewhere).
`.github/workflows/verify-production.yml` checks the live site daily with
`scripts/verify-deployment.mjs` (routes, headers, asset sha256 vs. a build with
the same base).
