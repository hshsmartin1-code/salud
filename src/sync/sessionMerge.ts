/**
 * "Combinar" for a training session edited on two devices (V3).
 *
 * A session row is only the header (date, status, exercise order, notes…): its sets are separate rows
 * that already sync and merge on their own, so this function never creates, copies or deletes a set.
 *
 * Required properties (tested in sessionMerge.test.ts):
 * - same id;
 * - idempotent: m(m(a,b),b) = m(a,b), m(m(a,b),a) = m(a,b), m(a,a) = a (for rows written by V3,
 *   whose restEndsAt is null);
 * - commutative in content: m(a,b) deep-equals m(b,a), so two devices that resolve the same
 *   conflict independently produce byte-identical rows and no further conflict.
 *
 * Field rules:
 * - status: done if either is done; startedAt: earliest non-null; endedAt: latest non-null when done,
 *   else null; restEndsAt: null; createdAt: min; updatedAt: max.
 * - notes (session and per exercise): union of distinct lines (trimmed, non-empty) in canonical
 *   lexical order, independent of timestamps and merge grouping, never repeated. Identical texts
 *   are kept as is so merging a row with itself does not rewrite its notes.
 * - every other field: from the row with the newer updatedAt; on an exact tie, per field the larger
 *   value in canonical JSON order (a deterministic, idempotent tie-break).
 * - exerciseOrder: union by exerciseId — the newer row's order, then the other's extras; per-exercise
 *   fields from the newer (tie: per field as above), per-exercise notes by the line rule. Then an
 *   exercise listed by only one side and with no set rows here is dropped (it was removed on the
 *   other device), and an exercise with set rows that neither lists is appended (sorted by id).
 *   On a tie the order of the lexicographically larger (filtered) id sequence is used.
 */
import type { TrackingType } from '../db/catalogTypes'
import type { SessionExercise } from '../db/types'
import { stableStringify } from './codec'

type Row = Record<string, unknown>
type Item = Record<string, unknown> & { exerciseId: string }

const SPECIAL = new Set(['id', 'profileId', 'createdAt', 'updatedAt', 'status', 'startedAt', 'endedAt', 'restEndsAt', 'notes', 'exerciseOrder'])

/** Canonical order of two JSON values; undefined (absent) is the smallest. */
function cmp(a: unknown, b: unknown): number {
  if (a === undefined) return b === undefined ? 0 : -1
  if (b === undefined) return 1
  const x = stableStringify(a)
  const y = stableStringify(b)
  return x < y ? -1 : x > y ? 1 : 0
}
const maxOf = (a: unknown, b: unknown) => (cmp(a, b) >= 0 ? a : b)

function noteLines(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return [...new Set(v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))]
}

/**
 * Canonically ordered line union of two notes. The legacy ordering argument is ignored: using a
 * merged row's timestamp to order its lines would lose each line's origin and depend on grouping.
 * Returns undefined when neither side has a note.
 */
export function mergeNotes(a: unknown, b: unknown, _newerFirst: boolean | null): string | undefined {
  const sa = typeof a === 'string' ? a : undefined
  const sb = typeof b === 'string' ? b : undefined
  if (sa === sb) return sa
  return [...new Set([...noteLines(sa), ...noteLines(sb)])].sort().join('\n')
}

function stripUndefined<T extends Row>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

/** Merges two versions of one exercise entry (same exerciseId). */
function mergeItem(newer: Item, older: Item, tie: boolean): Item {
  const out: Row = {}
  for (const k of new Set([...Object.keys(newer), ...Object.keys(older)])) {
    if (k === 'notes') out.notes = mergeNotes(newer.notes, older.notes, tie ? null : true)
    else out[k] = tie ? maxOf(newer[k], older[k]) : newer[k]
  }
  out.exerciseId = newer.exerciseId
  return stripUndefined(out) as Item
}

function cmpSeq(a: readonly Item[], b: readonly Item[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!.exerciseId
    const y = b[i]!.exerciseId
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length - b.length
}

function items(v: unknown): Item[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Item[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object' || typeof (x as Item).exerciseId !== 'string') continue
    const it = x as Item
    if (seen.has(it.exerciseId)) continue
    seen.add(it.exerciseId)
    out.push(it)
  }
  return out
}

export type DescribeExercise = (exerciseId: string) => Pick<SessionExercise, 'name' | 'trackingType' | 'restSec'>

const defaultDescribe: DescribeExercise = (id) => ({ name: id, trackingType: 'weight_reps' as TrackingType, restSec: 0 })

function mergeOrder(newer: unknown, older: unknown, tie: boolean, withSets: ReadonlySet<string>, describe: DescribeExercise): Item[] {
  const n = items(newer)
  const o = items(older)
  const inN = new Set(n.map((i) => i.exerciseId))
  const inO = new Set(o.map((i) => i.exerciseId))
  const keep = (id: string) => (inN.has(id) && inO.has(id)) || withSets.has(id)
  const fN = n.filter((i) => keep(i.exerciseId))
  const fO = o.filter((i) => keep(i.exerciseId))
  const [primary, other] = tie && cmpSeq(fO, fN) > 0 ? [fO, fN] : [fN, fO]
  const byN = new Map(fN.map((i) => [i.exerciseId, i]))
  const byO = new Map(fO.map((i) => [i.exerciseId, i]))
  const merged = (id: string): Item => {
    const a = byN.get(id)
    const b = byO.get(id)
    if (a && b) return mergeItem(a, b, tie)
    return { ...(a ?? b)! }
  }
  const out = primary.map((i) => merged(i.exerciseId))
  const listed = new Set(out.map((i) => i.exerciseId))
  for (const i of other) if (!listed.has(i.exerciseId)) out.push(merged(i.exerciseId))
  const orphans = [...withSets].filter((id) => !inN.has(id) && !inO.has(id)).sort()
  for (const id of orphans) out.push({ ...describe(id), exerciseId: id } as Item)
  return out
}

const earliest = (a: unknown, b: unknown) => {
  const xs = [a, b].filter((x): x is string => typeof x === 'string' && x !== '')
  return xs.length ? xs.sort()[0]! : null
}
const latest = (a: unknown, b: unknown) => {
  const xs = [a, b].filter((x): x is string => typeof x === 'string' && x !== '')
  return xs.length ? xs.sort()[xs.length - 1]! : null
}

/**
 * Merges two versions of the same training session row.
 * @param setExerciseIds exercise ids that have set rows of this session on this device.
 * @param describe name/tracking/rest for an exercise that has sets but is in neither list.
 */
export function mergeSessionRows<T extends Row>(local: T, remote: T, setExerciseIds: Iterable<string>, describe: DescribeExercise = defaultDescribe): T {
  const withSets = new Set(setExerciseIds)
  const ua = String(local.updatedAt ?? '')
  const ub = String(remote.updatedAt ?? '')
  const tie = ua === ub
  const [newer, older] = ua >= ub ? [local, remote] : [remote, local]

  const out: Row = {}
  for (const k of new Set([...Object.keys(newer), ...Object.keys(older)])) {
    if (SPECIAL.has(k)) continue
    out[k] = tie ? maxOf(newer[k], older[k]) : newer[k]
  }
  out.id = local.id
  if ('profileId' in local) out.profileId = local.profileId
  out.createdAt = earliest(local.createdAt, remote.createdAt) ?? undefined
  out.updatedAt = latest(local.updatedAt, remote.updatedAt) ?? undefined
  const done = local.status === 'done' || remote.status === 'done'
  out.status = done ? 'done' : tie ? maxOf(newer.status, older.status) : newer.status
  out.startedAt = earliest(local.startedAt, remote.startedAt)
  out.endedAt = done ? latest(local.endedAt, remote.endedAt) : null
  out.restEndsAt = null
  out.notes = mergeNotes(newer.notes, older.notes, tie ? null : true)
  out.exerciseOrder = mergeOrder(newer.exerciseOrder, older.exerciseOrder, tie, withSets, describe)
  return stripUndefined(out) as T
}

/** Name/tracking/rest of an exercise known only from its set rows (for mergeSessionRows). */
export function describeFromSets(sets: readonly { exerciseId: string; exerciseName?: string; setIndex?: number; weight?: number | null; reps?: number | null; durationSec?: number | null; distanceM?: number | null }[]): DescribeExercise {
  return (id) => {
    const mine = sets.filter((s) => s.exerciseId === id).sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0))
    const s = mine[0]
    const trackingType: TrackingType = mine.some((x) => x.distanceM != null)
      ? 'distance'
      : mine.some((x) => x.reps != null)
        ? mine.some((x) => x.weight != null)
          ? 'weight_reps'
          : 'bodyweight_reps'
        : mine.some((x) => x.durationSec != null)
          ? 'time'
          : 'weight_reps'
    return { name: s?.exerciseName ?? id, trackingType, restSec: 0 }
  }
}
