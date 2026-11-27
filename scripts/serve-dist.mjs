import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { resolveInside } from './resolve-inside.mjs';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.env.E2E_PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};
// Optional mount prefix (e.g. /monster-league-arcade) so a build made with
// `--base=/monster-league-arcade/` is served exactly as the hub serves it. Anything outside
// the prefix is a 404, which makes root-absolute URLs fail loudly.
const prefix = (process.env.E2E_BASE_PATH ?? '').replace(/\/+$/, '');

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (prefix) {
      if (path !== prefix && !path.startsWith(`${prefix}/`)) throw new Error('outside base');
      path = path.slice(prefix.length) || '/';
    }
    let file = resolveInside(dist, path);
    if (!file) throw new Error('forbidden');
    const s = await stat(file).catch(() => null);
    if (s?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.info(`serving ${dist} on ${port}`));
