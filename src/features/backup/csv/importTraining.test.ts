import { afterEach, describe, expect, it } from 'vitest'
import catalogRaw from '../../../../public/data/exercises.json?raw'
import hevyRaw from '../../../../e2e/fixtures/hevy-sintetico.csv?raw'
import strongRaw from '../../../../e2e/fixtures/strong-sintetico.csv?raw'
import type { CatalogExerciseFile } from '../../../db/catalogTypes'
import { repo } from '../../../db/repo'
import { createDB, type SaludDB } from '../../../db/schema'
import { setKind } from '../../../domain/setKind'
import { allRecords, prepareStats, weekSummary } from '../../training/trainingStats'
import { buildIndex, matchExercise, nameKey, nameTokens, type LibraryEntry } from './matchExercise'
import { applyTrainingImport, parseDurationMin, parseLocalDateTime, parseTrainingCsv, planTrainingImport, sessionIdFor, undoTrainingImport, type ExerciseChoice, type ParseOk, type ParsedWorkout } from './importTraining'

const HEVY = hevyRaw
const STRONG = strongRaw
const catalog = JSON.parse(catalogRaw) as CatalogExerciseFile
const entries: LibraryEntry[] = catalog.exercises.map((e) => ({ id: e.id, nameEs: e.nameEs, nameEn: e.nameEn, aliases: e.aliases, custom: false }))
const index = buildIndex(entries)
const ok = (r: ReturnType<typeof parseTrainingCsv>): ParseOk => {
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('date and duration parsing', () => {
  it('reads Hevy, ISO and 12-hour formats; rejects impossible dates', () => {
    expect(parseLocalDateTime('16 Nov 2026, 18:30')).toEqual({ y: 2026, mo: 11, d: 16, h: 18, mi: 30, s: 0 })
    expect(parseLocalDateTime('2026-05-11 18:30:15')).toMatchObject({ mo: 5, d: 11, s: 15 })
    expect(parseLocalDateTime('Nov 16, 2026, 6:30 PM')).toMatchObject({ h: 18, mi: 30 })
    expect(parseLocalDateTime('16 nov. 2026, 12:05 am')).toMatchObject({ h: 0 })
    expect(parseLocalDateTime('16 ene 2026, 07:00')).toMatchObject({ mo: 1 })
    expect(parseLocalDateTime('31 Feb 2026, 10:00')).toBeNull()
    expect(parseLocalDateTime('mañana')).toBeNull()
  })
  it('reads durations', () => {
    expect(parseDurationMin('1h 2m')).toBe(62)
    expect(parseDurationMin('62m')).toBe(62)
    expect(parseDurationMin('01:02:00')).toBe(62)
    expect(parseDurationMin('45s')).toBe(1)
    expect(parseDurationMin('')).toBeNull()
    expect(parseDurationMin('xyz')).toBeNull()
  })
})

describe('Hevy parser', () => {
  const p = ok(parseTrainingCsv(HEVY))
  it('groups rows into workouts with Bogotá local time and quoted descriptions', () => {
    expect(p.source).toBe('hevy')
    expect(p.workouts).toHaveLength(2)
    const w = p.workouts[0]!
    expect(w).toMatchObject({ date: '2026-11-16', name: 'Empuje A', startedAt: '2026-11-16T23:30:00.000Z', durationMin: 65, notes: 'Sesión de prueba, con "comillas"' })
    expect(w.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Lateral Raise (Dumbbell)', 'Zzqx Flujo Imaginario'])
    expect(w.exercises[0]!.notes).toBe('Agarre medio')
  })
  it('maps set types, rpe, distance and duration', () => {
    const bench = p.workouts[0]!.exercises[0]!.sets
    expect(bench.map((s) => s.kind)).toEqual(['warmup', 'normal', 'failure'])
    expect(bench[2]).toMatchObject({ weightKg: 80, reps: 6, rpe: 9.5 })
    expect(p.workouts[0]!.exercises[1]!.sets[1]!.kind).toBe('drop')
    const cardio = p.workouts[1]!.exercises
    expect(cardio[0]!.sets[0]).toMatchObject({ durationSec: 60, weightKg: null, reps: null })
    expect(cardio[1]!.sets[0]).toMatchObject({ distanceM: 5200, durationSec: 1800 })
  })
  it('converts weight_lbs to kg', () => {
    const csv = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe\nA,"16 Nov 2026, 18:30","16 Nov 2026, 19:00",,Curl,,,0,normal,100,10,,,\n'
    const r = ok(parseTrainingCsv(csv))
    expect(r.unit).toBe('lb')
    expect(r.unitFromFile).toBe(true)
    expect(r.workouts[0]!.exercises[0]!.sets[0]!.weightKg).toBe(45.36)
  })
  it('rejects unknown files', () => {
    expect(parseTrainingCsv('a,b\n1,2\n')).toMatchObject({ ok: false })
    expect(parseTrainingCsv('')).toMatchObject({ ok: false })
  })
})

describe('Strong parser', () => {
  it('reads ; separated files with decimal comma, W/D/F set orders and ignores rest timers', () => {
    const p = ok(parseTrainingCsv(STRONG))
    expect(p.source).toBe('strong')
    expect(p.unitFromFile).toBe(false)
    expect(p.skippedRows).toBe(1)
    const w = p.workouts[0]!
    expect(w).toMatchObject({ date: '2026-11-10', startedAt: '2026-11-10T12:15:00.000Z', durationMin: 62, notes: 'Buen día' })
    const squat = w.exercises[0]!.sets
    expect(squat.map((s) => s.kind)).toEqual(['warmup', 'normal', 'normal'])
    expect(squat[1]).toMatchObject({ weightKg: 100.5, reps: 5, rpe: 8, distanceM: null, durationSec: null })
    expect(squat[2]!.rpe).toBe(8.5)
    expect(w.exercises[1]!.sets[0]!.kind).toBe('drop')
  })
  it('uses the units the person picks, or the header when it says so', () => {
    const lb = ok(parseTrainingCsv(STRONG, { unit: 'lb' }))
    expect(lb.unit).toBe('lb')
    expect(lb.workouts[0]!.exercises[0]!.sets[1]!.weightKg).toBe(45.59)
    const hdr = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight (lbs),Reps,Distance,Seconds,Notes,Workout Notes,RPE\n2026-11-10 07:15:00,Pierna,45m,Squat,1,225,5,,,,,\n'
    const r = ok(parseTrainingCsv(hdr, { unit: 'kg' }))
    expect(r.unit).toBe('lb')
    expect(r.unitFromFile).toBe(true)
    expect(r.workouts[0]!.exercises[0]!.sets[0]!.weightKg).toBe(102.06)
  })
})

describe('exercise matching', () => {
  it('normalises names ignoring order, accents, punctuation and plural', () => {
    expect(nameKey('Bench Press (Barbell)')).toBe(nameKey('barbell bench press'))
    expect(nameTokens('DB Curls')).toEqual(['curl', 'dumbbell'])
  })
  it('finds catalog exercises with a confidence level', () => {
    const m = matchExercise('Bench Press (Dumbbell)', index)[0]!
    expect(m.entry.nameEn).toBe('Dumbbell Bench Press')
    expect(m.level).toBe('exact')
    const b = matchExercise('Bench Press (Barbell)', index)[0]!
    expect(b.entry.nameEn.toLowerCase()).toContain('barbell')
    expect(b.entry.nameEn.toLowerCase()).toContain('bench press')
    expect(b.score).toBeGreaterThanOrEqual(0.8)
    expect(matchExercise('Zzqx Flujo Imaginario', index)).toEqual([])
  })
  it('matches own exercises by Spanish name', () => {
    const own: LibraryEntry = { id: 'custom:1', nameEs: 'Plancha raro', nameEn: '', aliases: [], custom: true }
    expect(matchExercise('Plancha Raro', buildIndex([own]))[0]!.level).toBe('exact')
  })
})

const choicesFor = (p: ParseOk): Record<string, ExerciseChoice> => {
  const out: Record<string, ExerciseChoice> = {}
  for (const w of p.workouts)
    for (const e of w.exercises) {
      const m = matchExercise(e.name, index)[0]
      out[e.key] = m && m.score >= 0.8 ? { kind: 'library', exerciseId: m.entry.id, name: m.entry.nameEs, trackingType: 'weight_reps' } : { kind: 'create' }
    }
  return out
}

describe('plan, apply, idempotency and stats', () => {
  const dbs: SaludDB[] = []
  let n = 0
  async function device() {
    const db = createDB(`csv-import-${Date.now()}-${n++}`)
    await db.open()
    dbs.push(db)
    return db
  }
  afterEach(async () => {
    for (const db of dbs.splice(0)) await db.delete()
  })

  it('builds sessions with deterministic ids, set kinds, source marker and custom exercises', () => {
    const p = ok(parseTrainingCsv(HEVY))
    const plan = planTrainingImport(p.workouts, 'prof', choicesFor(p), new Set())
    expect(plan.newSessions).toBe(2)
    expect(plan.knownSessions).toBe(0)
    const s = plan.sessions[0]!
    expect(s).toMatchObject({ status: 'done', origin: 'app', sourceRef: 'csv:hevy', routineId: null, durationMin: 65, endedAt: '2026-11-17T00:35:00.000Z' })
    expect(s.notes).toContain('Importado de Hevy (CSV)')
    expect(s.id).toBe(sessionIdFor('prof', 'hevy', '2026-11-16T23:30:00.000Z'))
    expect(sessionIdFor('other', 'hevy', '2026-11-16T23:30:00.000Z')).not.toBe(s.id)
    expect(plan.customs.map((c) => c.nameEs).sort()).toEqual(['Plancha Raro', 'Running (Outdoor)', 'Zzqx Flujo Imaginario'].sort())
    const kinds = plan.sets.filter((x) => x.sessionId === s.id).map((x) => setKind(x))
    expect(kinds).toContain('warmup')
    expect(kinds).toContain('failure')
    expect(kinds).toContain('drop')
    expect(new Set(plan.sets.map((x) => x.id)).size).toBe(plan.sets.length)
    expect(planTrainingImport(p.workouts, 'prof', choicesFor(p), new Set()).sets.map((x) => x.id)).toEqual(plan.sets.map((x) => x.id))
  })

  it('skips exercises the person excluded and counts them', () => {
    const p = ok(parseTrainingCsv(HEVY))
    const ch = choicesFor(p)
    ch[nameKey('Zzqx Flujo Imaginario')] = { kind: 'skip' }
    const plan = planTrainingImport(p.workouts, 'prof', ch, new Set())
    expect(plan.skippedSets).toBe(1)
    expect(plan.customs.map((c) => c.nameEs)).not.toContain('Zzqx Flujo Imaginario')
  })

  it('applies once, re-import adds nothing, undo removes exactly what was added', async () => {
    const db = await device()
    const r = repo('prof', db)
    const p = ok(parseTrainingCsv(HEVY))
    const choices = choicesFor(p)
    const existing = async () => new Set((await r.all('trainingSessions')).map((s) => s.id))
    const plan1 = planTrainingImport(p.workouts, 'prof', choices, await existing())
    const receipt = await applyTrainingImport(r, plan1, 'hevy')
    expect(receipt.sessionIds).toHaveLength(2)
    expect(await r.count('trainingSessions')).toBe(2)
    expect(await r.count('exerciseSets')).toBe(plan1.sets.length)
    expect(await r.count('customExercises')).toBe(3)

    const plan2 = planTrainingImport(p.workouts, 'prof', choices, await existing())
    expect(plan2).toMatchObject({ newSessions: 0, knownSessions: 2, newSets: 0 })
    const again = await applyTrainingImport(r, plan2, 'hevy')
    expect(again.sessionIds).toEqual([])
    // Even a stale plan (computed before the first apply) cannot duplicate.
    const stale = await applyTrainingImport(r, plan1, 'hevy')
    expect(stale.sessionIds).toEqual([])
    expect(await r.count('trainingSessions')).toBe(2)
    expect(await r.count('exerciseSets')).toBe(plan1.sets.length)

    await undoTrainingImport(r, receipt)
    expect(await r.count('trainingSessions')).toBe(0)
    expect(await r.count('exerciseSets')).toBe(0)
    expect(await r.count('customExercises')).toBe(0)
  })

  it('imported sessions flow into stats, weekly summary and PRs', async () => {
    const db = await device()
    const r = repo('prof', db)
    const p = ok(parseTrainingCsv(HEVY))
    await applyTrainingImport(r, planTrainingImport(p.workouts, 'prof', choicesFor(p), new Set()), 'hevy')
    const prepared = prepareStats(await r.all('trainingSessions'), await r.all('exerciseSets'))
    expect(prepared.sessions.map((s) => s.date)).toEqual(['2026-11-18', '2026-11-16'])
    const week = weekSummary(prepared, '2026-11-16')
    expect(week.sessions).toBe(2)
    // Work sets: bench 80x8 and 80x6 (failure counts), raise 10x15 and 6x12 (drop counts), imaginary 25x12, warm-up excluded.
    expect(week.volume).toBe(80 * 8 + 80 * 6 + 10 * 15 + 6 * 12 + 25 * 12)
    // The first time an exercise is done is not a record; a heavier second session is.
    const head = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\n'
    const next = ok(parseTrainingCsv(`${head}Empuje A,"23 Nov 2026, 18:30","23 Nov 2026, 19:30",,Bench Press (Barbell),,,0,normal,90,5,,,\n`))
    await applyTrainingImport(r, planTrainingImport(next.workouts, 'prof', choicesFor(p), new Set((await r.all('trainingSessions')).map((x) => x.id))), 'hevy')
    const after = prepareStats(await r.all('trainingSessions'), await r.all('exerciseSets'))
    expect(after.sessions).toHaveLength(3)
    const records = allRecords(after)
    const heavy = (await r.all('exerciseSets')).find((x) => x.weight === 90)!
    expect(records.get(heavy.id)).toContain('max_weight')
  })

  it('Strong import in lb stores kg', () => {
    const p = ok(parseTrainingCsv(STRONG, { unit: 'lb' }))
    const plan = planTrainingImport(p.workouts as ParsedWorkout[], 'prof', choicesFor(p), new Set())
    expect(plan.sets.find((s) => s.weight === 45.59)).toBeTruthy()
    expect(plan.sessions[0]!.sourceRef).toBe('csv:strong')
  })
})
