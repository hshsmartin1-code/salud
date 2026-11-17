import { NUTRIENTS, type NutrientCode } from '../../db/catalogTypes'
import type { FoodLog } from '../../db/types'

const ES = Object.fromEntries(NUTRIENTS.map((n) => [n.code, n.es])) as Record<NutrientCode, string>

/** Spanish name of a nutrient, lower case ("proteína"). */
export const nutrientName = (code: string): string => (ES[code as NutrientCode] ?? code).toLowerCase()

export interface IncompleteFood {
  id: string
  name: string
  missing: NutrientCode[]
}

/** The logs with at least one core nutrient unknown, in the order of the day. */
export function incompleteFoods(logs: readonly Pick<FoodLog, 'id' | 'name' | 'missing'>[]): IncompleteFood[] {
  return logs.filter((l) => l.missing.length > 0).map((l) => ({ id: l.id, name: l.name, missing: [...l.missing] }))
}

/** "3 alimentos con datos incompletos" / "1 alimento con datos incompletos". */
export function incompleteHeadline(count: number): string {
  return `${count} ${count === 1 ? 'alimento' : 'alimentos'} con datos incompletos`
}

/** "proteína, fibra y sodio". */
export function nutrientList(codes: readonly string[]): string {
  const names = codes.map(nutrientName)
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

const isKnown = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)

/** Names of the foods (one entry per distinct name, in the order of the day) that give no value for `code`. */
export function foodsLacking(logs: readonly Pick<FoodLog, 'name' | 'nutrients'>[], code: NutrientCode): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of logs) {
    if (isKnown(l.nutrients[code]) || seen.has(l.name)) continue
    seen.add(l.name)
    out.push(l.name)
  }
  return out
}

/** The one sentence a partial total explains itself with ("fibra dietaria" → «…no informan fibra dietaria…»). */
export function partialSentence(code: NutrientCode): string {
  return `Algunos alimentos no informan ${nutrientName(code)}, así que este total puede ser mayor.`
}
