import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dayLabel, DateNav, useDateParam } from '../../app/useDate'
import { useRepo } from '../../app/profile'
import type { FoodLog, MealKey, MealTemplate } from '../../db/types'
import { addDays } from '../../domain/dates'
import { useToday } from '../../app/useToday'
import { formatNutrient, sumNutrients } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'
import { TextField } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { PageHeader, Sheet } from '../../ui/kit'
import { useSwipeNav } from '../../ui/useSwipeNav'
import { Menu, type MenuItem } from '../../ui/Menu'
import { useToast } from '../../ui/Toast'
import { DaySummary } from './DaySummary'
import { describeQty, formatLogAmount, shortQty } from './food'
import { PartialMark } from './PartialMark'
import { useMealSlots } from './useMealSlots'
import { MacroLine } from './NutrientView'
import { searchPath } from './paths'
import { QuantitySheet } from './QuantitySheet'
import { TextFoodSheet } from './TextFoodSheet'
import { hasPendingNutrition } from './textFoodDraft'
import { logSnapshots, type LogEntry } from './quickAdd'
import { CopyMealSheet } from './CopyMealSheet'
import { habitsForSlot, type SlotHabit } from './slotHabits'
import { useDayNutrition } from './useDayNutrition'
import { useDesktop } from './useDesktop'
import { useFoods } from './useFoods'
import { useQuickLog, useRecentLogs } from './useQuickLog'
import { setDayMark } from '../../db/dayRecords'
import { dayMarkOf } from '../../domain/dayRecords'

export function NutritionPage() {
  const slots = useMealSlots()
  const lower = slots.lower
  const [date, setDate] = useDateParam()
  const day = useDayNutrition(date)
  const r = useRepo()
  const foods = useFoods()
  const nav = useNavigate()
  const toast = useToast()
  const recent = useRecentLogs(date)
  const quickLog = useQuickLog()
  const [editing, setEditing] = useState<FoodLog | null>(null)
  const [completing, setCompleting] = useState<FoodLog | null>(null)
  const [saveTpl, setSaveTpl] = useState<MealKey | null>(null)
  const [applyTpl, setApplyTpl] = useState<MealKey | null>(null)
  const [copyFor, setCopyFor] = useState<MealKey | null>(null)
  const today = useToday()
  // One day per swipe, same date rules as the arrows. The day slides in from the side it came from.
  const swipe = useSwipeNav({ onPrev: () => setDate(addDays(date, -1)), onNext: () => setDate(addDays(date, 1)) })
  const [seen, setSeen] = useState<{ date: string; dir: 'next' | 'prev' | null }>({ date, dir: null })
  if (seen.date !== date) setSeen({ date, dir: date > seen.date ? 'next' : 'prev' })
  const slide = seen.dir ? `day-in-${seen.dir}` : ''
  const dq = date === today ? '' : `?d=${date}`
  const editFood = editing ? foods.resolve(editing.foodRef) ?? null : null
  // Under the meals on the phone; from lg it joins the summary column (one element, so its DOM order never changes).
  const desktop = useDesktop()
  const dayMark = day && (day.logs.length > 0 || day.imported.length > 0) ? <DayCompleteMark date={date} className="lg:mt-4" /> : null

  // At most one discreet line under the slot of the hour, only on today's diary.
  const habits = useMemo(
    () => habitsForSlot(recent ?? [], { slot: slots.now.key, today, viewed: date }).filter((h) => !quickLog.done.has(`habit:${date}:${slots.now.key}:${h.foodRef}`)),
    [recent, slots.now.key, today, date, quickLog.done],
  )

  function addHabit(h: SlotHabit, meal: MealKey) {
    void quickLog.add(`habit:${date}:${meal}:${h.foodRef}`, [{ snapshot: h.snapshot }], date, meal, `Agregado a ${lower(meal)}: ${h.name} · ${shortQty(h.snapshot)}`)
  }

  /** One batch through the quick-log path: one undo for everything copied. */
  function copyPrevious(entries: LogEntry[], from: string, meal: MealKey) {
    void quickLog.run(
      `copy:${date}:${meal}:${from}:${Date.now()}`,
      () => logSnapshots(r, entries, date, meal),
      (b) => `${b.ids.length} ${b.ids.length === 1 ? 'alimento copiado' : 'alimentos copiados'} de ${dayLabel(from).toLowerCase()} a ${lower(meal)}`,
    )
  }

  /** One more of the same entry, in the same meal and date (the snapshot is copied as stored). */
  function repeatRow(l: FoodLog) {
    void quickLog.add(`row:${l.id}:${Date.now()}`, [{ snapshot: l }], l.date, l.meal, `Repetido en ${lower(l.meal)}: ${l.name} · ${shortQty(l)}`)
  }

  async function removeLog(l: FoodLog) {
    await r.remove('foodLogs', l.id)
    setEditing(null)
    toast.show({
      message: `Eliminado: ${l.name}`,
      actionLabel: 'Deshacer',
      onAction: () => void r.put('foodLogs', l),
    })
  }

  return (
    <>
      <PageHeader
        title="Comida"
        actions={
          <>
            {/* Desktop only: the shortcuts live next to "Agregar" (on the phone they sit below the meals). */}
            <Link to={`/comida/recetas${dq}`} className="btn-secondary hidden px-3 lg:inline-flex">
              <Icon name="book" size={18} /> Recetas
            </Link>
            <Link to={`/comida/plantillas${dq}`} className="btn-secondary hidden px-3 lg:inline-flex">
              <Icon name="layers" size={18} /> Plantillas
            </Link>
            <Link to={`/comida/etiqueta${dq}`} className="btn-secondary hidden px-3 lg:inline-flex" aria-label="Registrar desde etiqueta">
              <Icon name="tag" size={18} /> Etiqueta
            </Link>
            <Link to={searchPath(date)} className="btn-primary px-3" data-testid="add-food">
              <Icon name="plus" size={18} /> Agregar
            </Link>
          </>
        }
      />
      {/* Phone: one column in DOM order. From lg: summary column (sticky) on the left, meals on the right. */}
      <div {...swipe} data-testid="diary-surface" className="min-h-[70vh]">
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(280px,2fr)_minmax(0,3fr)] lg:items-start lg:gap-x-8">
        <StickyColumn>
          <div className="mb-3 flex justify-center lg:justify-start">
            <DateNav date={date} onChange={setDate} />
          </div>
          {day ? <div key={date} className={slide}><DaySummary day={day} /></div> : <div className="h-48 rounded-2xl bg-surface2/40" aria-hidden />}
          {desktop ? dayMark : null}
        </StickyColumn>

        <div className="contents lg:block lg:min-w-0">
      {day?.imported.length ? (
        <div className="mt-4 border-b border-line pb-4 text-body lg:mb-3 lg:mt-0">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <Icon name="database" size={16} /> Historial importado (Fase 0)
          </div>
          <ul className="space-y-0.5 text-muted">
            {day.imported.map((i) => (
              <li key={i.id}>
                {i.label}: <span className="num font-medium text-ink">{i.value !== null ? formatNumber(i.value, 1) : i.valueText}</span> {i.unit ?? ''}
                {i.approx ? ' (aprox.)' : ''}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-label text-muted">Totales diarios sin detalle por alimento; no se suman a los registros de abajo.</p>
        </div>
      ) : null}

      <div key={date} className={`divide-rows lg:space-y-3 lg:[&>*+*]:border-t-0 ${slide}`} data-testid="meals">
        {slots.visible(day?.logs ?? []).map((m) => {
          const entries = (day?.logs ?? []).filter((l) => l.meal === m.key)
          const items: MenuItem[] = [
            { label: 'Copiar comida anterior', icon: 'copy', onSelect: () => setCopyFor(m.key) },
            { label: 'Aplicar plantilla', icon: 'layers', onSelect: () => setApplyTpl(m.key) },
            ...(entries.length ? [{ label: 'Guardar como plantilla', icon: 'star' as const, onSelect: () => setSaveTpl(m.key) }] : []),
          ]
          return (
            <MealSection
              key={m.key}
              meal={m.key}
              name={m.label}
              date={date}
              entries={entries}
              habits={m.key === slots.now.key ? habits : []}
              items={items}
              onEdit={setEditing}
              onRepeatRow={repeatRow}
              onRemoveRow={(l) => void removeLog(l)}
              onHabit={(h) => addHabit(h, m.key)}
            />
          )
        })}
      </div>

        {desktop ? null : dayMark}
        </div>

      <div className="mt-5 grid grid-cols-3 gap-2 lg:hidden">
        <Link to={`/comida/recetas${dq}`} className="btn-secondary flex-col gap-1 px-2 py-3 text-center text-label">
          <Icon name="book" /> Recetas
        </Link>
        <Link to={`/comida/plantillas${dq}`} className="btn-secondary flex-col gap-1 px-2 py-3 text-center text-label">
          <Icon name="layers" /> Plantillas
        </Link>
        <Link to={`/comida/etiqueta${dq}`} className="btn-secondary flex-col gap-1 px-2 py-3 text-center text-label" aria-label="Registrar desde etiqueta">
          <Icon name="tag" /> Etiqueta
        </Link>
      </div>
      </div>
      </div>

      {editing ? (
        <QuantitySheet
          open
          food={editFood}
          existing={editing}
          date={date}
          onClose={() => setEditing(null)}
          onDelete={() => void removeLog(editing)}
          onCompleteNutrition={hasPendingNutrition(editing) ? () => { setCompleting(editing); setEditing(null) } : undefined}
        />
      ) : null}
      {completing ? <TextFoodSheet startingText="" existing={completing} date={completing.date} meal={completing.meal} onClose={() => setCompleting(null)} /> : null}

      <SaveTemplateSheet meal={saveTpl} date={date} onClose={() => setSaveTpl(null)} />
      <CopyMealSheet meal={copyFor} date={date} onClose={() => setCopyFor(null)} onCopy={copyPrevious} />
      <ApplyTemplateSheet
        meal={applyTpl}
        onClose={() => setApplyTpl(null)}
        onManage={() => nav(`/comida/plantillas${dq}`)}
        onApply={(t, meal) => {
          setApplyTpl(null)
          void quickLog.run(
            `tpl:${date}:${meal}:${t.id}`,
            () => logSnapshots(r, t.items.map((snapshot) => ({ snapshot, time: null })), date, meal),
            (b) => `Plantilla «${t.name}» aplicada a ${lower(meal)}: ${b.ids.length} ${b.ids.length === 1 ? 'alimento' : 'alimentos'}`,
          )
        }}
      />
    </>
  )
}


function MealSection({
  meal,
  name,
  date,
  entries,
  habits,
  items,
  onEdit,
  onRepeatRow,
  onRemoveRow,
  onHabit,
}: {
  meal: MealKey
  name: string
  date: string
  entries: FoodLog[]
  habits: SlotHabit[]
  items: MenuItem[]
  onEdit: (l: FoodLog) => void
  onRepeatRow: (l: FoodLog) => void
  onRemoveRow: (l: FoodLog) => void
  onHabit: (h: SlotHabit) => void
}) {
  const { totals, partial } = sumNutrients(entries)
  const [macros, setMacros] = useState(false)
  const macrosId = `meal-macros-${meal}`
  return (
    <section data-testid={`meal-${meal}`} className="py-3 lg:rounded-2xl lg:border lg:border-line lg:px-4 lg:py-2" aria-label={name}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-1 gap-y-0">
        <h2 className={`min-w-0 flex-1 text-heading ${entries.length ? 'text-ink' : 'text-muted'}`}>
          {entries.length ? (
            <span className="flex min-h-11 w-full items-center">
              <button
                type="button"
                aria-expanded={macros}
                aria-controls={macrosId}
                data-testid={`meal-toggle-${meal}`}
                onClick={() => setMacros((v) => !v)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="readout mr-1 text-title">{formatNutrient('kcal', totals.kcal, false)}</span>
              </button>
              {partial.includes('kcal') ? (
                <span className="readout -ml-1 mr-1 text-title text-muted">
                  <PartialMark code="kcal" logs={entries} />
                </span>
              ) : null}
              <button type="button" tabIndex={-1} aria-hidden onClick={() => setMacros((v) => !v)} className="flex h-11 w-7 shrink-0 items-center justify-center text-muted">
                <Icon name={macros ? 'chevronUp' : 'chevronDown'} size={16} />
              </button>
            </span>
          ) : (
            name
          )}
        </h2>
        <div className="flex items-center gap-1 lg:order-1" data-no-swipe>
          <Menu label={`Opciones de ${name.toLowerCase()}`} items={items} />
          <Link
            to={searchPath(date, meal)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-accent transition-colors duration-state hover:bg-accent/10 active:scale-95"
            aria-label={`Agregar a ${name.toLowerCase()}`}
            title={`Agregar a ${name.toLowerCase()}`}
          >
            <Icon name="plus" size={22} />
          </Link>
        </div>
      </div>
      {entries.length && macros ? (
        <div id={macrosId} className="pb-1" data-testid={`meal-macros-${meal}`}>
          <MacroLine n={totals} partial={partial} hideKcal />
        </div>
      ) : null}

      {entries.length ? (
        <>
          {/* Desktop column heads (decorative: each row is one button whose name already says it all). */}
          <div className={`${ENTRY_GRID} mb-0.5 hidden border-b border-line pb-1 text-micro text-muted lg:grid`} aria-hidden>
            <span className="col-start-2 text-right">Cantidad</span>
            {MACRO_COLS.map((m, i) => (
              <span key={m.code} className={`hidden items-center justify-end gap-1 xl:flex ${MACRO_COL_START[i]}`}>
                <span className="h-1.5 w-1.5 rounded-[2px]" style={{ background: `rgb(var(--${m.color}))` }} />
                {m.l}
              </span>
            ))}
            <span className="col-start-3 text-right xl:col-start-6">kcal</span>
          </div>
          <ul>
            {entries.map((l) => (
              <li key={l.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onEdit(l)}
                  className={`${ENTRY_GRID} -mx-2 flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors duration-state hover:bg-surface2/50 active:bg-surface2 lg:grid lg:min-h-11 lg:content-center lg:py-1`}
                >
                  <span className="min-w-0 flex-1 lg:contents">
                    <span className="block truncate text-body font-medium lg:col-start-1">{l.name}</span>
                    <span className="num block truncate text-label text-muted lg:col-start-2 lg:text-right" title={describeQty(l)}>{formatLogAmount(l)}{hasPendingNutrition(l) ? ' · Nutrición pendiente' : ''}</span>
                  </span>
                  {MACRO_COLS.map((m, i) => (
                    <span key={m.code} aria-hidden className={`num hidden text-right text-label text-muted xl:block ${MACRO_COL_START[i]}`}>
                      {formatNutrient(m.code, l.nutrients[m.code], false)}
                    </span>
                  ))}
                  <span className="num shrink-0 text-body font-semibold lg:col-start-3 lg:text-right xl:col-start-6">{formatNutrient('kcal', l.nutrients.kcal, false)}</span>
                </button>
                <span data-no-swipe className="inline-flex">
                  <Menu
                    label={`Acciones de ${l.name}`}
                    items={[
                      { label: 'Repetir', icon: 'copy', onSelect: () => onRepeatRow(l) },
                      { label: 'Eliminar', icon: 'trash', tone: 'danger', onSelect: () => onRemoveRow(l) },
                    ]}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {habits.length ? (
        <div role="group" aria-label={`Lo que sueles tomar en ${name.toLowerCase()}`} className="mt-1 flex flex-wrap gap-x-2" data-testid="slot-habits">
          {habits.map((h) => (
            <button
              key={h.foodRef}
              type="button"
              data-testid="slot-habit"
              aria-label={`Agregar ${describeQty(h.snapshot)} de ${h.name} a ${name.toLowerCase()}`}
              onClick={() => onHabit(h)}
              className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full px-1 text-label text-muted transition-colors duration-state hover:text-ink active:scale-95"
            >
              <Icon name="plus" size={14} className="shrink-0 text-accent" />
              <span className="min-w-0 truncate" title={h.name}>{h.name}</span>
              <span className="num shrink-0">· {shortQty(h.snapshot)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** Column template shared by the desktop entry rows and their heads: name, quantity, [P C G from xl], kcal. */
const ENTRY_GRID = 'lg:grid-cols-[minmax(0,1fr)_5.5rem_3.5rem] lg:gap-x-3 xl:grid-cols-[minmax(0,1fr)_5.5rem_repeat(3,2.5rem)_3.25rem]'
const MACRO_COLS = [
  { code: 'protein', l: 'P', color: 'protein' },
  { code: 'carbs', l: 'C', color: 'carbs' },
  { code: 'fat', l: 'G', color: 'fat' },
] as const
const MACRO_COL_START = ['xl:col-start-3', 'xl:col-start-4', 'xl:col-start-5'] as const

/**
 * Keeps the desktop summary column in view while the meals scroll. Taller than the window, it scrolls with
 * the page until its bottom edge shows, then holds there (top is negative). On the phone it is not a box at all.
 */
function StickyColumn({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.top = `${Math.min(24, window.innerHeight - el.offsetHeight - 24)}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [])
  return (
    <div ref={ref} className="contents lg:sticky lg:block lg:min-w-0">
      {children}
    </div>
  )
}

function SaveTemplateSheet({ meal, date, onClose }: { meal: MealKey | null; date: string; onClose: () => void }) {
  const r = useRepo()
  const slots = useMealSlots()
  const [name, setName] = useState('')
  return (
    <Sheet
      open={!!meal}
      onClose={onClose}
      title="Guardar como plantilla"
      footer={
        <button
          className="btn-primary w-full"
          disabled={!name.trim()}
          onClick={async () => {
            if (!meal) return
            const logs = (await r.onDate('foodLogs', date)).filter((l) => l.meal === meal)
            await r.add('mealTemplates', {
              name: name.trim(),
              meal,
              items: logs.map((l) => ({
                foodRef: l.foodRef,
                name: l.name,
                brand: l.brand,
                source: l.source,
                datasetVersion: l.datasetVersion,
                kind: l.kind,
                qty: l.qty,
                unit: l.unit,
                portionLabel: l.portionLabel,
                grams: l.grams,
                ml: l.ml,
                nutrients: l.nutrients,
                missing: l.missing,
              })),
            })
            setName('')
            onClose()
          }}
        >
          Guardar
        </button>
      }
    >
      <TextField label="Nombre de la plantilla" value={name} onChange={setName} autoFocus placeholder={meal ? `Mi ${slots.lower(meal)}` : ''} />
      <p className="mt-2 text-label text-muted">Guarda los alimentos y cantidades de esta comida con sus valores nutricionales.</p>
    </Sheet>
  )
}

function ApplyTemplateSheet({ meal, onClose, onManage, onApply }: { meal: MealKey | null; onClose: () => void; onManage: () => void; onApply: (t: MealTemplate, meal: MealKey) => void }) {
  const r = useRepo()
  const slots = useMealSlots()
  const templates = useLiveQuery(() => r.all('mealTemplates'), [r])
  return (
    <Sheet open={!!meal} onClose={onClose} title={`Aplicar plantilla${meal ? ` a ${slots.lower(meal)}` : ''}`}>
      {templates && templates.length ? (
        <ul className="space-y-2 pb-2">
          {templates.map((t) => {
            const { totals, partial } = sumNutrients(t.items)
            return (
              <li key={t.id}>
                <button type="button" className="w-full rounded-2xl border border-line p-3 text-left hover:bg-surface2" onClick={() => meal && onApply(t, meal)}>
                  <div className="font-semibold">{t.name}</div>
                  <div className="mt-0.5 text-label text-muted">{t.items.length} alimentos</div>
                  <div className="mt-1">
                    <MacroLine n={totals} partial={partial} />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-4 text-body text-muted">No hay plantillas. Usa «Guardar como plantilla» en una comida registrada.</p>
      )}
      <button className="btn-ghost w-full" onClick={onManage}>
        Gestionar plantillas
      </button>
    </Sheet>
  )
}

/**
 * Lets the person say whether the day's log is complete. Adaptive energy only trusts confirmed or
 * plausible days; "incompleto" removes the day from that estimate. Not marking is fine.
 */
function DayCompleteMark({ date, className = '' }: { date: string; className?: string }) {
  const r = useRepo()
  const mark = useLiveQuery(async () => dayMarkOf(await r.onDate('dayMarks', date)), [r, date])
  if (mark === undefined) return null
  const value: 'none' | 'complete' | 'incomplete' = mark === null ? 'none' : mark.complete ? 'complete' : 'incomplete'
  async function set(v: 'none' | 'complete' | 'incomplete') {
    await setDayMark(r, date, v)
  }
  const opts = [
    { v: 'complete', l: 'Completo' },
    { v: 'incomplete', l: 'Incompleto' },
  ] as const
  return (
    <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`} data-testid="day-complete">
      <span className="text-body text-muted" id={`day-mark-${date}`}>
        ¿Registraste todo lo de este día?
      </span>
      <div className="flex gap-2" role="radiogroup" aria-labelledby={`day-mark-${date}`}>
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            className={`chip ${value === o.v ? 'chip-on' : ''}`}
            onClick={() => void set(value === o.v ? 'none' : o.v)}
          >
            {value === o.v ? <Icon name="check" size={14} /> : null}
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}
