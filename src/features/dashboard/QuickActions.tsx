import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../ui/Icon'
import type { QuickTarget } from '../health/QuickLog'

const CHIP = 'flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-line bg-surface px-1 text-label font-medium text-ink outline-none transition-colors duration-state hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-accent active:bg-surface2'

function Chip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <>
      <Icon name={icon} size={18} className="text-muted" />
      <span className="max-w-full truncate">{label}</span>
    </>
  )
}

/** Comida goes to the search for the meal of the hour; the other three open the Salud quick sheets in place. */
export function QuickActions({ mealPath, onOpen }: { mealPath: string; onOpen: (t: QuickTarget) => void }) {
  return (
    <section aria-label="Registrar" data-testid="hoy-quick">
      <div className="grid grid-cols-4 gap-2">
        <Link to={mealPath} className={CHIP} data-testid="hoy-quick-meal">
          <Chip icon="utensils" label="Comida" />
        </Link>
        <button type="button" className={CHIP} onClick={() => onOpen({ kind: 'water' })} data-testid="hoy-quick-water">
          <Chip icon="droplet" label="Agua" />
        </button>
        <button type="button" className={CHIP} onClick={() => onOpen({ kind: 'weight' })} data-testid="hoy-quick-weight">
          <Chip icon="scale" label="Peso" />
        </button>
        <button type="button" className={CHIP} onClick={() => onOpen({ kind: 'sleep' })} data-testid="hoy-quick-sleep">
          <Chip icon="bed" label="Sueño" />
        </button>
      </div>
    </section>
  )
}
