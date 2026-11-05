#!/usr/bin/env node
// Validates the announcer voice pack with ffprobe/ffmpeg: all 12 clips exist and are
// valid mp3, compact (<=60 KB, <=6 s), loudness-normalized near -16 LUFS, and that
// audio spend in .asset-manifest.json is <= $5.00.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'apps/arcade-hub/public/assets/audio/announcer';
const BUDGET = 5.0;
const src = readFileSync('packages/shared-core/src/audio/voiceManifest.ts', 'utf8');
const ids = [...src.matchAll(/\{ id: '([^']+)', text:/g)].map((m) => m[1]);
const errors = [];
if (ids.length !== 12) errors.push(`expected 12 clips in manifest, found ${ids.length}`);

for (const id of ids) {
  const f = join(dir, `${id}.mp3`);
  if (!existsSync(f)) {
    errors.push(`missing ${f}`);
    continue;
  }
  try {
    const probe = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration,size,format_name',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'json',
        f,
      ]).toString(),
    );
    const dur = Number(probe.format.duration);
    const size = statSync(f).size;
    if (!probe.format.format_name.includes('mp3') || probe.streams?.[0]?.codec_name !== 'mp3')
      errors.push(`${f}: not mp3`);
    if (!(dur > 0.3 && dur <= 6)) errors.push(`${f}: duration ${dur}s out of range`);
    if (size > 60 * 1024) errors.push(`${f}: ${size} bytes exceeds 60KB`);
    const r = spawnSync(
      'ffmpeg',
      [
        '-nostats',
        '-i',
        f,
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    );
    const m = (r.stderr ?? '').match(/\{[^{}]*"input_i"[^{}]*\}/s);
    if (!m) {
      errors.push(`${f}: loudness measurement failed`);
      continue;
    }
    const j = JSON.parse(m[0]);
    const lufs = Number(j.input_i);
    const tp = Number(j.input_tp);
    // Short clips: loudnorm single-pass is approximate; require within 3 LU and true peak <= -0.9 dBTP.
    if (Math.abs(lufs + 16) > 3) errors.push(`${f}: ${lufs} LUFS not near -16`);
    if (tp > -0.9) errors.push(`${f}: true peak ${tp} dBTP too hot`);
  } catch (e) {
    errors.push(`${f}: ffprobe failed: ${e.message}`);
  }
}

if (existsSync('.asset-manifest.json')) {
  const m = JSON.parse(readFileSync('.asset-manifest.json', 'utf8'));
  const spend = (m.entries ?? [])
    .filter((e) => e.kind === 'audio')
    .reduce((s, e) => s + e.costUsd, 0);
  console.log(`audio spend: $${spend.toFixed(4)} (cap $${BUDGET})`);
  if (spend > BUDGET) errors.push(`audio spend $${spend} exceeds $${BUDGET}`);
} else {
  console.log('no .asset-manifest.json (gitignored); skipping spend check');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`validate-audio: ${ids.length} clips OK`);
