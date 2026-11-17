import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { normalize } from '../../domain/search'
import {
  activeFilterCount,
  EMPTY_FILTER,
  exerciseRecords,
  filterLibrary,
  findVariants,
  idsResolvingTo,
  loadExerciseSets,
  nameStem,
  parseAliases,
  progression,
  rankSubstitutions,
  reasonText,
  resolveExerciseId,
  setFavorite,
  summarizeSessions,
  type KExercise,
} from './exerciseKnowledge'

// Synthetic data only.
let seq = 0
function ex(id: string, nameEs: string, o: Partial<KExercise> = {}): KExercise {
  return {
    id,
    nameEs,
    aliases: [],
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    category: 'strength',
    level: 'beginner',
    mechanic: 'compound',
    force: 'push',
    trackingType: 'weight_reps',
    custom: false,
    search: normalize(nameEs),
    ...o,
  }
}

const bench = ex('fedb:bench', 'Press de banca con barra')
const LIB: KExercise[] = [
  bench,
  ex('fedb:bench_db', 'Press de banca con mancuernas', { equipment: 'dumbbell' }),
  ex('fedb:incline_db', 'Press de banca inclinado con mancuernas', { equipment: 'dumbbell', level: 'intermediate' }),
  ex('fedb:machine_press', 'Press en máquina', { equipment: 'machine' }),
  ex('fedb:fly', 'Aperturas con polea', { equipment: 'cable', mechanic: 'isolation', force: 'pull' }),
  ex('fedb:pushup', 'Flexiones', { equipment: 'body only', trackingType: 'bodyweight_reps' }),
  ex('fedb:plank', 'Plancha', { primaryMuscles: ['abdominals'], equipment: 'body only', trackingType: 'time', mechanic: 'isolation', force: 'static' }),
  ex('fedb:squat', 'Sentadilla con barra', { primaryMuscles: ['quadriceps'], force: 'push' }),
  ex('fedb:chest_stretch', 'Estiramiento de pecho', { category: 'stretching', equipment: null, trackingType: 'time', mechanic: null, force: 'static' }),
  ex('custom:mine', 'Mi press raro', { custom: true, level: null, equipment: null }),
]

describe('filterLibrary', () => {
  it('is accent-insensitive and token based', () => {
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, q: 'maquina' }).map((e) => e.id)).toEqual(['fedb:machine_press'])
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, q: 'banca mancuernas' }).map((e) => e.id)).toContain('fedb:bench_db')
  })
  it('combines muscle (primary only), equipment, level and category', () => {
    const f = { ...EMPTY_FILTER, muscle: 'chest', equipment: 'dumbbell', level: 'intermediate' }
    expect(filterLibrary(LIB, f).map((e) => e.id)).toEqual(['fedb:incline_db'])
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, category: 'stretching' }).map((e) => e.id)).toEqual(['fedb:chest_stretch'])
    const sec = [ex('a', 'Remo', { primaryMuscles: ['lats'], secondaryMuscles: ['chest'] })]
    expect(filterLibrary(sec, { ...EMPTY_FILTER, muscle: 'chest' })).toHaveLength(0)
  })
  it('custom, favourites and illustration filters', () => {
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, customOnly: true }).map((e) => e.id)).toEqual(['custom:mine'])
    const favorites = new Set(['fedb:fly', 'custom:mine'])
    expect(
      filterLibrary(LIB, { ...EMPTY_FILTER, favoritesOnly: true }, { favorites })
        .map((e) => e.id)
        .sort(),
    ).toEqual(['custom:mine', 'fedb:fly'])
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, withMedia: true }, { hasMedia: (id) => id === 'fedb:plank' }).map((e) => e.id)).toEqual(['fedb:plank'])
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, withMedia: true })).toHaveLength(0)
  })
  it('favourites float to the top without a query, not with one', () => {
    const favorites = new Set(['fedb:squat'])
    expect(filterLibrary(LIB, EMPTY_FILTER, { favorites })[0]!.id).toBe('fedb:squat')
    expect(filterLibrary(LIB, { ...EMPTY_FILTER, q: 'press' }, { favorites }).map((e) => e.id)).not.toContain('fedb:squat')
  })
  it('counts active filters', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTER, muscle: 'chest', withMedia: true })).toBe(2)
  })
})

describe('alias resolution', () => {
  const aliases = parseAliases({ _comment: 'x', old1: 'mid', mid: 'new', loop_a: 'loop_b', loop_b: 'loop_a', bad: 5, same: 'same' })
  it('parses and ignores metadata/invalid', () => {
    expect(Object.keys(aliases).sort()).toEqual(['loop_a', 'loop_b', 'mid', 'old1'])
    expect(parseAliases(null)).toEqual({})
  })
  it('follows chains, is identity without alias and cycle-safe', () => {
    expect(resolveExerciseId('old1', aliases)).toBe('new')
    expect(resolveExerciseId('fedb:x', aliases)).toBe('fedb:x')
    expect(['loop_a', 'loop_b']).toContain(resolveExerciseId('loop_a', aliases))
  })
  it('lists every id that resolves to the current one', () => {
    expect(idsResolvingTo('new', aliases)).toEqual(['new', 'old1', 'mid'])
    expect(idsResolvingTo('old1', aliases)[0]).toBe('new')
  })
})

describe('variants', () => {
  it('finds same-movement family across equipment, excludes itself and other muscles', () => {
    const v = findVariants(bench, LIB).map((x) => x.exercise.id)
    expect(v).toContain('fedb:bench_db')
    expect(v).toContain('fedb:incline_db')
    expect(v).not.toContain('fedb:bench')
    expect(v).not.toContain('fedb:squat')
    expect(v).not.toContain('fedb:fly')
    expect(findVariants(bench, LIB, { labels: { equipment: { dumbbell: 'Mancuernas' } } }).find((x) => x.exercise.id === 'fedb:bench_db')!.reasons.join(' ')).toContain('mancuernas')
  })
  it('stems drop articles and equipment words', () => {
    expect(nameStem('Press de banca con barra')).toEqual(['press', 'banca'])
  })
})

describe('substitutions', () => {
  it('ranks by muscle, mechanic, force, tracking, equipment; excludes self and wrong muscles', () => {
    const ids = rankSubstitutions(bench, LIB).map((s) => s.exercise.id)
    expect(ids).not.toContain('fedb:bench')
    expect(ids).not.toContain('fedb:squat')
    expect(ids).not.toContain('fedb:plank')
    expect(ids).not.toContain('fedb:chest_stretch')
    expect(ids.indexOf('fedb:bench_db')).toBeLessThan(ids.indexOf('fedb:fly'))
    expect(ids.indexOf('fedb:machine_press')).toBeLessThan(ids.indexOf('fedb:fly'))
  })
  it('gives Spanish reasons', () => {
    const subs = rankSubstitutions(bench, LIB)
    const db = subs.find((s) => s.exercise.id === 'fedb:bench_db')!
    expect(reasonText(db)).toBe('Mismo músculo principal · compuesto · empuje · equipo similar')
    const fly = subs.find((s) => s.exercise.id === 'fedb:fly')!
    expect(reasonText(fly)).toContain('otro equipo')
    expect(reasonText(fly)).toMatch(/^Mismo músculo principal/)
  })
  it('compatibleTrackingOnly keeps weight/bodyweight together and drops time', () => {
    const ids = rankSubstitutions(bench, LIB, { compatibleTrackingOnly: true }).map((s) => s.exercise.id)
    expect(ids).toContain('fedb:pushup')
    const timed = ex('t', 'Isométrico', { primaryMuscles: ['chest'], trackingType: 'time' })
    expect(rankSubstitutions(bench, [...LIB, timed], { compatibleTrackingOnly: true }).map((s) => s.exercise.id)).not.toContain('t')
    expect(rankSubstitutions(bench, [...LIB, timed]).map((s) => s.exercise.id)).toContain('t')
  })
  it('honours exclude, favourites flag and exercises without muscle', () => {
    expect(rankSubstitutions(bench, LIB, { exclude: new Set(['fedb:bench_db']) }).map((s) => s.exercise.id)).not.toContain('fedb:bench_db')
    const fav = rankSubstitutions(bench, LIB, { favorites: new Set(['fedb:fly']) }).find((s) => s.exercise.id === 'fedb:fly')!
    expect(fav.reasons).toContain('favorito')
    expect(rankSubstitutions(ex('n', 'Sin músculo', { primaryMuscles: [] }), LIB)).toEqual([])
  })
})

type S = Parameters<typeof summarizeSessions>[0][number]
let sid = 0
function set(sessionId: string, date: string, weight: number | null, reps: number | null, o: Partial<S> = {}): S {
  return { id: `s${sid++}`, sessionId, date, setIndex: sid, weight, reps, durationSec: null, distanceM: null, isWarmup: false, done: true, ...o }
}

describe('history, progression and records', () => {
  const sets: S[] = [
    set('a', '2026-01-05', 20, 10, { isWarmup: true }),
    set('a', '2026-01-05', 60, 8),
    set('a', '2026-01-05', 60, 6),
    set('b', '2026-01-12', 65, 8),
    set('b', '2026-01-12', 70, 3),
    set('c', '2026-01-19', 100, 5, { done: false }),
    set('c', '2026-01-19', 62.5, 8),
  ]
  it('summarizes sessions newest first, excluding undone sets and warm-ups from best', () => {
    const ss = summarizeSessions(sets, 'weight_reps')
    expect(ss.map((s) => s.date)).toEqual(['2026-01-19', '2026-01-12', '2026-01-05'])
    const a = ss[2]!
    expect(a.best).toMatchObject({ weight: 60, reps: 8 })
    expect(a.volume).toBe(60 * 8 + 60 * 6)
    expect(a.e1rm).toBeCloseTo(60 * (1 + 8 / 30), 5)
  })
  it('progression is oldest to newest with one point per session', () => {
    const p = progression(summarizeSessions(sets, 'weight_reps'))
    expect(p.map((x) => x.date)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19'])
    expect(p[1]!.value).toBeCloseTo(65 * (1 + 8 / 30), 5)
  })
  it('records: load, e1RM, reps at load, best volume session, with dates', () => {
    const rec = exerciseRecords(sets)
    expect(rec.bestLoad).toEqual({ value: 70, date: '2026-01-12', reps: 3 })
    expect(rec.bestE1rm!.date).toBe('2026-01-12')
    expect(rec.repsAtLoad[0]).toEqual({ weight: 70, reps: 3, date: '2026-01-12' })
    expect(rec.bestVolumeSession).toEqual({ value: 60 * 8 + 60 * 6, date: '2026-01-05' })
    expect(rec.repsAtLoad.find((x) => x.weight === 100)).toBeUndefined()
  })
  it('handles empty input and time-based exercises', () => {
    expect(exerciseRecords([]).bestLoad).toBeNull()
    expect(summarizeSessions([], 'weight_reps')).toEqual([])
    const t = [set('x', '2026-02-01', null, null, { durationSec: 45 }), set('y', '2026-02-08', null, null, { durationSec: 60 })]
    expect(exerciseRecords(t).bestDuration).toEqual({ value: 60, date: '2026-02-08' })
    expect(progression(summarizeSessions(t, 'time')).map((p) => p.value)).toEqual([45, 60])
  })
})

describe('favourites and aliased history (db)', () => {
  let db: SaludDB
  beforeEach(async () => {
    db = createDB(`knowledge-${Date.now()}-${seq++}`)
    await db.open()
  })
  afterEach(async () => {
    await db.delete()
  })
  const mk = (name: string) => createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)

  it('favourites are isolated between profiles and toggle off', async () => {
    const a = await mk('Perfil A')
    const b = await mk('Perfil B')
    const ra = repo(a.id, db)
    const rb = repo(b.id, db)
    await setFavorite(ra, a.id, 'fedb:plank', 'Plancha', true)
    await setFavorite(rb, b.id, 'fedb:squat', 'Sentadilla', true)
    expect((await ra.all('exerciseFavorites')).map((f) => f.exerciseId)).toEqual(['fedb:plank'])
    expect((await rb.all('exerciseFavorites')).map((f) => f.exerciseId)).toEqual(['fedb:squat'])
    await setFavorite(ra, a.id, 'fedb:plank', 'Plancha', true)
    expect(await ra.all('exerciseFavorites')).toHaveLength(1)
    await setFavorite(ra, a.id, 'fedb:plank', 'Plancha', false)
    expect(await ra.all('exerciseFavorites')).toHaveLength(0)
    expect(await rb.all('exerciseFavorites')).toHaveLength(1)
  })

  it('history stored under an old id is still found through aliases', async () => {
    const p = await mk('Perfil A')
    const r = repo(p.id, db)
    const base = { sessionId: 'sx', date: '2026-03-01', setIndex: 0, weight: 50, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, origin: 'app' as const }
    await r.add('exerciseSets', { ...base, exerciseId: 'fedb:Old_Name', exerciseName: 'Nombre viejo' })
    await r.add('exerciseSets', { ...base, sessionId: 'sy', exerciseId: 'fedb:New_Name', exerciseName: 'Nombre nuevo' })
    const aliases = { 'fedb:Old_Name': 'fedb:New_Name' }
    const sets = await loadExerciseSets(r, 'fedb:New_Name', aliases)
    expect(sets).toHaveLength(2)
    expect(sets.map((s) => s.exerciseName).sort()).toEqual(['Nombre nuevo', 'Nombre viejo'])
    expect(await loadExerciseSets(r, 'fedb:New_Name', {})).toHaveLength(1)
  })
})
