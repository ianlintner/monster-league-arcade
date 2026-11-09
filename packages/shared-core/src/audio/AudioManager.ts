import { GenesisSynth, type BgmTrackId, type SfxId } from './GenesisSynth';
import { resolveVoiceClip, type VoiceClipId } from './voiceManifest';

export const AUDIO_STORAGE_KEY = 'monster-league:audio:v1';

export interface AudioSettings {
  master: number;
  bgm: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.8,
  bgm: 0.6,
  sfx: 0.9,
  muted: false,
};

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/** Parse persisted settings defensively; anything malformed falls back to defaults. */
export function parseSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const o = JSON.parse(raw) as Partial<AudioSettings> | null;
    const d = DEFAULT_AUDIO_SETTINGS;
    return {
      master: clamp01(o?.master, d.master),
      bgm: clamp01(o?.bgm, d.bgm),
      sfx: clamp01(o?.sfx, d.sfx),
      muted: typeof o?.muted === 'boolean' ? o.muted : d.muted,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface AudioManagerOptions {
  storage?: StorageLike | null;
  /** Returns a new AudioContext, or null when Web Audio is unavailable (headless/offline). */
  createContext?: () => AudioContext | null;
  /** Decodes + plays an announcer clip. Resolves false if unavailable so the fallback runs. */
  playClip?: (url: string, ctx: AudioContext, dest: AudioNode) => Promise<boolean>;
  seed?: number;
  /** Frame scheduler for the gamepad unlock poll; injectable for tests. */
  raf?: (cb: FrameRequestCallback) => number;
  cancelRaf?: (id: number) => void;
  getGamepads?: () => ReadonlyArray<Gamepad | null>;
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultCreateContext(): AudioContext | null {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  try {
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

async function defaultPlayClip(url: string, ctx: AudioContext, dest: AudioNode): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    return true;
  } catch {
    return false;
  }
}

function defaultRaf(cb: FrameRequestCallback): number {
  const g = globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number };
  if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame(cb);
  return setTimeout(() => cb(0), 250) as unknown as number;
}

function defaultCancelRaf(id: number): void {
  const g = globalThis as { cancelAnimationFrame?: (id: number) => void };
  if (typeof g.cancelAnimationFrame === 'function') g.cancelAnimationFrame(id);
  else clearTimeout(id);
}

function defaultGetGamepads(): ReadonlyArray<Gamepad | null> {
  const g = globalThis as { navigator?: { getGamepads?: () => (Gamepad | null)[] } };
  if (!g.navigator || typeof g.navigator.getGamepads !== 'function') return [];
  try {
    return g.navigator.getGamepads();
  } catch {
    return [];
  }
}

const UNLOCK_EVENTS = ['keydown', 'pointerdown', 'click', 'touchstart', 'gamepadconnected'];

/** Unified audio facade: volumes, mute, persistence, autoplay unlock, BGM/SFX/voice. */
export class AudioManager {
  private settings: AudioSettings;
  private ctx: AudioContext | null = null;
  private synth: GenesisSynth | null = null;
  private master: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private unlocked = false;
  private unlockTarget: EventTarget | null = null;
  private pendingBgm: BgmTrackId | null = null;
  private listeners = new Set<(s: AudioSettings) => void>();
  private readonly storage: StorageLike | null;
  private readonly createContext: () => AudioContext | null;
  private readonly playClipImpl: NonNullable<AudioManagerOptions['playClip']>;
  private readonly seed: number | undefined;
  private readonly raf: (cb: FrameRequestCallback) => number;
  private readonly cancelRaf: (id: number) => void;
  private readonly getGamepads: () => ReadonlyArray<Gamepad | null>;
  private disposed = false;
  private gamepadRafId: number | null = null;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private readonly unlockHandler = (): void => {
    void this.unlock();
  };
  private readonly gamepadTick = (): void => {
    this.gamepadRafId = null;
    if (this.disposed || this.unlocked) return;
    if (this.anyGamepadActivity()) {
      void this.unlock().then((ok) => {
        if (!ok) return; // no Web Audio available; stop polling
      });
      return;
    }
    this.gamepadRafId = this.raf(this.gamepadTick);
  };

  constructor(opts: AudioManagerOptions = {}) {
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.createContext = opts.createContext ?? defaultCreateContext;
    this.playClipImpl = opts.playClip ?? defaultPlayClip;
    this.seed = opts.seed;
    this.raf = opts.raf ?? defaultRaf;
    this.cancelRaf = opts.cancelRaf ?? defaultCancelRaf;
    this.getGamepads = opts.getGamepads ?? defaultGetGamepads;
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(AUDIO_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    this.settings = parseSettings(raw);
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  onChange(fn: (s: AudioSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setMasterVolume(v: number): void {
    this.update({ master: clamp01(v, this.settings.master) });
  }
  setBgmVolume(v: number): void {
    this.update({ bgm: clamp01(v, this.settings.bgm) });
  }
  setSfxVolume(v: number): void {
    this.update({ sfx: clamp01(v, this.settings.sfx) });
  }
  setMuted(m: boolean): void {
    this.update({ muted: m });
  }
  toggleMute(): boolean {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  private update(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* storage full / denied: keep in-memory state */
    }
    this.applyGains();
    if (this.effectiveSfxGain() <= 0) this.cancelSpeech();
    for (const l of this.listeners) l(this.getSettings());
  }

  /** Effective SFX gain after master volume and mute (mirrors the Web Audio gain graph). */
  private effectiveSfxGain(): number {
    return this.settings.muted ? 0 : this.settings.master * this.settings.sfx;
  }

  private applyGains(): void {
    if (!this.ctx || !this.master || !this.bgmGain || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.01);
    this.bgmGain.gain.setTargetAtTime(this.settings.bgm, t, 0.01);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, t, 0.01);
  }

  /** Listen for the first key/pointer/gamepad gesture and unlock audio. */
  attachAutoUnlock(target?: EventTarget | null): void {
    this.detachAutoUnlock();
    const tgt = target ?? (typeof window !== 'undefined' ? window : null);
    if (!tgt) return;
    this.unlockTarget = tgt;
    for (const ev of UNLOCK_EVENTS) tgt.addEventListener(ev, this.unlockHandler);
    this.startGamepadPoll();
  }

  detachAutoUnlock(): void {
    this.stopGamepadPoll();
    if (!this.unlockTarget) return;
    for (const ev of UNLOCK_EVENTS) this.unlockTarget.removeEventListener(ev, this.unlockHandler);
    this.unlockTarget = null;
  }

  private anyGamepadActivity(): boolean {
    for (const pad of this.getGamepads()) {
      if (!pad) continue;
      for (const b of pad.buttons) if (b.pressed) return true;
      for (const a of pad.axes) if (Math.abs(a) > 0.25) return true;
    }
    return false;
  }

  private startGamepadPoll(): void {
    if (this.gamepadRafId !== null) return;
    this.gamepadRafId = this.raf(this.gamepadTick);
  }

  private stopGamepadPoll(): void {
    if (this.gamepadRafId === null) return;
    this.cancelRaf(this.gamepadRafId);
    this.gamepadRafId = null;
  }

  private clearActiveUtterance(u: SpeechSynthesisUtterance): void {
    if (this.activeUtterance === u) this.activeUtterance = null;
  }

  /** Stop any Web Speech utterance owned by this manager (speech bypasses the gain graph). */
  private cancelSpeech(): void {
    const u = this.activeUtterance;
    this.activeUtterance = null;
    if (!u) return;
    const ss = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    try {
      ss?.cancel();
    } catch {
      /* ignore */
    }
  }

  /** Create/resume the AudioContext. Safe to call repeatedly; false when Web Audio is unavailable. */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.ctx) {
      const ctx = this.createContext();
      if (!ctx) return false;
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.bgmGain = ctx.createGain();
      this.sfxGain = ctx.createGain();
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(ctx.destination);
      this.synth = new GenesisSynth(ctx, { bgm: this.bgmGain, sfx: this.sfxGain }, this.seed);
      this.applyGains();
    }
    const resumingCtx = this.ctx;
    if (!resumingCtx) return false;
    try {
      if (resumingCtx.state === 'suspended') await resumingCtx.resume();
    } catch {
      return false;
    }
    if (this.disposed || this.ctx !== resumingCtx) return false;
    this.unlocked = true;
    this.detachAutoUnlock();
    if (this.pendingBgm) {
      const id = this.pendingBgm;
      this.pendingBgm = null;
      this.synth?.playBgm(id);
    }
    return true;
  }

  playBgm(id: BgmTrackId): void {
    if (this.unlocked && this.synth) this.synth.playBgm(id);
    else this.pendingBgm = id; // starts on first unlock
  }

  stopBgm(): void {
    this.pendingBgm = null;
    this.synth?.stopBgm();
  }

  playSfx(id: SfxId): void {
    if (this.unlocked) this.synth?.playSfx(id);
  }

  /** Play an announcer callout: mp3 when available, otherwise Web Speech / formant fallback. Never throws. */
  async playVoice(id: VoiceClipId): Promise<'clip' | 'speech' | 'formant' | 'none'> {
    const clip = resolveVoiceClip(id);
    const activeCtx = this.ctx;
    const activeGain = this.sfxGain;
    if (this.disposed || !this.unlocked || !activeCtx || !activeGain) return 'none';
    try {
      if (await this.playClipImpl(clip.url, activeCtx, activeGain)) return 'clip';
    } catch {
      /* fall through to fallback */
    }
    // Re-check after the await: the manager may have been disposed or muted meanwhile.
    if (this.disposed || !this.unlocked || this.ctx !== activeCtx || this.effectiveSfxGain() <= 0)
      return 'none';
    const ss = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    const Utt = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
      .SpeechSynthesisUtterance;
    if (ss && Utt) {
      try {
        const u = new Utt(clip.text);
        u.pitch = 0.2;
        u.rate = 0.8;
        u.volume = this.effectiveSfxGain();
        this.activeUtterance = u;
        u.onend = () => this.clearActiveUtterance(u);
        u.onerror = (ev) => {
          this.clearActiveUtterance(u);
          const err = ev.error;
          if (
            err !== 'canceled' &&
            err !== 'interrupted' &&
            !this.disposed &&
            this.effectiveSfxGain() > 0
          )
            this.formantVoice(clip.text);
        };
        ss.speak(u);
        return 'speech';
      } catch {
        /* fall through */
      }
    }
    this.formantVoice(clip.text);
    return 'formant';
  }

  /**
   * Deterministic formant-synth fallback: a sawtooth "glottal" source through two
   * bandpass formants per vowel, vowels picked from the text characters.
   */
  private formantVoice(text: string): void {
    const ctx = this.ctx;
    const dest = this.sfxGain;
    if (!ctx || !dest) return;
    const vowels: Record<string, [number, number]> = {
      A: [800, 1200],
      E: [450, 1900],
      I: [300, 2300],
      O: [500, 900],
      U: [330, 800],
    };
    let t = ctx.currentTime;
    for (const ch of text.toUpperCase()) {
      const f = vowels[ch];
      if (!f) {
        t += ch === ' ' ? 0.06 : 0.02;
        continue;
      }
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(70, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      for (const hz of f) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(hz, t);
        bp.Q.setValueAtTime(6, t);
        osc.connect(bp);
        bp.connect(g);
      }
      g.connect(dest);
      osc.start(t);
      osc.stop(t + 0.18);
      t += 0.14;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.detachAutoUnlock();
    this.cancelSpeech();
    this.synth?.dispose();
    this.listeners.clear();
    const c = this.ctx;
    this.ctx = null;
    this.synth = null;
    this.unlocked = false;
    if (c && typeof c.close === 'function') void c.close().catch(() => undefined);
  }
}
