/** Canonical Monster Faction, roster and arena registry (PLAN.md §2.3, §3.4). */

export type FactionId = 'reapers' | 'deadskins' | 'nightstalkers' | 'ghouls';
export type ArenaId = 'cursed-graveyard' | 'brimstone-hellfire-pit' | 'ectoplasm-swamp';

export interface FactionStats {
  /** All stats are 1-10 arcade ratings. */
  speed: number;
  power: number;
  passing: number;
  defense: number;
}

export interface StarPlayer {
  name: string;
  position: string;
}

export interface Faction {
  id: FactionId;
  name: string;
  species: string;
  /** Primary / secondary / accent uniform colours (#RRGGBB). */
  colors: { primary: string; secondary: string; accent: string };
  stats: FactionStats;
  stars: StarPlayer[];
  homeArena: ArenaId;
  deathVfx: string;
  silhouette: string;
}

export interface Arena {
  id: ArenaId;
  name: string;
  hazards: string[];
  description: string;
}

export const FACTIONS: readonly Faction[] = [
  {
    id: 'reapers',
    name: 'Boneyard Reapers',
    species: 'Skeletons',
    colors: { primary: '#F4EFE6', secondary: '#2B0938', accent: '#00F0FF' },
    stats: { speed: 8, power: 5, passing: 7, defense: 6 },
    stars: [
      { name: 'Rib Rodriguez', position: 'QB' },
      { name: 'Skully McBones', position: 'WR' },
      { name: 'Femur Fitzgerald', position: 'DL' },
    ],
    homeArena: 'cursed-graveyard',
    deathVfx: 'Explodes into 8 bouncing pixel bones and a chattering skull',
    silhouette: 'Jagged shoulder spikes, exposed ribcages, horned skull helmets',
  },
  {
    id: 'deadskins',
    name: 'Rotting Deadskins',
    species: 'Zombies',
    colors: { primary: '#6B8E23', secondary: '#8B1E1E', accent: '#39FF14' },
    stats: { speed: 4, power: 10, passing: 4, defense: 8 },
    stars: [
      { name: 'Brain Bobbitt', position: 'RB' },
      { name: 'Lurch Lombardi', position: 'DL' },
      { name: 'Gristle Gunderson', position: 'LB' },
    ],
    homeArena: 'ectoplasm-swamp',
    deathVfx: 'Splats into a green slime puddle and a twitching severed arm',
    silhouette: 'Hulking asymmetric shoulder pads, torn jerseys, glowing yellow eyes',
  },
  {
    id: 'nightstalkers',
    name: 'Transylvania Nightstalkers',
    species: 'Vampires',
    colors: { primary: '#990024', secondary: '#FFD166', accent: '#110B1A' },
    stats: { speed: 9, power: 6, passing: 8, defense: 5 },
    stars: [
      { name: 'Count Cutback', position: 'RB' },
      { name: 'Vlad Vickers', position: 'QB' },
      { name: 'Mina Mayhem', position: 'DB' },
    ],
    homeArena: 'brimstone-hellfire-pit',
    deathVfx: 'Poofs into an ash cloud and a swarm of 5 pixel bats',
    silhouette: 'High-collared bat-wing shoulder armor, sleek visors, cape strips',
  },
  {
    id: 'ghouls',
    name: 'Salem Bayou Ghouls',
    species: 'Ghouls & Witches',
    colors: { primary: '#7B2CBF', secondary: '#FF6B1A', accent: '#2A4D3E' },
    stats: { speed: 6, power: 6, passing: 6, defense: 9 },
    stars: [
      { name: 'Hester Hexington', position: 'QB' },
      { name: 'Gumbo Gravely', position: 'LB' },
      { name: 'Lantern Lou', position: 'TE' },
    ],
    homeArena: 'ectoplasm-swamp',
    deathVfx: 'Dissolves into purple cursed flames and a floating wisp',
    silhouette: 'Hooded tattered jerseys, glowing lantern belt, witch-iron facemasks',
  },
];

export const ARENAS: readonly Arena[] = [
  {
    id: 'cursed-graveyard',
    name: 'The Cursed Graveyard',
    hazards: ['Tombstone obstacles', 'Open grave pits', 'Jack-o-lantern landmines'],
    description: 'Weathered gothic turf littered with tombstones and open graves.',
  },
  {
    id: 'brimstone-hellfire-pit',
    name: 'Brimstone Hellfire Pit',
    hazards: ['Lava geysers', 'Fire pits', 'Scorching ember sidelines'],
    description: 'Cracked obsidian turf with erupting lava geysers.',
  },
  {
    id: 'ectoplasm-swamp',
    name: 'Ectoplasm Swamp',
    hazards: ['Slippery bog patches', 'Toxic sludge puddles', 'Rolling fog banks'],
    description: 'Slippery bog turf, toxic sludge and rolling fog.',
  },
];

export function getFaction(id: FactionId): Faction {
  const f = FACTIONS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown faction: ${id}`);
  return f;
}

export function getArena(id: ArenaId): Arena {
  const a = ARENAS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown arena: ${id}`);
  return a;
}
