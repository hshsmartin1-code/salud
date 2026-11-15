import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DateNav, useDateParam } from '../../app/useDate'
import { useRepo } from '../../app/profile'
import type { FoodLog, MealKey, MealTemplate } from '../../db/types'
import { addDays } from '../../domain/dates'
import { formatNutrient, sumNutrients } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'
import { TextField } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, PageHeader, Sheet } from '../../ui/kit'
import { DaySummary } from './DaySummary'
import { FoodSearch } from './FoodSearch'
import { describeQty, MEAL_LABEL, MEALS, SOURCE_SHORT, type Food } from './food'
import { MacroLine } from './NutrientView'
import { QuantitySheet, touchRecent } from './QuantitySheet'
import { useDayNutrition } from './useDayNutrition'
import { useFoods } from './useFoods'

export function NutritionPage() {
  const [date, setDate] = useDateParam()
  const day = useDayNutrition(date)
  const r = useRepo()
  const foods = useFoods()
  const nav = useNavigate()
  const [editing, setEditing] = useState<FoodLog | null>(null)
  const [saveTpl, setSaveTpl] = useState<MealKey | null>(null)
  const [applyTpl, setApplyTpl] = useState<MealKey | null>(null)
  const editFood = editing ? foods.resolve(editing.foodRef) ?? null : null

  async function copyFromYesterday(meal: MealKey) {
    const prev = (await r.onDate('foodLogs', addDays(date, -1))).filter((l) => l.meal === meal)
    for (const l of prev) {
      const { id: _id, createdAt: _c, updatedAt: _u, profileId: _p, ...rest } = l
      void _id
      void _c
      void _u
      void _p
      await r.add('foodLogs', { ...rest, date, origin: 'app' })
    }
  }

  return (
    <>
      <PageHeader
        title="Comida"
        actions={
          <Link to={`/comida/buscar?d=${date}`} className="btn-primary px-3" data-testid="add-food">
            <Icon name="plus" size={18} /> Agregar
          </Link>
        }
      />
      <div className="mb-3 flex justify-center">
        <DateNav date={date} onChange={setDate} />
      </div>
      {day ? <DaySummary day={day} /> : <div className="card h-48 animate-pulse" />}

      {day?.imported.length ? (
        <div className="card mt-3 p-4 text-sm">
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
          <p className="mt-1 text-[11px] text-faint">Totales diarios sin detalle por alimento; no se suman a los registros de arriba.</p>
        </div>
      ) : null}

      <div className="card mt-4 overflow-hidden divide-rows">
        {MEALS.map((m) => {
          const entries = (day?.logs ?? []).filter((l) => l.meal === m.key)
          const { totals, partial } = sumNutrients(entries)
          return (
            <section key={m.key} data-testid={`meal-${m.key}`}>
              <div className="flex min-h-[52px] items-center gap-2 py-1.5 pl-4 pr-2">
                <div className="min-w-0 flex-1">
                  <h2 className={`font-semibold ${entries.length ? '' : 'text-muted'}`}>{m.es}</h2>
                  {entries.length ? (
                    <div className="mt-0.5">
                      <MacroLine n={totals} partial={partial} hideKcal />
                    </div>
                  ) : null}
                </div>
                {entries.length ? (
                  <span className="readout mr-1 text-[20px]">
                    {formatNutrient('kcal', totals.kcal, false)}
                    {partial.includes('kcal') ? '*' : ''}
                  </span>
                ) : null}
                <MealMenu
                  hasEntries={entries.length > 0}
                  onCopy={() => void copyFromYesterday(m.key)}
                  onSaveTpl={() => setSaveTpl(m.key)}
                  onApplyTpl={() => setApplyTpl(m.key)}
                />
                <Link
                  to={`/comida/buscar?d=${date}&meal=${m.key}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent/10"
                  aria-label={`Agregar a ${m.es.toLowerCase()}`}
                  title={`Agregar a ${m.es.toLowerCase()}`}
                >
                  <Icon name="plus" size={20} />
                </Link>
              </div>
              {entries.length ? (
                <ul className="pb-1.5">
                  {entries.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => setEditing(l)} className="flex w-full items-center gap-3 py-2 pl-4 pr-4 text-left transition-colors hover:bg-surface2/50">
                        <span className="h-8 w-[3px] shrink-0 rounded-full bg-line" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{l.name}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                            <span className="num">{describeQty(l)}</span>
                            <Badge>{SOURCE_SHORT[l.source]}</Badge>
                            {l.missing.length ? <span className="text-warn" title={`Sin dato: ${l.missing.join(', ')}`}>datos incompletos</span> : null}
                          </span>
                        </span>
                        <span className="num shrink-0 text-sm font-semibold">{formatNutrient('kcal', l.nutrients.kcal, false)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )
        })}
      </div>

      {day && (day.logs.length > 0 || day.imported.length > 0) ? <DayCompleteMark date={date} /> : null}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link to="/comida/recetas" className="btn-secondary flex-col gap-1 py-3 text-[13px]">
          <Icon name="book" /> Recetas
        </Link>
        <Link to="/comida/plantillas" className="btn-secondary flex-col gap-1 py-3 text-[13px]">
          <Icon name="layers" /> Plantillas
        </Link>
        <Link to="/comida/etiqueta" className="btn-secondary flex-col gap-1 py-3 text-[13px]">
          <Icon name="tag" /> Desde etiqueta
        </Link>
      </div>

      {editing && editFood ? (
        <QuantitySheet
          open
          food={editFood}
          existing={editing}
          date={date}
          onClose={() => setEditing(null)}
          onDelete={async () => {
            await r.remove('foodLogs', editing.id)
            setEditing(null)
          }}
        />
      ) : null}
      {editing && !editFood ? (
        <Sheet open onClose={() => setEditing(null)} title={editing.name}>
          <p className="text-sm text-muted">
            {describeQty(editing)} · {MEAL_LABEL[editing.meal]}. El alimento original ya no está disponible; el registro conserva su copia de valores.
          </p>
          <div className="mt-3">
            <MacroLine n={editing.nutrients} />
          </div>
          <button
            className="btn-danger mt-4 w-full"
            onClick={async () => {
              await r.remove('foodLogs', editing.id)
              setEditing(null)
            }}
          >
            <Icon name="trash" size={16} /> Eliminar registro
          </button>
        </Sheet>
      ) : null}

      <SaveTemplateSheet meal={saveTpl} date={date} onClose={() => setSaveTpl(null)} />
      <ApplyTemplateSheet meal={applyTpl} date={date} onClose={() => setApplyTpl(null)} onManage={() => nav('/comida/plantillas')} />
    </>
  )
}

function MealMenu({ hasEntries, onCopy, onSaveTpl, onApplyTpl }: { hasEntries: boolean; onCopy: () => void; onSaveTpl: () => void; onApplyTpl: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" className="btn-ghost p-1.5" aria-label="Opciones de la comida" onClick={() => setOpen((v) => !v)}>
        <Icon name="dots" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
            {[
              { l: 'Copiar de ayer', i: 'copy' as const, f: onCopy, show: true },
              { l: 'Aplicar plantilla', i: 'layers' as const, f: onApplyTpl, show: true },
              { l: 'Guardar como plantilla', i: 'star' as const, f: onSaveTpl, show: hasEntries },
            ]
              .filter((x) => x.show)
              .map((x) => (
                <button
                  key={x.l}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-surface2"
                  onClick={() => {
                    setOpen(false)
                    x.f()
                  }}
                >
                  <Icon name={x.i} size={16} className="text-muted" /> {x.l}
                </button>
              ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function SaveTemplateSheet({ meal, date, onClose }: { meal: MealKey | null; date: string; onClose: () => void }) {
  const r = useRepo()
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
      <TextField label="Nombre de la plantilla" value={name} onChange={setName} autoFocus placeholder={meal ? `Mi ${MEAL_LABEL[meal].toLowerCase()}` : ''} />
      <p className="mt-2 text-xs text-muted">Guarda los alimentos y cantidades de esta comida con sus valores nutricionales.</p>
    </Sheet>
  )
}

function ApplyTemplateSheet({ meal, date, onClose, onManage }: { meal: MealKey | null; date: string; onClose: () => void; onManage: () => void }) {
  const r = useRepo()
  const templates = useLiveQuery(() => r.all('mealTemplates'), [r])
  async function apply(t: MealTemplate) {
    if (!meal) return
    for (const it of t.items) {
      await r.add('foodLogs', { ...it, date, meal, time: null, origin: 'app' })
      await touchRecent(r, it)
    }
    onClose()
  }
  return (
    <Sheet open={!!meal} onClose={onClose} title={`Aplicar plantilla${meal ? ` a ${MEAL_LABEL[meal].toLowerCase()}` : ''}`}>
      {templates && templates.length ? (
        <ul className="space-y-2 pb-2">
          {templates.map((t) => {
            const { totals, partial } = sumNutrients(t.items)
            return (
              <li key={t.id}>
                <button type="button" className="w-full rounded-2xl border border-line p-3 text-left hover:bg-surface2" onClick={() => void apply(t)}>
                  <div className="font-semibold">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.items.length} alimentos</div>
                  <div className="mt-1">
                    <MacroLine n={totals} partial={partial} />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted">No hay plantillas. Usa «Guardar como plantilla» en una comida registrada.</p>
      )}
      <button className="btn-ghost w-full" onClick={onManage}>
        Gestionar plantillas
      </button>
    </Sheet>
  )
}

/** /comida/buscar — search, then quantity sheet. */
export function FoodSearchPage() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [date] = useDateParam()
  const meal = (params.get('meal') as MealKey | null) ?? undefined
  const [food, setFood] = useState<Food | null>(null)
  return (
    <>
      <PageHeader title="Agregar alimento" subtitle={meal ? MEAL_LABEL[meal] : undefined} back={`/comida${date ? `?d=${date}` : ''}`} />
      <FoodSearch onSelect={setFood} autoScan={params.get('scan') === '1'} />
      <QuantitySheet open={!!food} food={food} date={date} meal={meal} onClose={() => setFood(null)} onSaved={() => nav(`/comida?d=${date}`)} />
    </>
  )
}

/**
 * Lets the person say whether the day's log is complete. Adaptive energy only trusts confirmed or
 * plausible days; "incompleto" removes the day from that estimate. Not marking is fine.
 */
function DayCompleteMark({ date }: { date: string }) {
  const r = useRepo()
  const mark = useLiveQuery(async () => (await r.onDate('dayMarks', date))[0] ?? null, [r, date])
  if (mark === undefined) return null
  const value: 'none' | 'complete' | 'incomplete' = mark === null ? 'none' : mark.complete ? 'complete' : 'incomplete'
  async function set(v: 'none' | 'complete' | 'incomplete') {
    const rows = await r.onDate('dayMarks', date)
    if (v === 'none') {
      for (const row of rows) await r.remove('dayMarks', row.id)
      return
    }
    if (rows[0]) await r.update('dayMarks', rows[0].id, { complete: v === 'complete' })
    else await r.add('dayMarks', { date, complete: v === 'complete' })
  }
  const opts = [
    { v: 'complete', l: 'Completo' },
    { v: 'incomplete', l: 'Incompleto' },
  ] as const
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-1" data-testid="day-complete">
      <span className="text-sm text-muted" id={`day-mark-${date}`}>
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
