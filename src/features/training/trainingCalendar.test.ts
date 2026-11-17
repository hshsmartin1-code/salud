import { describe, expect, it } from 'vitest'
import type { ExerciseSet, TrainingSession } from '../../db/types'
import { calendarWeeks, streakText, weekStreak } from './trainingCalendar'
import { prepareStats } from './trainingStats'

// Synthetic data only. 2026-11-15 is a Sunday; its week starts Monday 2026-11-09.
const base = { profileId: 'p', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
let n = 0
const s = (date: string, extra: Partial<TrainingSession> = {}): TrainingSession => ({ ...base, id: `s${++n}`, date, name: 'Pierna A', routineId: null, status: 'done', startedAt: `${date}T18:00:00.000Z`, endedAt: null, restEndsAt: null, exerciseOrder: [], durationMin: 50, ...extra })
const p = (list: TrainingSession[]) => prepareStats(list, [] as ExerciseSet[])

describe('calendarWeeks', () => {
  it('gives 5 Monday-first weeks of 7 days ending with the current week, marking today and the future', () => {
    const w = calendarWeeks(p([]), '2026-11-11', 5)
    expect(w).toHaveLength(5)
    expect(w.every((x) => x.length === 7)).toBe(true)
    expect(w[0]![0]!.date).toBe('2026-10-12')
    expect(w[4]![0]!.date).toBe('2026-11-09')
    expect(w[4]![2]).toMatchObject({ date: '2026-11-11', today: true, future: false })
    expect(w[4]![3]).toMatchObject({ date: '2026-11-12', future: true })
  })
  it('marks days with counted sessions only (active and flagged sessions do not count), several per day kept', () => {
    const list = [s('2026-11-10'), s('2026-11-10', { name: 'Torso A' }), s('2026-11-11', { status: 'active' }), s('2026-11-12', { excludeFromStats: true }), s('2026-11-02')]
    const w = calendarWeeks(p(list), '2026-11-15')
    expect(w[4]![1]!.sessions.map((x) => x.name).sort()).toEqual(['Pierna A', 'Torso A'])
    expect(w[4]![2]!.sessions).toEqual([])
    expect(w[4]![3]!.sessions).toEqual([])
    expect(w[3]![0]!.sessions).toHaveLength(1)
  })
  it('puts Sunday in the same week as the Monday before it', () => {
    const w = calendarWeeks(p([s('2026-11-08')]), '2026-11-15')
    expect(w[3]![6]!.date).toBe('2026-11-08')
    expect(w[3]![6]!.sessions).toHaveLength(1)
  })
})

describe('weekStreak', () => {
  it('counts consecutive weeks with at least one session, current week included when it has one', () => {
    expect(weekStreak(p([s('2026-11-10'), s('2026-11-03'), s('2026-10-27')]), '2026-11-15')).toBe(3)
  })
  it('does not break the streak while the current week is still empty', () => {
    expect(weekStreak(p([s('2026-11-03'), s('2026-10-27')]), '2026-11-09')).toBe(2)
  })
  it('a missed week ends it', () => {
    expect(weekStreak(p([s('2026-11-10'), s('2026-10-27')]), '2026-11-15')).toBe(1)
  })
  it('is 0 with no recent sessions and ignores uncounted ones', () => {
    expect(weekStreak(p([]), '2026-11-15')).toBe(0)
    expect(weekStreak(p([s('2026-11-10', { excludeFromStats: true })]), '2026-11-15')).toBe(0)
    expect(weekStreak(p([s('2026-09-01')]), '2026-11-15')).toBe(0)
  })
  it('speaks only from two weeks on', () => {
    expect(streakText(1)).toBeNull()
    expect(streakText(3)).toBe('3 semanas seguidas con al menos 1 sesión')
  })
})
