import { isAbsolute, join, normalize, relative, sep } from 'node:path';

/** Resolve urlPath under root; return null if it escapes root (incl. sibling-prefix dirs). */
export function resolveInside(root, urlPath) {
  const file = normalize(join(root, urlPath));
  const rel = relative(root, file);
  if (rel === '') return file;
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return file;
}
