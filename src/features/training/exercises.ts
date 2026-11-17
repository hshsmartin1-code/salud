import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useProfile, useRepo } from '../../app/profile'
import type { CatalogExercise, CatalogExerciseFile, TrackingType } from '../../db/catalogTypes'
import type { CustomExercise } from '../../db/types'
import { normalize } from '../../domain/search'
import { EMPTY_FILTER, filterLibrary, loadExerciseAliases, resolveExerciseId, setFavorite, type ExerciseAliases, type LibraryFilter } from './exerciseKnowledge'

export interface Exercise extends CatalogExercise {
  custom: boolean
  search: string
}

export interface ExerciseLabels {
  muscles: Record<string, string>
  equipment: Record<string, string>
  category: Record<string, string>
}

export interface ExerciseCatalog {
  list: Exercise[]
  labels: ExerciseLabels
  attribution: string
  license: string
  datasetVersion: string
}

export const TRACKING_LABEL: Record<TrackingType, string> = {
  weight_reps: 'Peso × repeticiones',
  bodyweight_reps: 'Peso corporal × repeticiones',
  time: 'Tiempo',
  distance: 'Distancia y tiempo',
}

const EMPTY_LABELS: ExerciseLabels = { muscles: {}, equipment: {}, category: {} }

function searchText(e: Pick<CatalogExercise, 'nameEs' | 'nameEn' | 'aliases'>): string {
  return normalize([e.nameEs, e.nameEn, ...e.aliases].join(' '))
}

let catalogPromise: Promise<ExerciseCatalog> | null = null
export function loadExerciseCatalog(): Promise<ExerciseCatalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(`${import.meta.env.BASE_URL}data/exercises.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<CatalogExerciseFile>
      })
      .then((f) => ({
        list: f.exercises.map((e) => ({ ...e, custom: false, search: searchText(e) })),
        labels: f.labelsEs ?? EMPTY_LABELS,
        attribution: f.attribution,
        license: f.license,
        datasetVersion: f.datasetVersion,
      }))
      .catch((e) => {
        catalogPromise = null
        throw e
      })
  }
  return catalogPromise
}

export function customToExercise(c: CustomExercise): Exercise {
  const base: CatalogExercise = {
    id: `custom:${c.id}`,
    nameEs: c.nameEs,
    nameEn: '',
    aliases: c.aliases,
    primaryMuscles: c.primaryMuscles,
    secondaryMuscles: c.secondaryMuscles,
    equipment: c.equipment,
    category: c.category,
    level: null,
    mechanic: null,
    force: null,
    trackingType: c.trackingType,
    instructionsEs: c.instructionsEs,
  }
  return { ...base, custom: true, search: searchText(base) }
}

/** Shared exercise catalog + this profile's custom exercises (+ stable-id aliases and favourites). */
export function useExercises() {
  const r = useRepo()
  const profileId = useProfile().id
  const [catalog, setCatalog] = useState<ExerciseCatalog | null>(null)
  const [aliases, setAliases] = useState<ExerciseAliases>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadExerciseCatalog()
      .then((c) => alive && setCatalog(c))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    loadExerciseAliases(import.meta.env.BASE_URL).then((a) => alive && setAliases(a))
    return () => {
      alive = false
    }
  }, [])
  const customs = useLiveQuery(() => r.all('customExercises'), [r])
  const favRows = useLiveQuery(() => r.all('exerciseFavorites'), [r])
  return useMemo(() => {
    const list = [...(customs ?? []).map(customToExercise), ...(catalog?.list ?? [])]
    const byId = new Map(list.map((e) => [e.id, e]))
    // Renamed ids keep resolving to the current exercise.
    for (const old of Object.keys(aliases)) {
      const cur = byId.get(resolveExerciseId(old, aliases))
      if (cur && !byId.has(old)) byId.set(old, cur)
    }
    const favorites = new Set((favRows ?? []).map((f) => resolveExerciseId(f.exerciseId, aliases)))
    const toggleFavorite = (e: Pick<Exercise, 'id' | 'nameEs'>) => setFavorite(r, profileId, e.id, e.nameEs, !favorites.has(e.id))
    return {
      ready: !!catalog,
      error,
      list,
      byId,
      labels: catalog?.labels ?? EMPTY_LABELS,
      catalog,
      aliases,
      favorites,
      toggleFavorite,
      resolve: (id: string) => resolveExerciseId(id, aliases),
    }
  }, [catalog, customs, error, aliases, favRows, r, profileId])
}

export type ExerciseFilter = LibraryFilter
export { EMPTY_FILTER, filterLibrary as filterExercises }

export function muscleList(e: Pick<CatalogExercise, 'primaryMuscles'>, labels: ExerciseLabels): string {
  return e.primaryMuscles.map((m) => labels.muscles[m] ?? m).join(', ')
}
