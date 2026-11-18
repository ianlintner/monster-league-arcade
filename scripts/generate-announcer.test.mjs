import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegArgs, finalizeLedger, transcodeAtomic } from './generate-announcer.mjs';

// NOTE: importing generate-announcer.mjs runs its top-level code (reads
// voiceManifest.ts, checks for .asset-manifest.json), not any paid fal calls —
// it only fetches inside the per-clip loop, which requires --force plus missing
// MP3s. The exported helpers are pure and safe to exercise directly.

describe('transcodeAtomic', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('selects an explicit mp3 muxer so ffmpeg can write a *.tmp output', () => {
    // ffmpeg infers the muxer from the output extension; `.tmp` is ambiguous and
    // would be rejected, so the args must force `-f mp3` right before the output.
    const args = ffmpegArgs('/in/a.wav', '/out/a.mp3.tmp');
    const outIdx = args.indexOf('/out/a.mp3.tmp');
    expect(outIdx).toBeGreaterThan(0);
    expect(args[outIdx - 2]).toBe('-f');
    expect(args[outIdx - 1]).toBe('mp3');
  });

  it('renames the temp file into place only after ffmpeg exits 0', () => {
    dir = mkdtempSync(join(tmpdir(), 'announcer-transcode-'));
    const wav = join(dir, 'a.wav');
    const dest = join(dir, 'a.mp3');
    const calls = [];
    const deps = {
      runFfmpeg: (input, output) => {
        calls.push(['run', input, output]);
        writeFileSync(output, 'stub mp3 bytes'); // ffmpeg writes the temp file
      },
      rmSync: vi.fn(),
    };
    transcodeAtomic(deps, wav, dest);
    expect(calls).toEqual([['run', wav, `${dest}.tmp`]]);
    expect(deps.rmSync).not.toHaveBeenCalled();
    // The destination now holds the transcoded bytes; the temp file is gone.
    expect(readFileSync(dest, 'utf8')).toBe('stub mp3 bytes');
  });

  it('removes the temp file and rethrows when ffmpeg fails (no partial dest)', () => {
    dir = mkdtempSync(join(tmpdir(), 'announcer-transcode-'));
    const wav = join(dir, 'a.wav');
    const dest = join(dir, 'a.mp3');
    const boom = new Error('ffmpeg exit 1');
    const rm = vi.fn((p) => rmSync(p, { force: true }));
    const deps = {
      runFfmpeg: (_input, output) => {
        writeFileSync(output, 'partial bytes'); // ffmpeg wrote then died
        throw boom;
      },
      rmSync: rm,
    };
    expect(() => transcodeAtomic(deps, wav, dest)).toThrow(boom);
    expect(rm).toHaveBeenCalledWith(`${dest}.tmp`);
  });
});

describe('finalizeLedger', () => {
  const clips = [{ id: 'kickoff' }, { id: 'touchdown' }, { id: 'welcome' }];

  it('promotes a paid_pending_transcode entry by re-transcoding from a saved source', () => {
    const entries = [
      { kind: 'audio', id: 'kickoff', status: 'paid_pending_transcode', qa_verdict: 'pending' },
    ];
    const transcoded = [];
    const failed = finalizeLedger({
      entries,
      clips,
      outDir: '/out',
      sourceFor: (id) => (id === 'kickoff' ? '/tmp/kickoff.wav' : null),
      transcode: (wav, dest) => transcoded.push([wav, dest]),
    });
    expect(failed).toEqual([]);
    expect(transcoded).toEqual([['/tmp/kickoff.wav', '/out/kickoff.mp3']]);
    expect(entries[0].status).toBe('transcoded');
    expect(entries[0].qa_verdict).toBe('pass');
    expect(entries[0].file).toBe('/out/kickoff.mp3');
  });

  it('marks failed (without promoting) when no saved source exists', () => {
    const entries = [
      { kind: 'audio', id: 'touchdown', status: 'paid_pending_transcode', qa_verdict: 'pending' },
    ];
    const transcode = vi.fn();
    const failed = finalizeLedger({
      entries,
      clips,
      outDir: '/out',
      sourceFor: () => null,
      transcode,
    });
    expect(failed).toEqual(['touchdown']);
    expect(entries[0].status).toBe('failed');
    expect(entries[0].qa_verdict).toBe('fail');
    expect(transcode).not.toHaveBeenCalled();
  });

  it('marks failed when re-transcode throws', () => {
    const entries = [
      { kind: 'audio', id: 'welcome', status: 'paid_pending_transcode', qa_verdict: 'pending' },
    ];
    const failed = finalizeLedger({
      entries,
      clips,
      outDir: '/out',
      sourceFor: (id) => (id === 'welcome' ? '/tmp/welcome.wav' : null),
      transcode: () => {
        throw new Error('ffmpeg down');
      },
    });
    expect(failed).toEqual(['welcome']);
    expect(entries[0].status).toBe('failed');
    expect(entries[0].qa_verdict).toBe('fail');
  });

  it('never promotes a paid_pending_transcode entry just because an mp3 file exists', () => {
    // A prior run left a partial mp3 on disk but no saved wav source: the entry
    // must be marked failed (exit non-zero), not silently "pass" on file presence.
    const entries = [
      {
        kind: 'audio',
        id: 'kickoff',
        status: 'paid_pending_transcode',
        qa_verdict: 'pending',
        file: '/out/kickoff.mp3',
      },
    ];
    const failed = finalizeLedger({
      entries,
      clips,
      outDir: '/out',
      sourceFor: () => null, // no recoverable source
      transcode: vi.fn(),
    });
    expect(failed).toEqual(['kickoff']);
    expect(entries[0].status).toBe('failed');
  });

  it('leaves already-transcoded entries untouched', () => {
    const entries = [{ kind: 'audio', id: 'kickoff', status: 'transcoded', qa_verdict: 'pass' }];
    const failed = finalizeLedger({
      entries,
      clips,
      outDir: '/out',
      sourceFor: () => null,
      transcode: vi.fn(),
    });
    expect(failed).toEqual([]);
    expect(entries[0].status).toBe('transcoded');
  });
});
