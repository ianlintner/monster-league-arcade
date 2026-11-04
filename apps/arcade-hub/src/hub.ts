import { initChrome } from './chrome';
import { FACTIONS, getArena, InputManager, type Faction } from '@monster-league/shared-core';
import { el } from '@monster-league/shared-core/ui';

initChrome();

const roster = document.getElementById('roster');
const detail = document.getElementById('faction-detail');

function showFaction(f: Faction): void {
  if (!detail) return;
  detail.replaceChildren();
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
