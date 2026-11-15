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
            className="flex flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-3 text-left transition hover:border-accent/40 hover:bg-accent/5"
          >
            <span className="rounded-xl bg-accent/10 p-2 text-accent">
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
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2 hover:text-ink'
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
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-1 border-r border-line bg-surface/60 p-4 lg:flex">
        <div className="mb-3 flex items-center gap-2 px-2">
          <img src="./favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-bold tracking-tight">Salud</span>
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
        <div className="section-title mb-1 mt-5 px-3">Más</div>
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
        <header className="pt-safe sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
            <div className="min-w-0 flex-1">{header}</div>
            <NavLink to="/mas" className="btn-ghost p-2" aria-label="Más secciones">
              <Icon name="grid" />
            </NavLink>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 lg:max-w-5xl lg:px-8 lg:pb-12 lg:pt-8">{children}</main>

        {/* Mobile bottom nav */}
        <nav
          aria-label="Principal"
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/90 backdrop-blur-md lg:hidden"
        >
          <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
            {MAIN_NAV.slice(0, 2).map((i) => (
              <BottomLink key={i.to} item={i} />
            ))}
            <div className="flex justify-center">
              <button
                type="button"
                aria-label="Registrar"
                onClick={() => setQuick(true)}
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-pop transition active:scale-95"
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
        `flex flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition ${isActive ? 'text-accent' : 'text-muted'}`
      }
    >
      <Icon name={item.icon} size={22} />
      {item.label}
    </NavLink>
  )
}
