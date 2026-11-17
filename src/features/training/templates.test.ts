import { describe, expect, it } from 'vitest'
import catalogRaw from '../../../public/data/exercises.json?raw'
import mediaRaw from '../../../public/data/exercise-media.json?raw'
import type { Routine } from '../../db/types'
import { routinesFromTemplate, TEMPLATES, templateLine } from './templates'

// The bundled catalog and illustration index, read from disk: a renamed or removed id fails here.
const catalog = new Map<string, { nameEs: string; trackingType: string }>(((JSON.parse(catalogRaw) as { exercises: { id: string; nameEs: string; trackingType: string }[] }).exercises as { id: string; nameEs: string; trackingType: string }[]).map((e) => [e.id, e]))
const media = (JSON.parse(mediaRaw) as { items: Record<string, unknown> }).items

describe('starter templates', () => {
  it('are the four agreed programmes', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['Cuerpo completo (3 días)', 'Torso / Pierna', 'Empuje / Tirón / Pierna', 'En casa sin equipo'])
    expect(TEMPLATES.map((t) => t.routines.length)).toEqual([1, 2, 3, 1])
  })
  it('only use exercises that exist in the catalog, with their real name and tracking type, and that have an illustration', () => {
    for (const t of TEMPLATES)
      for (const r of t.routines)
        for (const e of r.exercises) {
          const c = catalog.get(e.exerciseId)
          expect(c, `${e.exerciseId} missing from the catalog`).toBeDefined()
          expect(e.name).toBe(c!.nameEs)
          expect(e.trackingType).toBe(c!.trackingType)
          expect(media[e.exerciseId], `${e.exerciseId} has no illustration`).toBeDefined()
          expect(e.sets).toBeGreaterThanOrEqual(1)
          expect(e.restSec).toBeGreaterThan(0)
        }
  })
  it('do not repeat an exercise inside one routine', () => {
    for (const t of TEMPLATES) for (const r of t.routines) expect(new Set(r.exercises.map((e) => e.exerciseId)).size).toBe(r.exercises.length)
  })
  it('become normal routines with new keys, and avoid names already taken', () => {
    let n = 0
    const existing = [{ id: 'a', name: 'Pierna', exercises: [] } as unknown as Routine]
    const out = routinesFromTemplate(TEMPLATES[2]!, existing, () => `k${++n}`)
    expect(out.map((r) => r.name)).toEqual(['Empuje', 'Tirón', 'Pierna (copia)'])
    expect(out[0]!.exercises[0]).toMatchObject({ exerciseId: 'fedb:Dumbbell_Bench_Press', targetSets: 3, targetReps: '8-10', restSec: 90, key: 'k1' })
    expect(out.every((r) => !('order' in r))).toBe(true)
  })
  it('go to the end of a manually ordered list', () => {
    const existing = [{ id: 'a', name: 'A', order: 0, exercises: [] }, { id: 'b', name: 'B', order: 4, exercises: [] }] as unknown as Routine[]
    const out = routinesFromTemplate(TEMPLATES[1]!, existing, () => 'k') as unknown as { order: number }[]
    expect(out.map((r) => r.order)).toEqual([5, 6])
  })
  it('describe sets, reps and rest', () => {
    expect(templateLine(TEMPLATES[0]!.routines[0]!.exercises[0]!)).toBe('3 × 8–12 · 1:30')
  })
})
