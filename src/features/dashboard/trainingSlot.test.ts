import { describe, expect, it } from 'vitest'
import type { Routine } from '../../db/types'
import type { StartSuggestion } from '../training/plan/startSuggestion'
import { shortDate, slotPosition, trainingSlot } from './trainingSlot'

const rt = (id: string, name: string) => ({ id, name, archived: false }) as Routine
const upper = rt('u', 'Upper A')
const lower = rt('l', 'Lower A')
const habitualS: StartSuggestion = { kind: 'habitual', routine: upper, habitual: upper, hasPlan: false }
const plannedS: StartSuggestion = { kind: 'planned', routine: lower, habitual: upper, hasPlan: true }
const daysOnlyS: StartSuggestion = { kind: 'planned', routine: null, habitual: upper, hasPlan: true }
const base = { active: false, suggestion: habitualS, doneToday: null, next: null }

describe('trainingSlot', () => {
  it('a session in progress renders nothing on Hoy (the shell shows its bar), whatever else is true', () => {
    expect(trainingSlot({ ...base, active: true, suggestion: plannedS })).toEqual({ kind: 'active' })
    expect(slotPosition({ kind: 'active' })).toBe('none')
  })
  it('planned today and not done: the top card with the planned routine', () => {
    const s = trainingSlot({ ...base, suggestion: plannedS })
    expect(s).toMatchObject({ kind: 'due', title: 'Lower A', detail: null })
    expect(s.kind === 'due' && s.routine?.id).toBe('l')
    expect(slotPosition(s)).toBe('top')
  })
  it('days-only plan: «Entrenamiento de hoy» that starts the habitual routine', () => {
    const s = trainingSlot({ ...base, suggestion: daysOnlyS })
    expect(s).toMatchObject({ kind: 'due', title: 'Entrenamiento de hoy', detail: 'Upper A' })
    expect(s.kind === 'due' && s.routine?.id).toBe('u')
  })
  it('days-only plan with no routines at all: a free session, no detail', () => {
    const s = trainingSlot({ ...base, suggestion: { ...daysOnlyS, habitual: null } })
    expect(s).toMatchObject({ kind: 'due', title: 'Entrenamiento de hoy', routine: null, detail: null })
  })
  it('a finished session today: the quiet «hecho» row at the end, with or without a plan', () => {
    for (const suggestion of [habitualS, { ...habitualS, hasPlan: true }]) {
      const s = trainingSlot({ ...base, suggestion, doneToday: { id: 's1', name: 'Upper A' }, next: { date: '2026-11-19', routine: lower } })
      expect(s).toEqual({ kind: 'done', sessionId: 's1', name: 'Upper A' })
      expect(slotPosition(s)).toBe('end')
    }
  })
  it('a rest day with a plan: the next session as a quiet row', () => {
    const s = trainingSlot({ ...base, suggestion: { ...habitualS, hasPlan: true }, next: { date: '2026-11-19', routine: lower } })
    expect(s).toEqual({ kind: 'next', text: 'Próxima sesión: jue 19 · Lower A' })
    expect(trainingSlot({ ...base, next: { date: '2026-11-20', routine: null } })).toEqual({ kind: 'next', text: 'Próxima sesión: vie 20' })
  })
  it('no plan, or nothing planned soon: «Ir a Entreno», never a routine', () => {
    const s = trainingSlot(base)
    expect(s).toEqual({ kind: 'go' })
    expect(slotPosition(s)).toBe('end')
  })
  it('shortDate', () => {
    expect(shortDate('2026-11-22')).toBe('dom 22')
    expect(shortDate('2026-12-01')).toBe('mar 1')
  })
})
