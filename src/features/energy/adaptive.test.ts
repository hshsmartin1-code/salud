import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile } from '../../db/profiles'
import { repo, type Repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { FoodLog, Goal, Profile } from '../../db/types'
import { addDays } from '../../domain/dates'
import { applyProposal, buildIntakeDays, formulaEstimate, loadAdaptiveState, resolveSettings } from './adaptive'

// Synthetic data only.
const TODAY = '2026-06-30'
let db: SaludDB
let n = 0

beforeEach(async () => {
  db = createDB(`adaptive-test-${Date.now()}-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

function log(date: string, kcal: number | undefined, extra: Partial<FoodLog> = {}): Omit<FoodLog, 'id' | 'profileId' | 'createdAt' | 'updatedAt'> {
  return {
    date,
    meal: 'almuerzo',
    foodRef: 'user:x',
    name: 'Comida de prueba',
    source: 'user',
    qty: 1,
    unit: 'portion',
    grams: null,
    ml: null,
    nutrients: kcal === undefined ? { protein: 10 } : { kcal, protein: 10 },
    missing: kcal === undefined ? ['kcal'] : [],
    ...extra,
  } as Omit<FoodLog, 'id' | 'profileId' | 'createdAt' | 'updatedAt'>
}

function goalRow(kcal: number, extra: Partial<Goal> = {}): Omit<Goal, 'id' | 'profileId' | 'createdAt' | 'updatedAt'> {
  return {
    validFrom: '2026-04-01',
    goal: 'lose',
    method: 'calculated',
    kcal,
    protein: 150,
    carbs: 250,
    fat: 70,
    fiber: 30,
    inputs: null,
    methodText: 'Prueba',
    warnings: [],
    targetWeightKg: null,
    ...extra,
  }
}

async function mkProfile(name: string, adaptive?: Profile['settings']['adaptive']): Promise<[Profile, Repo]> {
  const p = await createProfile(
    { name, sex: 'male', birthDate: '1990-01-01', heightCm: 178, activity: 'moderate', color: 'emerald', settings: { addActivityKcal: false, adaptive } },
    db,
  )
  return [p, repo(p.id, db)]
}

/** 56 days: steady 2400 kcal/day and a 0,35 kg/week loss → observed TDEE ≈ 2400 + 0,05·7700 ≈ 2785. */
async function seedSteadyLoss(r: Repo) {
  for (let i = 56; i >= 1; i--) {
    const date = addDays(TODAY, -i)
    await r.add('foodLogs', log(date, 1200))
    await r.add('foodLogs', log(date, 1200))
    const day = 56 - i
    await r.add('bodyMeasurements', { date, weightKg: 85 - (0.35 / 7) * day, circumferences: {}, skinfolds: {}, protocol: null, derived: null })
  }
}

describe('buildIntakeDays', () => {
  it('sums logs per day, flags partial days, applies marks and never double counts Phase 0 totals', () => {
    const now = '2026-01-01T00:00:00Z'
    const base = { id: 'x', profileId: 'p', createdAt: now, updatedAt: now }
    const days = buildIntakeDays(
      [
        { ...base, ...log('2026-05-01', 800) },
        { ...base, ...log('2026-05-01', 900) },
        { ...base, ...log('2026-05-02', undefined) },
        { ...base, ...log('2026-05-02', 1500) },
      ] as FoodLog[],
      [
        { ...base, date: '2026-05-01', metric: 'kcal_intake', value: 3000, valueText: null, unit: 'kcal', label: 'Ingesta' },
        { ...base, date: '2026-05-03', metric: 'kcal_intake', value: 2100, valueText: null, unit: 'kcal', label: 'Ingesta' },
        { ...base, date: '2026-05-04', metric: 'kcal_intake', value: 1800, valueText: null, unit: 'kcal', label: 'Ingesta', excludeFromStats: true },
      ],
      [{ ...base, date: '2026-05-02', complete: true }],
    )
    expect(days).toEqual([
      { date: '2026-05-01', kcal: 1700, entries: 2, partial: false, complete: null },
      { date: '2026-05-02', kcal: 1500, entries: 2, partial: true, complete: true },
      { date: '2026-05-03', kcal: 2100, entries: 1, partial: false, complete: null },
    ])
  })
})

describe('settings and formula', () => {
  it('is off by default, with phase and rate derived from the goal', () => {
    const s = resolveSettings({ ...goalRow(2200), id: 'g', profileId: 'p', createdAt: '', updatedAt: '' }, undefined)
    expect(s.mode).toBe('off')
    expect(s.phase).toBe('deficit')
    expect(s.targetRatePctPerWeek).toBe(-0.5)
  })
  it('stored choices win and unsafe rates are clamped', () => {
    const s = resolveSettings(null, { mode: 'suggest', phase: 'deficit', targetRatePctPerWeek: -3, maxStepKcal: 100 })
    expect(s.mode).toBe('suggest')
    expect(s.targetRatePctPerWeek).toBe(-1)
    expect(s.maxStepKcal).toBe(100)
  })
  it('lists what is missing instead of guessing', () => {
    const p = { sex: 'female', birthDate: null, heightCm: null, activity: null } as unknown as Profile
    const { formula, missing } = formulaEstimate(p, null, null, TODAY)
    expect(formula).toBeNull()
    expect(missing).toEqual(['un peso registrado', 'la estatura', 'la fecha de nacimiento', 'el nivel de actividad'])
  })
})

describe('loadAdaptiveState + applyProposal', () => {
  it('estimates from the active profile only: the other profile sees no data', async () => {
    const [, ra] = await mkProfile('Perfil Uno', { mode: 'suggest', phase: 'deficit', targetRatePctPerWeek: -0.5 })
    const [pb, rb] = await mkProfile('Perfil Dos', { mode: 'suggest', phase: 'deficit', targetRatePctPerWeek: -0.5 })
    await seedSteadyLoss(ra)
    await rb.add('goals', goalRow(2000))
    await rb.add('bodyMeasurements', { date: addDays(TODAY, -2), weightKg: 60, circumferences: {}, skinfolds: {}, protocol: null, derived: null })

    const pa = (await db.profiles.get(ra.profileId))!
    await ra.add('goals', goalRow(2300))
    const a = await loadAdaptiveState(ra, pa, TODAY)
    expect(a.observed?.status).toBe('ok')
    expect(a.observed!.observedTdee!).toBeGreaterThan(2650)
    expect(a.observed!.observedTdee!).toBeLessThan(2900)

    const b = await loadAdaptiveState(rb, pb, TODAY)
    expect(b.observed?.status).toBe('insufficient')
    expect(b.observed?.validIntakeDays).toBe(0)
  })

  it('suggests, applies on acceptance (carbs absorb the change) and then waits for the cooldown', async () => {
    const [p, r] = await mkProfile('Perfil Uno', { mode: 'suggest', phase: 'deficit', targetRatePctPerWeek: -0.5 })
    await seedSteadyLoss(r)
    await r.add('goals', goalRow(2000))
    const s = await loadAdaptiveState(r, p, TODAY)
    expect(s.proposal?.status).toBe('suggest')
    expect(s.proposal!.deltaKcal).toBe(150) // step limit: raw target ≈ 2785 − 85·0,005·7700/7 ≈ 2320
    expect(s.proposal!.limitedBy).toContain('step')
    expect(s.proposal!.explanation).toMatch(/no una medición exacta/)

    const g = await applyProposal(r, s, 'accepted')
    expect(g).not.toBeNull()
    expect(g!.kcal).toBe(2150)
    expect(g!.carbs).toBe(250 + Math.round(150 / 4))
    expect(g!.protein).toBe(150)
    expect(g!.fat).toBe(70)
    expect(g!.adaptive).toBe(true)
    expect(g!.validFrom).toBe(TODAY)
    const adj = await r.all('energyAdjustments')
    expect(adj).toHaveLength(1)
    expect(adj[0]).toMatchObject({ fromKcal: 2000, toKcal: 2150, applied: 'accepted', goalId: g!.id, phase: 'deficit' })

    const again = await loadAdaptiveState(r, p, TODAY)
    expect(again.goal?.id).toBe(g!.id)
    expect(again.proposal?.status).toBe('cooldown')
    expect(await applyProposal(r, again, 'accepted')).toBeNull()
  })

  it('never changes a manual goal on its own and respects "off"', async () => {
    const [p, r] = await mkProfile('Perfil Uno', { mode: 'auto', phase: 'deficit', targetRatePctPerWeek: -0.5 })
    await seedSteadyLoss(r)
    await r.add('goals', goalRow(2000, { method: 'manual' }))
    const s = await loadAdaptiveState(r, p, TODAY)
    expect(s.proposal?.status).toBe('manual_locked')
    expect(await applyProposal(r, s, 'auto')).toBeNull()

    const off = await loadAdaptiveState(r, { ...p, settings: { addActivityKcal: false } }, TODAY)
    expect(off.settings.mode).toBe('off')
    expect(off.proposal?.status).toBe('disabled')
  })

  it('a goal the person just set restarts the waiting period', async () => {
    const [p, r] = await mkProfile('Perfil Uno', { mode: 'suggest', phase: 'deficit', targetRatePctPerWeek: -0.5 })
    await seedSteadyLoss(r)
    await r.add('goals', goalRow(2000, { validFrom: addDays(TODAY, -3) }))
    const s = await loadAdaptiveState(r, p, TODAY)
    expect(s.proposal?.status).toBe('cooldown')
  })

  it('days marked incomplete are excluded', async () => {
    const [p, r] = await mkProfile('Perfil Uno', { mode: 'suggest', phase: 'deficit', targetRatePctPerWeek: -0.5 })
    await seedSteadyLoss(r)
    await r.add('goals', goalRow(2000))
    for (let i = 1; i <= 5; i++) await r.add('dayMarks', { date: addDays(TODAY, -i), complete: false })
    const s = await loadAdaptiveState(r, p, TODAY)
    expect(s.observed?.excludedIntakeDays).toHaveLength(5)
    expect(s.observed?.validIntakeDays).toBe(23)
  })
})
