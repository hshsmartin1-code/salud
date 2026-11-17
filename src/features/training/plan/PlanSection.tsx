import { useState } from 'react'
import { Icon } from '../../../ui/Icon'
import { Sheet, Segmented } from '../../../ui/kit'
import { SelectField } from '../../../ui/fields'
import { useConfirm } from '../../../ui/Confirm'
import { addDays, isoWeekStart, isoWeekday } from '../../../domain/dates'
import type { Routine } from '../../../db/types'
import { useDesktop } from '../../nutrition/useDesktop'
import { useStartTraining } from '../shared/useStartTraining'
import { moveDay, planFor, setOverride, setWeekday } from './plan'
import { PlanReminderRow } from './PlanReminderRow'
import { usePlan, type PlanCell, type PlanState } from './usePlan'

const LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos']
const ABBR = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const NONE = 'none'

/** First word of the routine name ('Pierna A' → 'Pierna'), or 'Entreno' for a day without routine. The full name is in the accessible name and the sheet. */
const shortName = (name: string | undefined) => name?.trim().split(/\s+/)[0] || 'Entreno'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const dayNumber = (date: string) => Number(date.slice(8, 10))
const shortDay = (cell: { weekday: number; date: string }) => `${ABBR[cell.weekday - 1]} ${dayNumber(cell.date)}`

function cellLabel(c: PlanCell): string {
  const what = c.status === 'done' ? 'entreno hecho' : c.status === 'planned' ? `entreno${c.routine ? `: ${c.routine.name}` : ''}` : c.status === 'rest' ? 'descanso' : 'sin plan'
  return `${NAMES[c.weekday - 1]} ${dayNumber(c.date)}, ${what}${c.today ? ', hoy' : ''}`
}

function DayCell({ cell, onOpen }: { cell: PlanCell; onOpen: () => void }) {
  const planned = cell.status === 'planned'
  const tone = cell.status === 'done' ? 'bg-[rgb(var(--train)/0.16)] text-ink' : planned ? 'bg-surface2 text-ink' : 'text-muted'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={cellLabel(cell)}
      data-testid="plan-day"
      data-date={cell.date}
      data-status={cell.status}
      className={`flex min-h-[60px] min-w-0 flex-col items-center justify-start gap-0.5 rounded-xl px-0 pb-1 pt-1.5 outline-none transition-colors hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent ${tone} ${cell.past && cell.status !== 'done' ? 'opacity-60' : ''}`}
    >
      <span className="text-micro text-muted" aria-hidden="true">
        {LETTERS[cell.weekday - 1]}
      </span>
      <span className={`num flex h-6 w-6 items-center justify-center rounded-full text-label ${cell.today ? 'bg-ink font-semibold text-bg' : ''}`} aria-hidden="true">
        {dayNumber(cell.date)}
      </span>
      <span className="flex h-4 w-full items-center justify-center text-micro" aria-hidden="true">
        {cell.status === 'done' ? (
          <Icon name="check" size={14} />
        ) : planned ? (
          <span className="block max-w-full truncate font-medium">{shortName(cell.routine?.name)}</span>
        ) : (
          <span className="text-faint">–</span>
        )}
      </span>
    </button>
  )
}

/** Entreno home → «Mi planificación»: the week as seven day cells, the next session, and the sheets that edit the plan. */
export function PlanSection({ dockOffersId = null }: { dockOffersId?: string | null } = {}) {
  const p = usePlan()
  const desktop = useDesktop()
  const start = useStartTraining()
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [setup, setSetup] = useState(false)

  if (!p.ready) return <div data-testid="plan-loading" className="h-[118px]" aria-hidden="true" />

  const cell = openDate ? p.week.find((c) => c.date === openDate) : undefined
  const next = p.next
  const nextText = next
    ? `Próxima sesión: ${next.date === p.today ? 'hoy' : shortDay({ weekday: isoWeekday(next.date), date: next.date })}${next.routine ? ` · ${next.routine.name}` : ''}`
    : 'Sin próxima sesión planificada'
  // On a phone the dock under this screen already offers this very routine: no second «Iniciar» here, only the text.
  const dockHasIt = !desktop && !!next?.routine && next.routine.id === dockOffersId
  const canStart = !!next && next.date === p.today && !dockHasIt

  return (
    <section aria-labelledby="plan-title" data-testid="plan-section">
      <div className="flex items-center justify-between gap-3">
        <h2 id="plan-title" className="min-w-0 text-heading text-ink">
          Mi planificación
        </h2>
        {p.has ? (
          <button type="button" className="-mr-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-label font-medium text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setSetup(true)} data-testid="plan-edit">
            Editar
          </button>
        ) : null}
      </div>
      {p.has ? (
        <div className="lg:flex lg:items-center lg:gap-10">
          <div className="mt-1 grid grid-cols-7 gap-0.5 lg:w-[30rem] lg:shrink-0" role="group" aria-label="Semana actual" data-testid="plan-week">
            {p.week.map((c) => (
              <DayCell key={c.date} cell={c} onOpen={() => setOpenDate(c.date)} />
            ))}
          </div>
          <div className="mt-2 flex min-h-[44px] items-center justify-between gap-3 lg:mt-0 lg:min-w-0 lg:flex-1">
            <p className="min-w-0 truncate text-body text-muted" data-testid="plan-next">
              {nextText}
            </p>
            {canStart ? (
              <button type="button" className="btn-primary min-h-[44px] shrink-0 px-4" onClick={() => void start(next!.routine ?? undefined)} data-testid="plan-start" aria-label={next!.routine ? `Iniciar ${next!.routine.name}` : 'Iniciar entrenamiento'}>
                <Icon name="play" size={16} /> Iniciar
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="plan-empty">
          <p className="text-body text-muted">Elige los días en que entrenas y verás aquí qué toca y cuándo.</p>
          <button type="button" className="btn-secondary shrink-0" onClick={() => setSetup(true)} data-testid="plan-create">
            <Icon name="calendar" size={16} /> Planificar semana
          </button>
        </div>
      )}
      {cell && p.has ? <DaySheet cell={cell} p={p} onClose={() => setOpenDate(null)} /> : null}
      <SetupSheet open={setup} onClose={() => setSetup(false)} p={p} />
    </section>
  )
}

function routineOptions(routines: readonly Routine[]) {
  return [{ value: NONE, label: 'Sin rutina' }, ...routines.map((r) => ({ value: r.id, label: r.name }))]
}

function DaySheet({ cell, p, onClose }: { cell: PlanCell; p: PlanState; onClose: () => void }) {
  const wd = cell.weekday
  const weekdayEntry = p.plan?.days?.[String(wd)]
  const baseTrains = !!weekdayEntry
  const over = p.plan?.overrides?.[cell.date]
  const effective = planFor(p.plan, cell.date)
  const effectiveTrains = effective?.kind === 'train'
  const known = (id: string | null | undefined) => (id && p.routines.some((r) => r.id === id) ? id : NONE)
  const options = routineOptions(p.routines)
  const canEditDate = !cell.past && cell.status !== 'done'

  // Dates this one session can move to: from today to the end of next week, resting days only.
  const end = addDays(isoWeekStart(p.today), 13)
  const targets: { value: string; label: string }[] = []
  for (let d = p.today; d <= end; d = addDays(d, 1)) {
    if (d === cell.date || p.done.has(d) || planFor(p.plan, d)?.kind === 'train') continue
    const w = isoWeekday(d)
    targets.push({ value: d, label: `${cap(NAMES[w - 1]!)} ${dayNumber(d)}` })
  }

  const singular = NAMES[wd - 1]!
  const weekdayRoutine = weekdayEntry?.routineId ?? null
  return (
    <Sheet open onClose={onClose} title={`${cap(singular)} ${dayNumber(cell.date)}`}>
      <div className="space-y-5 pb-2" data-testid="plan-day-sheet">
        {cell.status === 'done' ? <p className="text-body text-muted">Ya entrenaste este día.</p> : null}

        <section aria-label={`Todos los ${PLURAL[wd - 1]}`} className="space-y-2">
          <h3 className="text-label font-medium text-muted">Todos los {PLURAL[wd - 1]}</h3>
          <Segmented
            ariaLabel={`Todos los ${PLURAL[wd - 1]}`}
            value={baseTrains ? 'train' : 'rest'}
            onChange={(v) => void p.edit((pl) => setWeekday(pl, wd, v === 'train' ? { kind: 'train', routineId: weekdayRoutine } : { kind: 'rest' }))}
            options={[
              { value: 'train', label: 'Entreno' },
              { value: 'rest', label: 'Descanso' },
            ]}
          />
          {baseTrains ? (
            <SelectField
              label="Rutina"
              value={known(weekdayRoutine)}
              onChange={(v) => void p.edit((pl) => setWeekday(pl, wd, { kind: 'train', routineId: v === NONE ? null : v }))}
              options={options}
            />
          ) : null}
        </section>

        {canEditDate ? (
          <section aria-label={`Solo este ${singular}`} className="space-y-2 border-t border-line pt-4">
            <h3 className="text-label font-medium text-muted">Solo este {singular}</h3>
            <Segmented
              ariaLabel={`Solo este ${singular}`}
              value={over ? (over && 'rest' in over ? 'rest' : 'train') : 'same'}
              onChange={(v) =>
                void p.edit((pl) => setOverride(pl, cell.date, v === 'same' ? null : v === 'rest' ? { kind: 'rest' } : { kind: 'train', routineId: weekdayRoutine }))
              }
              options={[
                { value: 'same', label: 'Igual' },
                baseTrains ? { value: 'rest', label: 'Descanso' } : { value: 'train', label: 'Entreno' },
              ]}
            />
            {effective?.kind === 'train' ? (
              <SelectField
                label="Rutina de este día"
                value={known(effective.routineId)}
                onChange={(v) => void p.edit((pl) => setOverride(pl, cell.date, { kind: 'train', routineId: v === NONE ? null : v }))}
                options={options}
              />
            ) : null}
            {effectiveTrains && targets.length ? (
              <SelectField
                label="Mover a otro día"
                value=""
                placeholder="Elegir día"
                onChange={(to) => {
                  void p.edit((pl) => moveDay(pl, cell.date, to))
                  onClose()
                }}
                options={targets}
              />
            ) : null}
            {over ? (
              <button type="button" className="btn-secondary w-full" onClick={() => void p.edit((pl) => setOverride(pl, cell.date, null))} data-testid="plan-clear-override">
                Quitar cambio
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </Sheet>
  )
}

function SetupSheet({ open, onClose, p }: { open: boolean; onClose: () => void; p: PlanState }) {
  const confirm = useConfirm()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={p.has ? 'Mi planificación' : 'Planificar semana'}
      footer={
        <button type="button" className="btn-primary w-full" onClick={onClose} data-testid="plan-done">
          Listo
        </button>
      }
    >
      <div className="space-y-4 pb-2" data-testid="plan-setup">
        <p className="text-body text-muted">Días en que entrenas</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Días en que entrenas">
          {NAMES.map((name, i) => {
            const wd = i + 1
            const on = !!p.plan?.days?.[String(wd)]
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                data-testid="plan-weekday"
                onClick={() => void p.edit((pl) => setWeekday(pl, wd, on ? null : { kind: 'train', routineId: null }))}
                className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3 text-left text-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${on ? 'border-accent bg-surface2 font-semibold text-ink' : 'border-line text-muted hover:bg-surface2'}`}
              >
                {cap(name)}
                {on ? <Icon name="check" size={16} /> : null}
              </button>
            )
          })}
        </div>
        {p.has ? (
          <>
            <PlanReminderRow p={p} />
            <button
              type="button"
              className="btn-ghost w-full text-bad"
              data-testid="plan-remove"
              onClick={async () => {
                const ok = await confirm({ title: '¿Quitar la planificación?', body: 'Tus entrenamientos y rutinas no cambian.', confirmLabel: 'Quitar', cancelLabel: 'Cancelar', tone: 'danger' })
                if (!ok) return
                await p.save(undefined)
                onClose()
              }}
            >
              Quitar planificación
            </button>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
