import { afterEach, beforeEach, expect, it } from 'vitest'
import { importBackup, parseBackup } from '../../db/backup'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import { sumNutrients } from '../../domain/nutrients'
import { buildDemoBackup } from '../../test/seed/demoSeed'

/**
 * Precision guard. GOLDEN values were computed from the demo seed BEFORE any V3 nutrition UI change
 * and hard-coded here. Any UI work (suggestions, one-tap copies, search) must leave them identical.
 */
const TODAY = '2026-11-15'
const GOLDEN: Record<string, { n: number; kcal?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; partial: string[] }> = {
  '2026-11-15': { n: 7, kcal: 1289.2, protein: 91.2, carbs: 162.7, fat: 31.2, fiber: 19.1, partial: [] },
  '2026-11-14': { n: 11, kcal: 2046.7, protein: 110.3, carbs: 223.9, fat: 83.8, fiber: 36.3, partial: [] },
  '2026-11-10': { n: 9, kcal: 1471.6, protein: 86.2, carbs: 226.7, fat: 26.3, fiber: 22.1, partial: [] },
  '2026-10-30': { n: 9, kcal: 1561.7, protein: 94, carbs: 210.2, fat: 40.7, fiber: 16.3, partial: ['fiber', 'satFat', 'sodium', 'sugars'] },
  '2026-10-12': { n: 8, kcal: 1326.9, protein: 52.7, carbs: 173.9, fat: 52.3, fiber: 21.8, partial: ['fiber', 'satFat', 'sodium', 'sugars'] },
  '2026-09-20': { n: 0, partial: [] },
}
let db: SaludDB
beforeEach(async () => { db = createDB(`golden-${crypto.randomUUID()}`); await db.open() })
afterEach(async () => { await db.delete() })

it('day totals and partial nutrients of the demo seed match the golden values', async () => {
  const backup = parseBackup(JSON.stringify(buildDemoBackup(TODAY)))
  await importBackup(backup, { mode: 'replace', mapping: { [backup.profiles[0]!.id]: 'new' } }, db)
  const pid = (await db.profiles.toArray())[0]!.id
  const r = repo(pid, db)
  for (const [date, g] of Object.entries(GOLDEN)) {
    const logs = await r.onDate('foodLogs', date)
    const { totals, partial } = sumNutrients(logs)
    expect(logs.length, `${date} rows`).toBe(g.n)
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const) {
      if (g[k] === undefined) expect(totals[k], `${date} ${k}`).toBeUndefined()
      else expect(totals[k]!, `${date} ${k}`).toBeCloseTo(g[k]!, 1)
    }
    expect([...partial].sort(), `${date} partial`).toEqual(g.partial)
  }
})
