/**
 * Set types (V3). A set is a normal work set, a warm-up, a drop set or a set to failure.
 *
 * Storage keeps 2.2.1 compatibility: `isWarmup` stays the source of truth for warm-ups (older clients
 * only know that flag) and `kind` is optional ('normal' = field absent). Always READ with `setKind()`
 * and WRITE with `setKindPatch()` / `withSetKind()`, never by touching the fields directly.
 *
 * Reading rule (robust against an older client that toggled only `isWarmup`):
 *   isWarmup === true            → 'warmup'
 *   kind 'drop' | 'failure'      → that kind
 *   anything else                → 'normal' (incl. a stale kind 'warmup' with isWarmup false)
 *
 * Volume and PRs: warm-ups are excluded; drop and failure sets count as work sets.
 */
export type SetKind = 'normal' | 'warmup' | 'drop' | 'failure'
export const SET_KINDS: readonly SetKind[] = ['normal', 'warmup', 'drop', 'failure']

export interface SetKindFields {
  isWarmup?: boolean | null
  kind?: string | null
}

export function setKind(s: SetKindFields): SetKind {
  if (s.isWarmup === true) return 'warmup'
  if (s.kind === 'drop' || s.kind === 'failure') return s.kind
  return 'normal'
}

export const isWarmupSet = (s: SetKindFields): boolean => setKind(s) === 'warmup'
/** Work sets count for volume, PRs and "previous performance" ordinals (drop and failure included). */
export const isWorkSet = (s: SetKindFields): boolean => setKind(s) !== 'warmup'

/**
 * Patch for `repo.update()`: keeps `kind` and `isWarmup` consistent. `kind: undefined` makes Dexie
 * remove the property, so a normal set has no `kind` at all (byte-identical to a 2.2.1 row).
 */
export function setKindPatch(kind: SetKind): { isWarmup: boolean; kind: 'warmup' | 'drop' | 'failure' | undefined } {
  return { isWarmup: kind === 'warmup', kind: kind === 'normal' ? undefined : kind }
}

/** Same rule for whole rows (add/put): returns a copy without a `kind` property for normal sets. */
export function withSetKind<T extends SetKindFields>(row: T, kind: SetKind): T {
  const { kind: _old, ...rest } = row
  void _old
  return (kind === 'normal' ? { ...rest, isWarmup: false } : { ...rest, isWarmup: kind === 'warmup', kind }) as T
}

/** Next kind when the set number is tapped: normal → warmup → drop → failure → normal. */
export function nextSetKind(k: SetKind): SetKind {
  return SET_KINDS[(SET_KINDS.indexOf(k) + 1) % SET_KINDS.length]!
}

export const SET_KIND_LABEL: Record<SetKind, string> = { normal: 'Serie', warmup: 'Calentamiento', drop: 'Serie descendente', failure: 'Al fallo' }
export const SET_KIND_SHORT: Record<SetKind, string> = { normal: '', warmup: 'C', drop: 'D', failure: 'F' }
