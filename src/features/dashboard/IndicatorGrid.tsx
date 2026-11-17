import { useState, type ReactNode } from 'react'
import { useProfile } from '../../app/profile'
import { updateProfile } from '../../db/profiles'
import type { DashboardIndicator } from '../../db/types'
import { Sheet } from '../../ui/kit'
import { Icon } from '../../ui/Icon'
import { SectionHeader } from '../../ui/SectionHeader'

/**
 * Registry of the indicators the dashboard knows. Saved preferences refer to these ids, never to a
 * position: an id that is not here is skipped, and a new id is appended after the saved order without
 * moving anything.
 */
export const INDICATOR_REGISTRY: readonly { id: DashboardIndicator; label: string }[] = [
  { id: 'weight', label: 'Peso' },
  { id: 'steps', label: 'Pasos' },
  { id: 'sleep', label: 'Sueño' },
  { id: 'training', label: 'Entreno' },
  { id: 'water', label: 'Agua' },
  { id: 'recovery', label: 'Recuperación' },
  { id: 'habits', label: 'Hábitos' },
  { id: 'pressure', label: 'Presión arterial' },
]
const LABEL = new Map<string, string>(INDICATOR_REGISTRY.map((i) => [i.id, i.label]))

/** Ids to show, in order: saved order (known ids only) then the registry ones not saved yet. */
export function resolveOrder(saved: readonly string[] | undefined): DashboardIndicator[] {
  const known = INDICATOR_REGISTRY.map((i) => i.id)
  const set = new Set<string>(known)
  return [...new Set([...(saved ?? []).filter((id) => set.has(id)), ...known])] as DashboardIndicator[]
}

/** Presentation preferences live in the profile and travel with its backups. */
export function IndicatorGrid({ present, tiles }: { present: Record<DashboardIndicator, boolean>; tiles: Partial<Record<DashboardIndicator, ReactNode>> }) {
  const profile = useProfile()
  const [open, setOpen] = useState(false)
  const prefs = profile.settings.dashboard ?? {}
  const order = resolveOrder(prefs.order)
  const hidden = new Set(prefs.hidden ?? [])
  const hideEmpty = prefs.hideEmpty ?? true
  const shown = order.filter((id) => !hidden.has(id) && tiles[id] !== undefined)
  const visible = shown.filter((id) => !hideEmpty || present[id])
  /** Indicators that have no data yet collapse into one quiet row instead of empty boxes. */
  const missing = shown.length - visible.length
  const addRow = hideEmpty && missing > 0
  const save = (patch: Partial<NonNullable<typeof profile.settings.dashboard>>) => updateProfile(profile.id, { settings: { ...profile.settings, dashboard: { ...prefs, ...patch } } })
  async function move(id: DashboardIndicator, delta: number) {
    const from = order.indexOf(id)
    const to = from + delta
    if (to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to]!, next[from]!]
    await save({ order: next })
  }
  return (
    <section aria-label="Indicadores">
      {visible.length ? (
        <SectionHeader
          title="Indicadores"
          action={
            addRow ? undefined : (
              <button type="button" className="btn-ghost -mr-3 text-label" onClick={() => setOpen(true)} data-testid="dashboard-customize">
                Personalizar
              </button>
            )
          }
        />
      ) : null}
      {visible.length ? (
        <div className="mt-2 grid grid-cols-2 items-start gap-2.5" data-testid="dashboard-indicators">
          {visible.map((id) => (
            <div key={id} className="contents" data-indicator={id}>
              {tiles[id]}
            </div>
          ))}
        </div>
      ) : null}
      {addRow || !visible.length ? (
        <button type="button" className="flex min-h-11 w-full items-center gap-2.5 text-left text-label text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setOpen(true)} data-testid="dashboard-customize">
          <Icon name="plus" size={16} className="shrink-0" />
          <span className="min-w-0 flex-1">Agregar indicadores</span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="Personalizar indicadores">
        <label className="mb-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => void save({ hideEmpty: e.target.checked })} data-testid="dashboard-hide-empty" />
          Ocultar indicadores sin registros
        </label>
        <div className="divide-y divide-line">
          {order.map((id, index) => (
            <div key={id} className="flex items-center gap-1 py-1">
              <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
                <input type="checkbox" checked={!hidden.has(id)} onChange={() => void save({ hidden: hidden.has(id) ? [...hidden].filter((v) => v !== id) : [...hidden, id] })} />
                {LABEL.get(id)}
              </label>
              <button type="button" className="btn-ghost min-h-11 min-w-11" disabled={index === 0} aria-label={`Subir ${LABEL.get(id)}`} onClick={() => void move(id, -1)}>
                ↑
              </button>
              <button type="button" className="btn-ghost min-h-11 min-w-11" disabled={index === order.length - 1} aria-label={`Bajar ${LABEL.get(id)}`} onClick={() => void move(id, 1)}>
                ↓
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => void save({ order: INDICATOR_REGISTRY.map((i) => i.id), hidden: [], hideEmpty: true })}>
          Restablecer indicadores
        </button>
      </Sheet>
    </section>
  )
}
