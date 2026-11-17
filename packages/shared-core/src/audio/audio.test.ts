// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_STORAGE_KEY,
  AudioManager,
  DEFAULT_AUDIO_SETTINGS,
  parseSettings,
} from './AudioManager';
import { BGM_TRACKS, BGM_TRACK_IDS, GenesisSynth, SFX_IDS, midiToHz } from './GenesisSynth';
import { ANNOUNCER_BASE_URL, VOICE_CLIPS, isVoiceClipId, resolveVoiceClip } from './voiceManifest';

/** Minimal recording AudioContext fake. */
function fakeCtx() {
  const counts = { osc: 0, buf: 0, stops: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const node = (): Record<string, unknown> => ({ connect: vi.fn(), disconnect: vi.fn() });
  const ctx = {
    currentTime: 0,
    sampleRate: 100,
    state: 'suspended',
    destination: node(),
    resume: vi.fn(async function (this: { state: string }) {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => undefined),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param(), type: '' }),
    createOscillator: () => {
      counts.osc++;
      return {
        ...node(),
        frequency: param(),
        type: '',
        start: vi.fn(),
        stop: vi.fn(() => counts.stops++),
        onended: null,
      };
    },
    createBuffer: (_c: number, len: number) => {
      counts.buf++;
      const data = new Float32Array(len);
      return { getChannelData: () => data };
    },
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      loop: false,
      start: vi.fn(),
      stop: vi.fn(() => counts.stops++),
      onended: null,
    }),
  };
  return { ctx: ctx as unknown as AudioContext, counts, raw: ctx };
}

const noTimers = { setTimeout: vi.fn(() => 1 as never), clearTimeout: vi.fn() } as never;

describe('GenesisSynth', () => {
  it('defines the three BGM tracks with non-empty, in-range note data', () => {
    expect(BGM_TRACK_IDS).toEqual(['graveyard-network', 'huddle-crypt', 'monster-bowl-fanfare']);
    for (const id of BGM_TRACK_IDS) {
      const t = BGM_TRACKS[id];
      expect(t.notes.length).toBeGreaterThan(8);
      for (const e of t.notes) {
        expect(e.beat).toBeGreaterThanOrEqual(0);
        expect(e.beat + e.beats).toBeLessThanOrEqual(t.lengthBeats + 0.001);
      }
    }
    expect(BGM_TRACKS['monster-bowl-fanfare'].loop).toBe(false);
  });

  it('is deterministic: same seed yields identical noise buffers', () => {
    const grab = (seed: number) => {
      const { ctx } = fakeCtx();
      const s = new GenesisSynth(
        ctx,
        { bgm: ctx.destination, sfx: ctx.destination },
        seed,
        noTimers,
      );
      let data: Float32Array | undefined;
      (ctx as unknown as { createBuffer: unknown }).createBuffer = (_c: number, len: number) => {
        data = new Float32Array(len);
        return { getChannelData: () => data };
      };
      s.playSfx('lava-hiss');
      return Array.from(data ?? []);
    };
    expect(grab(1)).toEqual(grab(1));
    expect(grab(1)).not.toEqual(grab(2));
  });

  it('plays every SFX without throwing and creates sound sources', () => {
    for (const id of SFX_IDS) {
      const { ctx, counts } = fakeCtx();
      const s = new GenesisSynth(ctx, { bgm: ctx.destination, sfx: ctx.destination }, 1, noTimers);
      expect(() => s.playSfx(id)).not.toThrow();
      expect(counts.osc + counts.buf).toBeGreaterThan(0);
    }
    expect(SFX_IDS).toHaveLength(15);
  });

  it('plays and stops BGM, tracking the current track', () => {
    const { ctx, counts } = fakeCtx();
    const s = new GenesisSynth(ctx, { bgm: ctx.destination, sfx: ctx.destination }, 1, noTimers);
    s.playBgm('huddle-crypt');
    expect(s.currentTrack).toBe('huddle-crypt');
    expect(counts.osc).toBeGreaterThan(0);
    s.stopBgm();
    expect(s.currentTrack).toBeNull();
    expect(counts.stops).toBeGreaterThan(0);
  });

  it('converts MIDI to Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
  });

  it('rebases delayed BGM loop passes instead of catch-up bursts', () => {
    const { ctx, raw } = fakeCtx();
    const starts: number[] = [];
    // Capture every oscillator schedule start time.
    raw.createOscillator = (() => {
      const orig = raw.createOscillator;
      return () => {
        const o = orig();
        const freq = o.frequency as { setValueAtTime: (v: number, t: number) => void };
        const sva = freq.setValueAtTime.bind(freq);
        freq.setValueAtTime = (v: number, t: number) => {
          starts.push(t);
          return sva(v, t);
        };
        return o;
      };
    })();
    const timers = {
      setTimeout: vi.fn(() => 42 as never),
      clearTimeout: vi.fn(),
    };
    const s = new GenesisSynth(
      ctx,
      { bgm: ctx.destination, sfx: ctx.destination },
      1,
      timers as never,
    );
    s.playBgm('huddle-crypt'); // first pass starts at currentTime+0.05 (~0.05), schedules note t ~ small
    // Tab throttled: currentTime jumps far past the ~8.78s loop boundary.
    (ctx as unknown as { currentTime: number }).currentTime = 100;
    const scheduled = timers.setTimeout.mock.calls.at(-1)! as unknown as [() => void, number];
    scheduled[0](); // loop timer fires while behind real time
    // The second pass must be scheduled at ~currentTime+0.02 (>=100), never at stale ~8.78.
    const secondPassStart = Math.max(...starts);
    expect(secondPassStart).toBeGreaterThanOrEqual(100);
    s.stopBgm();
  });
});

describe('voice manifest', () => {
  it('lists the 12 announcer callouts and resolves ids to mp3 URLs', () => {
    expect(VOICE_CLIPS).toHaveLength(12);
    expect(new Set(VOICE_CLIPS.map((c) => c.id)).size).toBe(12);
    expect(resolveVoiceClip('touchdown')).toEqual({
      id: 'touchdown',
      text: 'TOUCHDOWN!',
      url: `${ANNOUNCER_BASE_URL}touchdown.mp3`,
    });
    expect(resolveVoiceClip('forfeit', '/cdn').url).toBe('/cdn/forfeit.mp3');
    expect(() => resolveVoiceClip('nope')).toThrow(/Unknown voice clip/);
    expect(isVoiceClipId('welcome')).toBe(true);
    expect(isVoiceClipId('x')).toBe(false);
  });
});

describe('AudioManager', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };

  it('defaults, clamps and persists volumes and mute', () => {
    const storage = mem();
    const a = new AudioManager({ storage, createContext: () => null });
    expect(a.getSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
    a.setMasterVolume(2);
    a.setBgmVolume(-1);
    a.setSfxVolume(0.25);
    expect(a.toggleMute()).toBe(true);
    const b = new AudioManager({ storage, createContext: () => null });
    expect(b.getSettings()).toEqual({ master: 1, bgm: 0, sfx: 0.25, muted: true });
    expect(JSON.parse(storage.m.get(AUDIO_STORAGE_KEY) as string).muted).toBe(true);
  });

  it('survives corrupt or throwing storage', () => {
    expect(parseSettings('{bad')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseSettings('{"master":"x","muted":1}')).toEqual(DEFAULT_AUDIO_SETTINGS);
    const boom = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const a = new AudioManager({ storage: boom, createContext: () => null });
    expect(() => a.setMasterVolume(0.1)).not.toThrow();
    expect(a.getSettings().master).toBe(0.1);
  });

  it('notifies listeners and applies mute to the master gain', async () => {
    const { ctx } = fakeCtx();
    const a = new AudioManager({ storage: mem(), createContext: () => ctx });
    const seen = vi.fn();
    a.onChange(seen);
    await a.unlock();
    a.setMuted(true);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ muted: true }));
  });

  it('initializes gains to saved mute/zero before connecting the graph', async () => {
    // Persisted state: muted, with sfx already at 0.
    const storage = mem();
    storage.setItem(
      AUDIO_STORAGE_KEY,
      JSON.stringify({ master: 0.8, bgm: 0.6, sfx: 0, muted: true }),
    );
    const { ctx, raw } = fakeCtx();
    const created: { gain: { value: number } }[] = [];
    const origCreateGain = raw.createGain;
    raw.createGain = () => {
      const n = origCreateGain();
      created.push(n as { gain: { value: number } });
      return n;
    };
    const a = new AudioManager({ storage, createContext: () => ctx });

    // Gains are seeded to the saved, muted state the moment the context is built.
    await a.unlock();
    const master = created[0];
    const bgm = created[1];
    const sfx = created[2];
    expect(master).toBeDefined();
    expect(bgm).toBeDefined();
    expect(sfx).toBeDefined();
    expect(bgm!.gain.value).toBe(0.6); // bgm gain respects saved volume
    expect(sfx!.gain.value).toBe(0); // zero sfx does not blip at 1.0
    expect(master!.gain.value).toBe(0); // muted master is silent from the first sample
    a.dispose();
  });

  it('unlocks on first keypress/click and starts queued BGM', async () => {
    const { ctx, raw, counts } = fakeCtx();
    const a = new AudioManager({ storage: mem(), createContext: () => ctx });
    const target = new EventTarget();
    a.attachAutoUnlock(target);
    a.playBgm('graveyard-network');
    expect(a.isUnlocked()).toBe(false);
    expect(counts.osc).toBe(0);
    target.dispatchEvent(new Event('keydown'));
    await vi.waitFor(() => expect(a.isUnlocked()).toBe(true));
    expect(raw.resume).toHaveBeenCalledTimes(1);
    expect(counts.osc).toBeGreaterThan(0);
    target.dispatchEvent(new Event('click'));
    expect(raw.resume).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('is a safe no-op without Web Audio (headless)', async () => {
    const a = new AudioManager({ storage: mem(), createContext: () => null });
    expect(await a.unlock()).toBe(false);
    expect(() => {
      a.playSfx('whistle');
      a.playBgm('huddle-crypt');
      a.stopBgm();
    }).not.toThrow();
    expect(await a.playVoice('touchdown')).toBe('none');
  });

  it('plays voice via clip, and falls back to formant synth when the clip fails', async () => {
    const { ctx, counts } = fakeCtx();
    const playClip = vi.fn(async () => true);
    const a = new AudioManager({ storage: mem(), createContext: () => ctx, playClip });
    await a.unlock();
    expect(await a.playVoice('touchdown')).toBe('clip');
    expect(playClip).toHaveBeenCalledWith(
      '/assets/audio/announcer/touchdown.mp3',
      ctx,
      expect.anything(),
    );

    playClip.mockRejectedValueOnce(new Error('offline'));
    const before = counts.osc;
    expect(await a.playVoice('welcome')).toBe('formant');
    expect(counts.osc).toBeGreaterThan(before);
    playClip.mockResolvedValueOnce(false);
    expect(await a.playVoice('forfeit')).toBe('formant');
  });

  it('attachAutoUnlock() with no window is a safe no-op (headless)', () => {
    const a = new AudioManager({ storage: mem(), createContext: () => null });
    expect(() => a.attachAutoUnlock()).not.toThrow();
    expect(() => a.detachAutoUnlock()).not.toThrow();
  });

  it('unlocks on gamepad button/axis activity via polling', async () => {
    const { ctx } = fakeCtx();
    const pads = new Map<number, Gamepad>();
    const rafCallbacks: FrameRequestCallback[] = [];
    let rafId = 0;
    const raf = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    const cancelRaf = vi.fn();
    const a = new AudioManager({
      storage: mem(),
      createContext: () => ctx,
      raf,
      cancelRaf,
      getGamepads: () => [null, pads.get(0) ?? null],
    });
    const padButtons = [
      { pressed: false, touched: false, value: 0 },
      { pressed: false, touched: false, value: 0 },
    ];
    const mk = (): Gamepad =>
      ({
        get buttons() {
          return padButtons;
        },
        axes: [0],
      }) as unknown as Gamepad;
    pads.set(0, mk());

    a.attachAutoUnlock(new EventTarget());
    expect(raf).toHaveBeenCalled();
    expect(a.isUnlocked()).toBe(false);

    // Press a button, then advance the poll.
    padButtons[1]!.pressed = true;
    const cb = rafCallbacks[0];
    if (!cb) throw new Error('poll not scheduled');
    cb(16);
    await vi.waitFor(() => expect(a.isUnlocked()).toBe(true));
    a.dispose();
  });

  it('dispose() during pending resume() does not mark unlocked or start BGM', async () => {
    const { ctx, counts } = fakeCtx();
    let release: () => void = () => {};
    (ctx as unknown as { resume: unknown }).resume = () =>
      new Promise<void>((r) => {
        release = r;
      });
    const a = new AudioManager({ storage: mem(), createContext: () => ctx });
    a.playBgm('graveyard-network');
    const p = a.unlock(); // parked on resume()
    a.dispose();
    release();
    expect(await p).toBe(false);
    expect(a.isUnlocked()).toBe(false);
    expect(counts.osc).toBe(0); // no BGM started after dispose
  });

  it('setMuted(true) cancels an active Web Speech utterance', async () => {
    const { ctx } = fakeCtx();
    const spoken: string[] = [];
    let cancel = false;
    const fakeUtt = class {
      text = '';
      pitch = 0;
      rate = 0;
      volume = 0;
      onend: (() => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      constructor(t: string) {
        this.text = t;
        spoken.push(t);
      }
    };
    const ss = {
      cancel: () => {
        cancel = true;
      },
      speak: () => {},
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      fakeUtt;
    (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = ss;

    const a = new AudioManager({
      storage: mem(),
      createContext: () => ctx,
      playClip: async () => false,
    });
    await a.unlock();
    expect(await a.playVoice('touchdown')).toBe('speech');
    expect(spoken.length).toBe(1);
    a.setMuted(true);
    expect(cancel).toBe(true);
    a.dispose();
    delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
    delete (globalThis as Record<string, unknown>).speechSynthesis;
  });

  it('utterance.onerror (non-canceled) triggers formant fallback', async () => {
    const { ctx, counts } = fakeCtx();
    const holder: { onerror: ((ev: { error: string }) => void) | null } = { onerror: null };
    const fakeUtt = class {
      text = '';
      pitch = 0;
      rate = 0;
      volume = 0;
      onend: (() => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    };
    const ss = {
      cancel: () => {},
      speak: (u: { onerror: ((ev: { error: string }) => void) | null }) => {
        holder.onerror = u.onerror;
      },
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      fakeUtt;
    (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = ss;

    const a = new AudioManager({
      storage: mem(),
      createContext: () => ctx,
      playClip: async () => false,
    });
    await a.unlock();
    expect(await a.playVoice('touchdown')).toBe('speech');
    const before = counts.osc;
    holder.onerror?.({ error: 'synthesis-failed' });
    expect(counts.osc).toBeGreaterThan(before); // formant synth ran
    a.dispose();
    delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
    delete (globalThis as Record<string, unknown>).speechSynthesis;
  });
});
