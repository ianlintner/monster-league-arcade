# Monster League Arcade (`monster-league-arcade`)

A retro-modern 16-bit/32-bit Halloween monster sports arcade hub for the web, built with **Phaser 4, TypeScript, and Vite** and hosted on **Azure Static Web Apps**.

Inspired by the 1993 Sega Genesis classic _Mutant League Football_ (and _Mutant League Hockey_) with modern arcade physics, lighting, and responsiveness inspired by _Tape to Tape_.

## Games & Routes

- **`/` — Monster League Arcade Hub ("GSN 66.6 Broadcast Cabinet")**: Select your sport, inspect the 4 Monster Factions (Skeletons, Zombies, Vampires, Ghouls), configure CRT scanlines & audio, and test controllers.
- **`/football/` — Halloween Monster League Football**: 7-on-7 satirical monster gridiron featuring Nasty Audibles (Pumpkin Bomb Pass, Dynamite Pitch, Bat-Wing Boost, Ghoul Gas, QB Crypt Blitz), Field Hazards (landmines, open graves, lava pits, ectoplasm sludge), Bribe Ref, Kill Ref, and Forfeit-by-Carnage rules.
- **`/hockey/` — Monster League Hockey (Preview)**: Shared-engine rink preview for the upcoming 5-on-5 monster hockey clash.

## Controls

All game input routes through the shared `InputManager` (Genesis 3-button arcade model: **A / B / C / Start**). Keyboard, gamepad, and touch all drive the same edge-buffered input snapshot.

| Action    | Keyboard (P1)   | Keyboard (P2) | Gamepad            |
| --------- | --------------- | ------------- | ------------------ |
| Move      | `W` `A` `S` `D` | Arrow keys    | D-pad / left stick |
| **A**     | `J` or `Space`  | `Z`           | South (A)          |
| **B**     | `K`             | `X`           | East (B)           |
| **C**     | `L`             | `C`           | West (X)           |
| **Start** | `P`             | `Enter`       | Start              |

- **Huddle**: `A`/`B`/`C` call a play; `C` opens the Nasty Drawer.
- **Pre-snap**: `A` audible, `B` shift, `C` hike.
- **Passing**: `C` opens receiver windows, then `A`/`B`/`C` throw (tap lob, hold bullet).
- **Ball carrier**: `A` dive, `B` spin/stiff-arm, `C` turbo.
- **Defense**: `A` big hit, `B` switch defender, `C` strip/burst.

## Status

- **Phase**: MVP in active Kanban development (`monster-league-arcade` board).
- **Architecture & Art Bible**: See [`PLAN.md`](./PLAN.md) for the complete clean-room specification, unified _16-Bit Midnight Broadcast_ art/UI design system, and card roadmap.
- **Module boundaries & file-size contract**: See [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- **Deployment**: `scripts/deploy.sh [review|production]` builds-checks, deploys the single `dist/` artifact to the `monster-league-arcade` Azure Static Web App, and verifies routes, security headers and asset sha256 parity. Requires Azure CLI access to the `nekoc` resource group; the deployment token stays in process memory.

## Development

```sh
npm install
npm run check                 # assets, typecheck, lint, format, 236+ unit tests, build
npx playwright test           # local multi-page E2E + screenshots
npm run e2e:live              # same E2E suite against the deployed SWA preview host
```

## License

MIT License — see [`LICENSE`](./LICENSE).
