/**
 * "Estado muscular" on the Entreno home: figure in recovery mode with its legend, a compact summary by
 * muscle group (expandable per group, or all 17 muscles at once, remembered per profile on this device)
 * and a sheet per muscle. Every row is a real button with the state in its accessible name, so nothing
 * depends on colour or on hitting a small shape.
 */
import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '../../../app/profile'
import { Icon } from '../../../ui/Icon'
import { SectionHeader } from '../../../ui/SectionHeader'
import { Sheet } from '../../../ui/kit'
import { MuscleMap } from '../MuscleMap'
import { BODYPARTS3D_ATTRIBUTION } from '../figureCredit'
import { shortDay } from '../shared/format'
import type { CatalogMuscles, Prepared } from '../trainingStats'
import { METHOD_PARAGRAPHS, SOURCES } from './method'
import {
  agoText,
  computeRecovery,
  formatSets,
  ruleText,
  spokenName,
  STATE_LABEL,
  summarizeGroups,
  weeklyText,
  type MuscleRecovery,
  type RecoveryState,
} from './recovery'

const STATE_TONE: Record<RecoveryState, string> = {
  recent: 'text-ink font-semibold',
  recovering: 'text-ink',
  ready: 'text-muted',
  rested: 'text-muted',
  none: 'text-faint',
}

function stateLine(r: Pick<MuscleRecovery, 'state' | 'hoursSince'>): string {
  return r.hoursSince === null ? STATE_LABEL.none : `${STATE_LABEL[r.state]} · ${agoText(r.hoursSince)}`
}
const setsWord = (n: number) => `${formatSets(n)} ${n === 1 ? 'serie' : 'series'}`

// ───────────── "Ver los 17 músculos", per profile, device only ─────────────
const allKey = (profileId: string) => `salud:training:recoveryAll:${profileId}`
function readAll(profileId: string): boolean {
  try {
    return localStorage.getItem(allKey(profileId)) === '1'
  } catch {
    return false
  }
}
function writeAll(profileId: string, on: boolean): void {
  try {
    localStorage.setItem(allKey(profileId), on ? '1' : '0')
  } catch {
    /* storage can be blocked; the choice then lasts for this visit only */
  }
}

/** "Now", refreshed when the page becomes visible or focused, and once a minute while visible. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: number | undefined
    const tick = () => setNow(Date.now())
    const arm = () => {
      window.clearInterval(timer)
      timer = document.visibilityState === 'visible' ? window.setInterval(tick, 60_000) : undefined
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
      arm()
    }
    arm()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', tick)
    }
  }, [])
  return now
}

/** Figure height by viewport width: ~230 px on 360 px phones, ~260 px from 400 px, 340 px from 1024 px
 *  (where the legend and the rows sit beside the figures). */
function useFigureHeight(): number {
  const pick = () => (typeof window === 'undefined' ? 260 : window.innerWidth >= 1024 ? 300 : window.innerWidth >= 400 ? 260 : 230)
  const [h, setH] = useState(pick)
  useEffect(() => {
    const onResize = () => setH(pick())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return h
}

const ROW = 'flex min-h-[44px] w-full items-center justify-between gap-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function RecoverySection({ prepared, catalog, labels, now: nowProp }: { prepared: Prepared; catalog: CatalogMuscles; labels: Record<string, string>; now?: number }) {
  const profileId = useProfile().id
  const figureHeight = useFigureHeight()
  const liveNow = useNow()
  const now = nowProp ?? liveNow
  const [selected, setSelected] = useState<string | null>(null)
  const [method, setMethod] = useState(false)
  const [allState, setAllState] = useState(() => ({ profileId, on: readAll(profileId) }))
  const showAll = allState.profileId === profileId ? allState.on : readAll(profileId)
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set())
  const rec = useMemo(() => computeRecovery(prepared, catalog, now), [prepared, catalog, now])
  const states = useMemo(() => new Map([...rec].map(([m, r]) => [m, r.state])), [rec])
  const groups = useMemo(() => summarizeGroups(rec), [rec])
  const name = (m: string) => labels[m] ?? m
  const hasData = [...rec.values()].some((r) => r.lastSession)
  const current = selected ? rec.get(selected) : undefined
  const close = () => {
    setSelected(null)
    setMethod(false)
  }
  const toggleAll = () => {
    writeAll(profileId, !showAll)
    setAllState({ profileId, on: !showAll })
    setOpenGroups(new Set())
  }
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section aria-labelledby="recovery-title" data-testid="recovery-section">
      <SectionHeader title={<span id="recovery-title">Estado muscular</span>} hint="Según tus sesiones registradas · orientativo" />
      <div className="mt-3 lg:[&_[data-testid=muscle-map]]:block">
        <MuscleMap
          labels={labels}
          recovery={states}
          onSelectMuscle={hasData ? setSelected : undefined}
          selected={selected}
          height={figureHeight}
          showLegend={hasData}
          expandable
          aside={
            <>
              {hasData ? (
                <button
                  type="button"
                  className="-ml-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-left text-label font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-expanded={showAll}
                  aria-controls="recovery-list"
                  onClick={toggleAll}
                  data-testid="recovery-show-all"
                >
                  {showAll ? 'Ver por grupos' : 'Ver los 17 músculos'}
                </button>
              ) : null}
              {!hasData ? (
                <p className="mt-1 text-body text-muted" data-testid="recovery-empty">
                  Cuando termines un entrenamiento verás aquí qué músculos trabajaste y hace cuánto.
                </p>
              ) : (
                <ul id="recovery-list" className="divide-rows" data-testid="recovery-list">
                  {groups.map((g) => {
                    const open = showAll || openGroups.has(g.id)
                    return (
                      <li key={g.id}>
                        {showAll ? (
                          <h3 className="pt-3 text-label text-muted" data-testid="recovery-group-heading">
                            {g.label}
                          </h3>
                        ) : (
                          <button
                            type="button"
                            className={ROW}
                            aria-expanded={open}
                            aria-label={`${spokenName(g.label, g)}. ${open ? 'Ocultar' : 'Mostrar'} sus músculos`}
                            onClick={() => toggleGroup(g.id)}
                            data-testid="recovery-group"
                            data-group={g.id}
                            data-state={g.state}
                          >
                            <span className="truncate text-body text-ink">{g.label}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className={`text-label ${STATE_TONE[g.state]}`}>{stateLine(g)}</span>
                              <Icon name="chevronDown" size={16} className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                            </span>
                          </button>
                        )}
                        {open ? (
                          <ul className={showAll ? 'divide-rows' : 'mb-2 ml-2 border-l border-line pl-3'}>
                            {g.muscles.map((r) => (
                              <li key={r.muscle}>
                                <button
                                  type="button"
                                  onClick={() => setSelected(r.muscle)}
                                  aria-label={spokenName(name(r.muscle), r)}
                                  data-testid="recovery-row"
                                  data-muscle={r.muscle}
                                  data-state={r.state}
                                  className={ROW}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-body text-ink">{name(r.muscle)}</span>
                                    <span className={`block text-label ${STATE_TONE[r.state]}`}>{stateLine(r)}</span>
                                  </span>
                                  {r.lastSession ? (
                                    <span className="num shrink-0 text-right text-label text-muted">
                                      <span className="block text-ink">{setsWord(r.lastSessionSets)}</span>
                                      <span className="block">{formatSets(r.weekSets)} en 7 d</span>
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
              {hasData && (showAll || openGroups.size > 0) ? (
                <p className="mt-2 text-label text-muted">
                  Series efectivas: cada serie de trabajo cuenta 1 para los músculos principales del ejercicio y 0,5 para los secundarios. Sin calentamientos.
                </p>
              ) : null}
            </>
          }
        />
      </div>
      <Sheet open={!!current} onClose={close} title={current ? name(current.muscle) : undefined}>
        {current ? (
          <div className="space-y-4 pb-2" data-testid="recovery-sheet">
            <div>
              <p className="text-heading text-ink" data-testid="recovery-sheet-state">
                {stateLine(current)}
              </p>
              <p className="text-body text-muted">{ruleText(current)}</p>
            </div>
            {current.lastSession ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
                <dt className="text-muted">Última sesión</dt>
                <dd className="text-ink">
                  {current.lastSession.name} · {shortDay(current.lastSession.date)}
                </dd>
                <dt className="text-muted">En esa sesión</dt>
                <dd className="num text-ink">{setsWord(current.lastSessionSets)} efectivas</dd>
                <dt className="text-muted">Últimos 7 días</dt>
                <dd className="text-ink" data-testid="recovery-sheet-week">
                  {weeklyText(current)}
                </dd>
              </dl>
            ) : null}
            {current.exercises.length ? (
              <div>
                <h3 className="text-label text-muted">Ejercicios que lo trabajaron</h3>
                <ul className="divide-rows">
                  {current.exercises.map((e) => (
                    <li key={e.exerciseId} className="flex min-h-[44px] items-center justify-between gap-3 text-body">
                      <span className="min-w-0 truncate text-ink">{e.name}</span>
                      <span className="shrink-0 text-label text-muted">
                        {e.sets} {e.sets === 1 ? 'serie' : 'series'} · {e.role === 'primary' ? 'principal' : 'secundario'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button type="button" className="btn-secondary w-full" aria-expanded={method} onClick={() => setMethod((v) => !v)} data-testid="recovery-method-toggle">
              Cómo se calcula
            </button>
            {method ? (
              <div className="space-y-2 text-label text-muted" data-testid="recovery-method">
                {METHOD_PARAGRAPHS.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                <ul className="list-disc space-y-1 pl-5">
                  {SOURCES.map((s) => (
                    <li key={s.doi}>
                      {s.cite}
                      <span className="block text-faint">doi:{s.doi}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-micro text-faint" data-testid="figure-credit">
                  Figura anatómica: {BODYPARTS3D_ATTRIBUTION}.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </section>
  )
}
