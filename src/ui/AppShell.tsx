import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { Sheet } from './kit'

type NavItem = { to: string; label: string; icon: IconName; end?: boolean }

export const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Hoy', icon: 'home', end: true },
  { to: '/comida', label: 'Comida', icon: 'utensils' },
  { to: '/entreno', label: 'Entreno', icon: 'dumbbell' },
  { to: '/cuerpo', label: 'Cuerpo', icon: 'ruler' },
]

export const MORE_NAV: NavItem[] = [
  { to: '/progreso', label: 'Progreso', icon: 'chart' },
  { to: '/actividad', label: 'Actividad', icon: 'activity' },
  { to: '/sueno', label: 'Sueño y recuperación', icon: 'bed' },
  { to: '/habitos', label: 'Hábitos y suplementos', icon: 'pill' },
  { to: '/perfil', label: 'Perfil y objetivos', icon: 'target' },
  { to: '/respaldo', label: 'Respaldo e importación', icon: 'database' },
  { to: '/ajustes', label: 'Ajustes y fuentes', icon: 'sliders' },
]

export const QUICK_ADD: { to: string; label: string; icon: IconName; hint: string }[] = [
  { to: '/comida/buscar', label: 'Alimento', icon: 'search', hint: 'Buscar y registrar por peso' },
  { to: '/comida/etiqueta', label: 'Etiqueta', icon: 'tag', hint: 'Desde la tabla nutricional' },
  { to: '/comida/buscar?scan=1', label: 'Código de barras', icon: 'barcode', hint: 'Open Food Facts' },
  { to: '/comida/recetas', label: 'Receta', icon: 'book', hint: 'Registrar una receta' },
  { to: '/entreno?iniciar=1', label: 'Entrenamiento', icon: 'dumbbell', hint: 'Iniciar sesión' },
  { to: '/cuerpo/nueva?tipo=peso', label: 'Peso', icon: 'scale', hint: 'Peso corporal' },
  { to: '/cuerpo/nueva', label: 'Medidas', icon: 'ruler', hint: 'Perímetros y pliegues' },
  { to: '/actividad?nuevo=1', label: 'Actividad', icon: 'activity', hint: 'Pasos, cardio' },
  { to: '/sueno?nuevo=1', label: 'Sueño', icon: 'bed', hint: 'Horas y calidad' },
  { to: '/habitos', label: 'Hábitos', icon: 'check', hint: 'Marcar del día' },
]

function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  return (
    <Sheet open={open} onClose={onClose} title="Registrar">
      <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3">
        {QUICK_ADD.map((q) => (
          <button
            key={q.to}
            type="button"
            onClick={() => {
              onClose()
              nav(q.to)
            }}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface2/50 active:scale-[0.98]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon name={q.icon} size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold">{q.label}</span>
              <span className="block text-xs text-muted">{q.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

function SideLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full ${
          isActive ? 'bg-surface2 text-ink before:bg-accent' : 'text-muted before:bg-transparent hover:bg-surface2/60 hover:text-ink'
        }`
      }
    >
      <Icon name={item.icon} size={19} />
      {item.label}
    </NavLink>
  )
}

export function AppShell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  const [quick, setQuick] = useState(false)
  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-4 lg:flex">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <img src="./favicon.svg" alt="" className="h-7 w-7" />
          <span className="title-wide text-lg font-bold">Salud</span>
        </div>
        {header ? <div className="mb-3">{header}</div> : null}
        <button type="button" className="btn-primary mb-3 w-full" onClick={() => setQuick(true)}>
          <Icon name="plus" size={18} /> Registrar
        </button>
        <nav className="flex flex-col gap-0.5" aria-label="Principal">
          {MAIN_NAV.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="mb-1 mt-5 px-3 text-[13px] font-medium text-faint">Más</div>
        <nav className="flex flex-col gap-0.5" aria-label="Secundaria">
          {MORE_NAV.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="mt-auto px-3 pt-4 text-[11px] leading-snug text-faint">
          Datos guardados solo en este dispositivo. Sin sincronización.
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/95 lg:hidden">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
            <div className="min-w-0 flex-1">{header}</div>
            <NavLink to="/mas" className="btn-ghost p-2" aria-label="Más secciones">
              <Icon name="grid" />
            </NavLink>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 lg:max-w-5xl lg:px-10 lg:pb-14 lg:pt-10">{children}</main>

        {/* Mobile bottom nav */}
        <nav
          aria-label="Principal"
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden"
        >
          <div className="mx-auto grid h-[62px] max-w-md grid-cols-5 items-stretch px-2">
            {MAIN_NAV.slice(0, 2).map((i) => (
              <BottomLink key={i.to} item={i} />
            ))}
            <div className="flex justify-center">
              <button
                type="button"
                aria-label="Registrar"
                onClick={() => setQuick(true)}
                className="my-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-ink-contrast transition active:scale-95"
              >
                <Icon name="plus" size={24} strokeWidth={2.2} />
              </button>
            </div>
            {MAIN_NAV.slice(2).map((i) => (
              <BottomLink key={i.to} item={i} />
            ))}
          </div>
        </nav>
      </div>
      <QuickAddSheet open={quick} onClose={() => setQuick(false)} />
    </div>
  )
}

function BottomLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors before:absolute before:top-0 before:h-[3px] before:w-8 before:rounded-b-full ${
          isActive ? 'text-ink before:bg-accent' : 'text-muted before:bg-transparent'
        }`
      }
    >
      <Icon name={item.icon} size={22} />
      {item.label}
    </NavLink>
  )
}
