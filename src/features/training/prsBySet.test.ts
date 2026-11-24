import { describe, expect, it } from 'vitest'
import type { ExerciseSet } from '../../db/types'
import { prsBySet, prsBySetReference } from './sets'

/** Small deterministic generator so failures are reproducible. */
function rng(seed: number) {
  let x = seed
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

function build(seed: number, opts: { overlap: boolean; ties: boolean }): ExerciseSet[] {
  const r = rng(seed)
  const out: ExerciseSet[] = []
  const sessions = 1 + Math.floor(r() * 25)
  for (let n = 0; n < sessions; n++) {
    const day = (opts.overlap ? Math.floor(r() * 6) : n) + 1
    const date = `2026-01-${String(day).padStart(2, '0')}`
    const sets = 1 + Math.floor(r() * 6)
    for (let i = 0; i < sets; i++) {
      const kind = r()
      const minute = opts.ties ? 0 : Math.floor(r() * 50)
      out.push({
        id: `s${n}-${i}`,
        profileId: 'p',
        createdAt: `${date}T10:${String(minute + i).padStart(2, '0')}:00Z`,
        updatedAt: '',
        sessionId: `x${n}`,
        date,
        exerciseId: 'e',
        exerciseName: 'E',
        setIndex: opts.ties && r() < 0.3 ? 0 : i,
        weight: kind < 0.85 ? Math.round(20 + r() * 8) * 2.5 : null,
        reps: kind < 0.9 ? 1 + Math.floor(r() * 12) : null,
        durationSec: r() < 0.2 ? Math.floor(r() * 90) : null,
        distanceM: r() < 0.1 ? Math.floor(r() * 500) : null,
        rpe: null,
        isWarmup: r() < 0.15,
        done: r() < 0.9,
      } as ExerciseSet)
    }
  }
  return out.sort(() => r() - 0.5)
}

describe('prsBySet', () => {
  it('matches the reference implementation (ordered sessions)', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rows = build(seed, { overlap: false, ties: false })
      expect([...prsBySet(rows)]).toEqual([...prsBySetReference(rows)])
    }
  })
  it('matches the reference with ties in set index and timestamps', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rows = build(seed, { overlap: false, ties: true })
      expect([...prsBySet(rows)]).toEqual([...prsBySetReference(rows)])
    }
  })
  it('falls back to the reference when sessions overlap in time', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rows = build(seed, { overlap: true, ties: false })
      expect([...prsBySet(rows)]).toEqual([...prsBySetReference(rows)])
    }
  })
})
