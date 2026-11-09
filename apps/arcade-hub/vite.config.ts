import { resolve, join, sep, extname } from 'node:path';
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const root = import.meta.dirname;

// Repository-root public/assets (written by scripts/generate-art.mjs) lives outside
// Vite's publicDir (default `apps/arcade-hub/public`), so it is neither served by the
// dev server nor copied into `dist` on build. This plugin bridges both while leaving
// `apps/arcade-hub/public/staticwebapp.config.json` untouched.
const repoAssets = resolve(root, '../../public/assets');
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
};

/** Serve repo-root public/assets under /assets/* in the dev server. */
function serveRepoAssets(): Plugin {
  return {
    name: 'serve-repo-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/assets/')) return next();
        const pathname = decodeURIComponent(req.url.split('?')[0] ?? '');
        // Reject traversal (raw or percent-encoded) before normalize() collapses the
        // `..` segments; normalize() alone turned `/assets/../../vite.config.ts` into
        // `../../vite.config.ts`, which no longer matched the `..${sep}` prefix guard.
        if (pathname.includes('\0') || /(^|[/\\])\.\.([/\\]|$)/.test(pathname)) {
          res.statusCode = 403;
          return res.end('forbidden');
        }
        const rel = pathname.slice('/assets'.length).replace(/^[/\\]+/, '');
        const file = join(repoAssets, rel);
        // Defense-in-depth: confirm the resolved path is still inside repoAssets, so an
        // encoded `..` that slipped the regex cannot escape the assets directory.
        const within = file === repoAssets || file.startsWith(repoAssets + sep);
        if (!within) {
          res.statusCode = 403;
          return res.end('forbidden');
        }
        const stat = statSync(file, { throwIfNoEntry: false });
        if (!stat?.isFile()) return next();
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
  };
}

/** Copy repo-root public/assets into dist/assets after the bundle is written. */
function copyRepoAssets(): Plugin {
  return {
    name: 'copy-repo-assets',
    apply: 'build',
    closeBundle() {
      if (!existsSync(repoAssets)) return;
      cpSync(repoAssets, resolve(root, '../../dist/assets'), { recursive: true });
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  build: {
    outDir: resolve(root, '../../dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        hub: resolve(root, 'index.html'),
        football: resolve(root, 'football/index.html'),
        hockey: resolve(root, 'hockey/index.html'),
      },
    },
  },
  server: { port: 5173 },
  plugins: [serveRepoAssets(), copyRepoAssets()],
});
