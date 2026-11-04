import { describe, expect, it } from 'vitest';
import { resolveInside } from './resolve-inside.mjs';

describe('resolveInside', () => {
  const root = '/srv/dist';
  it('allows files inside root', () => {
    expect(resolveInside(root, '/a/b.js')).toBe('/srv/dist/a/b.js');
    expect(resolveInside(root, '/')).toBe('/srv/dist/');
  });
  it('rejects traversal and sibling-prefix directories', () => {
    expect(resolveInside(root, '/../dist-private/secret.txt')).toBeNull();
    expect(resolveInside(root, '/../../etc/passwd')).toBeNull();
  });
});
