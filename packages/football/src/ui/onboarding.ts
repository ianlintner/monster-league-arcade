/**
 * Onboarding — the first-run controls card and the in-viewport prompt strip.
 *
 * Pure DOM (no Phaser). The prompt strip is `position: fixed` to the bottom of the
 * viewport so the current instruction is visible at any canvas scale (at 1280×720
 * the 2× canvas pushes the control bar below the fold). The controls card is shown
 * on the first huddle, dismissed by any key (the dismissing key is swallowed so it
 * never also picks a play), remembered in `localStorage`, and reopened with `?`/H.
 */

export const SEEN_CONTROLS_KEY = 'mla.football.seenControls';

/** Keys that reopen the card once dismissed (`?` is Shift+/ on most layouts). */
const REOPEN_KEYS = new Set(['?', 'h', 'H']);

export interface Onboarding {
  /** True while the card is up (the scene pauses its clocks meanwhile). */
  isOpen(): boolean;
  /** Update the in-viewport prompt strip text. */
  setPrompt(text: string): void;
}

function safeStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

export function hasSeenControls(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(SEEN_CONTROLS_KEY) === '1';
  } catch {
    return false;
  }
}

/** The controls card content: goal, attack direction and the working keys. */
export function buildControlsCard(doc: Document): HTMLElement {
  const card = doc.createElement('div');
  card.className = 'gsn-controls-card';
  card.setAttribute('data-testid', 'controls-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'How to play');
  const rows: [string, string][] = [
    ['Huddle', 'J / K / L call a play'],
    ['Pre-snap', 'L hikes the ball'],
    ['Run', 'WASD run · J dive · L turbo'],
    ['Pass', 'L opens receiver windows · J / K / L throw'],
    ['Defense', 'WASD steer defender · K switch · J dive tackle'],
    ['This card', '? or H reopens it'],
  ];
  const keyRows = rows.map(([k, v]) => `<li><b>${k}</b> <span>${v}</span></li>`).join('');
  card.innerHTML =
    '<h2 class="gsn-controls-card__title">HOW TO PLAY</h2>' +
    '<p><b>Goal:</b> score more than the Deadskins. Lose 4 monsters and you forfeit.</p>' +
    '<p><b>Attack direction:</b> you drive <b>→ to the right</b>, toward the glowing arrow in the far end zone.</p>' +
    `<ul class="gsn-controls-card__keys">${keyRows}</ul>` +
    '<p class="gsn-controls-card__dismiss">Press any key to start</p>';
  return card;
}

/** Mount the prompt strip + controls card. Safe to call once per page. */
export function mountOnboarding(doc: Document = document, win: Window = window): Onboarding {
  const prompt = doc.createElement('div');
  prompt.className = 'gsn-onboard-prompt';
  prompt.setAttribute('data-testid', 'onboard-prompt');
  prompt.setAttribute('role', 'status');
  doc.body.append(prompt);

  const storage = safeStorage(win);
  let card: HTMLElement | null = null;

  const open = (): void => {
    if (card) return;
    card = buildControlsCard(doc);
    card.addEventListener('click', close);
    doc.body.append(card);
  };
  const close = (): void => {
    if (!card) return;
    card.remove();
    card = null;
    try {
      storage?.setItem(SEEN_CONTROLS_KEY, '1');
    } catch {
      /* private mode: just don't remember */
    }
  };

  // Capture phase on `window` runs before the InputManager's bubble listener, so the
  // dismissing key (and every key while the card is up) never reaches the game.
  win.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (card) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) close();
        return;
      }
      if (REOPEN_KEYS.has(e.key) && !e.repeat) {
        e.stopImmediatePropagation();
        open();
      }
    },
    true,
  );

  if (!hasSeenControls(storage)) open();

  return {
    isOpen: () => card !== null,
    setPrompt: (text) => {
      if (prompt.textContent !== text) prompt.textContent = text;
    },
  };
}
