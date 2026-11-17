import { describe, expect, it } from 'vitest'
import type { ExerciseSet, TrainingSession } from '../../../db/types'
import { MUSCLE_IDS } from '../muscles'
import { prepareStats, type CatalogMuscles } from '../trainingStats'
import {
  agoSpoken,
  agoText,
  computeRecovery,
  formatSets,
  ruleText,
  sessionInstant,
  spokenName,
  stateFor,
  summarizeGroups,
  weeklyNote,
  weeklyText,
} from './recovery'

// Synthetic data only.
const H = 3_600_000
const NOW = Date.parse('2026-11-15T20:00:00.000Z')
const base = { profileId: 'p', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
let n = 0
const catalog: CatalogMuscles = new Map([
  ['squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings', 'quadriceps'] }],
  ['bench', { primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'] }],
  ['curl', { primaryMuscles: ['biceps'], secondaryMuscles: [] }],
])
function session(hoursAgo: number, extra: Partial<TrainingSession> = {}): TrainingSession {
  const end = new Date(NOW - hoursAgo * H).toISOString()
  return { ...base, id: extra.id ?? `s${++n}`, date: end.slice(0, 10), name: 'Pierna A', routineId: null, status: 'done', startedAt: end, endedAt: end, restEndsAt: null, exerciseOrder: [], durationMin: 60, ...extra }
}
function sets(s: TrainingSession, exerciseId: string, count: number, extra: Partial<ExerciseSet> = {}): ExerciseSet[] {
  return Array.from({ length: count }, (_, i) => ({
    ...base, id: `x${++n}`, sessionId: s.id, date: s.date, exerciseId, exerciseName: exerciseId, setIndex: i,
    weight: 50, reps: 8, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, ...extra,
  }))
}
const run = (ss: TrainingSession[], xs: ExerciseSet[]) => computeRecovery(prepareStats(ss, xs), catalog, NOW)

describe('computeRecovery', () => {
  it('counts primary as 1 and secondary as 0.5 (a muscle listed in both counts once as primary)', () => {
    const s = session(30)
    const r = run([s], sets(s, 'squat', 4))
    expect(r.get('quadriceps')!.lastSessionSets).toBe(4)
    expect(r.get('glutes')!.lastSessionSets).toBe(2)
    expect(r.get('hamstrings')!.weekSets).toBe(2)
  })

  it('excludes warm-ups, undone sets, flagged sets and flagged or unfinished sessions', () => {
    const ok = session(30)
    const flagged = session(5, { excludeFromStats: true })
    const active = session(2, { status: 'active', endedAt: null })
    const xs = [
      ...sets(ok, 'curl', 3),
      ...sets(ok, 'curl', 2, { isWarmup: true }),
      ...sets(ok, 'curl', 1, { done: false }),
      ...sets(ok, 'curl', 1, { excludeFromStats: true }),
      ...sets(flagged, 'curl', 5),
      ...sets(active, 'curl', 5),
    ]
    const b = run([ok, flagged, active], xs).get('biceps')!
    expect(b.lastSessionSets).toBe(3)
    expect(b.lastSession!.id).toBe(ok.id)
    expect(b.weekSets).toBe(3)
  })

  it('applies the states at the documented boundaries', () => {
    expect(stateFor(null, 0)).toBe('none')
    expect(stateFor(23.9, 48)).toBe('recent')
    expect(stateFor(24, 48)).toBe('recovering')
    expect(stateFor(47.9, 48)).toBe('recovering')
    expect(stateFor(48, 48)).toBe('ready')
    expect(stateFor(60, 72)).toBe('recovering')
    expect(stateFor(168, 48)).toBe('ready')
    expect(stateFor(168.1, 48)).toBe('rested')
  })

  it('extends the window to 72 h from 8 effective sets in the session', () => {
    const s7 = session(60, { id: 'a' })
    const r7 = run([s7], sets(s7, 'bench', 7)).get('chest')!
    expect(r7.windowHours).toBe(48)
    expect(r7.state).toBe('ready')
    const s8 = session(60, { id: 'b' })
    const r8 = run([s8], sets(s8, 'bench', 8)).get('chest')!
    expect(r8.windowHours).toBe(72)
    expect(r8.state).toBe('recovering')
    expect(ruleText(r8)).toContain('72 h tras 8 series')
  })

  it('ignores a session below one effective set and uses the previous stimulus', () => {
    const old = session(100)
    const recent = session(3)
    // 1 bench set = 0.5 for triceps: not a stimulus for triceps on its own.
    const r = run([old, recent], [...sets(old, 'bench', 4), ...sets(recent, 'bench', 1)])
    expect(r.get('triceps')!.lastSession!.id).toBe(old.id)
    expect(r.get('triceps')!.weekSets).toBe(2.5)
    expect(r.get('chest')!.state).toBe('recent')
  })

  it('reports rested after 7 days, none without data, and ignores future sessions', () => {
    const old = session(200)
    const future = session(-5)
    const r = run([old, future], [...sets(old, 'curl', 3), ...sets(future, 'bench', 3)])
    expect(r.get('biceps')!.state).toBe('rested')
    expect(r.get('biceps')!.weekSets).toBe(0)
    expect(r.get('biceps')!.weekNote).toBeNull()
    expect(r.get('chest')!.state).toBe('none')
    expect(r.get('calves')!.hoursSince).toBeNull()
    expect(r.size).toBe(MUSCLE_IDS.length)
  })

  it('lists the exercises of the last session with their role', () => {
    const s = session(10)
    const r = run([s], [...sets(s, 'squat', 3), ...sets(s, 'bench', 2)]).get('glutes')!
    expect(r.exercises).toEqual([{ exerciseId: 'squat', name: 'squat', role: 'secondary', sets: 3 }])
  })
})

describe('text', () => {
  it('formats sets, hours and the weekly note', () => {
    expect(formatSets(6)).toBe('6')
    expect(formatSets(6.5)).toBe('6,5')
    expect(agoText(26.7)).toBe('hace 26 h')
    expect(agoText(80)).toBe('hace 3 d')
    expect(weeklyNote(0)).toBeNull()
    expect(weeklyNote(11.5)).toBe('below')
    expect(weeklyNote(12)).toBe('within')
    expect(weeklyNote(20.5)).toBe('above')
    expect(weeklyText({ weekSets: 13, weekNote: 'within' })).toMatch(/^13 series en 7 días · dentro del rango de 12–20/)
  })
  it('uses the end of the session, then its start, then noon of its date', () => {
    expect(sessionInstant({ endedAt: '2026-11-10T20:00:00.000Z', startedAt: '2026-11-10T19:00:00.000Z', date: '2026-11-10' })).toBe(Date.parse('2026-11-10T20:00:00.000Z'))
    expect(sessionInstant({ endedAt: null, startedAt: '2026-11-10T19:00:00.000Z', date: '2026-11-10' })).toBe(Date.parse('2026-11-10T19:00:00.000Z'))
    expect(sessionInstant({ endedAt: null, startedAt: null, date: '2026-11-10' })).toBe(Date.parse('2026-11-10T12:00:00'))
  })
})

describe('group summary and spoken names', () => {
  it('rolls muscles up into six rows (legs with glutes) with the strongest state and the latest hours', () => {
    const legs = session(30, { id: 'legs' })
    const arms = session(5, { id: 'arms' })
    const r = run([legs, arms], [...sets(legs, 'squat', 4), ...sets(arms, 'curl', 3)])
    const g = summarizeGroups(r)
    expect(g.map((x) => x.label)).toEqual(['Pecho', 'Espalda', 'Hombros', 'Brazos', 'Core', 'Piernas y glúteos'])
    const legRow = g.find((x) => x.id === 'legs')!
    expect(legRow.muscles.map((m) => m.muscle)).toContain('glutes')
    expect(legRow.state).toBe('recovering')
    expect(Math.round(legRow.hoursSince!)).toBe(30)
    expect(g.find((x) => x.id === 'arms')!.state).toBe('recent')
    expect(g.find((x) => x.id === 'chest')!.state).toBe('none')
    expect(g.flatMap((x) => x.muscles).length).toBe(MUSCLE_IDS.length)
  })
  it('builds accessible names with the state and the time', () => {
    expect(spokenName('Cuádriceps', { state: 'ready', hoursSince: 50 })).toBe('Cuádriceps, ventana cumplida, hace 2 días')
    expect(spokenName('Bíceps', { state: 'recent', hoursSince: 1.5 })).toBe('Bíceps, menos de 24 horas, hace 1 hora')
    expect(spokenName('Cuello', { state: 'none', hoursSince: null })).toBe('Cuello, sin registros')
    expect(agoSpoken(26.2)).toBe('hace 26 horas')
  })
})
