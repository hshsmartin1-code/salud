import type { TrackingType } from '../../db/catalogTypes'
import type { ExerciseSet } from '../../db/types'
import { isWarmupSet } from '../../domain/setKind'
import { detectPRs, e1rm, type PRType } from '../../domain/training'
import { formatNumber } from '../../domain/units'

export const PR_LABEL: Record<PRType, string> = {
  max_weight: 'Peso máximo',
  max_e1rm: '1RM estimado',
  max_reps_at_weight: 'Más reps con ese peso',
  max_volume_set: 'Mayor volumen en una serie',
  max_duration: 'Mayor duración',
  max_distance: 'Mayor distancia',
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

/** "60 kg × 8", "12 reps", "0:45", "2,5 km · 14:30". */
export function formatSet(s: Pick<ExerciseSet, 'weight' | 'reps' | 'durationSec' | 'distanceM'>, t: TrackingType): string {
  switch (t) {
    case 'weight_reps':
      return `${s.weight !== null ? formatNumber(s.weight, 2) : '—'} kg × ${s.reps ?? '—'}`
    case 'bodyweight_reps':
      return `${s.reps ?? '—'} reps${s.weight ? ` (+${formatNumber(s.weight, 2)} kg)` : ''}`
    case 'time':
      return formatDuration(s.durationSec)
    case 'distance':
      return `${s.distanceM !== null ? formatNumber(s.distanceM / 1000, 2) + ' km' : '—'}${s.durationSec ? ' · ' + formatDuration(s.durationSec) : ''}`
  }
}

/** A set counts once marked done and it carries the measure its tracking type needs. */
export function isCompleteSet(s: ExerciseSet, t: TrackingType): boolean {
  if (!s.done) return false
  switch (t) {
    case 'weight_reps':
      return s.weight !== null && s.reps !== null
    case 'bodyweight_reps':
      return s.reps !== null
    case 'time':
      return s.durationSec !== null
    case 'distance':
      return s.distanceM !== null || s.durationSec !== null
  }
}

/** Sets performed before `s`: earlier dates, or the same session with a lower index. */
function before(s: ExerciseSet, h: ExerciseSet): boolean {
  if (h.id === s.id) return false
  if (h.sessionId === s.sessionId) return h.setIndex < s.setIndex
  return h.date < s.date || (h.date === s.date && h.createdAt < s.createdAt)
}

/** Reference implementation: judges every set against every earlier one (O(n²) with a heavy constant). Used as the fallback and as the oracle in tests. */
export function prsBySetReference(all: ExerciseSet[]): Map<string, PRType[]> {
  const done = all.filter((s) => s.done && !isWarmupSet(s))
  const out = new Map<string, PRType[]>()
  for (const s of done) {
    const prior = done.filter((h) => before(s, h))
    const prs = detectPRs(prior, s)
    if (prs.length) out.set(s.id, prs)
  }
  return out
}

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const keyLess = (a: ExerciseSet, b: ExerciseSet) => a.date < b.date || (a.date === b.date && a.createdAt < b.createdAt)

/** Running maxima of everything done so far; `against` mirrors detectPRs (domain/training.ts) condition by condition. */
class History {
  count = 0
  maxWeight = -Infinity
  maxE1rm = -Infinity
  maxVolume = -Infinity
  maxDuration = -Infinity
  maxDistance = -Infinity
  private weights: number[] = []
  private reps: number[] = []

  add(s: ExerciseSet) {
    this.count++
    if (num(s.weight) && s.weight > 0 && s.weight > this.maxWeight) this.maxWeight = s.weight
    const e = num(s.weight) && num(s.reps) ? e1rm(s.weight, s.reps) : null
    if (e !== null && e > this.maxE1rm) this.maxE1rm = e
    if (num(s.weight) && num(s.reps)) {
      this.weights.push(s.weight)
      this.reps.push(s.reps)
      const v = s.weight * s.reps
      if (v > 0 && v > this.maxVolume) this.maxVolume = v
    }
    if (num(s.durationSec) && s.durationSec > 0 && s.durationSec > this.maxDuration) this.maxDuration = s.durationSec
    if (num(s.distanceM) && s.distanceM > 0 && s.distanceM > this.maxDistance) this.maxDistance = s.distanceM
  }

  against(c: ExerciseSet): PRType[] {
    if (this.count === 0) return []
    const prs: PRType[] = []
    if (num(c.weight) && c.weight > 0 && this.maxWeight > -Infinity && c.weight > this.maxWeight) prs.push('max_weight')
    const ce = num(c.weight) && num(c.reps) ? e1rm(c.weight, c.reps) : null
    if (ce !== null && this.maxE1rm > -Infinity && ce > this.maxE1rm + 1e-9) prs.push('max_e1rm')
    if (num(c.weight) && c.weight > 0 && num(c.reps) && c.reps > 0) {
      let best = -Infinity
      for (let i = 0; i < this.weights.length; i++) if (this.weights[i]! >= c.weight && this.reps[i]! > best) best = this.reps[i]!
      if (best > -Infinity && c.reps > best) prs.push('max_reps_at_weight')
    }
    const cv = num(c.weight) && num(c.reps) ? c.weight * c.reps : 0
    if (cv > 0 && this.maxVolume > -Infinity && cv > this.maxVolume) prs.push('max_volume_set')
    if (num(c.durationSec) && c.durationSec > 0 && this.maxDuration > -Infinity && c.durationSec > this.maxDuration) prs.push('max_duration')
    if (num(c.distanceM) && c.distanceM > 0 && this.maxDistance > -Infinity && c.distanceM > this.maxDistance) prs.push('max_distance')
    return prs
  }
}

/**
 * Same result as the reference in one ordered pass. Valid when sessions do not overlap in time (every set of an
 * earlier session is before every set of a later one, the normal case); returns null otherwise so the caller falls back.
 */
function prsOrdered(done: ExerciseSet[]): Map<string, PRType[]> | null {
  const bySession = new Map<string, ExerciseSet[]>()
  for (const s of done) {
    const list = bySession.get(s.sessionId)
    if (list) list.push(s)
    else bySession.set(s.sessionId, [s])
  }
  const sessions = [...bySession.values()].map((sets) => {
    let min = sets[0]!
    let max = sets[0]!
    for (const s of sets) {
      if (keyLess(s, min)) min = s
      if (keyLess(max, s)) max = s
    }
    return { sets: sets.slice().sort((a, b) => a.setIndex - b.setIndex), min, max }
  })
  sessions.sort((a, b) => (keyLess(a.min, b.min) ? -1 : keyLess(b.min, a.min) ? 1 : 0))
  let latest: ExerciseSet | null = null
  for (const ss of sessions) {
    if (latest && !keyLess(latest, ss.min)) return null
    if (!latest || keyLess(latest, ss.max)) latest = ss.max
  }
  const found = new Map<string, PRType[]>()
  const history = new History()
  for (const ss of sessions) {
    const { sets } = ss
    for (let i = 0; i < sets.length; ) {
      let j = i
      while (j < sets.length && sets[j]!.setIndex === sets[i]!.setIndex) j++
      for (let k = i; k < j; k++) {
        const prs = history.against(sets[k]!)
        if (prs.length) found.set(sets[k]!.id, prs)
      }
      for (let k = i; k < j; k++) history.add(sets[k]!)
      i = j
    }
  }
  const out = new Map<string, PRType[]>()
  for (const s of done) {
    const prs = found.get(s.id)
    if (prs) out.set(s.id, prs)
  }
  return out
}

/** PRs for each completed set of one exercise, judged only against what came before it. */
export function prsBySet(all: ExerciseSet[]): Map<string, PRType[]> {
  const done = all.filter((s) => s.done && !isWarmupSet(s))
  return prsOrdered(done) ?? prsBySetReference(all)
}

export function bestE1rm(sets: ExerciseSet[]): number | null {
  let best: number | null = null
  for (const s of sets) {
    if (!s.done || isWarmupSet(s) || s.weight === null || s.reps === null) continue
    const v = e1rm(s.weight, s.reps)
    if (v !== null && (best === null || v > best)) best = v
  }
  return best
}
