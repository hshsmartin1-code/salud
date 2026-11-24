import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dayMarkId, dayMarkOf, dedupeDayMarks, dedupeHabitLogs, habitLogId, habitValueOn } from '../domain/dayRecords'
import { setDayMark, setHabitValue } from './dayRecords'
import { repo } from './repo'
import { createDB, type SaludDB } from './schema'
import type { DayMark, HabitLog } from './types'

let db: SaludDB
let n = 0
beforeEach(async () => {
  db = createDB(`day-records-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const hl = (id: string, value: number, updatedAt: string, date = '2026-11-18'): HabitLog =>
  ({ id, profileId: 'p', habitId: 'h', date, value, createdAt: updatedAt, updatedAt }) as HabitLog
const dm = (id: string, complete: boolean, updatedAt: string): DayMark => ({ id, profileId: 'p', date: '2026-11-18', complete, createdAt: updatedAt, updatedAt }) as DayMark

describe('legacy duplicate rows are read as ONE value (latest wins, never summed)', () => {
  it('habit value', () => {
    const logs = [hl('a', 3, '2026-11-18T10:00:00Z'), hl('b', 5, '2026-11-18T11:00:00Z'), hl('c', 4, '2026-11-18T09:00:00Z')]
    expect(habitValueOn(logs, 'h', '2026-11-18')).toBe(5)
    expect(habitValueOn(logs, 'h', '2026-11-19')).toBe(0)
    expect(dedupeHabitLogs(logs)).toHaveLength(1)
  })
  it('day mark', () => {
    const marks = [dm('a', true, '2026-11-18T10:00:00Z'), dm('b', false, '2026-11-18T12:00:00Z')]
    expect(dayMarkOf(marks)?.complete).toBe(false)
    expect(dedupeDayMarks(marks)).toHaveLength(1)
    expect(dayMarkOf([])).toBeNull()
  })
  it('ties on updatedAt resolve identically regardless of order', () => {
    const a = hl('a', 1, 't')
    const b = hl('b', 2, 't')
    expect(habitValueOn([a, b], 'h', '2026-11-18')).toBe(habitValueOn([b, a], 'h', '2026-11-18'))
  })
})

describe('setHabitValue', () => {
  it('concurrent writes for the same day leave a single row with a deterministic id', async () => {
    const r = repo('p1', db)
    await Promise.all([setHabitValue(r, 'h1', '2026-11-18', 3), setHabitValue(r, 'h1', '2026-11-18', 3), setHabitValue(r, 'h1', '2026-11-18', 4)])
    const rows = await r.onDate('habitLogs', '2026-11-18')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(habitLogId('p1', 'h1', '2026-11-18'))
    expect(habitValueOn(rows, 'h1', '2026-11-18')).toBeGreaterThanOrEqual(3)
  })
  it('replaces legacy random-id duplicates and a value of 0 clears the day', async () => {
    const r = repo('p1', db)
    await r.add('habitLogs', { habitId: 'h1', date: '2026-11-18', value: 2 })
    await r.add('habitLogs', { habitId: 'h1', date: '2026-11-18', value: 2 })
    await setHabitValue(r, 'h1', '2026-11-18', 5)
    const rows = await r.onDate('habitLogs', '2026-11-18')
    expect(rows.map((x) => x.value)).toEqual([5])
    await setHabitValue(r, 'h1', '2026-11-18', 0)
    expect(await r.onDate('habitLogs', '2026-11-18')).toHaveLength(0)
  })
  it('does not touch another habit or another profile', async () => {
    const r = repo('p1', db)
    const other = repo('p2', db)
    await setHabitValue(other, 'h1', '2026-11-18', 9)
    await setHabitValue(r, 'h2', '2026-11-18', 1)
    await setHabitValue(r, 'h1', '2026-11-18', 2)
    expect((await other.onDate('habitLogs', '2026-11-18')).map((x) => x.value)).toEqual([9])
    expect(await r.onDate('habitLogs', '2026-11-18')).toHaveLength(2)
  })
})

describe('setDayMark', () => {
  it('toggling repeatedly keeps one mark; "none" removes it, legacy duplicates included', async () => {
    const r = repo('p1', db)
    await r.add('dayMarks', { date: '2026-11-18', complete: true })
    await r.add('dayMarks', { date: '2026-11-18', complete: false })
    await setDayMark(r, '2026-11-18', 'complete')
    await Promise.all([setDayMark(r, '2026-11-18', 'incomplete'), setDayMark(r, '2026-11-18', 'incomplete')])
    const rows = await r.onDate('dayMarks', '2026-11-18')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(dayMarkId('p1', '2026-11-18'))
    expect(rows[0]!.complete).toBe(false)
    await setDayMark(r, '2026-11-18', 'none')
    expect(await r.onDate('dayMarks', '2026-11-18')).toHaveLength(0)
  })
})
