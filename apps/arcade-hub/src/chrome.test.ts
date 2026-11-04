import { afterEach, describe, expect, it, vi } from 'vitest';
import { initChrome } from './chrome';

describe('initChrome', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('does not throw when localStorage throws SecurityError', () => {
    const err = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: err, setItem: err });
    document.body.innerHTML = '<button data-crt-toggle></button>';
    expect(() => initChrome()).not.toThrow();
    const btn = document.querySelector<HTMLButtonElement>('[data-crt-toggle]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(() => btn.click()).not.toThrow();
  });
});
