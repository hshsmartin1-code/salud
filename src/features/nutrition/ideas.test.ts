import { describe, expect, it } from 'vitest'
import type { FoodLog, MealKey } from '../../db/types'
import type { NutrientMap } from '../../db/catalogTypes'
import {
  dayGap,
  describeGap,
  foodIdeas,
  HISTORY_RECENT_DAYS,
  IDEAS_HISTORY_DAYS,
  MIN_FOOD_LOGS,
  MIN_HISTORY_DAYS,
  MIN_MEAL_LOGS,
  recentLogDays,
  type IdeaTargets,
  type IdeasInput,
} from './ideas'
import { lastLogByFood } from './suggestions'

const D = '2026-11-15'
const T: IdeaTargets = { kcal: 2000, protein: 120, carbs: 250, fat: 65, fiber: 30 }

let n = 0
function log(foodRef: string, date: string, meal: MealKey, nutrients: NutrientMap, over: Partial<FoodLog> = {}): FoodLog {
  n++
  return {
    id: `l${n}`, profileId: 'p', createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`, updatedAt: '',
    foodRef, name: foodRef, source: 'usda_sr', qty: 100, unit: 'g', grams: 100, ml: null, nutrients, missing: [],
    date, meal, time: null, ...over,
  } as FoodLog
}
const POLLO: NutrientMap = { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 }
const ARROZ: NutrientMap = { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 }
const YOGUR: NutrientMap = { kcal: 100, protein: 17, carbs: 6, fat: 0.7, fiber: 0 }
const ALMENDRAS: NutrientMap = { kcal: 145, protein: 5.3, carbs: 5.4, fat: 12.5, fiber: 3.1 }
const LENTEJA: NutrientMap = { kcal: 232, protein: 18, carbs: 40, fat: 0.8, fiber: 15.8 }

/** The days a habit is logged on (newest first): 3 distinct days, all inside the last 30. */
const HABIT_DATES = ['2026-11-14', '2026-11-12', '2026-11-10']
/** A food logged `dates.length` times in `meal`: a habit that qualifies for ideas in that meal. */
const habit = (ref: string, meal: MealKey, nutrients: NutrientMap, over: Partial<FoodLog> = {}, dates: string[] = HABIT_DATES): FoodLog[] => dates.map((d) => log(ref, d, meal, nutrients, over))
/** Enough distinct days of history (8 days of zero-energy filler food, which is never an idea itself). */
const FILLER = ['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'].map((d) => log('filler', d, 'otro', { kcal: 0 }))
const H = (...groups: (FoodLog | FoodLog[])[]): FoodLog[] => [...groups.flat(), ...FILLER.map((l, i) => ({ ...l, id: `f${i}` }))]

/** Breakfast logged today: 600 kcal, 20 g protein, 90 g carbs, 15 g fat, 10 g fibre. */
const breakfast = (meal: MealKey = 'desayuno') => log('desayuno-x', D, meal, { kcal: 600, protein: 20, carbs: 90, fat: 15, fiber: 10 })

function input(over: Partial<IdeasInput> = {}): IdeasInput {
  return { date: D, targets: T, today: [breakfast()], meal: 'cena', history: [], ...over }
}

describe('dayGap', () => {
  it('needs a kcal target', () => {
    expect(dayGap(null, [])).toBeNull()
    expect(dayGap({ kcal: null, protein: 120 }, [])).toBeNull()
    expect(dayGap({ kcal: 0 }, [])).toBeNull()
  })
  it('gives nothing when energy is already exceeded or below 150 kcal left', () => {
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 2100, protein: 10 })])).toBeNull()
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 1851, protein: 10 })])).toBeNull()
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 1850, protein: 10 })])).not.toBeNull()
  })
  it('needs 15 g of protein left or 25 % of the energy target', () => {
    // 400 kcal left (20 %), protein 10 g left → nothing
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 1600, protein: 110, carbs: 100, fat: 30, fiber: 25 })])).toBeNull()
    // 400 kcal left, 15 g protein left → ideas
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 1600, protein: 105, carbs: 240, fat: 60, fiber: 25 })])?.main).toBe('protein')
    // 600 kcal left (30 %), protein covered → ideas
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 1400, protein: 130, carbs: 100, fat: 30 })])).not.toBeNull()
    // no protein target: only the energy share rule applies
    expect(dayGap({ kcal: 2000 }, [log('a', D, 'cena', { kcal: 1600 })])).toBeNull()
    expect(dayGap({ kcal: 2000 }, [log('a', D, 'cena', { kcal: 1400 })])?.main).toBe('kcal')
  })
  it('decides the main gap by priority: protein (≥ 15 g left), else fibre (≥ 8 g), else energy', () => {
    expect(dayGap(T, [breakfast()])!.main).toBe('protein')
    // carbs and fat have far larger shares left, but are never the main gap
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 500, protein: 106, carbs: 10, fat: 5, fiber: 25 })])!.main).toBe('kcal')
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 500, protein: 104, carbs: 10, fat: 5, fiber: 25 })])!.main).toBe('protein')
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 500, protein: 106, carbs: 10, fat: 5, fiber: 23 })])!.main).toBe('kcal')
    expect(dayGap(T, [log('a', D, 'cena', { kcal: 500, protein: 106, carbs: 10, fat: 5, fiber: 22 })])!.main).toBe('fiber')
  })
  it('considers fibre only when at least 8 g are left', () => {
    const others = { kcal: 1000, protein: 118, carbs: 245, fat: 63 }
    expect(dayGap(T, [log('a', D, 'cena', { ...others, fiber: 5 })])!.main).toBe('fiber')
    expect(dayGap(T, [log('a', D, 'cena', { ...others, fiber: 23 })])!.main).not.toBe('fiber')
  })
  it('ignores nutrients without a target', () => {
    const g = dayGap({ kcal: 2000, carbs: 250 }, [breakfast()])!
    expect(g.main).toBe('kcal')
    expect(g.left).toEqual({ carbs: 160 })
  })
  it('describes the gap in words with the same rounding as the summary', () => {
    const g = dayGap({ ...T, kcal: 2675 }, [log('a', D, 'cena', { kcal: 1600, protein: 59, carbs: 200, fat: 50, fiber: 25 })])!
    expect(describeGap(g)).toBe('Te faltan 61 g de proteína y 1.075 kcal')
    expect(describeGap({ kcal: 500.4, left: {}, main: 'kcal' })).toBe('Te quedan 500 kcal')
  })
})

describe('foodIdeas', () => {
  it('returns nothing without targets, with energy exceeded, or with the day complete', () => {
    const history = H(habit('pollo', 'cena', POLLO))
    expect(foodIdeas(input({ targets: null, history })).ideas).toEqual([])
    expect(foodIdeas(input({ today: [log('a', D, 'cena', { kcal: 2500, protein: 10 })], history })).ideas).toEqual([])
    expect(foodIdeas(input({ history, dayComplete: true })).ideas).toEqual([])
    expect(foodIdeas(input({ history })).ideas).toHaveLength(1)
  })

  it('uses the frozen snapshot of the usual quantity (the quick-add pick), never recomputed', () => {
    const old = log('pollo', '2026-11-01', 'cena', POLLO, { qty: 100 })
    const usual = log('pollo', '2026-11-12', 'cena', { kcal: 338, protein: 63.6, carbs: 0, fat: 7.3 }, { qty: 205, grams: 205, name: 'Pechuga de pollo' })
    const lunch = log('pollo', '2026-11-14', 'almuerzo', { kcal: 99, protein: 18.6 }, { qty: 60 })
    const history = H(old, usual, lunch)
    const r = foodIdeas(input({ history }))
    expect(r.ideas).toHaveLength(1)
    const idea = r.ideas[0]!
    expect(idea.snapshot).toBe(lastLogByFood(history, 'cena').get('pollo'))
    expect(idea.snapshot).toBe(usual)
    expect(idea).toMatchObject({ key: 'history:pollo', name: 'Pechuga de pollo', kcal: 338, protein: 63.6 })
    expect(idea.reason).toBe('+64 g de proteína · 338 kcal')
  })

  it('with a protein gap, ranks by grams of protein per 100 kcal; under 5 g/100 kcal does not qualify', () => {
    const history = H(habit('arroz', 'cena', ARROZ), habit('almendras', 'cena', ALMENDRAS), habit('pollo', 'cena', POLLO), habit('yogur', 'cena', YOGUR))
    // g protein / 100 kcal: pollo 18.8, yogur 17, almendras 3.7 and arroz 2.1 (< 5 → out)
    const r = foodIdeas(input({ history }))
    expect(r.ideas.map((i) => i.foodRef)).toEqual(['pollo', 'yogur'])
    expect(r.ideas[0]!.score).toBeCloseTo(18.7879, 3)
  })

  it('a protein idea must close at least 15 % of the protein gap', () => {
    // 100 g of protein left → 15 g needed. 14 g at 70 kcal (20 g/100 kcal) is not an idea; 15 g is.
    const history = H(habit('few', 'cena', { kcal: 70, protein: 14 }), habit('enough', 'cena', { kcal: 75, protein: 15 }))
    expect(foodIdeas(input({ history })).ideas.map((i) => i.foodRef)).toEqual(['enough'])
  })

  it('excludes a candidate exceeding the energy left by more than 10 %, penalises one within 10 %', () => {
    const today = [log('a', D, 'desayuno', { kcal: 1700, protein: 60, carbs: 200, fat: 40, fiber: 28 })] // 300 kcal left
    const history = H(
      habit('big', 'cena', { kcal: 340, protein: 60, carbs: 0, fat: 5 }), // > 330 → out
      habit('edge', 'cena', { kcal: 320, protein: 60, carbs: 0, fat: 5 }), // within 10 %, halved
      habit('small', 'cena', { kcal: 150, protein: 22, carbs: 0, fat: 1 }),
    )
    const r = foodIdeas(input({ today, history }))
    expect(r.ideas.map((i) => i.foodRef)).toEqual(['small', 'edge'])
    // edge: 60 g / 320 kcal = 18.75 g per 100 kcal, halved → 9.375 (small: 14.67)
    expect(r.ideas[1]!.score).toBeCloseTo(9.375, 4)
  })

  it('penalises a candidate that pushes fat past its target by more than 10 %', () => {
    const today = [log('a', D, 'desayuno', { kcal: 900, protein: 30, carbs: 100, fat: 60, fiber: 10 })] // fat 5 g left
    const history = H(habit('fatty', 'cena', { kcal: 200, protein: 25, carbs: 0, fat: 12 }), habit('lean', 'cena', { kcal: 200, protein: 22, carbs: 0, fat: 2 }))
    const r = foodIdeas(input({ today, history }))
    expect(r.ideas.map((i) => i.foodRef)).toEqual(['lean', 'fatty'])
  })

  it('one idea per food: the same food in two quantities appears once, and same-name refs once', () => {
    const history = H(
      log('pollo', '2026-11-10', 'cena', POLLO, { qty: 100 }),
      log('pollo', '2026-11-12', 'cena', { kcal: 248, protein: 46.5, fat: 5.4 }, { qty: 150 }),
      log('pollo', '2026-11-13', 'almuerzo', POLLO),
      habit('custom:1', 'cena', { kcal: 200, protein: 20 }, { name: 'POLLO' }),
    )
    const r = foodIdeas(input({ history }))
    expect(r.ideas).toHaveLength(1)
    expect(r.ideas[0]!.snapshot.qty).toBe(150)
  })

  it('skips foods already logged in that meal today, not those logged in another meal', () => {
    const history = H(habit('pollo', 'cena', POLLO), habit('yogur', 'cena', YOGUR))
    const today = [breakfast(), log('pollo', D, 'cena', { kcal: 100, protein: 10, fat: 10 })]
    expect(foodIdeas(input({ history, today })).ideas.map((i) => i.foodRef)).toEqual(['yogur'])
    const today2 = [breakfast(), log('pollo', D, 'almuerzo', { kcal: 100, protein: 10, fat: 10 })]
    expect(foodIdeas(input({ history, today: today2 })).ideas.map((i) => i.foodRef).sort()).toEqual(['pollo', 'yogur'])
  })

  it('breaks ties by recency, then by key, so the order is stable', () => {
    const history = H(
      habit('b', 'cena', POLLO, { createdAt: 'same', name: 'Comida b' }, ['2026-11-12', '2026-11-11', '2026-11-10']),
      habit('c', 'cena', POLLO, { createdAt: 'same', name: 'Comida c' }, ['2026-11-14', '2026-11-11', '2026-11-10']),
      habit('a', 'cena', POLLO, { createdAt: 'same', name: 'Comida a' }, ['2026-11-12', '2026-11-11', '2026-11-10']),
    )
    const names = (h: FoodLog[]) => foodIdeas(input({ history: h })).ideas.map((i) => i.foodRef)
    expect(names(history)).toEqual(['c', 'a', 'b'])
    expect(names([...history].reverse())).toEqual(['c', 'a', 'b'])
  })

  it('reads only the last 60 days: a food logged three times, but not inside them, is not an idea', () => {
    expect(IDEAS_HISTORY_DAYS).toBe(60)
    const old = habit('pollo', 'cena', POLLO, {}, ['2026-08-01', '2026-08-02', '2026-08-03'])
    expect(foodIdeas(input({ history: H(old) })).ideas).toEqual([])
    const edge = habit('pollo', 'cena', POLLO, {}, ['2026-09-16', '2026-09-17', '2026-09-18'])
    expect(foodIdeas(input({ history: H(edge) })).ideas).toHaveLength(1)
  })

  it('when only fibre is missing, ranks by fibre', () => {
    const today = [log('a', D, 'desayuno', { kcal: 1300, protein: 118, carbs: 240, fat: 60, fiber: 10 })] // 700 kcal, 20 g fibre
    const history = H(habit('pollo', 'cena', POLLO), habit('lenteja', 'cena', LENTEJA), habit('almendras', 'cena', ALMENDRAS))
    const r = foodIdeas(input({ today, history }))
    expect(r.gap?.main).toBe('fiber')
    expect(r.ideas.map((i) => i.foodRef)).toEqual(['lenteja', 'almendras'])
    expect(r.ideas[0]!.reason).toBe('+16 g de fibra · 232 kcal')
    expect(describeGap(r.gap!)).toBe('Te faltan 20 g de fibra y 700 kcal')
  })

  it('only energy left (no macro target): reason is kcal only', () => {
    const r = foodIdeas(input({ targets: { kcal: 2000 }, history: H(habit('arroz', 'cena', ARROZ)) }))
    expect(r.gap?.main).toBe('kcal')
    expect(r.ideas[0]!.reason).toBe('130 kcal')
  })

  it('skips snapshots without energy', () => {
    expect(foodIdeas(input({ history: H(habit('x', 'cena', { protein: 30 })) })).ideas).toEqual([])
  })

  it('respects the limit', () => {
    const history = H(...['a', 'b', 'c', 'd', 'e'].map((k) => habit(k, 'cena', POLLO, { name: k })))
    expect(foodIdeas(input({ history })).ideas).toHaveLength(3)
    expect(foodIdeas(input({ history, limit: 5 })).ideas).toHaveLength(5)
  })

  it('without a meal, considers every meal and skips anything logged today', () => {
    const history = H(habit('pollo', 'almuerzo', POLLO), habit('yogur', 'cena', YOGUR))
    const r = foodIdeas(input({ meal: null, history, today: [breakfast(), log('yogur', D, 'onces', { kcal: 50, protein: 5 })] }))
    expect(r.ideas.map((i) => i.foodRef)).toEqual(['pollo'])
  })
})

describe('ideas need real history (no catalog fallback)', () => {
  it('has the documented constants', () => {
    expect([MIN_HISTORY_DAYS, HISTORY_RECENT_DAYS, MIN_FOOD_LOGS, MIN_MEAL_LOGS]).toEqual([7, 30, 3, 2])
  })

  it('a brand-new profile (no history) gets no ideas and needs history', () => {
    const r = foodIdeas(input({ history: [], today: [] }))
    expect(r).toEqual({ gap: null, ideas: [], historyDays: 0, needsHistory: true })
  })

  it('thin history (6 days) gets no ideas, even with a perfect food', () => {
    const six = ['2026-11-14', '2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09']
    const history = six.map((d) => log('pollo', d, 'cena', POLLO))
    const r = foodIdeas(input({ history }))
    expect(r.historyDays).toBe(6)
    expect(r.needsHistory).toBe(true)
    expect(r.ideas).toEqual([])
    // the seventh distinct day opens the door
    const seven = foodIdeas(input({ history: [...history, log('pollo', '2026-11-08', 'cena', POLLO)] }))
    expect(seven.needsHistory).toBe(false)
    expect(seven.ideas.map((i) => i.foodRef)).toEqual(['pollo'])
  })

  it('counts distinct days with logs in the last 30 only', () => {
    const logs = [log('a', '2026-11-14', 'cena', POLLO), log('b', '2026-11-14', 'cena', POLLO), log('a', '2026-10-16', 'cena', POLLO), log('a', '2026-10-15', 'cena', POLLO)]
    expect(recentLogDays(logs, D)).toBe(2) // 14 Nov and 16 Oct (30 days back); 15 Oct is outside
  })

  it('a food needs 3 logs in 60 days and 2 in the planned meal', () => {
    const twoDinners = habit('pollo', 'cena', POLLO, {}, ['2026-11-14', '2026-11-12']) // 2 in total: not enough
    expect(foodIdeas(input({ history: H(twoDinners) })).ideas).toEqual([])
    const oneDinner = [log('pollo', '2026-11-14', 'cena', POLLO), log('pollo', '2026-11-13', 'almuerzo', POLLO), log('pollo', '2026-11-12', 'almuerzo', POLLO)] // 3 in total, 1 at dinner
    expect(foodIdeas(input({ history: H(oneDinner) })).ideas).toEqual([])
    const ok = [log('pollo', '2026-11-14', 'cena', POLLO), log('pollo', '2026-11-12', 'cena', POLLO), log('pollo', '2026-11-13', 'almuerzo', POLLO)]
    expect(foodIdeas(input({ history: H(ok) })).ideas.map((i) => i.foodRef)).toEqual(['pollo'])
  })

  it('several entries of one day are one habit day, not three', () => {
    const sameDay = [log('pollo', '2026-11-14', 'cena', POLLO), log('pollo', '2026-11-14', 'cena', POLLO), log('pollo', '2026-11-14', 'cena', POLLO)]
    expect(foodIdeas(input({ history: H(sameDay) })).ideas).toEqual([])
  })

  it('breakfast never gets a food only eaten at lunch', () => {
    const history = H(habit('pollo', 'almuerzo', POLLO), habit('huevos', 'desayuno', { kcal: 150, protein: 20, fat: 10 }))
    const breakfastIdeas = foodIdeas(input({ meal: 'desayuno', today: [], history, targets: T }))
    expect(breakfastIdeas.ideas.map((i) => i.foodRef)).toEqual(['huevos'])
    const lunchIdeas = foodIdeas(input({ meal: 'almuerzo', today: [], history, targets: T }))
    expect(lunchIdeas.ideas.map((i) => i.foodRef)).toEqual(['pollo'])
  })

  it('no meal-fit flag and no catalog source exist any more', () => {
    const r = foodIdeas(input({ history: H(habit('pollo', 'cena', POLLO)) }))
    expect(Object.keys(r.ideas[0]!)).not.toContain('mealFit')
    expect(Object.keys(r.ideas[0]!)).not.toContain('source')
  })
})
