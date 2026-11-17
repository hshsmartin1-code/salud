import { useEffect, useRef, useState, type ReactNode } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { STORAGE_NOTE_TINY } from '../sync/copy'
import { OngoingSessionBar } from '../features/training/session/OngoingSessionBar'
import { useActiveSession } from '../features/training/useTraining'
import type { TrainingSession } from '../db/types'
import { observeDockInset } from './dockInset'
import { QuickAdd } from '../features/quick/QuickAdd'

/**
 * Live session focus mode: on the route of the ACTIVE session the session owns the screen (no top
 * bar, no bottom navigation). Anywhere else, while a session is active, a "Sesión en curso" bar sits
 * above the bottom navigation (and in the desktop sidebar).
 */
function useSessionChrome() {
  const { pathname } = useLocation()
  const active = useActiveSession()
  const route = matchPath('/entreno/sesion/:id', pathname)
  // While the active session is still loading on its own route, keep the chrome hidden (no flash).
  const focus = !!route && (active === undefined || active?.id === route.params.id)
  const bar = !route || active?.id !== route.params.id ? (active ?? null) : null
  return { focus, bar }
}

/** The mobile "Sesión en curso" bar: publishes its height (--dock-inset / --session-bar-inset). */
function MobileSessionBar({ session }: { session: TrainingSession }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = el.current
    if (!node) return
    return observeDockInset('session', node)
  }, [])
  return (
    <div ref={el} className="fixed inset-x-0 bottom-[calc(62px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 backdrop-blur-xl lg:hidden">
      <OngoingSessionBar session={session} variant="bottom" />
    </div>
  )
}

type NavItem = { to: string; label: string; icon: IconName; end?: boolean }

export const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Hoy', icon: 'home', end: true },
  { to: '/comida', label: 'Comida', icon: 'utensils' },
  { to: '/entreno', label: 'Entreno', icon: 'dumbbell' },
  { to: '/salud', label: 'Salud', icon: 'heart' },
]

/** Health modules, reachable from the Salud hub (mobile) and the sidebar (desktop). */
export const HEALTH_NAV: NavItem[] = [
  { to: '/cuerpo', label: 'Cuerpo y medidas', icon: 'ruler' },
  { to: '/actividad', label: 'Actividad', icon: 'activity' },
  { to: '/sueno', label: 'Sueño y recuperación', icon: 'bed' },
  { to: '/signos', label: 'Signos vitales', icon: 'heart' },
  { to: '/agua', label: 'Hidratación', icon: 'droplet' },
  { to: '/habitos', label: 'Hábitos y suplementos', icon: 'pill' },
  { to: '/fotos', label: 'Fotos de progreso', icon: 'image' },
]

export const MORE_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Análisis', items: [{ to: '/progreso', label: 'Gráficas de progreso', icon: 'chart' }] },
  {
    // Same order as /ajustes: everyday first (account, profile), then data; technical items live inside "Ajustes > Avanzado".
    title: 'Cuenta y datos',
    items: [
      { to: '/cuenta', label: 'Cuenta y sincronización', icon: 'user' },
      { to: '/perfil', label: 'Perfil y objetivos', icon: 'target' },
      { to: '/ajustes', label: 'Ajustes', icon: 'sliders' },
      { to: '/integraciones', label: 'Health Connect', icon: 'link' },
      { to: '/respaldo', label: 'Datos y respaldos', icon: 'database' },
    ],
  },
]
export const MORE_NAV: NavItem[] = MORE_GROUPS.flatMap((g) => g.items)

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
  const { focus, bar } = useSessionChrome()
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
        {bar ? <OngoingSessionBar session={bar} variant="sidebar" /> : null}
        <nav className="flex flex-col gap-0.5" aria-label="Principal">
          {MAIN_NAV.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="mb-1 mt-5 px-3 text-label font-medium text-faint">Salud</div>
        <nav className="flex flex-col gap-0.5" aria-label="Salud">
          {HEALTH_NAV.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        {MORE_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 mt-5 px-3 text-label font-medium text-faint">{g.title}</div>
            <nav className="flex flex-col gap-0.5" aria-label={g.title}>
              {g.items.map((i) => (
                <SideLink key={i.to} item={i} />
              ))}
            </nav>
          </div>
        ))}
        <div className="mt-auto px-3 pt-4 text-micro text-faint">
          {STORAGE_NOTE_TINY}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar (hidden while the live session owns the screen) */}
        {focus ? null : (
        <header className="pt-safe sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
            <div className="min-w-0 flex-1">{header}</div>
            <NavLink to="/mas" className="btn-ghost p-2" aria-label="Más secciones">
              <Icon name="grid" />
            </NavLink>
          </div>
        </header>
        )}

        <main
          className={`mx-auto w-full max-w-3xl px-4 lg:max-w-5xl lg:px-10 lg:pb-[calc(3.5rem+var(--update-banner-inset,0px))] ${focus ? 'pb-10 pt-0' : bar ? 'pb-[calc(11rem+var(--update-banner-inset,0px))] pt-5 lg:pt-10' : 'pb-[calc(7rem+var(--update-banner-inset,0px))] pt-5 lg:pt-10'}`}
        >
          {children}
        </main>

        {/* "Sesión en curso": above the bottom navigation, never over the page (main is padded) */}
        {bar && !focus ? <MobileSessionBar session={bar} /> : null}

        {/* Mobile bottom nav */}
        {focus ? null : (
        <nav
          aria-label="Principal"
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden"
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
        )}
      </div>
      <QuickAdd open={quick} onClose={() => setQuick(false)} />
    </div>
  )
}

function BottomLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center gap-1 text-micro font-medium transition-colors before:absolute before:top-0 before:h-[3px] before:w-8 before:rounded-b-full ${
          isActive ? 'text-ink before:bg-accent' : 'text-muted before:bg-transparent'
        }`
      }
    >
      <Icon name={item.icon} size={22} />
      {item.label}
    </NavLink>
  )
}
