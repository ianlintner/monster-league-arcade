import { initChrome } from './chrome';
import { FACTIONS, getArena, InputManager, type Faction } from '@monster-league/shared-core';
import { el } from '@monster-league/shared-core/ui';
import { AudioManager } from '@monster-league/shared-core/audio';

// Shared normalized-art registry: all routes point at the same /assets tree.
const ASSET_ROOT = '/assets';
const ASSET_SLUGS: Record<string, string> = {
  reapers: 'boneyard_reapers',
  deadskins: 'rotting_deadskins',
  nightstalkers: 'transylvania_nightstalkers',
  ghouls: 'salem_bayou_ghouls',
};
const FACTION_ART: Record<string, { coach: string; crest: string; sheet: string }> =
  Object.fromEntries(
    Object.entries(ASSET_SLUGS).map(([id, slug]) => [
      id,
      {
        coach: `${ASSET_ROOT}/portraits/coach_${slug}.png`,
        crest: `${ASSET_ROOT}/sprites/crest_${slug}.png`,
        sheet: `${ASSET_ROOT}/sprites/${slug}.png`,
      },
    ]),
  );
const ARENA_ART: Record<string, string> = {
  cursed_graveyard: `${ASSET_ROOT}/arenas/cursed_graveyard_turf.png`,
  brimstone_hellfire_pit: `${ASSET_ROOT}/arenas/brimstone_hellfire_pit_turf.png`,
  ectoplasm_swamp: `${ASSET_ROOT}/arenas/ectoplasm_swamp_turf.png`,
};
const OFFICIAL_ART = {
  necroRef: `${ASSET_ROOT}/portraits/necro_ref.png`,
  announcer: `${ASSET_ROOT}/portraits/crypt_announcer.png`,
};

initChrome();

const roster = document.getElementById('roster');
const detail = document.getElementById('faction-detail');

function imgCard(src: string, label: string, testid?: string): HTMLElement {
  const card = el('figure', 'gsn-art-card');
  const img = el('img', 'gsn-art-card__img');
  img.src = src;
  img.alt = label;
  if (testid) img.dataset.testid = testid;
  card.append(img, el('figcaption', 'gsn-art-card__label', label));
  return card;
}

function showFaction(f: Faction): void {
  if (!detail) return;
  detail.replaceChildren();
  const art = FACTION_ART[f.id];
  if (art) {
    const strip = el('div', 'gsn-art-strip');
    strip.append(
      imgCard(art.coach, `${f.name} coach portrait`, 'faction-coach-portrait'),
      imgCard(art.crest, `${f.name} crest`, 'faction-crest'),
      imgCard(art.sheet, `${f.name} away kit`, 'faction-spritesheet'),
    );
    detail.append(strip);
  }
  const dl = el('dl');
  const row = (k: string, v: string): void => {
    const r = el('div', 'gsn-kv');
    r.append(el('dt', undefined, k), el('dd', undefined, v));
    dl.append(r);
  };
  row('Team', f.name);
  row('Species', f.species);
  row('Home Arena', getArena(f.homeArena).name);
  row('Stars', f.stars.map((s) => `${s.name} (${s.position})`).join(', '));
  row(
    'Stats',
    Object.entries(f.stats)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · '),
  );
  row('Death VFX', f.deathVfx);
  detail.append(dl);
}

FACTIONS.forEach((f, i) => {
  const btn = el('button', 'gsn-faction');
  btn.type = 'button';
  const swatch = el('span', 'gsn-faction__swatch');
  swatch.style.background = f.colors.primary;
  btn.append(
    swatch,
    el('span', 'gsn-faction__name', f.name),
    el('span', 'gsn-faction__species', f.species),
  );
  btn.addEventListener('click', () => {
    roster
      ?.querySelectorAll('.gsn-faction')
      .forEach((b) => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    showFaction(f);
  });
  roster?.append(btn);
  if (i === 0) {
    btn.setAttribute('aria-pressed', 'true');
    showFaction(f);
  }
});

// Controller tester.
const padEl = document.getElementById('pad');
const dpad = document.getElementById('dpad');
const keys = new Map<string, HTMLElement>();
for (const b of ['A', 'B', 'C', 'START']) {
  const k = el('div', 'gsn-key', b);
  keys.set(b, k);
  padEl?.append(k);
}
const cells: HTMLElement[] = [];
for (let i = 0; i < 9; i++) {
  const c = el('div', 'gsn-dpad__cell');
  cells.push(c);
  dpad?.append(c);
}
const input = new InputManager();
input.attach(window);
function tick(): void {
  const activeCells = new Set<number>();
  for (const node of keys.values()) node.dataset.active = 'false';
  for (const player of [0, 1] as const) {
    const s = input.poll(player);
    if (s.x !== 0 || s.y !== 0) {
      const col = s.x > 0.3 ? 2 : s.x < -0.3 ? 0 : 1;
      const rowIdx = s.y > 0.3 ? 2 : s.y < -0.3 ? 0 : 1;
      activeCells.add(rowIdx * 3 + col);
    }
    for (const [name, node] of keys) {
      if (s.buttons[name as 'A' | 'B' | 'C' | 'START']) node.dataset.active = 'true';
    }
  }
  cells.forEach((c, i) => (c.dataset.active = String(activeCells.has(i))));
  requestAnimationFrame(tick);
}
tick();

// Shared-asset broadcast stage: the same normalized arenas and officials feed
// football and hockey. Displayed here so the hub doubles as the visual QA board.
const stage = el('section', 'gsn-panel gsn-asset-stage');
stage.append(el('h2', 'gsn-panel__title', 'Broadcast Asset Board'));
const arenas = el('div', 'gsn-art-strip');
for (const [id, src] of Object.entries(ARENA_ART)) {
  arenas.append(imgCard(src, id.replaceAll('_', ' '), `arena-${id}`));
}
arenas.append(
  imgCard(OFFICIAL_ART.necroRef, 'Necro-Ref', 'official-necro-ref'),
  imgCard(OFFICIAL_ART.announcer, 'Crypt Announcer', 'official-announcer'),
);
stage.append(arenas);
document.querySelector('.gsn-chrome')?.append(stage);

// Crypt Announcer / FM synth preview. Audio starts on user gesture, as required
// by browser autoplay policy; the same AudioManager is shared with both games.
const audioPanel = el('section', 'gsn-panel gsn-audio-preview');
audioPanel.append(el('h2', 'gsn-panel__title', 'Broadcast Audio Test'));
const audioBtn = el('button', 'gsn-btn', 'Test Crypt Announcer');
audioBtn.type = 'button';
audioBtn.dataset.testid = 'audio-test';
const audioStatus = el('span', 'gsn-audio-status', 'Ready');
audioStatus.dataset.testid = 'audio-status';
const audio = new AudioManager();
audioBtn.addEventListener('click', () => {
  void audio.unlock().then(() => {
    audio.playSfx('bleep-a');
    void audio.playVoice('welcome').then((kind) => {
      audioStatus.textContent = kind === 'clip' ? 'Clip played' : `Fallback: ${kind}`;
    });
  });
});
audioPanel.append(audioBtn, audioStatus);
stage.after(audioPanel);
