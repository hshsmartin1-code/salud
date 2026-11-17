/** Contract of the muscle figure data (see muscleFigure.ts and docs/V3_MUSCLE_RECOVERY.md). */
export interface FigureShape {
  /** Catalog muscle id (muscles.ts). Several shapes may share one. */
  muscleId: string
  /** Closed path(s), absolute commands, even-odd fill. */
  d: string
  side?: 'left' | 'right'
  /** Spanish anatomical name of the region (tooltip). */
  region?: string
}

/** Pre-rendered shaded image of the body, drawn under the shapes and stretched to the viewBox. */
export interface FigureBase {
  /** Path relative to the app base URL (bundled under public/). */
  href: string
  /** Pixel size of the image. */
  width: number
  height: number
}

export interface FigureData {
  viewBox: { x: number; y: number; w: number; h: number }
  /** Neutral body outline(s), drawn under everything (fallback when the base image is missing). */
  silhouette: string[]
  shapes: FigureShape[]
  /** Optional internal hairlines (open paths) between anatomical parts of one id. */
  lines?: string[]
  base?: FigureBase
}
