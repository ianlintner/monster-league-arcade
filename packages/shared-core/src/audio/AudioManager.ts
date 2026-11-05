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
  private readonly unlockHandler = (): void => {
    void this.unlock();
  };

  constructor(opts: AudioManagerOptions = {}) {
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.createContext = opts.createContext ?? defaultCreateContext;
    this.playClipImpl = opts.playClip ?? defaultPlayClip;
    this.seed = opts.seed;
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
    for (const l of this.listeners) l(this.getSettings());
  }

  private applyGains(): void {
    if (!this.ctx || !this.master || !this.bgmGain || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.01);
    this.bgmGain.gain.setTargetAtTime(this.settings.bgm, t, 0.01);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, t, 0.01);
  }

  /** Listen for the first key/pointer/gamepad gesture and unlock audio. */
  attachAutoUnlock(target: EventTarget = window): void {
    this.detachAutoUnlock();
    this.unlockTarget = target;
    for (const ev of UNLOCK_EVENTS) target.addEventListener(ev, this.unlockHandler);
  }

  detachAutoUnlock(): void {
    if (!this.unlockTarget) return;
    for (const ev of UNLOCK_EVENTS) this.unlockTarget.removeEventListener(ev, this.unlockHandler);
    this.unlockTarget = null;
  }

  /** Create/resume the AudioContext. Safe to call repeatedly; false when Web Audio is unavailable. */
  async unlock(): Promise<boolean> {
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
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      return false;
    }
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
    if (!this.unlocked || !this.ctx || !this.sfxGain) return 'none';
    try {
      if (await this.playClipImpl(clip.url, this.ctx, this.sfxGain)) return 'clip';
    } catch {
      /* fall through to fallback */
    }
    const ss = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    const Utt = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
      .SpeechSynthesisUtterance;
    if (ss && Utt && !this.settings.muted) {
      try {
        const u = new Utt(clip.text);
        u.pitch = 0.2;
        u.rate = 0.8;
        u.volume = this.settings.master * this.settings.sfx;
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
    this.detachAutoUnlock();
    this.synth?.dispose();
    this.listeners.clear();
    const c = this.ctx;
    this.ctx = null;
    this.synth = null;
    this.unlocked = false;
    if (c && typeof c.close === 'function') void c.close().catch(() => undefined);
  }
}
