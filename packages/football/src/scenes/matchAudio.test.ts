import { describe, expect, it } from 'vitest';
import type { BgmTrackId, SfxId, VoiceClipId } from '@monster-league/shared-core';
import type { PlayResult } from '../sim/index';
import {
  MatchAudio,
  VOICE_HOLD_MS,
  bgmForMode,
  cuesForNasty,
  cuesForPlayResult,
  type AudioSink,
} from './matchAudio';

function result(over: Partial<PlayResult> = {}): PlayResult {
  return {
    kind: 'RUN',
    touchdown: false,
    fieldGoalGood: false,
    turnover: false,
    fumble: false,
    casualties: [],
    penalties: [],
    ...over,
  } as unknown as PlayResult;
}

class FakeSink implements AudioSink {
  bgm: BgmTrackId[] = [];
  sfx: SfxId[] = [];
  voices: VoiceClipId[] = [];
  unlocked = false;
  muted = false;
  playBgm(id: BgmTrackId): void {
    this.bgm.push(id);
  }
  playSfx(id: SfxId): void {
    this.sfx.push(id);
  }
  playVoice(id: VoiceClipId): Promise<string> {
    this.voices.push(id);
    return Promise.resolve('clip');
  }
  isUnlocked(): boolean {
    return this.unlocked;
  }
  getSettings(): { muted: boolean } {
    return { muted: this.muted };
  }
}

describe('scene event -> cue mapping', () => {
  it('touchdown: crowd roar, whistle and the touchdown clip', () => {
    const cue = cuesForPlayResult(result({ touchdown: true }), true);
    expect(cue.voice).toBe('touchdown');
    expect(cue.sfx).toContain('crowd-roar');
    expect(cue.sfx).toContain('tackle-crunch');
    expect(cue.sfx).toContain('whistle');
  });

  it('casualty: splat sfx and player-liquidated', () => {
    const cue = cuesForPlayResult(result({ casualties: [{}] as PlayResult['casualties'] }), true);
    expect(cue.sfx).toContain('slime-splat');
    expect(cue.voice).toBe('player-liquidated');
  });

  it('nasty: audible clip, ref tricks get their own clips', () => {
    expect(cuesForNasty('PUMPKIN_BOMB_PASS')).toEqual({
      sfx: ['bat-screech'],
      voice: 'nasty-audible',
    });
    expect(cuesForNasty('BRIBE_REF').voice).toBe('ref-bribed');
    expect(cuesForNasty('KILL_REF').voice).toBe('kill-the-ref');
  });

  it('bribe: a bribed-ref flag plays the crying penalty and buzzer; bashing wins', () => {
    const bribe = cuesForPlayResult(
      result({ penalties: [{ kind: 'BRIBE' }] as PlayResult['penalties'] }),
      false,
    );
    expect(bribe.voice).toBe('penalty-crying');
    expect(bribe.sfx).toContain('penalty-buzzer');
    const bash = cuesForPlayResult(
      result({
        penalties: [{ kind: 'BRIBE' }, { kind: 'REF_BASHING' }] as PlayResult['penalties'],
      }),
      false,
    );
    expect(bash.voice).toBe('ref-bashing');
  });

  it('turnovers and scores pick the single most dramatic voice', () => {
    expect(cuesForPlayResult(result({ kind: 'INTERCEPTION', turnover: true }), false).voice).toBe(
      'intercepted',
    );
    expect(cuesForPlayResult(result({ fumble: true, turnover: true }), true).voice).toBe('fumble');
    expect(cuesForPlayResult(result({ fieldGoalGood: true }), false).voice).toBe('its-good');
    expect(cuesForPlayResult(result({ kind: 'FORFEIT' }), false).voice).toBe('forfeit');
    // Forfeit beats a casualty on the same snap.
    expect(
      cuesForPlayResult(
        result({ kind: 'FORFEIT', casualties: [{}] as PlayResult['casualties'] }),
        false,
      ).voice,
    ).toBe('forfeit');
  });
});

describe('MatchAudio', () => {
  it('plays cues through the sink and drops a voice requested while another speaks', () => {
    const sink = new FakeSink();
    let t = 1000;
    const audio = new MatchAudio(sink, () => t);
    audio.playNasty('BRIBE_REF');
    audio.playResult(result({ touchdown: true }), true); // dropped: ref-bribed still speaking
    expect(sink.voices).toEqual(['ref-bribed']);
    expect(sink.sfx).toContain('crowd-roar'); // SFX never dropped
    t += VOICE_HOLD_MS;
    audio.playResult(result({ touchdown: true }), false);
    expect(sink.voices).toEqual(['ref-bribed', 'touchdown']);
  });

  it('swaps BGM with the presentation mode and greets once after unlock', () => {
    const sink = new FakeSink();
    const audio = new MatchAudio(sink, () => 0);
    audio.tick('PICK');
    audio.tick('PRE_SNAP');
    expect(sink.bgm).toEqual(['huddle-crypt']);
    audio.tick('LIVE');
    expect(sink.bgm).toEqual(['huddle-crypt', 'graveyard-network']);
    expect(sink.voices).toEqual([]);
    sink.unlocked = true;
    audio.tick('LIVE');
    audio.tick('LIVE');
    expect(sink.voices).toEqual(['welcome']);
    expect(bgmForMode('BANNER')).toBe('graveyard-network');
  });

  it('is inert without a sink and reports state read-only', () => {
    const silent = new MatchAudio(null);
    silent.tick('LIVE');
    silent.playNasty('KILL_REF');
    expect(silent.state()).toEqual({ muted: false, unlocked: false });
    const sink = new FakeSink();
    sink.muted = true;
    sink.unlocked = true;
    expect(new MatchAudio(sink).state()).toEqual({ muted: true, unlocked: true });
  });
});
