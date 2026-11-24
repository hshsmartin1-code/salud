import { describe, expect, it } from 'vitest'
import { calcPlates, describeSide, plateIncrement, plateInventory } from './plates'
import { warmupPlan } from './warmup'

const gym = plateInventory(undefined) // default: 6 pairs of each (0.5 kg: none)
const side = (r: ReturnType<typeof calcPlates>) => r.perSide.map((p) => `${p.count}x${p.plate}`).join(',')
const sum = (r: ReturnType<typeof calcPlates>) => r.bar + 2 * r.perSide.reduce((a, p) => a + p.plate * p.count, 0)

describe('calcPlates', () => {
  it('loads standard weights with the fewest plates, heaviest first', () => {
    expect(side(calcPlates(100, 20, gym))).toBe('1x25,1x15')
    expect(side(calcPlates(60, 20, gym))).toBe('1x20')
    expect(side(calcPlates(140, 20, gym))).toBe('2x25,1x10')
    expect(calcPlates(20, 20, gym)).toMatchObject({ perSide: [], achieved: 20, exact: true })
  })

  it('reports exactness and the achieved weight', () => {
    const r = calcPlates(62.5, 20, gym)
    expect(r).toMatchObject({ exact: true, achieved: 62.5 })
    expect(sum(r)).toBe(62.5)
  })

  it('offers the nearest lower and higher weights when exact is impossible', () => {
    const r = calcPlates(61, 20, gym) // smallest step is 2.5 kg
    expect(r.exact).toBe(false)
    expect(r.lower).toBe(60)
    expect(r.higher).toBe(62.5)
    expect(r.achieved).toBe(60)
    expect(sum(r)).toBe(r.achieved)
    expect(calcPlates(62, 20, gym).achieved).toBe(62.5)
  })

  it('respects the inventory instead of greedy: a missing plate is never used', () => {
    const inv = plateInventory({ '25': 1, '20': 2, '15': 0, '10': 0, '5': 0, '2.5': 0, '1.25': 0 })
    // 40 per side needs 2 × 20 even though greedy would start with the 25
    const r = calcPlates(100, 20, inv)
    expect(r.exact).toBe(true)
    expect(side(r)).toBe('2x20')
    // 65 total → 22.5 per side: impossible; nearest are 60 and 70
    const s = calcPlates(65, 20, inv)
    expect(s.exact).toBe(false)
    expect([s.lower, s.higher]).toEqual([60, 70])
    // beyond the inventory: heaviest loadable weight and no higher one
    const max = calcPlates(500, 20, inv)
    expect(max.higher).toBeNull()
    expect(max.achieved).toBe(20 + 2 * (25 + 40))
  })

  it('handles targets below the bar and an empty inventory', () => {
    expect(calcPlates(10, 20, gym)).toMatchObject({ perSide: [], achieved: 20, exact: false, lower: null, higher: 20 })
    const none = plateInventory(Object.fromEntries([25, 20, 15, 10, 5, 2.5, 1.25].map((p) => [String(p), 0])))
    expect(calcPlates(60, 20, none)).toMatchObject({ achieved: 20, exact: false, higher: null })
  })

  it('uses the optional 0.5 kg disc and other bars', () => {
    const fine = plateInventory({ '0.5': 2 })
    expect(plateIncrement(fine)).toBe(1)
    expect(calcPlates(21, 20, fine)).toMatchObject({ exact: true, achieved: 21 })
    expect(calcPlates(40, 15, gym).achieved).toBe(40)
    expect(calcPlates(40, 10, gym).exact).toBe(true)
  })

  it('supports pounds', () => {
    const lb = plateInventory(undefined, 'lb')
    expect(side(calcPlates(225, 45, lb))).toBe('2x45')
    expect(side(calcPlates(135, 45, lb))).toBe('1x45')
    expect(calcPlates(137, 45, lb).exact).toBe(false)
    expect(calcPlates(137, 45, lb).achieved).toBe(135)
  })

  it('every result adds up (sweep)', () => {
    for (let w = 20; w <= 300; w += 1.25) {
      const r = calcPlates(w, 20, gym)
      expect(sum(r)).toBeCloseTo(r.achieved, 6)
      if (r.exact) expect(r.achieved).toBeCloseTo(w, 6)
    }
  })

  it('describes one side', () => {
    expect(describeSide(calcPlates(100, 20, gym).perSide, String)).toBe('25 + 15')
    expect(describeSide(calcPlates(20, 20, gym).perSide, String)).toBe('Solo la barra')
    expect(describeSide(calcPlates(140, 20, gym).perSide, String)).toBe('2 × 25 + 10')
  })
})

describe('warmupPlan', () => {
  it('ramps from the bar to ~80 % with loadable weights', () => {
    expect(warmupPlan(100, 20, gym)).toEqual([
      { weight: 20, reps: 10 },
      { weight: 40, reps: 5 },
      { weight: 60, reps: 3 },
      { weight: 80, reps: 1 },
    ])
  })

  it('skips steps at or below the bar and repeated weights', () => {
    const w = warmupPlan(40, 20, gym)
    expect(w[0]).toEqual({ weight: 20, reps: 10 })
    expect(w.every((s, i) => i === 0 || s.weight > w[i - 1]!.weight)).toBe(true)
    expect(w.every((s) => s.weight < 40)).toBe(true)
    expect(warmupPlan(22.5, 20, gym)).toEqual([])
    expect(warmupPlan(20, 20, gym)).toEqual([])
    expect(warmupPlan(0, 20, gym)).toEqual([])
  })

  it('without a bar (dumbbells, machines) rounds to the plate step and starts above zero', () => {
    const w = warmupPlan(50, null, gym)
    expect(w.map((s) => s.reps)).toEqual([5, 3, 1])
    expect(w.map((s) => s.weight)).toEqual([20, 30, 40])
  })
})
