import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { dayLabel } from '../../app/useDate'
import { useRepo } from '../../app/profile'
import type { MealKey } from '../../db/types'
import { addDays } from '../../domain/dates'
import { formatNutrient } from '../../domain/nutrients'
import { Sheet } from '../../ui/kit'
import { datesWithSlot, initialDraft, planCopy, rowsOf, unitText, type CopyDraft } from './copyPrevious'
import type { LogEntry } from './quickAdd'
import { useMealSlots } from './useMealSlots'

/**
 * "Copiar comida anterior": pick a date (the latest earlier one with entries in this slot by default), tick the foods,
 * adjust a quantity if needed and copy them in one batch. The footer stays above the keyboard (Sheet follows the visual viewport).
 */
export function CopyMealSheet({
  meal,
  date,
  onClose,
  onCopy,
}: {
  meal: MealKey | null
  /** The day being viewed: where the foods go. */
  date: string
  onClose: () => void
  onCopy: (entries: LogEntry[], from: string, meal: MealKey) => void
}) {
  return meal ? <Body key={`${meal}|${date}`} meal={meal} date={date} onClose={onClose} onCopy={onCopy} /> : null
}

function Body({ meal, date, onClose, onCopy }: { meal: MealKey; date: string; onClose: () => void; onCopy: (entries: LogEntry[], from: string, meal: MealKey) => void }) {
  const r = useRepo()
  const slots = useMealSlots()
  const name = slots.label(meal)
  // Every earlier log of this slot: one read answers "which is the latest date" and lists the foods of any date picked.
  const earlier = useLiveQuery(async () => (await r.range('foodLogs', '0000-01-01', addDays(date, -1))).filter((l) => l.meal === meal), [r, date, meal])
  const dates = useMemo(() => (earlier ? datesWithSlot(earlier, meal, date) : []), [earlier, meal, date])
  const [picked, setPicked] = useState<string | null>(null)
  const from = picked ?? dates[0] ?? addDays(date, -1)
  const rows = useMemo(() => (earlier && from < date ? rowsOf(earlier, meal, from) : []), [earlier, meal, from, date])
  const loaded = earlier !== undefined

  // The draft restarts whenever the date or the foods behind it change.
  const key = `${from}|${rows.map((x) => x.id).join(',')}`
  const [state, setState] = useState<{ key: string; draft: CopyDraft }>({ key: '', draft: { checked: {}, qty: {} } })
  if (loaded && state.key !== key) setState({ key, draft: initialDraft(rows) })
  const draft = state.draft
  const plan = useMemo(() => planCopy(rows, draft), [rows, draft])
  const [busy, setBusy] = useState(false)

  const setChecked = (id: string, on: boolean) => setState((s) => ({ ...s, draft: { ...s.draft, checked: { ...s.draft.checked, [id]: on } } }))
  const setQty = (id: string, v: string) => setState((s) => ({ ...s, draft: { ...s.draft, qty: { ...s.draft.qty, [id]: v } } }))

  const none = loaded && rows.length === 0
  return (
    <Sheet
      open
      onClose={onClose}
      title="Copiar comida anterior"
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!plan.ok || busy}
          data-testid="copy-meal-save"
          onClick={() => {
            if (!plan.ok || busy) return
            setBusy(true)
            onCopy(plan.entries, from, meal)
            onClose()
          }}
        >
          Copiar {plan.count} {plan.count === 1 ? 'alimento' : 'alimentos'}
        </button>
      }
    >
      <div className="space-y-3 pb-2" data-testid="copy-meal">
        <p className="text-label text-muted">
          A {name.toLowerCase()} de {dayLabel(date).toLowerCase()}.
        </p>
        <label className="label">
          Fecha de origen
          <input
            type="date"
            className="field mt-1"
            value={from}
            data-testid="copy-meal-date"
            onChange={(e) => e.target.value && setPicked(e.target.value)}
            aria-label="Fecha de origen"
          />
        </label>
        {none ? (
          <p className="text-body text-muted" data-testid="copy-meal-none">
            {from >= date ? 'Elige un día anterior.' : `No hay registros de ${name.toLowerCase()} ese día.`}
          </p>
        ) : null}
        {rows.length ? (
          <ul className="divide-rows" data-testid="copy-meal-list">
            {rows.map((row) => {
              const checked = !!draft.checked[row.id]
              const err = plan.errors[row.id]
              const kcal = checked ? plan.kcal[row.id] : row.nutrients.kcal
              return (
                <li key={row.id} className="py-1.5" data-testid="copy-meal-row">
                  <div className="flex items-center gap-2">
                    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
                        checked={checked}
                        onChange={(e) => setChecked(row.id, e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-body font-medium">{row.name}</span>
                        <span className="num block truncate text-label text-muted">{kcal === undefined ? '—' : `${formatNutrient('kcal', kcal, false)} kcal`}</span>
                      </span>
                    </label>
                    <div className="flex w-28 shrink-0 items-center gap-1.5">
                      <input
                        type="text"
                        inputMode={row.unit === 'portion' || row.unit === 'serving' ? 'text' : 'decimal'}
                        enterKeyHint="done"
                        className={`field num !min-h-11 w-full min-w-0 text-right ${err ? '!border-bad' : ''}`}
                        value={draft.qty[row.id] ?? ''}
                        disabled={!checked}
                        aria-label={`Cantidad de ${row.name} en ${unitText(row)}`}
                        aria-invalid={err ? true : undefined}
                        onChange={(e) => setQty(row.id, e.target.value)}
                      />
                      <span className="w-9 shrink-0 truncate text-label text-muted" title={unitText(row)}>
                        {unitText(row)}
                      </span>
                    </div>
                  </div>
                  {err ? (
                    <p role="alert" className="pl-8 text-label text-bad">
                      {err}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </Sheet>
  )
}
