import type { TrackingType } from '../../db/catalogTypes'
import type { ExerciseSet } from '../../db/types'
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

/** PRs for each completed set of one exercise, judged only against what came before it. */
export function prsBySet(all: ExerciseSet[]): Map<string, PRType[]> {
  const done = all.filter((s) => s.done && !s.isWarmup)
  const out = new Map<string, PRType[]>()
  for (const s of done) {
    const prior = done.filter((h) => before(s, h))
    const prs = detectPRs(prior, s)
    if (prs.length) out.set(s.id, prs)
  }
  return out
}

export function bestE1rm(sets: ExerciseSet[]): number | null {
  let best: number | null = null
  for (const s of sets) {
    if (!s.done || s.isWarmup || s.weight === null || s.reps === null) continue
    const v = e1rm(s.weight, s.reps)
    if (v !== null && (best === null || v > best)) best = v
  }
  return best
}
