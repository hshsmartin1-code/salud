/**
 * Public entry point for exercise media. Every surface renders through `ExerciseMediaView`
 * (media/ExerciseMediaView.tsx); `ExerciseThumb` and `ExerciseIllustration` are thin wrappers that keep the
 * signatures the screens already use (new props are optional). The model, licence gating and the single
 * active pack live in media/*; see the project notes.
 */
import { ExerciseMediaView } from './media/ExerciseMediaView'
import type { ExerciseMedia, ExerciseMediaFile } from './media/store'
import type { TileExercise } from './media/Placeholder'
import { packUrl } from './media/manifest'

export { ExerciseGlyph, ExerciseTile, type TileExercise } from './media/Placeholder'
export { POSE_LABEL, ExerciseMediaView, type ExerciseMediaViewProps } from './media/ExerciseMediaView'
export { loadExerciseMedia, useExerciseMedia, type ExerciseMedia, type ExerciseMediaFile } from './media/store'

export const REPDB_ATTRIBUTION = 'Exercise data by RepDB (repdb.co)'
export const REPDB_URL = 'https://repdb.co'

/** URL of a file of the active pack (kept for callers that build their own paths). */
export function mediaSrc(file: ExerciseMediaFile, name: string): string {
  return packUrl({ basePath: file.basePath }, name, import.meta.env.BASE_URL)
}

/** Square thumbnail; the neutral tile when there is no (licensed) media for the exercise or it fails to load. */
export function ExerciseThumb({
  media,
  item,
  size = 44,
  exercise,
  muscle,
  exerciseId,
}: {
  media: ExerciseMediaFile | null
  item: ExerciseMedia | undefined
  size?: number
  /** Pass the exercise so the tile can pick its glyph (callers that omit it get the generic tile). */
  exercise?: TileExercise
  muscle?: string
  /** Catalog id; resolved through the alias map so a renamed id keeps its media. */
  exerciseId?: string
}) {
  return <ExerciseMediaView variant="thumb" media={media} item={item} exerciseId={exerciseId} size={size} exercise={exercise} muscle={muscle} />
}

/** Detail media (animation or Inicio / Final poses) with the pack attribution; the neutral tile otherwise. */
export function ExerciseIllustration({
  media,
  item,
  exercise,
  muscle,
  equipment,
  exerciseId,
}: {
  media: ExerciseMediaFile | null
  item: ExerciseMedia | undefined
  exercise?: TileExercise
  muscle?: string
  equipment?: string
  exerciseId?: string
}) {
  return <ExerciseMediaView variant="detail" media={media} item={item} exerciseId={exerciseId} exercise={exercise} muscle={muscle} equipment={equipment} />
}
