import { describe, expect, it } from 'vitest'
import type { MealKey, MealSlotPref } from '../../db/types'
import { defaultMeal, MEALS } from './food'
import {
  chooserSlots, cleanName, moveSlot, renameSlot, resolveSlots, sanitizePrefs, setSlotTime, slotForTime, toggleSlot, toPrefs, visibleSlots,
} from './mealSlots'

const keys = (s: { key: MealKey }[]) => s.map((x) => x.key)
const on = (s: { key: MealKey; on: boolean }[]) => s.filter((x) => x.on).map((x) => x.key)
const allOn = (): MealSlotPref[] => MEALS.map((m) => ({ key: m.key, on: true }))
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

describe('resolveSlots without stored preferences', () => {
  it('shows breakfast, lunch and dinner in the usual order', () => {
    const s = resolveSlots(undefined, [])
    expect(keys(s)).toEqual(['desayuno', 'media_manana', 'almuerzo', 'onces', 'cena', 'otro'])
    expect(on(s)).toEqual(['desayuno', 'almuerzo', 'cena'])
    expect(s[0]).toMatchObject({ label: 'Desayuno', renamed: false })
  })
  it('keeps on any slot used in the last 30 days', () => {
    expect(on(resolveSlots(undefined, ['onces', 'onces', 'otro']))).toEqual(['desayuno', 'almuerzo', 'onces', 'cena', 'otro'])
  })
})

describe('sanitising stored preferences', () => {
  it('drops duplicates and unknown keys, appends missing keys off', () => {
    const s = sanitizePrefs([
      { key: 'cena', on: true },
      { key: 'cena', on: false, name: 'Segunda' },
      { key: 'brunch' as MealKey, on: true },
      { key: 'desayuno', on: true },
    ])
    expect(keys(s)).toEqual(['cena', 'desayuno', 'media_manana', 'almuerzo', 'onces', 'otro'])
    expect(s[0]).toEqual({ key: 'cena', on: true })
    expect(on(s)).toEqual(['cena', 'desayuno'])
  })
  it('turns the first slot on when none is on, also for an empty list', () => {
    expect(on(sanitizePrefs([{ key: 'onces', on: false }, { key: 'cena', on: false }]))).toEqual(['onces'])
    expect(on(sanitizePrefs([]))).toEqual(['desayuno'])
  })
  it('trims names to 24 characters and treats blanks as the default name', () => {
    expect(cleanName('  Merienda de la tarde con fruta y más  ')).toBe('Merienda de la tarde con')
    expect(cleanName('   ')).toBeUndefined()
    const s = resolveSlots([{ key: 'onces', on: true, name: '  Merienda  ' }, { key: 'cena', on: true, name: '  ' }])
    expect(s[0]).toMatchObject({ label: 'Merienda', renamed: true })
    expect(s[1]).toMatchObject({ label: 'Cena', renamed: false })
  })
  it('drops a bad time and keeps a good one', () => {
    const s = resolveSlots([
      { key: 'desayuno', on: true, time: '7:30' },
      { key: 'almuerzo', on: true, time: '25:00' },
      { key: 'cena', on: true, time: '19:45' },
    ])
    expect(s.map((x) => x.time)).toEqual([undefined, undefined, '19:45', undefined, undefined, undefined])
  })
  it('never mutates what was stored', () => {
    const stored = [{ key: 'cena', on: false }] as MealSlotPref[]
    resolveSlots(stored)
    expect(stored).toEqual([{ key: 'cena', on: false }])
  })
})

describe('visibleSlots and choosers', () => {
  it('adds a hidden slot that has entries that day, in its place', () => {
    const slots = resolveSlots([{ key: 'desayuno', on: true }, { key: 'media_manana', on: false }, { key: 'almuerzo', on: true }])
    expect(keys(visibleSlots(slots, []))).toEqual(['desayuno', 'almuerzo'])
    expect(keys(visibleSlots(slots, [{ meal: 'media_manana' }]))).toEqual(['desayuno', 'media_manana', 'almuerzo'])
    expect(keys(visibleSlots(slots, [{ meal: 'otro' }]))).toEqual(['desayuno', 'almuerzo', 'otro'])
  })
  it('a chooser lists active slots plus the hidden slot of the row being edited', () => {
    const slots = resolveSlots(undefined)
    expect(keys(chooserSlots(slots))).toEqual(['desayuno', 'almuerzo', 'cena'])
    expect(keys(chooserSlots(slots, 'onces'))).toEqual(['desayuno', 'almuerzo', 'onces', 'cena'])
    expect(keys(chooserSlots(slots, 'cena'))).toEqual(['desayuno', 'almuerzo', 'cena'])
  })
})

describe('slotForTime', () => {
  it('equals defaultMeal at every minute when all six are on and no time is set', () => {
    const slots = resolveSlots(allOn())
    for (let m = 0; m < 1440; m++) expect(slotForTime(slots, hhmm(m)).key).toBe(defaultMeal(hhmm(m)))
  })
  it('matches the existing boundaries', () => {
    const slots = resolveSlots(allOn())
    const at = (t: string) => slotForTime(slots, t).key
    expect([at('10:29'), at('10:30'), at('11:59'), at('12:00'), at('14:59'), at('15:00'), at('18:29'), at('18:30'), at('21:59'), at('22:00')]).toEqual([
      'desayuno', 'media_manana', 'media_manana', 'almuerzo', 'almuerzo', 'onces', 'onces', 'cena', 'cena', 'otro',
    ])
  })
  it('always returns an active slot', () => {
    const cases: (MealSlotPref[] | undefined)[] = [
      undefined,
      [{ key: 'otro', on: true }],
      [{ key: 'media_manana', on: true }, { key: 'cena', on: true }],
      [{ key: 'desayuno', on: true, time: '08:00' }],
    ]
    for (const prefs of cases) {
      const slots = resolveSlots(prefs)
      for (let m = 0; m < 1440; m++) expect(slotForTime(slots, hhmm(m)).on).toBe(true)
    }
  })
  it('maps an inactive default slot to the nearest active one', () => {
    const slots = resolveSlots(undefined)
    expect(slotForTime(slots, '11:00').key).toBe('desayuno')
    expect(slotForTime(slots, '16:00').key).toBe('almuerzo')
    expect(slotForTime(slots, '23:30').key).toBe('cena')
  })
  it('custom times win, with the boundary at the midpoint and the later slot taking the midpoint', () => {
    const slots = resolveSlots([
      { key: 'desayuno', on: true, time: '07:00' },
      { key: 'almuerzo', on: true, time: '13:00' },
      { key: 'cena', on: true, time: '20:00' },
    ])
    const at = (t: string) => slotForTime(slots, t).key
    expect([at('07:00'), at('09:59'), at('10:00'), at('13:00'), at('16:29'), at('16:30'), at('20:00')]).toEqual([
      'desayuno', 'desayuno', 'almuerzo', 'almuerzo', 'almuerzo', 'cena', 'cena',
    ])
  })
  it('wraps around midnight between the last and the first time', () => {
    const slots = resolveSlots([
      { key: 'desayuno', on: true, time: '07:00' },
      { key: 'cena', on: true, time: '21:00' },
    ])
    const at = (t: string) => slotForTime(slots, t).key
    // the midpoint of 21:00 and 07:00 (next day) is 02:00
    expect([at('23:59'), at('00:00'), at('01:59'), at('02:00'), at('06:59')]).toEqual(['cena', 'cena', 'cena', 'desayuno', 'desayuno'])
  })
  it('places slots without a time among custom ones by their usual hour', () => {
    const slots = resolveSlots([
      { key: 'desayuno', on: true, time: '06:00' },
      { key: 'almuerzo', on: true },
      { key: 'cena', on: true, time: '22:00' },
    ])
    expect(slotForTime(slots, '13:00').key).toBe('almuerzo')
    expect(slotForTime(slots, '06:30').key).toBe('desayuno')
  })
  it('a single active slot gets every hour', () => {
    expect(slotForTime(resolveSlots([{ key: 'onces', on: true, time: '16:00' }]), '03:00').key).toBe('onces')
    expect(slotForTime(resolveSlots([{ key: 'onces', on: true }]), '03:00').key).toBe('onces')
  })
})

describe('settings reducer', () => {
  const start = () => resolveSlots(undefined)
  it('toggles a slot', () => {
    expect(on(toggleSlot(start(), 'onces'))).toEqual(['desayuno', 'almuerzo', 'onces', 'cena'])
    expect(on(toggleSlot(start(), 'cena'))).toEqual(['desayuno', 'almuerzo'])
  })
  it('refuses to turn off the last active slot', () => {
    expect(on(toggleSlot(resolveSlots([{ key: 'cena', on: true }]), 'cena'))).toEqual(['cena'])
  })
  it('renames, falls back to the default for an empty name and stores nothing for the default name', () => {
    let s = renameSlot(start(), 'cena', '  Comida de la noche  ')
    expect(s.find((x) => x.key === 'cena')).toMatchObject({ label: 'Comida de la noche', renamed: true })
    expect(toPrefs(s).find((x) => x.key === 'cena')).toMatchObject({ name: 'Comida de la noche' })
    s = renameSlot(s, 'cena', '')
    expect(s.find((x) => x.key === 'cena')).toMatchObject({ label: 'Cena', renamed: false })
    expect(toPrefs(renameSlot(start(), 'cena', 'Cena'))).toEqual(toPrefs(start()))
  })
  it('sets and clears a time and ignores an invalid one', () => {
    let s = setSlotTime(start(), 'almuerzo', '13:15')
    expect(s.find((x) => x.key === 'almuerzo')?.time).toBe('13:15')
    s = setSlotTime(s, 'almuerzo', null)
    expect(s.find((x) => x.key === 'almuerzo')?.time).toBeUndefined()
    expect(setSlotTime(start(), 'almuerzo', '99:99').find((x) => x.key === 'almuerzo')?.time).toBeUndefined()
  })
  it('moves up and down and stops at the ends', () => {
    expect(keys(moveSlot(start(), 'cena', -1)).slice(3, 5)).toEqual(['cena', 'onces'])
    expect(keys(moveSlot(start(), 'desayuno', -1))).toEqual(keys(start()))
    expect(keys(moveSlot(start(), 'otro', 1))).toEqual(keys(start()))
    expect(keys(moveSlot(start(), 'desayuno', 1)).slice(0, 2)).toEqual(['media_manana', 'desayuno'])
  })
  it('what is written survives a round trip through resolveSlots unchanged', () => {
    let s = renameSlot(start(), 'onces', 'Merienda')
    s = setSlotTime(toggleSlot(s, 'onces'), 'onces', '16:30')
    s = moveSlot(s, 'cena', -1)
    expect(resolveSlots(toPrefs(s))).toEqual(s)
  })
})
