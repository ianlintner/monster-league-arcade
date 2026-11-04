import '@monster-league/shared-core/styles.css';
import { setCrtEnabled, isCrtEnabled } from '@monster-league/shared-core/ui';

const CRT_STORAGE_KEY = 'gsn-crt';

function readCrt(): boolean {
  try {
    return localStorage.getItem(CRT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCrt(on: boolean): void {
  try {
    localStorage.setItem(CRT_STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: ignore */
  }
}

/** Inject the CRT overlay and wire up any `[data-crt-toggle]` button. */
export function initChrome(): void {
  document.body.classList.add('gsn-app');
  const overlay = document.createElement('div');
  overlay.className = 'gsn-crt-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.append(overlay);

  const saved = readCrt();
  setCrtEnabled(saved);
  document.querySelectorAll<HTMLButtonElement>('[data-crt-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(saved));
    btn.addEventListener('click', () => {
      setCrtEnabled(!isCrtEnabled());
      btn.setAttribute('aria-pressed', String(isCrtEnabled()));
      writeCrt(isCrtEnabled());
    });
  });
}
