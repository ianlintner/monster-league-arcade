import * as Phaser from 'phaser';
import { HALLOWEEN_MIDNIGHT_PALETTE as P } from '@monster-league/shared-core';
import { MatchScene, CANVAS_WIDTH, CANVAS_HEIGHT } from './scenes/MatchScene';
import type { AudioSink } from './scenes/matchAudio';

export const GAME_TITLE = 'Halloween Monster League Football';
export { CANVAS_WIDTH, CANVAS_HEIGHT, MatchScene };

export * from './sim/index';
export * from './field/index';
export * from './ai/AICoach';
export * from './modes/MonsterBowl';
export * from './ui/hud';

export type { AudioSink } from './scenes/matchAudio';
export { cuesForPlayResult, cuesForNasty, MatchAudio } from './scenes/matchAudio';

export function bootFootball(
  parent: HTMLElement,
  opts?: { production?: boolean; audio?: AudioSink },
): Phaser.Game {
  MatchScene.isProduction = opts?.production ?? false;
  MatchScene.audioSink = opts?.audio ?? null;
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: P.VOID_BLACK,
    pixelArt: true,
    // All match audio goes through the page's single shared `AudioManager`; Phaser's
    // own sound manager would create a second AudioContext before any user gesture.
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.NONE },
    scene: MatchScene,
  });
}
