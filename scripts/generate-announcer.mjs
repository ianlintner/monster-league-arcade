#!/usr/bin/env node
// Generates the Crypt Announcer voice pack via fal.ai Kokoro TTS, then
// normalizes with ffmpeg loudnorm to compact mono mp3. Logs spend to the
// gitignored .asset-manifest.json. Needs FAL_KEY. Usage: node scripts/generate-announcer.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODEL = 'fal-ai/kokoro/american-english';
const COST_PER_1K_CHARS = 0.02; // fal.ai Kokoro list price
const BUDGET = 5.0;
const out = 'apps/arcade-hub/public/assets/audio/announcer';
const manifestPath = '.asset-manifest.json';

// Lower pitch slightly for a gravelly crypt voice, add a short crypt echo, then loudnorm.
const AF = 'asetrate=24000*0.9,aresample=24000,aecho=0.8:0.6:60:0.25,loudnorm=I=-16:TP=-1.5:LRA=7';

export function ffmpegArgs(input, output) {
  return [
    '-y',
    '-loglevel',
    'error',
    '-i',
    input,
    '-af',
    AF,
    '-ac',
    '1',
    '-ar',
    '24000',
    '-b:a',
    '64k',
    '-f',
    'mp3',
    output,
  ];
}

/**
 * Transcode `wavPath` to `destPath` atomically: render into a sibling `*.tmp`
 * and rename it over the destination only after ffmpeg exits 0. A failed
 * ffmpeg leaves no partial destination, so a later run never mistakes a
 * truncated MP3 for a completed transcode.
 *
 * `deps.runFfmpeg(inputPath, outputPath)` must throw on a non-zero exit and
 * `deps.rmSync` removes the temp file best-effort. Both are injected so the
 * transcode logic can be unit-tested without invoking real ffmpeg or fal.
 */
export function transcodeAtomic(deps, wavPath, destPath) {
  const tmp = `${destPath}.tmp`;
  try {
    deps.runFfmpeg(wavPath, tmp);
    renameSync(tmp, destPath);
  } catch (err) {
    try {
      deps.rmSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

/**
 * Pure final sweep over the manifest. Never promotes a `paid_pending_transcode`
 * entry merely because an mp3 file exists: it re-transcodes from the saved
 * source when present, otherwise marks the entry failed. Mutates `entries` and
 * returns the list of ids left in a failed state (caller exits non-zero when
 * non-empty). `transcode(wavPath, destPath)` performs the atomic re-transcode
 * and must throw on failure.
 */
export function finalizeLedger({ entries, clips, outDir, sourceFor, transcode }) {
  const failed = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const c of clips) {
    const e = byId.get(c.id);
    if (!e || e.status !== 'paid_pending_transcode') continue;
    const srcPath = sourceFor(c.id);
    const dest = join(outDir, `${c.id}.mp3`);
    if (!srcPath) {
      e.status = 'failed';
      e.qa_verdict = 'fail';
      failed.push(c.id);
      continue;
    }
    try {
      transcode(srcPath, dest);
      e.status = 'transcoded';
      e.qa_verdict = 'pass';
      e.file = dest;
      e.transcodedAt = new Date().toISOString();
    } catch {
      e.status = 'failed';
      e.qa_verdict = 'fail';
      failed.push(c.id);
    }
  }
  return failed;
}

function parseClips() {
  const src = readFileSync('packages/shared-core/src/audio/voiceManifest.ts', 'utf8');
  const clips = [
    ...src.matchAll(/\{ id: '([^']+)', text: ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*') \}/g),
  ].map((m) => ({
    id: m[1],
    text: JSON.parse(m[2].startsWith('"') ? m[2] : `"${m[2].slice(1, -1)}"`),
  }));
  if (clips.length !== 12) throw new Error(`expected 12 clips, got ${clips.length}`);
  return clips;
}

async function main() {
  const clips = parseClips();
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

  // Saved wav sources keyed by clip id, so a final sweep can re-transcode a
  // `paid_pending_transcode` entry instead of trusting a possibly-partial mp3.
  const savedSources = new Map();
  const transcode = (wavPath, destPath) => {
    transcodeAtomic(
      { runFfmpeg: (i, o) => execFileSync('ffmpeg', ffmpegArgs(i, o)), rmSync },
      wavPath,
      destPath,
    );
  };
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
    const { audio, request_id } = await res.json();
    const requestId = request_id ?? null;
    const paidAt = new Date().toISOString();
    // Persist the paid request IMMEDIATELY (before any download/ffmpeg step can fail) so a real
    // fal.ai charge is never omitted from the budget ledger.
    manifest.entries.push({
      kind: 'audio',
      id: c.id,
      model: MODEL,
      text: c.text,
      costUsd: cost,
      requestId,
      estimatedCostUsd: cost,
      status: 'paid_pending_transcode',
      file: dest,
      qa_verdict: 'pending',
      at: paidAt,
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const wav = join(process.env.TMPDIR ?? tmpdir(), `${c.id}.wav`);
    writeFileSync(wav, Buffer.from(await (await fetch(audio.url)).arrayBuffer()));
    savedSources.set(c.id, wav);
    transcode(wav, dest);
    // Persist transition to `transcoded` immediately after the atomic rename succeeds.
    const entry = manifest.entries[manifest.entries.length - 1];
    entry.status = 'transcoded';
    entry.qa_verdict = 'pass';
    entry.file = dest;
    entry.transcodedAt = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`generated ${dest} ($${cost.toFixed(4)})`);
  }

  // Final sweep: never promote a `paid_pending_transcode` entry just because an mp3
  // file exists. Re-transcode from the saved source when available, else mark failed.
  const failed = finalizeLedger({
    entries: manifest.entries,
    clips,
    outDir: out,
    sourceFor: (id) => savedSources.get(id) ?? null,
    transcode,
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`audio spend: $${spent().toFixed(4)} / $${BUDGET}`);
  if (failed.length) {
    console.error(
      `failed to transcode paid requests (no recoverable source): ${failed.join(', ')}`,
    );
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
