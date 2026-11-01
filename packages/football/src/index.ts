import * as Phaser from 'phaser';
import {
  HALLOWEEN_MIDNIGHT_PALETTE as P,
  projectToScreen,
  toPhaserColor,
} from '@monster-league/shared-core';

export const GAME_TITLE = 'Halloween Monster League Football';
export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 360;

class GridironScene extends Phaser.Scene {
  constructor() {
    super('graveyard-gridiron');
  }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(toPhaserColor('VOID_BLACK'), 1).fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const corners = [
      projectToScreen(0, 0),
      projectToScreen(120, 0),
      projectToScreen(120, 53),
      projectToScreen(0, 53),
    ];
    g.fillStyle(0x2a4d3e, 1).fillPoints(
      corners.map((c) => new Phaser.Math.Vector2(c.x, c.y)),
      true,
    );
    g.lineStyle(1, toPhaserColor('TOMBSTONE_GRAY'), 1);
    for (let x = 10; x <= 110; x += 10) {
      const a = projectToScreen(x, 0);
      const b = projectToScreen(x, 53);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (const [x, y] of [
      [30, 20],
      [85, 38],
      [60, 12],
    ] as const) {
      const p = projectToScreen(x, y);
      g.fillStyle(toPhaserColor('TOMBSTONE_GRAY'), 1).fillRect(
        p.x - 5 * p.scale,
        p.y - 14 * p.scale,
        10 * p.scale,
        14 * p.scale,
      );
      g.fillStyle(toPhaserColor('AGED_PARCHMENT'), 1).fillRect(p.x - 1, p.y - 9 * p.scale, 2, 4);
    }
    this.add.text(8, CANVAS_HEIGHT - 16, 'GRAVEYARD GRIDIRON - PREVIEW', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: P.ECTO_GREEN,
    });
  }
}

export function bootFootball(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: P.VOID_BLACK,
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE },
    scene: GridironScene,
  });
}
