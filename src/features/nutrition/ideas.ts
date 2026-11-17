import type { FoodLog, FoodSnapshot, MealKey } from '../../db/types'
import { addDays } from '../../domain/dates'
import { sumNutrients } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'
import { lastLogByFood, newestFirst } from './suggestions'

/**
 * "Ideas para lo que falta": pure arithmetic on the person's own targets and the person's own habits. A food is
 * a candidate only when real history backs it (see `MIN_HISTORY_DAYS`, `MIN_FOOD_LOGS`, `MIN_MEAL_LOGS`) at its usual
 * quantity (the frozen snapshot a quick add would copy). There is no catalog fallback: a new profile gets no ideas.
 * No health claims, no food labels: numbers only.
 */

/** Days of history read for candidates (a food must have been logged `MIN_FOOD_LOGS` times inside it). */
export const IDEAS_HISTORY_DAYS = 60
/** Ideas appear only when the person logged on at least this many distinct days... */
export const MIN_HISTORY_DAYS = 7
/** ...inside the last this many days. */
export const HISTORY_RECENT_DAYS = 30
/** A food qualifies only if logged (on distinct days) at least this many times in the last `IDEAS_HISTORY_DAYS` days... */
export const MIN_FOOD_LOGS = 3
/** ...and at least this many times in the planned meal. */
export const MIN_MEAL_LOGS = 2
/** Ideas shown by default. */
export const IDEAS_LIMIT = 3
/** No ideas below this much energy left (kcal). */
export const MIN_KCAL_LEFT = 150
/** Ideas need at least this much protein left (g)... (and with it, protein is the main gap) */
export const MIN_PROTEIN_LEFT = 15
/** ...or at least this share of the energy target left. */
export const MIN_KCAL_SHARE_LEFT = 0.25
/** Fibre is the main gap (when protein is not) only with at least this much left (g). */
export const MIN_FIBER_LEFT = 8
/** A candidate that would exceed the energy left by more than this share is excluded. */
export const KCAL_OVER_TOLERANCE = 0.1
/** Score multiplier for a candidate that exceeds the energy left, within the tolerance. */
export const KCAL_OVER_PENALTY = 0.5
/** A candidate that would push fat or carbohydrate past its own target by more than this share... */
export const MACRO_OVER_TOLERANCE = 0.1
/** ...has its score multiplied by this, once per nutrient. */
export const MACRO_OVER_PENALTY = 0.5
/** A candidate must close at least this share of a protein gap... */
export const MIN_GAP_SHARE_PROTEIN = 0.15
/** ...or of a fibre gap (otherwise it does not address it). */
export const MIN_GAP_SHARE = 0.05
/** With a protein gap, a food needs at least this many grams of protein per 100 kcal to qualify. */
export const MIN_PROTEIN_PER_100KCAL = 5

export type GapNutrient = 'protein' | 'carbs' | 'fat' | 'fiber'
/** Fat and carbohydrate are never the main gap: they only constrain (over-target penalties). */
export type MainGap = 'protein' | 'fiber' | 'kcal'

/** The day's targets. Only nutrients with a target are considered; `kcal` is required for any idea. */
export interface IdeaTargets {
  kcal: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fiber?: number | null
}

export interface IdeasInput {
  /** The diary date (YYYY-MM-DD). */
  date: string
  targets: IdeaTargets | null
  /** Everything logged on `date` (all meals). */
  today: readonly FoodLog[]
  /** The meal being planned, or null. */
  meal: MealKey | null
  /** The person's logs (any range: only the `IDEAS_HISTORY_DAYS` up to `date` are read). */
  history: readonly FoodLog[]
  /** The day is marked complete → no ideas. */
  dayComplete?: boolean
  limit?: number
}

export interface DayGap {
  /** Energy left (kcal), against the kcal target. */
  kcal: number
  /** Left per nutrient that has a target (negative = over). */
  left: Partial<Record<GapNutrient, number>>
  main: MainGap
}

export interface FoodIdea {
  key: string
  foodRef: string
  name: string
  /** The exact frozen snapshot one tap logs. */
  snapshot: FoodSnapshot
  kcal: number
  protein: number | undefined
  carbs: number | undefined
  fat: number | undefined
  fiber: number | undefined
  /** Factual phrase from numbers, e.g. "+32 g de proteína · 180 kcal". */
  reason: string
  score: number
}

export interface IdeasResult {
  gap: DayGap | null
  ideas: FoodIdea[]
  /** Distinct days with logs in the last `HISTORY_RECENT_DAYS` days (up to the diary date). */
  historyDays: number
  /** Too little history for any idea: the screens say so in one muted line instead of showing a card. */
  needsHistory: boolean
}

const NAME_ES: Record<GapNutrient, string> = { protein: 'proteína', carbs: 'carbohidratos', fat: 'grasa', fiber: 'fibra' }
const PRIORITY: GapNutrient[] = ['protein', 'carbs', 'fat', 'fiber']

const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/** Accent- and case-insensitive name, so the same base food under two refs counts once. */
export function baseFoodKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What is left of the day and the main gap, or null when the rules give no ideas: no kcal target, fewer
 * than `MIN_KCAL_LEFT` kcal left, or neither `MIN_PROTEIN_LEFT` g of protein nor `MIN_KCAL_SHARE_LEFT` of
 * the energy target left. The main gap is decided by priority: protein (≥ `MIN_PROTEIN_LEFT` g left),
 * else fibre (≥ `MIN_FIBER_LEFT` g left), else energy.
 */
export function dayGap(targets: IdeaTargets | null, today: readonly FoodLog[]): DayGap | null {
  if (!targets || !positive(targets.kcal)) return null
  const { totals } = sumNutrients([...today])
  const kcal = targets.kcal - (totals.kcal ?? 0)
  if (kcal < MIN_KCAL_LEFT) return null
  const left: Partial<Record<GapNutrient, number>> = {}
  for (const n of PRIORITY) {
    const t = targets[n]
    if (positive(t)) left[n] = t - (totals[n] ?? 0)
  }
  const proteinOk = left.protein !== undefined && left.protein >= MIN_PROTEIN_LEFT
  if (!proteinOk && kcal < MIN_KCAL_SHARE_LEFT * targets.kcal) return null
  const main: MainGap = proteinOk ? 'protein' : left.fiber !== undefined && left.fiber >= MIN_FIBER_LEFT ? 'fiber' : 'kcal'
  return { kcal, left, main }
}

/** "Te faltan 61 g de proteína y 1.075 kcal" / "Te quedan 1.075 kcal" (rounded like the day summary). */
export function describeGap(gap: DayGap): string {
  const kcal = `${formatNumber(gap.kcal, 0)} kcal`
  if (gap.main === 'kcal') return `Te quedan ${kcal}`
  return `Te faltan ${formatNumber(gap.left[gap.main] ?? 0, 0)} g de ${NAME_ES[gap.main]} y ${kcal}`
}

function reasonFor(main: MainGap, snap: FoodSnapshot): string {
  const kcal = `${formatNumber(snap.nutrients.kcal ?? 0, 0)} kcal`
  if (main === 'kcal') return kcal
  return `+${formatNumber(snap.nutrients[main] ?? 0, 0)} g de ${NAME_ES[main]} · ${kcal}`
}

interface Candidate {
  snapshot: FoodSnapshot
  /** Date of the newest log of the food. */
  lastDate: string
  newest?: FoodLog
}

/** Score of one candidate, or null when the rules exclude it. */
function scoreOf(c: Candidate, gap: DayGap, targets: IdeaTargets, consumed: Partial<Record<GapNutrient, number>>): number | null {
  const n = c.snapshot.nutrients
  const kcal = n.kcal
  if (kcal === undefined || !(kcal > 0)) return null
  if (kcal > gap.kcal * (1 + KCAL_OVER_TOLERANCE)) return null
  let score: number
  if (gap.main === 'protein') {
    const need = gap.left.protein as number
    const protein = n.protein ?? 0
    const density = (protein / kcal) * 100
    if (density < MIN_PROTEIN_PER_100KCAL) return null
    if (Math.min(protein, need) / need < MIN_GAP_SHARE_PROTEIN) return null
    // Grams of protein per 100 kcal.
    score = density
  } else {
    let closes: number
    if (gap.main === 'kcal') closes = Math.min(kcal, gap.kcal) / gap.kcal
    else {
      const need = gap.left.fiber as number
      closes = Math.min(n.fiber ?? 0, need) / need
      if (closes < MIN_GAP_SHARE) return null
    }
    // Share of the main gap closed per share of the remaining energy used.
    score = closes / (kcal / gap.kcal)
  }
  if (kcal > gap.kcal) score *= KCAL_OVER_PENALTY
  for (const m of ['fat', 'carbs'] as const) {
    const t = targets[m]
    if (!positive(t)) continue
    if ((consumed[m] ?? 0) + (n[m] ?? 0) > t * (1 + MACRO_OVER_TOLERANCE)) score *= MACRO_OVER_PENALTY
  }
  return round4(score)
}

function toIdea(c: Candidate, score: number, main: MainGap): FoodIdea {
  const n = c.snapshot.nutrients
  return {
    key: `history:${c.snapshot.foodRef}`,
    foodRef: c.snapshot.foodRef,
    name: c.snapshot.name,
    snapshot: c.snapshot,
    kcal: n.kcal ?? 0,
    protein: n.protein,
    carbs: n.carbs,
    fat: n.fat,
    fiber: n.fiber,
    reason: reasonFor(main, c.snapshot),
    score,
  }
}

/** Newest log of each food in the window: the quick-add pick (`lastLogByFood`) when a meal is given. */
function usualSnapshots(window: readonly FoodLog[], meal: MealKey | null): Map<string, FoodLog> {
  if (meal) return lastLogByFood(window, meal)
  const best = new Map<string, FoodLog>()
  for (const l of window) {
    const cur = best.get(l.foodRef)
    if (!cur || newestFirst(l, cur) < 0) best.set(l.foodRef, l)
  }
  return best
}

/** Distinct days with at least one log in the `HISTORY_RECENT_DAYS` days up to `date`. */
export function recentLogDays(history: readonly FoodLog[], date: string): number {
  const from = addDays(date, -HISTORY_RECENT_DAYS)
  return new Set(history.filter((l) => l.date >= from && l.date <= date).map((l) => l.date)).size
}

/** Up to `limit` ranked ideas for what is left of the day (see the constants above for every rule). */
export function foodIdeas(input: IdeasInput): IdeasResult {
  const limit = input.limit ?? IDEAS_LIMIT
  const historyDays = recentLogDays(input.history, input.date)
  const needsHistory = historyDays < MIN_HISTORY_DAYS
  const none: IdeasResult = { gap: null, ideas: [], historyDays, needsHistory }
  if (input.dayComplete || needsHistory) return none
  const gap = dayGap(input.targets, input.today)
  if (!gap || !input.targets) return none
  const targets = input.targets
  const { totals } = sumNutrients([...input.today])
  const consumed: Partial<Record<GapNutrient, number>> = { fat: totals.fat, carbs: totals.carbs }

  const loggedHere = input.today.filter((l) => input.meal === null || l.meal === input.meal)
  const skipRefs = new Set(loggedHere.map((l) => l.foodRef))
  const skipBases = new Set(loggedHere.map((l) => baseFoodKey(l.name)))

  const from = addDays(input.date, -IDEAS_HISTORY_DAYS)
  const window = input.history.filter((l) => l.date >= from && l.date <= input.date)
  // A habit is a repetition on distinct days, not several entries of one day.
  const daysOf = (pred: (l: FoodLog) => boolean) => {
    const m = new Map<string, Set<string>>()
    for (const l of window) if (pred(l)) m.set(l.foodRef, (m.get(l.foodRef) ?? new Set()).add(l.date))
    return m
  }
  const anyMeal = daysOf(() => true)
  const inMeal = daysOf((l) => input.meal === null || l.meal === input.meal)
  const usual = usualSnapshots(window, input.meal)
  const newestOf = new Map<string, FoodLog>()
  for (const l of window) {
    const cur = newestOf.get(l.foodRef)
    if (!cur || newestFirst(l, cur) < 0) newestOf.set(l.foodRef, l)
  }

  type Scored = { c: Candidate; score: number }
  const rank = (a: Scored, b: Scored) =>
    b.score - a.score ||
    b.c.lastDate.localeCompare(a.c.lastDate) ||
    (a.c.newest && b.c.newest ? newestFirst(a.c.newest, b.c.newest) : 0) ||
    a.c.snapshot.foodRef.localeCompare(b.c.snapshot.foodRef)

  const history: Scored[] = []
  for (const [ref, log] of usual) {
    if (skipRefs.has(ref) || skipBases.has(baseFoodKey(log.name))) continue
    if ((anyMeal.get(ref)?.size ?? 0) < MIN_FOOD_LOGS || (inMeal.get(ref)?.size ?? 0) < MIN_MEAL_LOGS) continue
    const newest = newestOf.get(ref) ?? log
    const c: Candidate = { snapshot: log, lastDate: newest.date, newest }
    const score = scoreOf(c, gap, targets, consumed)
    if (score !== null) history.push({ c, score })
  }
  history.sort(rank)

  const out: FoodIdea[] = []
  const usedBases = new Set<string>()
  for (const { c, score } of history) {
    if (out.length >= limit) break
    const base = baseFoodKey(c.snapshot.name)
    if (usedBases.has(base)) continue
    usedBases.add(base)
    out.push(toIdea(c, score, gap.main))
  }
  return { gap, ideas: out, historyDays, needsHistory }
}
