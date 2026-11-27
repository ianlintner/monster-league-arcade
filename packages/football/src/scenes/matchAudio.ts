/**
 * matchAudio — the football page's audio cues (ML-NEXT D3).
 *
 * The football package never imports the shared `AudioManager` directly: it depends on the
 * narrow `AudioSink` below (which `AudioManager` satisfies structurally), so tests pass a
 * fake. This module owns (a) the pure scene-event → cue mapping, (b) a one-voice-at-a-time
 * gate that DROPS a voice line rather than queueing a stale one, and (c) the BGM mode swap.
 * It reads no scene state; callers hand it the event.
 */
import type { BgmTrackId, SfxId, VoiceClipId } from '@monster-league/shared-core';
import type { NastyKind, PlayResult } from '../sim/index';

/** What the match needs from the audio layer. `AudioManager` implements this. */
export interface AudioSink {
  playBgm(id: BgmTrackId): void;
  stopBgm?(): void;
  playSfx(id: SfxId): void;
  playVoice(id: VoiceClipId): unknown;
  isUnlocked?(): boolean;
  getSettings?(): { muted: boolean };
}

export interface AudioCue {
  sfx: SfxId[];
  voice: VoiceClipId | null;
}

/** BGM follows the presentation mode: calm huddle loop vs the live-play theme. */
export const HUDDLE_BGM: BgmTrackId = 'huddle-crypt';
export const PLAY_BGM: BgmTrackId = 'graveyard-network';

/** A voice line blocks further lines for this long (ms); later ones are dropped. */
export const VOICE_HOLD_MS = 1800;

export function bgmForMode(mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER'): BgmTrackId {
  return mode === 'LIVE' || mode === 'BANNER' ? PLAY_BGM : HUDDLE_BGM;
}

/**
 * Cues for a committed play. Exactly one voice line, picked by drama:
 * forfeit > touchdown > field goal > interception > fumble > casualty > ref bashing > bribe flag.
 */
export function cuesForPlayResult(res: PlayResult, tackled: boolean): AudioCue {
  const sfx: SfxId[] = [];
  let voice: VoiceClipId | null = null;
  const bashed = res.penalties.some((p) => p.kind === 'REF_BASHING');
  const bribeFlag = res.penalties.some((p) => p.kind === 'BRIBE');

  if (tackled) sfx.push('tackle-crunch');
  if (res.casualties.length > 0) sfx.push('slime-splat');
  if (res.touchdown || res.fieldGoalGood) sfx.push('crowd-roar');
  else if (res.turnover || res.fumble) sfx.push('crowd-groan');
  if (res.penalties.length > 0) sfx.push('penalty-buzzer');
  sfx.push('whistle');

  if (res.kind === 'FORFEIT') voice = 'forfeit';
  else if (res.touchdown) voice = 'touchdown';
  else if (res.fieldGoalGood) voice = 'its-good';
  else if (res.kind === 'INTERCEPTION') voice = 'intercepted';
  else if (res.fumble) voice = 'fumble';
  else if (res.casualties.length > 0) voice = 'player-liquidated';
  else if (bashed) voice = 'ref-bashing';
  else if (bribeFlag) voice = 'penalty-crying';
  return { sfx, voice };
}

/** Cues for a nasty audible / ref trick the moment it is accepted by the sim. */
export function cuesForNasty(kind: NastyKind): AudioCue {
  if (kind === 'BRIBE_REF') return { sfx: ['bleep-c'], voice: 'ref-bribed' };
  if (kind === 'KILL_REF') return { sfx: ['bat-screech'], voice: 'kill-the-ref' };
  return { sfx: ['bat-screech'], voice: 'nasty-audible' };
}

/** Plays cues through a sink. Safe with a null sink (page without audio / tests). */
export class MatchAudio {
  private voiceUntil = 0;
  private welcomed = false;
  private bgm: BgmTrackId | null = null;

  constructor(
    private readonly sink: AudioSink | null,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Read-only view for `__mlf.audio()`. */
  state(): { muted: boolean; unlocked: boolean } {
    return {
      muted: this.sink?.getSettings?.().muted ?? false,
      unlocked: this.sink?.isUnlocked?.() ?? false,
    };
  }

  /** Per-frame: swap BGM with the mode, and greet once audio first unlocks. */
  tick(mode: 'PICK' | 'PRE_SNAP' | 'LIVE' | 'BANNER'): void {
    if (!this.sink) return;
    const want = bgmForMode(mode);
    if (want !== this.bgm) {
      this.bgm = want;
      this.sink.playBgm(want);
    }
    if (!this.welcomed && this.sink.isUnlocked?.()) {
      this.welcomed = true;
      this.voice('welcome');
    }
  }

  /** The hike: ball snap sound. */
  snap(): void {
    this.sink?.playSfx('snap');
  }

  play(cue: AudioCue): void {
    if (!this.sink) return;
    for (const id of cue.sfx) this.sink.playSfx(id);
    if (cue.voice) this.voice(cue.voice);
  }

  playResult(res: PlayResult, tackled: boolean): void {
    this.play(cuesForPlayResult(res, tackled));
  }

  playNasty(kind: NastyKind): void {
    this.play(cuesForNasty(kind));
  }

  /** One voice at a time: a line requested while another is still speaking is dropped. */
  private voice(id: VoiceClipId): void {
    const t = this.now();
    if (t < this.voiceUntil) return;
    this.voiceUntil = t + VOICE_HOLD_MS;
    try {
      const r = this.sink?.playVoice(id);
      if (r && typeof (r as Promise<unknown>).catch === 'function')
        void (r as Promise<unknown>).catch(() => undefined);
    } catch {
      /* audio must never break the match */
    }
  }
}
