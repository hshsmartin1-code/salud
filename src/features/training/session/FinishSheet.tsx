import { useState } from 'react'
import { useRepo } from '../../../app/profile'
import type { TrainingSession } from '../../../db/types'
import { formatNumber } from '../../../domain/units'
import { Icon } from '../../../ui/Icon'
import { Sheet } from '../../../ui/kit'
import { useTextDraft } from '../useSetDraft'
import { ElapsedClock } from './clock'
import type { SessionStats } from './model'
import type { RecordLine } from './records'
import { useSaveGuard } from './saveGuard'

/**
 * "Terminar": what was done, the records of the session, what happens to the rows not marked done, an
 * optional note and overall effort.
 *
 * Rows not marked done are split in two (see sessionWork.ts, "touched"): rows the person typed or
 * confirmed values in are offered to be saved as done (the default) or discarded; rows prefilled from
 * last time and never touched are discarded. "Deshacer" after finishing reopens everything.
 */
export function FinishSheet({
  open,
  onClose,
  session,
  stats,
  records,
  withData,
  onFinish,
}: {
  open: boolean
  onClose: () => void
  session: TrainingSession
  stats: SessionStats
  records: readonly RecordLine[]
  /** Pending rows with values the person typed or confirmed in this session. */
  withData: number
  /** complete: also mark the pending rows with data as done. */
  onFinish: (complete: boolean) => Promise<void>
}) {
  // One finish per opening: a double tap must not finish twice (or show two toasts).
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setBusy(false)
  }
  const run = (complete: boolean) => {
    if (busy) return
    setBusy(true)
    onFinish(complete).catch(() => setBusy(false))
  }
  const primary = withData === 0 ? 'Terminar entrenamiento' : withData === 1 ? 'Marcar como hecha la serie con datos' : `Marcar como hechas las ${withData} series con datos`
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Terminar entrenamiento"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" className="btn-secondary sm:min-w-[160px]" onClick={onClose} data-autofocus>
            Seguir entrenando
          </button>
          {withData ? (
            <button type="button" className="btn-secondary sm:min-w-[160px]" disabled={busy} onClick={() => run(false)} data-testid="finish-discard">
              Descartarlas y terminar
            </button>
          ) : null}
          <button type="button" className="btn-primary sm:min-w-[200px]" disabled={busy} aria-busy={busy} onClick={() => run(true)} data-testid="finish-confirm">
            <Icon name="check" size={18} strokeWidth={2.4} /> {primary}
          </button>
        </div>
      }
    >
      {open ? <FinishBody session={session} stats={stats} records={records} withData={withData} /> : null}
    </Sheet>
  )
}

function FinishBody({ session, stats, records, withData }: { session: TrainingSession; stats: SessionStats; records: readonly RecordLine[]; withData: number }) {
  const r = useRepo()
  const guard = useSaveGuard()
  const note = useTextDraft(session.notes, (v) => r.update('trainingSessions', session.id, { notes: v }), `session-note:${session.id}`)
  const rpe = session.rpe ?? null
  const untouched = stats.pending - withData
  const cell = 'min-w-0 bg-surface px-3 py-3'
  return (
    <div className="pb-2" data-testid="finish-summary">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        <div className={cell}>
          <div className="text-label text-muted">Tiempo</div>
          <ElapsedClock startedAt={session.startedAt} className="readout mt-1 block text-readout" />
        </div>
        <div className={cell}>
          <div className="text-label text-muted">Series hechas</div>
          <div className="readout mt-1 text-readout">
            {stats.workDone}
            <span className="ml-1 text-label font-medium text-muted">de {stats.workTotal}</span>
          </div>
        </div>
        <div className={cell}>
          <div className="text-label text-muted">Volumen</div>
          <div className="readout mt-1 text-readout">
            {formatNumber(stats.volume, 0)}
            <span className="ml-1 text-label font-medium text-muted">kg</span>
          </div>
        </div>
        <div className={cell}>
          <div className="text-label text-muted">Récords</div>
          <div className={`readout mt-1 flex items-center gap-1.5 text-readout ${records.length ? 'text-warn' : ''}`}>
            {records.length ? <Icon name="trophy" size={20} strokeWidth={2.2} /> : null}
            {records.length}
          </div>
        </div>
      </div>

      {records.length ? (
        <ul className="mt-3 space-y-1.5 rounded-xl bg-warn/10 px-3 py-2.5" data-testid="finish-records" aria-label="Récords de esta sesión">
          {records.map((rec) => (
            <li key={rec.key} className="flex items-start gap-2 text-label text-ink">
              <Icon name="trophy" size={15} className="mt-px shrink-0 text-warn" strokeWidth={2.2} />
              <span>
                <span className="font-semibold">{rec.exercise}</span> · {rec.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {withData ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-train/10 px-3 py-2.5 text-label text-ink" data-testid="finish-with-data">
          <Icon name="pencil" size={16} className="mt-px shrink-0 text-train" />
          <span>
            {withData === 1 ? 'Hay 1 serie con datos que no marcaste como hecha.' : `Hay ${withData} series con datos que no marcaste como hechas.`} Puedes guardarlas como hechas o descartarlas.
          </span>
        </p>
      ) : null}
      {untouched > 0 ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2.5 text-label text-ink" data-testid="finish-discarded">
          <Icon name="alert" size={16} className="mt-px shrink-0 text-warn" />
          <span>
            {untouched === 1 ? 'Se descartará 1 serie sin completar' : `Se descartarán ${untouched} series sin completar`} (prellenadas y sin tocar). Las series completadas se guardan.
          </span>
        </p>
      ) : null}
      {!stats.pending ? <p className="mt-3 text-label text-muted">Todas las series están completadas.</p> : null}

      <label className="mt-5 block">
        <span className="label">Nota de la sesión (opcional)</span>
        <textarea className="field min-h-[72px] resize-none" placeholder="Cómo te sentiste, qué ajustar la próxima vez…" {...note.bind()} />
      </label>

      <div className="mt-4" role="radiogroup" aria-label="Esfuerzo de la sesión, de 1 a 10">
        <span className="label">Esfuerzo de la sesión (opcional) · 1 muy fácil, 10 máximo</span>
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={rpe === v}
              aria-label={`Esfuerzo ${v} de 10`}
              className={`h-11 rounded-lg readout text-[18px] motion-safe:transition-colors ${rpe === v ? 'bg-ink text-ink-contrast' : 'bg-surface2 text-ink hover:bg-line'}`}
              onClick={() => void guard(r.update('trainingSessions', session.id, { rpe: rpe === v ? null : v }))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
