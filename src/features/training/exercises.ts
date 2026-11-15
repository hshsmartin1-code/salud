import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { CatalogExercise, CatalogExerciseFile, TrackingType } from '../../db/catalogTypes'
import type { CustomExercise } from '../../db/types'
import { normalize } from '../../domain/search'

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

/** Shared exercise catalog + this profile's custom exercises. */
export function useExercises() {
  const r = useRepo()
  const [catalog, setCatalog] = useState<ExerciseCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadExerciseCatalog()
      .then((c) => alive && setCatalog(c))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [])
  const customs = useLiveQuery(() => r.all('customExercises'), [r])
  return useMemo(() => {
    const list = [...(customs ?? []).map(customToExercise), ...(catalog?.list ?? [])]
    const byId = new Map(list.map((e) => [e.id, e]))
    return { ready: !!catalog, error, list, byId, labels: catalog?.labels ?? EMPTY_LABELS, catalog }
  }, [catalog, customs, error])
}

export interface ExerciseFilter {
  q: string
  muscle: string
  equipment: string
  category: string
}

export function filterExercises(list: Exercise[], f: ExerciseFilter, limit = 80): Exercise[] {
  const tokens = normalize(f.q).split(' ').filter(Boolean)
  const out: { e: Exercise; score: number }[] = []
  for (const e of list) {
    if (f.muscle && !e.primaryMuscles.includes(f.muscle) && !e.secondaryMuscles.includes(f.muscle)) continue
    if (f.equipment && (e.equipment ?? '') !== f.equipment) continue
    if (f.category && e.category !== f.category) continue
    if (tokens.length && !tokens.every((t) => e.search.includes(t))) continue
    let score = 0
    if (e.custom) score -= 50
    if (f.muscle && e.primaryMuscles.includes(f.muscle)) score -= 10
    const name = normalize(e.nameEs)
    if (tokens.length && name.startsWith(tokens[0]!)) score -= 20
    if (tokens.length && tokens.every((t) => name.includes(t))) score -= 10
    if (e.level === 'beginner') score -= 2
    score += name.length / 100
    out.push({ e, score })
  }
  out.sort((a, b) => a.score - b.score)
  return out.slice(0, limit).map((x) => x.e)
}

export function muscleList(e: Pick<CatalogExercise, 'primaryMuscles'>, labels: ExerciseLabels): string {
  return e.primaryMuscles.map((m) => labels.muscles[m] ?? m).join(', ')
}
