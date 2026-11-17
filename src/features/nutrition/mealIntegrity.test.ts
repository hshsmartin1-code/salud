import { describe, expect, it } from 'vitest'
import type { MealSlotPref } from '../../db/types'
import { defaultMeal } from './food'
import { resolveSlots, slotForTime, toPrefs } from './mealSlots'

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

describe('meal resolution integrity', () => {
  it.each([false, 7, 'meals', {}, [null, 4, { key: 'unknown', on: true }, { key: 'cena', on: false, name: 'x'.repeat(100_000) }, { key: 'cena', on: true }]])('reads malformed stored preferences without changing them: %j', (raw) => {
    const before = structuredClone(raw)
    const slots = resolveSlots(raw as unknown as MealSlotPref[])
    expect(slots).toHaveLength(6)
    expect(new Set(slots.map((s) => s.key)).size).toBe(6)
    expect(slots.some((s) => s.on)).toBe(true)
    expect(slots.every((s) => s.label.length <= 24)).toBe(true)
    expect(raw).toEqual(before)
  })

  it('uses an enabled slot in every nonempty subset at every minute, matching the legacy clock with all six', () => {
    const all = resolveSlots(undefined).map((s) => ({ ...s, on: true }))
    for (let mask = 1; mask < 64; mask++) {
      const slots = resolveSlots(toPrefs(all.map((s, i) => ({ ...s, on: !!(mask & (1 << i)) }))))
      for (let minute = 0; minute < 1440; minute++) {
        const result = slotForTime(slots, clock(minute))
        if (!result.on || (mask === 63 && result.key !== defaultMeal(clock(minute)))) {
          throw Error(`Invalid slot for mask ${mask} at ${clock(minute)}`)
        }
      }
    }
  })

  it.each([['01:00', '23:00', '23:00'], ['00:00', '00:00', '00:00'], ['07:00', '13:00', '20:00']])('uses circular midpoints, including tied anchors: %j', (...times) => {
    const slots = resolveSlots(['desayuno', 'almuerzo', 'cena'].map((key, i) => ({ key, on: true, time: times[i] })) as MealSlotPref[])
    const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b))
    for (let minute = 0; minute < 1440; minute++) {
      const chosen = slotForTime(slots, clock(minute))
      const nearest = Math.min(...slots.filter((s) => s.on).map((s) => distance(minute, minuteOf(s.time!))))
      expect(distance(minute, minuteOf(chosen.time!))).toBe(nearest)
    }
  })
})
