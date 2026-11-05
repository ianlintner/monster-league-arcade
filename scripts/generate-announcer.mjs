#!/usr/bin/env node
// Generates the Crypt Announcer voice pack via fal.ai Kokoro TTS, then
// normalizes with ffmpeg loudnorm to compact mono mp3. Logs spend to the
// gitignored .asset-manifest.json. Needs FAL_KEY. Usage: node scripts/generate-announcer.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = 'fal-ai/kokoro/american-english';
const COST_PER_1K_CHARS = 0.02; // fal.ai Kokoro list price
const BUDGET = 5.0;
const out = 'apps/arcade-hub/public/assets/audio/announcer';
const manifestPath = '.asset-manifest.json';
const src = readFileSync('packages/shared-core/src/audio/voiceManifest.ts', 'utf8');
const clips = [
  ...src.matchAll(/\{ id: '([^']+)', text: ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*') \}/g),
].map((m) => ({
  id: m[1],
  text: JSON.parse(m[2].startsWith('"') ? m[2] : `"${m[2].slice(1, -1)}"`),
}));
if (clips.length !== 12) throw new Error(`expected 12 clips, got ${clips.length}`);
// fal's content filter rejects some violent wording; speak phonetic respellings instead.
const SPOKEN = { 'kill-the-ref': 'Kil the ref!' };
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { entries: [] };
manifest.entries ??= [];
const spent = () =>
  manifest.entries.filter((e) => e.kind === 'audio').reduce((s, e) => s + e.costUsd, 0);
mkdirSync(out, { recursive: true });
const force = process.argv.includes('--force');
for (const c of clips) {
  const dest = join(out, `${c.id}.mp3`);
  if (existsSync(dest) && !force) continue;
  const cost = (c.text.length / 1000) * COST_PER_1K_CHARS;
  if (spent() + cost > BUDGET) throw new Error('audio budget exceeded');
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: SPOKEN[c.id] ?? c.text, voice: 'am_onyx', speed: 0.9 }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
  const { audio } = await res.json();
  const wav = join(process.env.TMPDIR ?? tmpdir(), `${c.id}.wav`);
  writeFileSync(wav, Buffer.from(await (await fetch(audio.url)).arrayBuffer()));
  // Lower pitch slightly for a gravelly crypt voice, add a short crypt echo, then loudnorm.
  const af =
    'asetrate=24000*0.9,aresample=24000,aecho=0.8:0.6:60:0.25,loudnorm=I=-16:TP=-1.5:LRA=7';
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    wav,
    '-af',
    af,
    '-ac',
    '1',
    '-ar',
    '24000',
    '-b:a',
    '64k',
    dest,
  ]);
  manifest.entries.push({
    kind: 'audio',
    id: c.id,
    model: MODEL,
    text: c.text,
    costUsd: cost,
    file: dest,
    at: new Date().toISOString(),
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`generated ${dest} ($${cost.toFixed(4)})`);
}
console.log(`audio spend: $${spent().toFixed(4)} / $${BUDGET}`);
