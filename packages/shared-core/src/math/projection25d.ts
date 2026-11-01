/**
 * 2.5D tilted-field projection. Field space: x along the field, y across it,
 * z height above turf. Screen space: pixels. Perspective narrows the far edge.
 */
export interface ProjectionConfig {
  fieldWidth: number;
  fieldHeight: number;
  screenWidth: number;
  screenHeight: number;
  /** Top (far) edge width as fraction of near edge, 0 < n <= 1. */
  farScale: number;
  /** Pixels of screen-height per unit of z. */
  zScale: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Depth scale at this row (farScale..1). */
  scale: number;
}

export const DEFAULT_PROJECTION: ProjectionConfig = {
  fieldWidth: 120,
  fieldHeight: 53,
  screenWidth: 640,
  screenHeight: 360,
  farScale: 0.7,
  zScale: 1,
};

/** Project field coords (x, y, z) to screen. y=0 is the far edge, y=fieldHeight the near edge. */
export function projectToScreen(
  x: number,
  y: number,
  z = 0,
  cfg: ProjectionConfig = DEFAULT_PROJECTION,
): ScreenPoint {
  const t = y / cfg.fieldHeight;
  const scale = cfg.farScale + (1 - cfg.farScale) * t;
  const nx = x / cfg.fieldWidth - 0.5;
  return {
    x: cfg.screenWidth / 2 + nx * cfg.screenWidth * scale,
    y: t * cfg.screenHeight - z * cfg.zScale * scale,
    scale,
  };
}

/** Inverse of {@link projectToScreen} for z = 0. */
export function unprojectFromScreen(
  sx: number,
  sy: number,
  cfg: ProjectionConfig = DEFAULT_PROJECTION,
): { x: number; y: number } {
  const t = sy / cfg.screenHeight;
  const scale = cfg.farScale + (1 - cfg.farScale) * t;
  const nx = (sx - cfg.screenWidth / 2) / (cfg.screenWidth * scale);
  return { x: (nx + 0.5) * cfg.fieldWidth, y: t * cfg.fieldHeight };
}

/** Depth-sort key: larger = nearer the camera = drawn later. */
export function depthOf(y: number): number {
  return y;
}
