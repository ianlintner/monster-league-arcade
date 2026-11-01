import * as Phaser from 'phaser';
import { HALLOWEEN_MIDNIGHT_PALETTE as P, toPhaserColor } from '@monster-league/shared-core';

export const GAME_TITLE = 'Monster League Hockey';
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

class RinkScene extends Phaser.Scene {
  private puck?: Phaser.GameObjects.Arc;

  constructor() {
    super('frozen-crypt-rink');
  }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(toPhaserColor('VOID_BLACK'), 1).fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    g.fillStyle(0x1b3a4b, 1).fillRoundedRect(40, 40, CANVAS_WIDTH - 80, CANVAS_HEIGHT - 80, 40);
    g.lineStyle(2, toPhaserColor('VAMPIRE_CRIMSON'), 1).lineBetween(
      CANVAS_WIDTH / 2,
      40,
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT - 40,
    );
    g.lineStyle(2, toPhaserColor('SPECTRAL_CYAN'), 1).strokeCircle(
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      40,
    );
    this.puck = this.add.circle(
      CANVAS_WIDTH / 2,
      CANVAS_HEIGHT / 2,
      7,
      toPhaserColor('HELLFIRE_AMBER'),
    );
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.puck?.setPosition(p.x, p.y));
    this.add.text(8, CANVAS_HEIGHT - 16, 'FROZEN-CRYPT RINK - MOVE THE PUCK', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: P.ECTO_GREEN,
    });
  }
}

export function bootHockey(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: P.VOID_BLACK,
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE },
    scene: RinkScene,
  });
}
