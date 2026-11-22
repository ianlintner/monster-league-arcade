#!/usr/bin/env node
/**
 * Verify a deployed build over HTTP: status, security headers, and asset
 * sha256 equality against the local dist/ artifact.
 *
 *   node scripts/verify-deployment.mjs https://<swa-host>
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/verify-deployment.mjs <https://swa-host>');
  process.exit(2);
}

const ROUTES = ['/', '/football/', '/hockey/'];
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let failures = 0;
const fail = (m) => {
  failures++;
  console.error('FAIL: ' + m);
};

// Collect all hashed asset URLs from built HTML plus the generated art/audio
// files, and compare remote sha256 with the local artifact.
const htmlFiles = ['index.html', 'football/index.html', 'hockey/index.html'];
const assetPaths = new Set();
for (const f of htmlFiles) {
  const html = readFileSync(join(DIST, f), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g))
    assetPaths.add(m[1]);
}
const walk = (dir, prefix = '') => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${e.name}`;
    if (e.isDirectory()) walk(join(dir, e.name), rel);
    else if (/\.(png|mp3|json)$/.test(e.name)) assetPaths.add(`/assets${rel}`);
  }
};

walk(join(DIST, 'assets'));

console.log(`verify-deployment: ${ROUTES.length} routes, ${assetPaths.size} assets`);

for (const route of ROUTES) {
  let res;
  try {
    res = await fetch(base + route);
  } catch (e) {
    fail(`${route} request failed: ${e.message}`);
    continue;
  }
  if (res.status !== 200) fail(`${route} returned HTTP ${res.status}`);
  for (const [name, want] of Object.entries(HEADERS)) {
    if ((res.headers.get(name) ?? '').toLowerCase() !== want.toLowerCase())
      fail(`${route} missing header ${name}: ${want}`);
  }
  const body = await res.text();
  if (!body.includes('GSN 66.6')) fail(`${route} body lacks GSN 66.6 chrome`);
}

for (const path of assetPaths) {
  const local = join(DIST, path.replace(/^\//, ''));
  if (!existsSync(local)) {
    fail(`local asset missing: ${path}`);
    continue;
  }
  const expected = sha256(readFileSync(local));
  let res;
  try {
    res = await fetch(base + path);
  } catch (e) {
    fail(`${path} request failed: ${e.message}`);
    continue;
  }
  if (res.status !== 200) {
    fail(`${path} returned HTTP ${res.status}`);
    continue;
  }
  const actual = sha256(Buffer.from(await res.arrayBuffer()));
  if (actual !== expected) fail(`${path} sha256 mismatch: want ${expected}, got ${actual}`);
}

if (failures) {
  console.error(`verify-deployment: ${failures} failure(s)`);
  process.exit(1);
}
console.log('verify-deployment: all routes, headers and asset hashes verified');
