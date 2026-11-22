import * as Phaser from 'phaser';
import { HALLOWEEN_MIDNIGHT_PALETTE as P } from '@monster-league/shared-core';
import { MatchScene, CANVAS_WIDTH, CANVAS_HEIGHT } from './scenes/MatchScene';

export const GAME_TITLE = 'Halloween Monster League Football';
export { CANVAS_WIDTH, CANVAS_HEIGHT, MatchScene };

export * from './sim/index';
export * from './field/index';
export * from './ai/AICoach';
export * from './modes/MonsterBowl';
export * from './ui/hud';

export function bootFootball(parent: HTMLElement, opts?: { production?: boolean }): Phaser.Game {
  MatchScene.isProduction = opts?.production ?? false;
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: P.VOID_BLACK,
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE },
    scene: MatchScene,
  });
}
