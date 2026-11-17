/**
 * Per-profile water containers (the one-tap buttons), stored in `Profile.settings.hydration.containers`.
 * Pure: validation and list edits. Defaults are 250 ml and 500 ml; at most 6 containers.
 */
import type { ProfileSettings } from '../../db/types'

export interface Container {
  label: string
  ml: number
}

export const MAX_CONTAINERS = 6
export const DEFAULT_CONTAINERS: readonly Container[] = [
  { label: 'Vaso', ml: 250 },
  { label: 'Botella', ml: 500 },
]
const MIN_ML = 10
const MAX_ML = 3000

const clean = (c: unknown): Container | null => {
  if (!c || typeof c !== 'object') return null
  const { label, ml } = c as { label?: unknown; ml?: unknown }
  if (typeof ml !== 'number' || !Number.isFinite(ml) || ml < MIN_ML || ml > MAX_ML) return null
  const text = typeof label === 'string' ? label.trim().slice(0, 20) : ''
  return { label: text || `${Math.round(ml)} ml`, ml: Math.round(ml) }
}

/** The containers of a profile: its own valid list (max 6) or the defaults when it has none. */
export function containersOf(settings: Pick<ProfileSettings, 'hydration'> | null | undefined): Container[] {
  const own = settings?.hydration?.containers
  if (Array.isArray(own)) {
    const list = own.map(clean).filter((c): c is Container => c !== null).slice(0, MAX_CONTAINERS)
    if (list.length) return list
  }
  return DEFAULT_CONTAINERS.map((c) => ({ ...c }))
}

/** Error message in Spanish, or null when `candidate` can be added to `list`. */
export function validateContainer(list: readonly Container[], candidate: { label: string; ml: number | null }): string | null {
  if (list.length >= MAX_CONTAINERS) return `Máximo ${MAX_CONTAINERS} recipientes.`
  if (candidate.ml === null) return 'Ingresa una cantidad en ml.'
  if (candidate.ml < MIN_ML || candidate.ml > MAX_ML) return `La cantidad debe estar entre ${MIN_ML} y ${MAX_ML} ml.`
  if (list.some((c) => c.ml === Math.round(candidate.ml as number))) return 'Ya tienes un recipiente con esa cantidad.'
  return null
}

export function addContainer(list: readonly Container[], candidate: { label: string; ml: number }): Container[] {
  const c = clean(candidate)
  if (!c || list.length >= MAX_CONTAINERS || list.some((x) => x.ml === c.ml)) return [...list]
  return [...list, c]
}

export function removeContainer(list: readonly Container[], ml: number): Container[] {
  return list.filter((c) => c.ml !== ml)
}

/** Settings with the container list replaced (other settings untouched). An empty list restores the defaults. */
export function withContainers(settings: ProfileSettings, list: readonly Container[]): ProfileSettings {
  const next = list.map(clean).filter((c): c is Container => c !== null).slice(0, MAX_CONTAINERS)
  return { ...settings, hydration: { ...settings.hydration, containers: next.length ? next : undefined } }
}
