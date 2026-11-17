import { expect, it } from 'vitest'
import { createDB } from '../../db/schema'
import { createProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { repeatMeal } from './repeatMeal'

it('repeats frozen snapshots atomically without copying ids or another profile rows', async () => {
  const db = createDB(`repeat-${crypto.randomUUID()}`)
  try {
    await db.open()
    const make = (name: string) => createProfile({ name, sex: 'female', birthDate: null, heightCm: null, activity: null, color: 'sky', settings: { addActivityKcal: false } }, db)
    const a = await make('Sintético A'), b = await make('Sintético B')
    const ra = repo(a.id, db), rb = repo(b.id, db)
    const snap = { foodRef: 'off:synthetic', name: 'Pan sintético', source: 'off' as const, qty: 2, unit: 'portion' as const, portionLabel: 'Tajada', grams: 50, ml: null, nutrients: { kcal: 125, protein: 4 }, missing: [], portionEquivalentAmount: 25 }
    const original = await ra.add('foodLogs', { ...snap, date: '2026-11-14', meal: 'desayuno' })
    await rb.add('foodLogs', { ...snap, date: '2026-11-14', meal: 'desayuno', nutrients: { kcal: 999 } })
    expect(await repeatMeal(ra, '2026-11-14', '2026-11-15', 'desayuno', 'almuerzo')).toBe(1)
    const [copy] = await ra.onDate('foodLogs', '2026-11-15')
    expect(copy).toMatchObject({ ...snap, meal: 'almuerzo', date: '2026-11-15' })
    expect(copy!.id).not.toBe(original.id)
    expect(await rb.count('foodLogs')).toBe(1)
    await expect(repeatMeal(ra, '2026-11-15', '2026-11-15', 'almuerzo')).rejects.toThrow(/duplicarla/)
    await expect(repeatMeal(ra, '2026-02-30', '2026-11-15', 'desayuno')).rejects.toThrow(/fecha/)
  } finally { await db.delete() }
})
