/// <reference types="vite/client" />
/**
 * Deployment-base-aware URL helpers.
 *
 * The game is hosted under a sub-path on the Cat Herding Games hub
 * (https://games.cat-herding.net/monster-league-arcade/), so no runtime URL may be
 * root-absolute. Vite statically replaces the literal `import.meta.env.BASE_URL`
 * ("/" by default, or the `--base` value at build time) — it must be written out in
 * full, not aliased, or the build will not substitute it.
 */

/** Deployment base path, always ending in "/". */
export function baseUrl(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** Resolve a path relative to the deployment base (leading slashes ignored). */
export function assetUrl(path: string): string {
  return `${baseUrl()}${path.replace(/^\/+/, '')}`;
}
