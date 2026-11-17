/**
 * Muscle vocabulary of the exercise catalog (17 ids, `public/data/exercises.json`) mapped to the
 * display groups used by chips, the muscle figure and (later) other screens. Pure, no React.
 */
import { isWorkSet, type ProgressSet } from './exerciseProgress'

export type MuscleGroupId = 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'legs' | 'glutes'

export const MUSCLE_GROUPS: readonly { id: MuscleGroupId; label: string }[] = [
  { id: 'chest', label: 'Pecho' },
  { id: 'back', label: 'Espalda' },
  { id: 'shoulders', label: 'Hombros' },
  { id: 'arms', label: 'Brazos' },
  { id: 'core', label: 'Core' },
  { id: 'legs', label: 'Piernas' },
  { id: 'glutes', label: 'Glúteos' },
]

/** Catalog muscle id → group. Every one of the 17 ids is listed (the test checks it against the catalog). */
export const MUSCLE_TO_GROUP: Record<string, MuscleGroupId> = {
  chest: 'chest',
  lats: 'back',
  'middle back': 'back',
  'lower back': 'back',
  traps: 'back',
  shoulders: 'shoulders',
  neck: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  abdominals: 'core',
  quadriceps: 'legs',
  hamstrings: 'legs',
  calves: 'legs',
  adductors: 'legs',
  abductors: 'legs',
  glutes: 'glutes',
}

export const MUSCLE_IDS: readonly string[] = Object.keys(MUSCLE_TO_GROUP)

export const groupOfMuscle = (id: string): MuscleGroupId | null => MUSCLE_TO_GROUP[id] ?? null
export const groupLabel = (id: MuscleGroupId): string => MUSCLE_GROUPS.find((g) => g.id === id)?.label ?? id

/** An exercise belongs to a group when any of its PRIMARY muscles does. */
export function inGroup(e: { primaryMuscles: readonly string[] }, group: MuscleGroupId): boolean {
  return e.primaryMuscles.some((m) => MUSCLE_TO_GROUP[m] === group)
}

export interface MuscleSets {
  muscle: string
  group: MuscleGroupId | null
  /** Work sets that train the muscle as a primary mover. This is the figure to show. */
  sets: number
  /** Work sets where it is only a secondary mover. NOT added to `sets`: show it separately and say so. */
  secondarySets: number
}

type SetForMuscles = ProgressSet & { exerciseId: string }
type MuscleSource = { primaryMuscles: readonly string[]; secondaryMuscles: readonly string[] }

/**
 * Work sets per muscle. Choice: `sets` counts PRIMARY muscles only (one set = one set for each of its
 * primary muscles). Secondary involvement is reported apart in `secondarySets` and never merged, so a
 * screen that wants the half-weight convention has to label it itself. Warm-ups, undone sets and rows
 * flagged `excludeFromStats` are ignored; exercises missing from the catalog contribute nothing.
 * Sorted by `sets` (then secondary) descending.
 */
export function setsPerMuscle(sets: readonly SetForMuscles[], catalog: ReadonlyMap<string, MuscleSource>): MuscleSets[] {
  const acc = new Map<string, { sets: number; secondarySets: number }>()
  const slot = (m: string) => {
    let v = acc.get(m)
    if (!v) acc.set(m, (v = { sets: 0, secondarySets: 0 }))
    return v
  }
  for (const s of sets) {
    if (!isWorkSet(s)) continue
    const e = catalog.get(s.exerciseId)
    if (!e) continue
    for (const m of new Set(e.primaryMuscles)) slot(m).sets++
    for (const m of new Set(e.secondaryMuscles)) if (!e.primaryMuscles.includes(m)) slot(m).secondarySets++
  }
  return [...acc.entries()]
    .map(([muscle, v]) => ({ muscle, group: groupOfMuscle(muscle), ...v }))
    .sort((a, b) => b.sets - a.sets || b.secondarySets - a.secondarySets || a.muscle.localeCompare(b.muscle))
}

/** Same count rolled up to display groups (primary muscles only). */
export function setsPerGroup(perMuscle: readonly MuscleSets[]): { group: MuscleGroupId; sets: number }[] {
  const acc = new Map<MuscleGroupId, number>()
  for (const m of perMuscle) if (m.group) acc.set(m.group, (acc.get(m.group) ?? 0) + m.sets)
  return [...acc.entries()].map(([group, sets]) => ({ group, sets })).sort((a, b) => b.sets - a.sets)
}

// ───────────── glyph choice for exercises without an illustration ─────────────
export type GlyphKey = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell' | 'band' | 'ball' | 'roller' | 'stretch' | 'cardio' | 'other'

/** Movement category wins for stretching and cardio; otherwise the equipment decides. */
export function glyphFor(e: { equipment: string | null; category: string }): GlyphKey {
  if (e.category === 'stretching') return 'stretch'
  if (e.category === 'cardio') return 'cardio'
  switch (e.equipment) {
    case 'barbell':
    case 'e-z curl bar':
      return 'barbell'
    case 'dumbbell':
      return 'dumbbell'
    case 'cable':
      return 'cable'
    case 'machine':
      return 'machine'
    case 'body only':
    case null:
      return 'bodyweight'
    case 'kettlebells':
      return 'kettlebell'
    case 'bands':
      return 'band'
    case 'medicine ball':
    case 'exercise ball':
      return 'ball'
    case 'foam roll':
      return 'roller'
    default:
      return 'other'
  }
}
