import type { MealKey, MealSlotPref } from '../../db/types'
import { defaultMeal, MEALS } from './food'

/**
 * Pure rules of the configurable meal slots (V3.2). The stored `MealKey` never changes: only whether a slot is
 * offered, what it is called, its usual time and its place in the list.
 */

export interface MealSlot {
  key: MealKey
  on: boolean
  /** What the person sees: the custom name or the default one. */
  label: string
  /** Default Spanish name of the key. */
  defaultLabel: string
  /** True when the label is a custom name. */
  renamed: boolean
  /** Usual local time 'HH:MM' (absent = none). */
  time?: string
}

export const MEAL_KEYS: readonly MealKey[] = MEALS.map((m) => m.key)
export const NAME_MAX = 24
/** Slots of a profile without preferences. Any other key shows up when it has logs in the last 30 days. */
export const DEFAULT_ON: readonly MealKey[] = ['desayuno', 'almuerzo', 'cena']
export const USED_WINDOW_DAYS = 30

const DEFAULT_LABEL = Object.fromEntries(MEALS.map((m) => [m.key, m.es])) as Record<MealKey, string>
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const isKey = (v: unknown): v is MealKey => typeof v === 'string' && (MEAL_KEYS as readonly string[]).includes(v)

export const defaultLabel = (key: MealKey): string => DEFAULT_LABEL[key]

export function cleanName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const t = name.trim().slice(0, NAME_MAX).trim()
  return t || undefined
}

export function cleanTime(time: unknown): string | undefined {
  return typeof time === 'string' && TIME_RE.test(time) ? time : undefined
}

/** Stored preferences made safe: unique known keys, missing ones appended off, at least one on, clean names and times. */
export function sanitizePrefs(prefs: readonly MealSlotPref[] | undefined | null): MealSlotPref[] {
  const out: MealSlotPref[] = []
  const seen = new Set<MealKey>()
  for (const p of Array.isArray(prefs) ? prefs : []) {
    if (!p || !isKey(p.key) || seen.has(p.key)) continue
    seen.add(p.key)
    const name = cleanName(p.name)
    const time = cleanTime(p.time)
    out.push({ key: p.key, on: p.on === true, ...(name ? { name } : {}), ...(time ? { time } : {}) })
  }
  for (const key of MEAL_KEYS) if (!seen.has(key)) out.push({ key, on: false })
  if (!out.some((p) => p.on)) out[0] = { ...out[0]!, on: true }
  return out
}

/** The six slots in display order. Without stored preferences: breakfast, lunch, dinner and any key used recently. */
export function resolveSlots(prefs: readonly MealSlotPref[] | undefined | null, usedKeys: Iterable<MealKey> = []): MealSlot[] {
  let list: MealSlotPref[]
  if (prefs === undefined || prefs === null) {
    const used = new Set<MealKey>(usedKeys)
    list = MEAL_KEYS.map((key) => ({ key, on: DEFAULT_ON.includes(key) || used.has(key) }))
  } else list = sanitizePrefs(prefs)
  return list.map((p) => {
    const name = cleanName(p.name)
    return {
      key: p.key,
      on: p.on,
      label: name ?? DEFAULT_LABEL[p.key],
      defaultLabel: DEFAULT_LABEL[p.key],
      renamed: !!name && name !== DEFAULT_LABEL[p.key],
      ...(p.time ? { time: p.time } : {}),
    }
  })
}

/** The shape written to `settings.meals` for a list of slots (names equal to the default are not stored). */
export function toPrefs(slots: readonly MealSlot[]): MealSlotPref[] {
  return slots.map((s) => ({ key: s.key, on: s.on, ...(s.renamed ? { name: s.label } : {}), ...(s.time ? { time: s.time } : {}) }))
}

/** Slots shown in a day: the active ones plus any slot that has entries that day. Hiding never hides entries. */
export function visibleSlots(slots: readonly MealSlot[], logs: readonly { meal: MealKey }[]): MealSlot[] {
  const used = new Set(logs.map((l) => l.meal))
  return slots.filter((s) => s.on || used.has(s.key))
}

/** What a meal chooser lists: the active slots plus the slot of the row being edited when it is hidden. */
export function chooserSlots(slots: readonly MealSlot[], ...current: (MealKey | null | undefined)[]): MealSlot[] {
  return slots.filter((s) => s.on || current.includes(s.key))
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m || 0)
}
/** Anchor of a slot with no usual time when others have one (only used to place it among the custom times). */
const NOMINAL: Record<MealKey, number> = { desayuno: 7 * 60 + 30, media_manana: 11 * 60, almuerzo: 13 * 60, onces: 16 * 60 + 30, cena: 20 * 60, otro: 22 * 60 + 30 }
/** Default meal intervals (same boundaries as `defaultMeal`), used to place the clock on a slot that is off. */
const DEFAULT_SPAN: Record<MealKey, [number, number]> = {
  desayuno: [0, 630], media_manana: [630, 720], almuerzo: [720, 900], onces: [900, 1110], cena: [1110, 1320], otro: [1320, 1440],
}

/**
 * The active slot for a clock time ('HH:MM'). Always an active slot. With no usual times it follows the
 * default day (exactly `defaultMeal` when every slot is on; otherwise the nearest active slot). With usual
 * times those rule: the boundary between two consecutive slots is the midpoint of their times.
 */
export function slotForTime(slots: readonly MealSlot[], time: string): MealSlot {
  const active = slots.filter((s) => s.on)
  const pool = active.length ? active : slots.slice(0, 1)
  const t = toMinutes(time)
  if (!pool.some((s) => s.time)) {
    const natural = defaultMeal(time)
    const hit = pool.find((s) => s.key === natural)
    if (hit) return hit
    const dist = (s: MealSlot) => {
      const [a, b] = DEFAULT_SPAN[s.key]
      return t < a ? a - t : t >= b ? t - b + 1 : 0
    }
    return pool.reduce((best, s) => (dist(s) < dist(best) ? s : best))
  }
  if (pool.length === 1) return pool[0]!
  const anchors = pool.map((s, i) => ({ s, i, at: s.time ? toMinutes(s.time) : NOMINAL[s.key] })).sort((a, b) => a.at - b.at || a.i - b.i)
  let k = -1
  for (let i = 0; i < anchors.length; i++) if (anchors[i]!.at <= t) k = i
  const prev = k < 0 ? { at: anchors[anchors.length - 1]!.at - 1440, s: anchors[anchors.length - 1]!.s } : anchors[k]!
  const nextIdx = k < 0 ? 0 : (k + 1) % anchors.length
  const next = { at: anchors[nextIdx]!.at + (k >= 0 && nextIdx === 0 ? 1440 : 0), s: anchors[nextIdx]!.s }
  return t >= (prev.at + next.at) / 2 ? next.s : prev.s
}

/** One line for the Ajustes row: the active slots by name. */
export const mealTimesSummary = (slots: readonly MealSlot[]): string => slots.filter((s) => s.on).map((s) => s.label).join(' · ')

/* ---- Settings reducer: each function returns the full new list (what gets written once per change). ---- */

export const slotNameMax = NAME_MAX

export function toggleSlot(slots: readonly MealSlot[], key: MealKey): MealSlot[] {
  const target = slots.find((s) => s.key === key)
  if (!target) return [...slots]
  if (target.on && slots.filter((s) => s.on).length <= 1) return [...slots] // the last active slot stays
  return slots.map((s) => (s.key === key ? { ...s, on: !s.on } : s))
}

export function renameSlot(slots: readonly MealSlot[], key: MealKey, name: string): MealSlot[] {
  const clean = cleanName(name)
  return slots.map((s) =>
    s.key !== key ? s : { ...s, label: clean ?? s.defaultLabel, renamed: !!clean && clean !== s.defaultLabel },
  )
}

export function setSlotTime(slots: readonly MealSlot[], key: MealKey, time: string | null): MealSlot[] {
  const clean = time ? cleanTime(time) : undefined
  return slots.map((s) => {
    if (s.key !== key) return s
    const { time: _t, ...rest } = s
    void _t
    return clean ? { ...rest, time: clean } : rest
  })
}

export function moveSlot(slots: readonly MealSlot[], key: MealKey, dir: -1 | 1): MealSlot[] {
  const i = slots.findIndex((s) => s.key === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= slots.length) return [...slots]
  const next = [...slots]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  return next
}
