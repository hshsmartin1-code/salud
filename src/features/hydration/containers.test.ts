import { describe, expect, it } from 'vitest'
import type { ProfileSettings } from '../../db/types'
import { DEFAULT_CONTAINERS, MAX_CONTAINERS, addContainer, containersOf, removeContainer, validateContainer, withContainers } from './containers'

const base: ProfileSettings = { addActivityKcal: false }

describe('water containers', () => {
  it('defaults to 250 and 500 ml', () => {
    expect(containersOf(base).map((c) => c.ml)).toEqual([250, 500])
    expect(containersOf(undefined)).toEqual(DEFAULT_CONTAINERS)
  })
  it('uses the profile list, dropping invalid entries and capping at 6', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `C${i}`, ml: 100 + i * 50 }))
    const s = { ...base, hydration: { containers: [{ label: 'x', ml: 5 }, ...many] } }
    expect(containersOf(s)).toHaveLength(MAX_CONTAINERS)
    expect(containersOf(s).every((c) => c.ml >= 10)).toBe(true)
  })
  it('validates additions', () => {
    const list = containersOf(base)
    expect(validateContainer(list, { label: 'Jarra', ml: null })).toMatch(/cantidad/)
    expect(validateContainer(list, { label: 'Jarra', ml: 4000 })).toMatch(/entre/)
    expect(validateContainer(list, { label: 'Vaso', ml: 250 })).toMatch(/Ya tienes/)
    expect(validateContainer(list, { label: 'Jarra', ml: 750 })).toBeNull()
    const full = Array.from({ length: 6 }, (_, i) => ({ label: 'c', ml: 100 + i }))
    expect(validateContainer(full, { label: 'x', ml: 900 })).toMatch(/Máximo/)
  })
  it('adds, removes and stores without touching other settings', () => {
    const added = addContainer(containersOf(base), { label: ' Jarra ', ml: 750 })
    expect(added.map((c) => c.ml)).toEqual([250, 500, 750])
    expect(added[2]!.label).toBe('Jarra')
    expect(removeContainer(added, 250).map((c) => c.ml)).toEqual([500, 750])
    const s = withContainers({ ...base, waterGoalMl: 2500 }, added)
    expect(s.waterGoalMl).toBe(2500)
    expect(s.hydration?.containers).toHaveLength(3)
    expect(containersOf(withContainers(s, []))).toEqual(DEFAULT_CONTAINERS)
  })
})
