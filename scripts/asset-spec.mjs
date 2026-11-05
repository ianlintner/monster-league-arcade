/** Single source of truth for expected assets (used by generator + validator). */
export const FACTIONS = [
  'boneyard_reapers',
  'rotting_deadskins',
  'transylvania_nightstalkers',
  'salem_bayou_ghouls',
];
export const SPRITE_SHEETS = [...FACTIONS, 'necro_ref', 'demon_ref'];
export const CREST_FACTIONS = FACTIONS;
export const PORTRAITS = [
  'coach_boneyard_reapers',
  'coach_rotting_deadskins',
  'coach_transylvania_nightstalkers',
  'coach_salem_bayou_ghouls',
  'necro_ref',
  'demon_ref',
  'crypt_announcer',
];
/** Animation rows in sprite sheets (PLAN.md §2.4). 6 columns max; run_8dir = 8 rows (S,SE,E,NE,N,NW,W,SW). */
export const ANIMATIONS = [
  { name: 'idle_stance', rows: 1, frames: 4 },
  { name: 'run_8dir', rows: 8, frames: 6 },
  { name: 'pass_windup_throw', rows: 1, frames: 4 },
  { name: 'dive_tackle_lunge', rows: 1, frames: 3 },
  { name: 'hit_stagger_knockdown', rows: 1, frames: 4 },
  { name: 'casualty_death', rows: 1, frames: 6 },
  { name: 'celebration', rows: 1, frames: 4 },
];
export const SHEET_COLS = 6;
export const SHEET_ROWS = ANIMATIONS.reduce((n, a) => n + a.rows, 0);
export const SPRITE_CELL = 48;
export const PORTRAIT_CELL = 64;
export const ARENAS = {
  cursed_graveyard: ['tombstones', 'grave_pit', 'jack_o_lantern_mine'],
  brimstone_hellfire_pit: ['obsidian_cracks', 'lava_geyser'],
  ectoplasm_swamp: ['sludge_puddle', 'bog_patch', 'fog'],
};
export const HAZARD_FRAMES = 4;
export const TILE = 64;
export const MAX_FILE_BYTES = 40 * 1024;
