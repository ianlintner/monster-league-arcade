import { SeededRandom } from '../math/prng';

/**
 * Zero-dependency, deterministic Web Audio "Sega Genesis" synthesizer.
 * YM2612-style 2-operator FM voices (modulator -> carrier.frequency) plus
 * SN76489-style PSG square/noise channels. All randomness comes from a seeded PRNG.
 */

export type BgmTrackId = 'graveyard-network' | 'huddle-crypt' | 'monster-bowl-fanfare';
export type SfxId =
  | 'whistle'
  | 'snap'
  | 'kick'
  | 'pass-whoosh'
  | 'tackle-crunch'
  | 'slime-splat'
  | 'bat-screech'
  | 'mine-explosion'
  | 'lava-hiss'
  | 'penalty-buzzer'
  | 'crowd-roar'
  | 'crowd-groan'
  | 'bleep-a'
  | 'bleep-b'
  | 'bleep-c';

export const BGM_TRACK_IDS: readonly BgmTrackId[] = [
  'graveyard-network',
  'huddle-crypt',
  'monster-bowl-fanfare',
];
export const SFX_IDS: readonly SfxId[] = [
  'whistle',
  'snap',
  'kick',
  'pass-whoosh',
  'tackle-crunch',
  'slime-splat',
  'bat-screech',
  'mine-explosion',
  'lava-hiss',
  'penalty-buzzer',
  'crowd-roar',
  'crowd-groan',
  'bleep-a',
  'bleep-b',
  'bleep-c',
];

export type Channel = 'fm-bass' | 'fm-organ' | 'psg-square' | 'psg-noise';

export interface NoteEvent {
  channel: Channel;
  /** Start time in beats. */
  beat: number;
  /** Length in beats. */
  beats: number;
  /** MIDI note number (ignored for noise). */
  midi: number;
  velocity: number;
}

export interface BgmTrack {
  id: BgmTrackId;
  title: string;
  bpm: number;
  /** Loop length in beats. */
  lengthBeats: number;
  loop: boolean;
  notes: readonly NoteEvent[];
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

const n = (
  channel: Channel,
  beat: number,
  beats: number,
  midi: number,
  velocity = 0.8,
): NoteEvent => ({
  channel,
  beat,
  beats,
  midi,
  velocity,
});

function buildGraveyard(): NoteEvent[] {
  // E minor, driving eighth-note metal bass + haunted organ lead, 8 bars of 4/4.
  const out: NoteEvent[] = [];
  const roots = [40, 40, 36, 38, 40, 40, 43, 41]; // E2 E2 C2 D2 E2 E2 G2 F2
  roots.forEach((root, bar) => {
    for (let i = 0; i < 8; i++)
      out.push(n('fm-bass', bar * 4 + i * 0.5, 0.45, root + (i % 4 === 3 ? 12 : 0), 0.9));
    out.push(n('psg-noise', bar * 4 + 1, 0.2, 0, 0.6), n('psg-noise', bar * 4 + 3, 0.2, 0, 0.6));
  });
  const lead = [64, 67, 71, 70, 69, 67, 64, 63]; // E G B Bb A G E D#
  lead.forEach((m, i) => out.push(n('fm-organ', i * 4, i % 2 ? 1.5 : 3, m, 0.7)));
  return out;
}

function buildHuddle(): NoteEvent[] {
  // Tense A-minor pulse: syncopated bass, ticking noise hat, sparse PSG stabs.
  const out: NoteEvent[] = [];
  const pattern = [0, 0, 12, 0, 0, 10, 0, 7];
  for (let bar = 0; bar < 4; bar++) {
    pattern.forEach((off, i) =>
      out.push(n('fm-bass', bar * 4 + i * 0.5, 0.4, 33 + off + (bar === 3 ? 1 : 0), 0.85)),
    );
    for (let t = 0; t < 4; t++) out.push(n('psg-noise', bar * 4 + t + 0.5, 0.1, 0, 0.4));
    out.push(n('psg-square', bar * 4 + 3, 0.5, bar % 2 ? 69 : 68, 0.5));
  }
  return out;
}

function buildFanfare(): NoteEvent[] {
  // Stadium "charge" organ riff mutated into C minor (Eb, Gb passing tones).
  const riff: Array<[number, number, number]> = [
    [0, 0.5, 60],
    [0.5, 0.5, 63],
    [1, 0.5, 67],
    [1.5, 1, 72],
    [2.5, 0.5, 67],
    [3, 1, 72],
    [4, 0.5, 70],
    [4.5, 0.5, 66],
    [5, 0.5, 63],
    [5.5, 1, 66],
    [6.5, 0.5, 63],
    [7, 1, 60],
  ];
  const out: NoteEvent[] = [];
  riff.forEach(([b, l, m]) => {
    out.push(n('fm-organ', b, l, m, 0.85), n('psg-square', b, l, m + 12, 0.35));
  });
  [36, 36, 39, 34].forEach((m, i) => out.push(n('fm-bass', i * 2, 1.9, m, 0.9)));
  out.push(n('psg-noise', 7.5, 0.4, 0, 0.7));
  return out;
}

export const BGM_TRACKS: Readonly<Record<BgmTrackId, BgmTrack>> = {
  'graveyard-network': {
    id: 'graveyard-network',
    title: 'Graveyard Sports Network Theme',
    bpm: 140,
    lengthBeats: 32,
    loop: true,
    notes: buildGraveyard(),
  },
  'huddle-crypt': {
    id: 'huddle-crypt',
    title: 'Huddle in the Crypt',
    bpm: 110,
    lengthBeats: 16,
    loop: true,
    notes: buildHuddle(),
  },
  'monster-bowl-fanfare': {
    id: 'monster-bowl-fanfare',
    title: 'Monster Bowl Fanfare',
    bpm: 132,
    lengthBeats: 8,
    loop: false,
    notes: buildFanfare(),
  },
};

export interface SynthOutputs {
  bgm: AudioNode;
  sfx: AudioNode;
}

type TimerApi = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;

export class GenesisSynth {
  private readonly rng: SeededRandom;
  private noiseBuffer: AudioBuffer | null = null;
  private bgmTimer: ReturnType<typeof setTimeout> | null = null;
  private bgmSources = new Set<AudioScheduledSourceNode>();
  private current: BgmTrackId | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: SynthOutputs,
    seed = 0x6666,
    private readonly timers: TimerApi = globalThis,
  ) {
    this.rng = new SeededRandom(seed);
  }

  get currentTrack(): BgmTrackId | null {
    return this.current;
  }

  // ---- BGM ----

  playBgm(id: BgmTrackId): void {
    this.stopBgm();
    const track = BGM_TRACKS[id];
    this.current = id;
    const loopOnce = (start: number): void => {
      this.scheduleTrack(track, start);
      const secs = (track.lengthBeats * 60) / track.bpm;
      if (track.loop) {
        this.bgmTimer = this.timers.setTimeout(
          () => {
            if (this.current === id) loopOnce(start + secs);
          },
          Math.max(0, (start + secs - this.ctx.currentTime) * 1000 - 250),
        );
      } else {
        this.bgmTimer = this.timers.setTimeout(() => {
          if (this.current === id) this.current = null;
        }, secs * 1000);
      }
    };
    loopOnce(this.ctx.currentTime + 0.05);
  }

  stopBgm(): void {
    if (this.bgmTimer !== null) this.timers.clearTimeout(this.bgmTimer);
    this.bgmTimer = null;
    this.current = null;
    for (const s of this.bgmSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.bgmSources.clear();
  }

  /** Schedule every note of one pass of a track at `start` (ctx seconds). Returns event count. */
  scheduleTrack(track: BgmTrack, start: number): number {
    const spb = 60 / track.bpm;
    for (const e of track.notes)
      this.playNote(e, start + e.beat * spb, e.beats * spb, this.out.bgm, true);
    return track.notes.length;
  }

  private playNote(e: NoteEvent, t: number, dur: number, dest: AudioNode, track: boolean): void {
    const peak = 0.18 * e.velocity;
    switch (e.channel) {
      case 'fm-bass':
        this.fmVoice(midiToHz(e.midi), 1, 2.2, t, dur, peak, dest, track, 'sawtooth');
        break;
      case 'fm-organ':
        // Pipe-organ: stacked sine partials with slow vibrato via FM ratio 2 + detuned octave.
        this.fmVoice(midiToHz(e.midi), 2, 0.6, t, dur, peak, dest, track, 'sine');
        this.fmVoice(midiToHz(e.midi + 12), 1, 0.2, t, dur, peak * 0.5, dest, track, 'sine');
        break;
      case 'psg-square':
        this.osc('square', midiToHz(e.midi), t, dur, peak * 0.6, dest, track);
        break;
      case 'psg-noise':
        this.noise(t, dur, peak, 4000, dest, track);
        break;
    }
  }

  // ---- Voices ----

  private track(src: AudioScheduledSourceNode, isBgm: boolean, end: number): void {
    if (!isBgm) return;
    this.bgmSources.add(src);
    src.onended = () => this.bgmSources.delete(src);
    void end;
  }

  private env(g: GainNode, t: number, dur: number, peak: number, attack = 0.005): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
  }

  private osc(
    type: OscillatorType,
    hz: number,
    t: number,
    dur: number,
    peak: number,
    dest: AudioNode,
    isBgm: boolean,
  ): OscillatorNode {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    this.env(g, t, dur, peak);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(o, isBgm, t + dur);
    return o;
  }

  /** 2-operator FM voice: modulator (ratio × carrier hz) drives carrier frequency by `index`. */
  private fmVoice(
    hz: number,
    ratio: number,
    index: number,
    t: number,
    dur: number,
    peak: number,
    dest: AudioNode,
    isBgm: boolean,
    carrierType: OscillatorType,
  ): OscillatorNode {
    const car = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    car.type = carrierType;
    mod.type = 'sine';
    car.frequency.setValueAtTime(hz, t);
    mod.frequency.setValueAtTime(hz * ratio, t);
    modGain.gain.setValueAtTime(hz * index, t);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, hz * index * 0.2), t + dur);
    mod.connect(modGain);
    modGain.connect(car.frequency);
    this.env(g, t, dur, peak);
    car.connect(g);
    g.connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
    this.track(car, isBgm, t + dur);
    this.track(mod, isBgm, t + dur);
    return car;
  }

  private getNoise(): AudioBuffer {
    if (!this.noiseBuffer) {
      const len = Math.floor(this.ctx.sampleRate);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = this.rng.next() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  private noise(
    t: number,
    dur: number,
    peak: number,
    cutoff: number,
    dest: AudioNode,
    isBgm: boolean,
    filterType: BiquadFilterType = 'highpass',
    sweepTo?: number,
  ): void {
    const src = this.ctx.createBufferSource();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = this.getNoise();
    src.loop = true;
    f.type = filterType;
    f.frequency.setValueAtTime(cutoff, t);
    if (sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    this.env(g, t, dur, peak, 0.003);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.05);
    this.track(src, isBgm, t + dur);
  }

  // ---- SFX ----

  playSfx(id: SfxId): void {
    const t = this.ctx.currentTime;
    const d = this.out.sfx;
    switch (id) {
      case 'whistle': {
        const o = this.osc('sine', 2800, t, 0.6, 0.25, d, false);
        o.frequency.linearRampToValueAtTime(3100, t + 0.15);
        o.frequency.linearRampToValueAtTime(2800, t + 0.6);
        this.noise(t, 0.6, 0.05, 5000, d, false);
        break;
      }
      case 'snap':
        this.osc('square', 140, t, 0.08, 0.3, d, false);
        this.noise(t, 0.05, 0.2, 1500, d, false);
        break;
      case 'kick': {
        const o = this.osc('sine', 150, t, 0.25, 0.5, d, false);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
        break;
      }
      case 'pass-whoosh':
        this.noise(t, 0.4, 0.25, 400, d, false, 'bandpass', 3000);
        break;
      case 'tackle-crunch':
        this.noise(t, 0.12, 0.5, 900, d, false, 'lowpass');
        for (let i = 0; i < 4; i++)
          this.noise(
            t + 0.03 + i * 0.045,
            0.05,
            0.3,
            2500 + this.rng.int(0, 2000),
            d,
            false,
            'bandpass',
          );
        this.fmVoice(70, 1.41, 4, t, 0.3, 0.4, d, false, 'square');
        break;
      case 'slime-splat': {
        const o = this.fmVoice(300, 0.5, 3, t, 0.4, 0.35, d, false, 'sine');
        o.frequency.exponentialRampToValueAtTime(60, t + 0.35);
        this.noise(t, 0.2, 0.15, 1200, d, false, 'lowpass');
        break;
      }
      case 'bat-screech': {
        const o = this.fmVoice(2000, 3.5, 5, t, 0.5, 0.2, d, false, 'sawtooth');
        o.frequency.exponentialRampToValueAtTime(5200, t + 0.15);
        o.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
        break;
      }
      case 'mine-explosion':
        this.noise(t, 1.0, 0.6, 3000, d, false, 'lowpass', 120);
        this.osc('sine', 90, t, 0.7, 0.6, d, false).frequency.exponentialRampToValueAtTime(
          25,
          t + 0.6,
        );
        break;
      case 'lava-hiss':
        this.noise(t, 1.2, 0.2, 2500, d, false, 'bandpass', 6000);
        break;
      case 'penalty-buzzer':
        this.osc('sawtooth', 110, t, 0.8, 0.3, d, false);
        this.osc('square', 117, t, 0.8, 0.2, d, false);
        break;
      case 'crowd-roar':
        this.noise(t, 2.0, 0.3, 700, d, false, 'bandpass', 1400);
        break;
      case 'crowd-groan': {
        this.noise(t, 1.6, 0.25, 900, d, false, 'bandpass', 300);
        this.fmVoice(
          200,
          1,
          1.5,
          t,
          1.4,
          0.15,
          d,
          false,
          'sawtooth',
        ).frequency.exponentialRampToValueAtTime(120, t + 1.3);
        break;
      }
      case 'bleep-a':
        this.osc('square', midiToHz(81), t, 0.08, 0.2, d, false);
        break;
      case 'bleep-b':
        this.osc('square', midiToHz(76), t, 0.08, 0.2, d, false);
        break;
      case 'bleep-c':
        this.osc('square', midiToHz(84), t, 0.05, 0.2, d, false);
        this.osc('square', midiToHz(88), t + 0.05, 0.08, 0.2, d, false);
        break;
    }
  }

  dispose(): void {
    this.stopBgm();
  }
}
