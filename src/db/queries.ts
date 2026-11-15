import type { Repo } from './repo'
import type { BodyMeasurement, Goal } from './types'

export function pickGoalForDate(goals: Goal[], date: string): Goal | null {
  let best: Goal | null = null
  for (const g of goals) {
    if (g.validFrom > date) continue
    if (!best || g.validFrom > best.validFrom || (g.validFrom === best.validFrom && g.createdAt > best.createdAt)) best = g
  }
  return best
}

export async function goalForDate(r: Repo, date: string): Promise<Goal | null> {
  return pickGoalForDate(await r.all('goals'), date)
}

/** Most recent measured body weight on or before `date` (approximate values only as a fallback). */
export async function latestWeight(r: Repo, date = '9999-12-31'): Promise<{ weightKg: number; date: string; approx: boolean } | null> {
  const rows = (await r.range('bodyMeasurements', '0000-01-01', date)).filter((m) => m.weightKg !== null)
  if (rows.length === 0) return null
  const sorted = rows.sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)))
  const exact = sorted.filter((m) => !m.approx)
  const pick: BodyMeasurement = (exact.length ? exact : sorted)[(exact.length ? exact : sorted).length - 1]
  return { weightKg: pick.weightKg as number, date: pick.date, approx: !!pick.approx }
}
