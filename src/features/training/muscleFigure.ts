/**
 * Muscle figure DATA (front and back). `MuscleMap` renders any data of the shape `FigureData` without
 * knowing the artwork, so the generated module can be replaced as a whole.
 *
 * CONTRACT (also in docs/V3_MUSCLE_RECOVERY.md, "Sustituir la figura"):
 *  - `FIGURE.front` and `FIGURE.back` are `FigureData` (muscleFigure.types.ts): a `viewBox` shared by
 *    both views, a neutral `silhouette`, `shapes` and optionally `lines` (internal hairlines) and `base`
 *    (a shaded image bundled under public/, drawn under the shapes).
 *  - One closed path (`d`, absolute commands, even-odd) per muscle region and side. `muscleId` must be an
 *    id of muscles.ts; every id needs at least one shape in one of the views (muscleFigure.test.ts).
 *  - No transforms or styles in the data: colour, hatching and blending are applied by the renderer.
 *
 * CURRENT DATA: generated from BodyParts3D (CC BY 4.0) by scripts/muscle-figure; see the header of
 * muscleFigure.data.ts for the attribution and how to regenerate it.
 */
import { BACK, FRONT } from './muscleFigure.data'
import type { FigureData } from './muscleFigure.types'

export { BODYPARTS3D_ATTRIBUTION, BODYPARTS3D_URL } from './figureCredit'
export type { FigureBase, FigureData, FigureShape } from './muscleFigure.types'

export const FIGURE: { front: FigureData; back: FigureData } = { front: FRONT, back: BACK }
