import '@monster-league/shared-core/styles.css';
import { setCrtEnabled, isCrtEnabled } from '@monster-league/shared-core/ui';

/** Inject the CRT overlay and wire up any `[data-crt-toggle]` button. */
export function initChrome(): void {
  document.body.classList.add('gsn-app');
  const overlay = document.createElement('div');
  overlay.className = 'gsn-crt-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.append(overlay);

  const saved = localStorage.getItem('gsn-crt') === '1';
  setCrtEnabled(saved);
  document.querySelectorAll<HTMLButtonElement>('[data-crt-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(saved));
    btn.addEventListener('click', () => {
      setCrtEnabled(!isCrtEnabled());
      btn.setAttribute('aria-pressed', String(isCrtEnabled()));
      localStorage.setItem('gsn-crt', isCrtEnabled() ? '1' : '0');
    });
  });
}
