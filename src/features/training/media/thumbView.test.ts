import { describe, expect, it } from 'vitest'
import exercises from '../../../../public/data/exercises.json'
import { FIGURE } from '../muscleFigure'
import { MUSCLE_IDS } from '../muscles'
import { REGION_CROP, thumbView, visibleIn } from './thumbView'

const role = (v: ReturnType<typeof thumbView>, m: string) => v.highlights.find((h) => h.muscleId === m)?.role

describe('thumbView', () => {
  it('chooses a region for each muscle family', () => {
    expect(thumbView(['chest'], []).region).toBe('front-upper')
    expect(thumbView(['biceps'], []).region).toBe('front-upper')
    expect(thumbView(['abdominals'], []).region).toBe('front-core')
    expect(thumbView(['lats'], []).region).toBe('back-upper')
    expect(thumbView(['traps'], []).view).toBe('back')
    expect(thumbView(['triceps'], []).region).toBe('back-upper')
    expect(thumbView(['lower back'], []).region).toBe('back-lumbar')
    expect(thumbView(['quadriceps'], []).region).toBe('front-legs')
    expect(thumbView(['adductors'], []).region).toBe('front-legs')
    expect(thumbView(['glutes'], []).region).toBe('back-legs')
    expect(thumbView(['hamstrings'], []).region).toBe('back-legs')
    expect(thumbView(['calves'], []).region).toBe('back-calves')
    expect(thumbView(['forearms'], []).region).toBe('front-arms')
  })
  it('highlights primary muscles as primary and the others as secondary, never twice', () => {
    const v = thumbView(['chest'], ['triceps', 'shoulders', 'chest'])
    expect(role(v, 'chest')).toBe('primary')
    expect(role(v, 'shoulders')).toBe('secondary')
    expect(role(v, 'triceps')).toBe('secondary')
    // lats exist only on the back view: not drawn in the chest window
    expect(role(thumbView(['chest'], ['lats']), 'lats')).toBeUndefined()
    expect(v.highlights.filter((h) => h.muscleId === 'chest')).toHaveLength(1)
  })
  it('the majority region wins and the first listed muscle breaks ties', () => {
    expect(thumbView(['lats', 'middle back', 'biceps'], []).view).toBe('back')
    expect(thumbView(['biceps', 'lats'], []).view).toBe('front')
    expect(thumbView(['lats', 'biceps'], []).view).toBe('back')
  })
  it('puts the shoulders on the back only for rear-delt work', () => {
    expect(thumbView(['shoulders'], ['triceps']).region).toBe('front-upper')
    expect(thumbView(['shoulders'], ['middle back', 'traps']).region).toBe('back-upper')
    expect(thumbView(['shoulders'], ['middle back', 'chest']).region).toBe('front-upper')
    expect(thumbView(['shoulders', 'middle back'], []).region).toBe('back-upper')
  })
  it('falls back to secondary muscles, drawn as secondary, when nothing is primary', () => {
    const v = thumbView([], ['hamstrings'])
    expect(v.region).toBe('back-legs')
    expect(role(v, 'hamstrings')).toBe('secondary')
  })
  it('shows the whole neutral figure without usable muscle data', () => {
    for (const v of [thumbView([], []), thumbView(undefined, undefined), thumbView(['unknown muscle'], ['nope'])]) {
      expect(v.region).toBe('whole')
      expect(v.highlights).toEqual([])
      expect(v.crop).toEqual(REGION_CROP.whole)
    }
  })
  it('only highlights regions that exist in the chosen view and fall inside the window', () => {
    for (const e of exercises.exercises) {
      const v = thumbView(e.primaryMuscles, e.secondaryMuscles)
      for (const h of v.highlights) {
        expect(FIGURE[v.view].shapes.some((s) => s.muscleId === h.muscleId), `${e.id} ${h.muscleId}`).toBe(true)
        expect(visibleIn(v.view, h.muscleId, v.crop)).toBe(true)
      }
    }
  })
  it('every catalog exercise with primary muscles gets at least one primary highlight', () => {
    const missing = exercises.exercises.filter((e) => e.primaryMuscles.length && !thumbView(e.primaryMuscles, e.secondaryMuscles).highlights.some((h) => h.role === 'primary'))
    expect(missing.map((e) => e.id)).toEqual([])
  })
  it('crops are square windows and every muscle id has a home region', () => {
    for (const c of Object.values(REGION_CROP)) expect(c.w).toBe(c.h)
    for (const id of MUSCLE_IDS) expect(thumbView([id], []).highlights.length, id).toBeGreaterThan(0)
  })
})
