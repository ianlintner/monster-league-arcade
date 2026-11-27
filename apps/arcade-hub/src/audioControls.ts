import { isInteractiveOrEditableTarget, type AudioManager } from '@monster-league/shared-core';

/**
 * Wire the toolbar mute button (`[data-mute-toggle]`) and the M key to the one
 * `AudioManager`. Both call `toggleMute()`; the persisted `muted` flag (existing
 * AUDIO_STORAGE_KEY) is the single source of truth, mirrored into `aria-pressed`.
 */
export function wireMuteControls(audio: AudioManager, doc: Document = document): void {
  const buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>('[data-mute-toggle]'));
  const sync = (): void => {
    const muted = audio.getSettings().muted;
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(muted));
      b.textContent = muted ? 'Sound: Off [M]' : 'Sound: On [M]';
    }
  };
  sync();
  audio.onChange(sync);

  for (const b of buttons) {
    b.addEventListener('click', () => {
      audio.toggleMute();
      // Hand the keyboard back to the game: a focused button would make the
      // interactive-target rule swallow the next M / gameplay key.
      b.blur();
    });
  }

  doc.defaultView?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'KeyM' || e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Same rule as InputManager: keys typed into controls are not game input.
    if (isInteractiveOrEditableTarget(e.target)) return;
    audio.toggleMute();
  });
}

/**
 * The first-run card swallows the dismissing key in the capture phase before the
 * AudioManager's own bubble listener runs, so unlock on a capture-phase listener
 * registered earlier. Any real key/pointer gesture creates the AudioContext.
 */
export function unlockOnFirstGesture(audio: AudioManager, win: Window = window): void {
  const go = (): void => {
    void audio.unlock();
  };
  win.addEventListener('keydown', go, { capture: true });
}
