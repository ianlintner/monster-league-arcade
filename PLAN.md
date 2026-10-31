# Monster League Arcade — Plan, Game Design & Unified Art/UI Bible

## 1. Executive Summary & Vision
**Monster League Arcade** (`ianlintner/monster-league-arcade`) is a multi-game retro-modern sports arcade hub built for the web with **Phaser 4, TypeScript, and Vite**, hosted on **Azure Static Web Apps**.

Our flagship title is **Halloween Monster League Football** (`/football/`) — a satirical Halloween monster gridiron clash inspired by the 1993 Sega Genesis classic *Mutant League Football* (and *John Madden Football '93* engine feel), elevated with modern 16-bit/32-bit "HD-2D Arcade" polish, responsive gamepad/keyboard controls, 2.5D tilted perspective, dynamic lighting/particles, and snappy physics inspired by *Tape to Tape*. The monorepo is architected from day one so **Monster League Hockey** (`/hockey/`) shares the input manager, monster factions, audio synth, UI components, and unified visual design language.

---

## 2. Unified Art Direction & UI Design System ("16-Bit Midnight Broadcast")

Every screen—from the `/` Arcade Hub to the `/football/` Huddle, on-field sprites, and `/hockey/` preview—MUST adhere to a single, strict, unified visual bible. No unstyled browser buttons, mismatched fonts, or inconsistent asset styles are allowed.

### 2.1 Aesthetic Pillars
1. **"Sega Genesis Heavy Metal Broadcast meets Modern HD-2D Arcade"**:
   - **Pixel Grid & Scaling**: Crisp nearest-neighbor (`image-rendering: pixelated`) sprite and tile rendering at a virtual base resolution of `640x360` (16:9 widescreen arcade, integer-scaled to 1080p/4K), paired with modern Phaser 4 additive bloom, 2D rim-lighting, drop shadows, and particle emitters.
   - **Unified Outline & Shading Rule**: Every character sprite, hazard, ball, referee, and UI icon uses a **1px deep-void outline (`#0B0711`)**, 4-to-6 ramp cel-shaded pixel clusters, and a high-contrast top-left rim highlight so players pop unmistakably against any field surface.
   - **Broadcast Chrome ("Graveyard Sports Network — GSN 66.6")**: All menus, scorebugs, playcalling huddles, and penalty banners are framed like a 1993 late-night Halloween cable sports broadcast on a haunted CRT/arcade monitor—featuring riveted gargoyle-iron bezels, weathered tombstone plaques, glowing slime/ember LED tickers, and a toggleable subtle scanline/vignette shader.

### 2.2 Master Color Palette ("Halloween Midnight Palette")
All procedural graphics, CSS UI tokens, and `fal.ai` post-processing quantization must map to or harmonize with this master palette:

- **Void & Iron Neutrals (Backgrounds & Frames)**:
  - `VOID_BLACK`: `#0B0711` (Outlines, deep shadows, letterbox)
  - `CRYPT_SLATE`: `#1A1426` (Primary panel background)
  - `IRON_BEZEL`: `#2E2540` (UI borders, scoreboard casing)
  - `TOMBSTONE_GRAY`: `#5C5270` (Bevel highlights, stone trim)
  - `BONE_WHITE`: `#F4EFE6` (Primary readable text, yard lines, skeleton bone highlight)
  - `AGED_PARCHMENT`: `#D6C7B2` (Secondary stats text, playbook diagrams)
- **Halloween Accent & Broadcast Glows**:
  - `PUMPKIN_ORANGE`: `#FF6B1A` (Primary CTA, down/distance LED, explosive hazards)
  - `HELLFIRE_AMBER`: `#FFB800` (Scoreboard digits, active selection border, MVP crown)
  - `ECTO_GREEN`: `#39FF14` (Stamina/turbo bar, toxic swamp hazards, audible active glow)
  - `VAMPIRE_CRIMSON`: `#E6193C` (HP damage, casualty skull alert, Kill Ref warning)
  - `HEX_PURPLE`: `#9D4EDD` (Nasty Audible badge, Bribe Ref indicator, magic projectiles)
  - `SPECTRAL_CYAN`: `#00F0FF` (Pass window target icons A/B/C, speed-burst trail, active player ring)

### 2.3 Faction Visual Identity & Sprite Specifications
Each team has a distinct silhouette, home/away uniform palette, and custom death particle effect so players never confuse teams in the heat of a blitz:
1. **Boneyard Reapers (Skeletons)**:
   - *Colors*: Bone White (`#F4EFE6`), Obsidian Purple (`#2B0938`), Spectral Cyan visors (`#00F0FF`).
   - *Silhouette*: Jagged shoulder spikes, exposed ribcages, horned skull helmets.
   - *Death VFX*: Explodes into 8 bouncing pixel bones + chattering skull on the turf.
2. **Rotting Deadskins (Zombies)**:
   - *Colors*: Putrid Olive (`#6B8E23`), Rust Blood (`#8B1E1E`), Toxic Slime (`#39FF14`).
   - *Silhouette*: Hulking asymmetric shoulder pads, torn jerseys, glowing yellow eyes.
   - *Death VFX*: Splats into a bubbling green slime puddle + severed zombie arm twitching.
3. **Transylvania Nightstalkers (Vampires)**:
   - *Colors*: Midnight Crimson (`#990024`), Vampire Gold (`#FFD166`), Velvet Black (`#110B1A`).
   - *Silhouette*: High collared bat-wing shoulder armor, sleek visors, flowing pixel cape strips.
   - *Death VFX*: Poofs into an ash cloud + swarm of 5 fluttering pixel bats.
4. **Salem Bayou Ghouls (Ghouls & Witches)**:
   - *Colors*: Hex Violet (`#7B2CBF`), Pumpkin Flame (`#FF6B1A`), Swamp Moss (`#2A4D3E`).
   - *Silhouette*: Hooded tattered jerseys, glowing lantern belt, crooked witch-iron facemasks.
   - *Death VFX*: Dissolves into purple cursed flames + floating wisp.
5. **The Necro-Ref (Referee)**:
   - *Colors*: Classic vertical Black & Bone-White stripes (`#0B0711` / `#F4EFE6`), glowing red eyes, crooked yellow penalty flag (`#FFB800`).

### 2.4 Sprite Sheet & Animation Matrix
- **Player Sprite Footprint**: `48x48` px frame cell (character ~32x36 px inside cell to allow big shoulder pads, weapon swings, and dive extensions).
- **Animation States per Archetype**:
  1. `idle_stance` (3-point lineman crouch / skill player bounce — 4 frames)
  2. `run_8dir` (snappy 6-frame arcade stride with dust/slime kickup)
  3. `pass_windup_throw` (QB arm cock & release — 4 frames)
  4. `dive_tackle_lunge` (horizontal airborne lunge with motion smear — 3 frames)
  5. `hit_stagger_knockdown` (impact flash + flat-on-back bounce — 4 frames)
  6. `casualty_death` (faction-specific gore-comedy demise — 6 frames)
  7. `celebration` (endzone monster taunt — 4 frames)
- **On-Field Ground Indicators (Rendered beneath sprites in 2.5D perspective)**:
  - **Active Controlled Player**: Pulsing `SPECTRAL_CYAN` (`#00F0FF`) ellipse ring + directional velocity arrow + compact curved Stamina/HP arc.
  - **Ball Carrier**: Rotating `HELLFIRE_AMBER` (`#FFB800`) spiked star ring beneath feet.
  - **Eligible Receivers (Passing Window Open)**: Crisp pixel button badges (`[A]`, `[B]`, `[C]`) floating 20px above receiver heads with color-coded lead reticles on the turf.
  - **Ball Shadow & Trajectory**: Dark elliptical ground shadow directly at `(ball.x, ball.y)` while the ball sprite scales and offsets vertically by `ball.z`, plus a dotted arc preview on kicks/passes.

### 2.5 Unified UI / HUD Component Architecture
All UI components live in a shared design system (`@monster-league/shared-core/ui` + unified CSS/Canvas components) with 9-slice pixel-art borders, stone/iron bevels, and arcade typography (`Press Start 2P` / `Silkscreen` for headers & LED digits; `Chakra Petch` / `VT323` for high-density playbook & roster stats):
1. **Top Broadcast Scorebug ("GSN 66.6")**:
   - Compact docked top bar showing: `[HOME LOGO + SCORE + CASUALTY SKULLS]` | `[QTR + LED CLOCK + PLAY CLOCK]` | `[DOWN & DISTANCE + BALL ON]` | `[AWAY LOGO + SCORE + CASUALTY SKULLS]`.
   - Active **Bribe Ref** status shows a grinning greedy Necro-Ref badge next to the bribing team; **Casualty Counter** shows 4 skull slots per team that light up crimson as players die (4 skulls = FORFEIT!).
2. **Genesis-Style Pre-Snap Huddle & Playbook Overlay**:
   - Split-panel CRT overlay (supports 1P hidden-choice or 2P simultaneous button combo selection like Genesis *Madden/MLF* so P2 doesn't see P1's play!):
   - Left: Formation selector (`Graveyard I-Form`, `Crypt Shotgun`, `Haunted Singleback`, `Goal Line`, `Special Teams`).
   - Center: 3 Play Cards mapped to **[A]**, **[B]**, **[C]** with crisp chalk-and-slime X's and O's route diagrams (Amber = primary run/pass, Cyan = secondary routes, Crimson = blitzes).
   - Right: **Dirty Tricks Drawer** (`[Nasty Audible]` slots with remaining half charges + `[Bribe Ref]` button).
3. **Animated Broadcast Banners & Coach Portraits**:
   - Full-width kinetic arcade banners with 64x64 pixel-art **Monster Coach & Necro-Ref Portraits** (jaw-flapping 2-frame talk cycle) for:
     - `TOUCHDOWN!` (flaming jack-o'-lanterns + organ fanfare)
     - `NASTY AUDIBLE ACTIVATED!` (purple lightning border + coach cackle)
     - `BOGUS PENALTY!` (Necro-Ref portrait with glowing dollar-sign eyes + satirical callout text)
     - `PLAYER LIQUIDATED!` (tombstone slam + casualty ticker update)
     - `FORFEIT BY CARNAGE!` (post-game slaughter trophy screen)
4. **Controls & Accessibility Bar**:
   - Persistent, unobtrusive bottom-corner context strip dynamically updating button prompts based on game state (`Pre-Snap: [A] Audible  [B] Flip/Shift  [C] Hike` → `Pass Mode: [A/B/C] Throw to Receiver` → `Ball Carrier: [A] Dive  [B] Dirty Trick  [C] Turbo`).

---

## 3. Clean-Room Study of 1993 Sega Genesis *Mutant League Football*

We implement a clean-room mechanical homage based on documented 1993 Genesis mechanics:

### 3.1 Core Gridiron Rules & 7-on-7 Format
- **7-on-7 on-field format**: 7 active players per side on the field (Offense: QB, 2 RB/WR skill hybrids, 1 TE/WR, 3 Linemen; Defense: 3 DL, 2 LB, 2 DB), keeping the screen readable and fast-paced like the Genesis original while allowing violent open-field chaos.
- **Play clock & quarters**: 4 short arcade quarters (configurable 2–3 min), 25-second play clock, standard 4 downs for 10 yards, kickoffs, punts, field goals, and 1-pt / 2-pt conversions.
- **Win conditions**:
  1. **Score Victory**: Highest score at the end of Q4 (or OT sudden death).
  2. **Forfeit by Carnage (Slaughter Rule)**: Every monster has persistent per-game HP and Armor. Tackles, post-whistle cheap shots, hazards, and dirty tricks reduce HP. At 0 HP, the player suffers a comedic Halloween demise, fumbles the ball if carrying, and is removed for the game. Losing 4 players triggers an immediate **Forfeit by Carnage** victory for the surviving team!

### 3.2 Controls & "Genesis Madden meets Tape to Tape" Feel
- **Genesis 3-Button Arcade Mapping** (with modern Gamepad + Keyboard + Touch HUD support):
  - **D-Pad / Left Stick / WASD / Arrows**: 8-way/360° responsive movement with momentum, cutback sparks, and *Tape to Tape*-style snappy turn acceleration.
  - **Pre-Snap**:
    - **Button A (South / Space / J)**: Open Audible / Nasty Audible selector (`A -> A/B` standard audible, `A -> C -> A/B/C` Nasty Audible, matching the Genesis combo!).
    - **Button B (East / K)**: Switch pre-snap player / shift defensive alignment.
    - **Button C (West / L / Enter)**: Hike / Snap the ball.
  - **Passing Mode (Offense behind LOS)**:
    - **Button C**: Open Passing Windows (3 receiver target icons: **A**, **B**, **C** overhead).
    - **Press A, B, or C**: Throw to corresponding receiver (tap for lob, hold for bullet pass).
  - **Ball Carrier (Offense)**:
    - **Button A**: Dive / Lunge for extra yards (or leap over hazards/tacklers).
    - **Button B**: Spin / Stiff-Arm / Fire Nasty Audible weapon (throw jack-o'-lantern bomb, ectoplasm gas cloud).
    - **Button C**: Speed Burst / Turbo dash (consumes stamina bar).
  - **Defense**:
    - **Button A**: Big Hit / Dive Tackle (high knockdown & HP damage, commits momentum, 60ms hit-stop + screen shake on bone-crunching contact).
    - **Button B**: Switch to nearest defender to the ball + Special defensive dirty move.
    - **Button C**: Speed Burst / Strip-ball tackle.

### 3.3 Playbook, Nasty Audibles, Bribe Ref & Kill Ref
- **Nasty Audibles (Dirty Tricks — usable once per half per slot)**:
  - *Offense*:
    1. **Pumpkin Bomb Pass**: Ball is rigged with cursed gunpowder — explodes on catch or interception, damaging everyone in blast radius.
    2. **Dynamite Pitch (Run Blast)**: RB receives the pitch armed with 3 jack-o'-lantern grenades (Button B throws them at pursuing defenders).
    3. **Bat-Wing Jet Boost (Super Speed)**: Ball carrier sprouts vampire wings / spectral thrusters for blazing speed.
    4. **Ghoul Gas (Skunk Homage)**: Ball carrier unleashes a toxic green cloud behind them (Button B) that stuns/poisons tacklers.
  - *Defense*:
    1. **QB Crypt Blitz (Intent to Kill)**: Defensive line jumps the snap with bloodlust aura and +50% hit damage targeting the QB.
    2. **Phantom Shroud (Ghosts)**: Defenders turn semi-transparent spectral wraiths for 4 seconds.
    3. **Hex of Confusion**: Curses the offense with inverted controls and dizzy stars for 3 seconds.
  - *Universal Referee Chaos*:
    1. **Bribe Ref** (1x per half): Corrupts the Necro-Ref! For the next 3 plays, the ref calls absurd bogus 5-to-10 yard penalties on the opponent (*"5 Yards — Excessive Whining!"*, *"5 Yards — Breathing on the Zombie!"*, *"10 Yards — Unsportsmanlike Pulse!"*).
    2. **Kill Ref** (Nasty Audible): All players swarm the bribed referee to liquidate him! The non-calling side can steer the panicking ref to try to escape out of bounds. If the ref is slain, a backup Demon Ref drops from the sky and flags the killers 5 yards for *"Ref Bashing"*, clearing the bribe!

### 3.4 Three Hazardous Halloween Arenas
1. **The Cursed Graveyard**: Weathered gothic turf, tombstone obstacles (bounce/block), open grave pits (instant fall/casualty if pushed in), and buried jack-o'-lantern landmines.
2. **Brimstone Hellfire Pit**: Cracked obsidian turf, erupting lava geysers / fire pits (heavy burn damage + fumble), and scorching ember sidelines.
3. **Ectoplasm Swamp**: Slippery bog patches (ice/mud physics momentum slide), toxic sludge puddles (DoT poison + slow), and rolling fog banks.

---

## 4. Architecture & Multi-Site Azure Hosting
- **Monorepo Layout (`npm workspaces`)**:
  - `packages/shared-core`: Unified UI Design System (`GSN 66.6` theme tokens, 9-slice panels, broadcast banners, CRT shader), Gamepad/Keyboard/Touch input manager, 2.5D tilted projection math, deterministic PRNG, Monster faction/roster data, Audio Synth & Voice manager.
  - `packages/football`: Complete Phaser 4 *Halloween Monster League Football* application.
  - `packages/hockey`: Interactive *Monster League Hockey* preview & rink physics prototype sharing the unified `GSN 66.6` UI chrome, monster factions, and input engine.
  - `apps/arcade-hub`: Root Vite multi-page build that outputs:
    - `/` — Retro-modern **Monster League Arcade Cabinet Hub** (select Football or Hockey, inspect the 4 Monster Factions & star rosters, test audio/CRT settings, view controls).
    - `/football/` — *Halloween Monster League Football*.
    - `/hockey/` — *Monster League Hockey* preview mode.
- **Azure Static Web Apps (`staticwebapp.config.json`)**:
  - Single Azure Static Web App resource (`monster-league-arcade`, Free SKU) serving the unified `dist/` artifact with clean sub-path routing (`/football/*`, `/hockey/*`), immutable asset caching, and security headers.

---

## 5. Asset & Audio Budget ($10 Approved Cap)
- **Approved Budget**: Up to **$10.00 total** across image generation (`fal.ai` / Gemini pixel art) and audio/voice generation (`fal.ai` announcer voice clips / SFX), tracked strictly in a gitignored `.asset-manifest.json` per `ai-media-generation-workflow`.
- **Budget Breakdown**:
  - **Images (≤ $5.00 cap)**: High-contrast pixel art spritesheets, stadium backgrounds, team crests, and 64x64 coach/referee portraits, post-processed through a deterministic palette/outline normalizer script (`scripts/normalize-art.mjs`) so every asset shares the exact `#0B0711` 1px outline and Halloween Midnight Palette. All text/numbers rendered deterministically in HTML/Canvas.
  - **Audio & Voice (≤ $5.00 cap)**:
    - Procedural **Web Audio API Genesis YM2612 FM + PSG Chiptune Synth** (0 cost, deterministic) for organ riffs, spooky Halloween arcade BGM, bone-crunch tackles, whistle, explosions, and UI bleeps.
    - **fal.ai TTS / Audio clips** for the booming **Crypt Announcer** voice callouts (*"TOUCHDOWN!", "FUMBLE!", "REF LIQUIDATED!", "PENALTY: EXCESSIVE CRYING!", "FORFEIT BY CARNAGE!"*).

---

## 6. Kanban Card Decomposition (`monster-league-arcade` board)

| # | Title | Depends on | Assignee | Route | Acceptance (verifiable) | Contract |
|---|---|---|---|---|---|---|
| 1 | Scaffold & Unified Design System: monorepo, Vite multi-page hub (`/`, `/football/`, `/hockey/`), GSN 66.6 UI theme, Phaser 4, Vitest, Playwright & CI | — | `coder-claude` | `smart-v2` | `npm run check && npx playwright test` passes; `dist/index.html`, `dist/football/index.html`, `dist/hockey/index.html` built with unified `GSN 66.6` palette/typography/CRT chrome | `local-only` |
| 2 | Core Gridiron Sim Engine: 7v7 rules, formations, playbook, Nasty Audibles, Bribe/Kill Ref & casualty forfeit | Card 1 | `coder-claude` | `smart-frontier-v2` (`switchyard-anthropic`) | Deterministic headless sim tests (`npm run test -w @monster-league/football`) cover downs, TD/FG, Nasty Audibles, Bribe/Kill Ref, HP death fumbles & 4-casualty forfeit | `local-only` |
| 3 | Field Physics, 2.5D Phaser 4 Renderer & Tape-to-Tape Controls: run/pass/tackle, hazards & camera | Card 2 | `coder-claude` | `smart-frontier-v2` (`switchyard-anthropic`) | Playable 7v7 snap-to-whistle loop in Phaser 4 with Genesis 3-button keyboard/gamepad controls, ground rings/pass windows, mines/fire/grave hazards, hit-stop & E2E tests | `local-only` |
| 4 | Halloween Pixel Art & Visual Asset Pipeline: 4 Monster Factions, 3 Arenas, Hazards & Portraits (fal.ai + palette normalizer) | Card 1 | `coder-claude` | `smart-v2` | Spritesheets, tilesets, crests & portraits generated within ≤$5 image cap, normalized to `#0B0711` outline + master palette, validated by `npm run validate-assets` | `local-only` |
| 5 | Audio Engine & Crypt Announcer: Web Audio YM2612 FM Synth + fal.ai Voice Pack | Card 1 | `coder-claude` | `smart-v2` | FM synth BGM/SFX + announcer voice clips generated within ≤$5 audio cap, zero console errors, mute/volume persistence tested | `local-only` |
| 6 | Broadcast HUD/UI & AI Coach: Genesis Playbook Huddle, Scorebug, Animated Penalty/Casualty Banners & Monster Bowl | Cards 2, 3 | `coder-claude` | `smart-v2` | Full 4-quarter exhibition + 4-team Monster Bowl tournament playable vs AI or 2P, unified `GSN 66.6` HUD overlays & penalty banners verified in Playwright across scenes | `local-only` |
| 7 | MVP Integration, Visual Coherence QA, Azure Static Web Apps Deployment & Architecture Lock | Cards 3, 4, 5, 6 | `coder-claude` | `smart-frontier-v2` (`switchyard-anthropic`) | All assets/audio wired into `/football/`, `/hockey/` & `/` hub, `ARCHITECTURE.md` written, `scripts/deploy.sh` deploys live Azure SWA preview, visual & E2E smoke passes | `local-only` |
