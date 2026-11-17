import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatNumber } from '../../../domain/units'
import { useConfirm } from '../../../ui/Confirm'
import type { MenuItem } from '../../../ui/Menu'
import { Skeleton } from '../../../ui/Skeleton'
import { useToast } from '../../../ui/Toast'
import { EmptyState, PageHeader } from '../../../ui/kit'
import { plural } from '../routines'
import { deleteSession } from '../session'
import { weekdayDay } from '../shared/format'
import { useStartTraining } from '../shared/useStartTraining'
import { useTrainingData } from '../shared/useTrainingData'
import { allRecords, digestSessions, groupByMonth, recordCountBySession, type SessionDigest } from '../trainingStats'
import { SessionCard } from './SessionCard'

const PAGE = 30

export function HistoryPage() {
  const { r, routines, prepared, ex } = useTrainingData()
  const start = useStartTraining()
  const confirm = useConfirm()
  const toast = useToast()
  const [shown, setShown] = useState(PAGE)
  const [params, setParams] = useSearchParams()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? params.get('dia')! : null
  const digests = useMemo(() => (prepared ? digestSessions(prepared, recordCountBySession(prepared, allRecords(prepared))) : null), [prepared])
  const byRoutine = useMemo(() => new Map((routines ?? []).map((rt) => [rt.id, rt])), [routines])

  async function remove(dg: SessionDigest) {
    const s = dg.session
    const ok = await confirm({
      title: `¿Eliminar «${s.name}»?`,
      body: `Sesión del ${weekdayDay(s.date)} con ${plural(dg.workSets, 'serie', 'series')} de trabajo. Se borran la sesión y todas sus series. No se puede deshacer.`,
      confirmLabel: 'Eliminar sesión',
      tone: 'danger',
    })
    if (!ok) return
    await deleteSession(r, s)
    toast.show({ message: 'Sesión eliminada' })
  }

  function menuFor(dg: SessionDigest): MenuItem[] {
    const routine = dg.session.routineId ? byRoutine.get(dg.session.routineId) : undefined
    return [
      ...(routine ? [{ label: `Repetir «${routine.name}»`, icon: 'refresh' as const, onSelect: () => void start(routine) }] : []),
      { label: 'Eliminar', icon: 'trash' as const, tone: 'danger' as const, onSelect: () => void remove(dg) },
    ]
  }

  if (!digests) {
    return (
      <>
        <PageHeader title="Historial" back="/entreno" />
        <Skeleton lines={6} label="Cargando historial" />
      </>
    )
  }
  const filtered = day ? digests.filter((x) => x.session.date === day) : digests
  const visible = filtered.slice(0, shown)
  const groups = groupByMonth(visible)
  return (
    <>
      <PageHeader title="Historial" back="/entreno" subtitle={digests.length ? plural(digests.length, 'entrenamiento terminado', 'entrenamientos terminados') : undefined} />
      {day ? (
        <p className="-mt-2 mb-4 flex items-center justify-between gap-3 text-label text-muted" data-testid="history-day">
          <span>Mostrando solo el {weekdayDay(day)}</span>
          <button type="button" className="btn-ghost px-2 text-label" onClick={() => setParams({}, { replace: true })}>
            Quitar filtro
          </button>
        </p>
      ) : null}
      {digests.length ? (
        <>
        <div className="space-y-7" data-testid="history-page">
          {groups.map((g) => {
            const all = digests.filter((x) => x.session.date.slice(0, 7) === g.key)
            const volume = all.reduce((a, x) => a + x.volume, 0)
            return (
              <section key={g.key} aria-labelledby={`m-${g.key}`} data-testid="history-month">
                <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <h2 id={`m-${g.key}`} className="text-heading text-ink">
                    {g.label}
                  </h2>
                  <p className="num text-label text-muted">
                    {plural(all.length, 'sesión', 'sesiones')} · {formatNumber(volume, 0)} kg
                  </p>
                </div>
                <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {g.rows.map((dg) => (
                    <SessionCard key={dg.session.id} digest={dg} prepared={prepared!} ex={ex} menu={menuFor(dg)} />
                  ))}
                </ul>
              </section>
            )
          })}
          {filtered.length > shown ? (
            <button type="button" className="btn-secondary w-full" onClick={() => setShown((n) => n + PAGE)} data-testid="history-more">
              Mostrar {Math.min(PAGE, filtered.length - shown)} más ({filtered.length - shown} sin mostrar)
            </button>
          ) : null}
        </div>
        </>
      ) : (
        <EmptyState icon="dumbbell" title="Sin entrenamientos terminados">
          Cuando termines una sesión aparecerá aquí. <Link to="/entreno" className="underline underline-offset-2">Volver a Entreno</Link>
        </EmptyState>
      )}
    </>
  )
}
