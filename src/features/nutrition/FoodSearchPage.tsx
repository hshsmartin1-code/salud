import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { dayLabel, useDateParam } from '../../app/useDate'
import { useRepo } from '../../app/profile'
import type { MealKey } from '../../db/types'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { Meter } from '../../ui/Meter'
import { FoodSearch, type QuickAddContext } from './FoodSearch'
import { Chooser } from './Chooser'
import { shortQty, type Food } from './food'
import { MEAL_KEYS } from './mealSlots'
import { useMealSlots } from './useMealSlots'
import { SearchIdeas, useFoodIdeas } from './FoodIdeas'
import type { FoodIdea } from './ideas'
import { diaryPath, routeGuard } from './paths'
import { useKeepAdding } from './prefs'
import { useDesktop } from './useDesktop'
import { QuantitySheet, type SavedInfo } from './QuantitySheet'
import { TextFoodSheet } from './TextFoodSheet'
import type { LoggedBatch } from './quickAdd'
import { useDayNutrition, type DayNutrition } from './useDayNutrition'
import { useQuickLog, useRecentLogs } from './useQuickLog'

const isMeal = (v: string | null): v is MealKey => !!v && (MEAL_KEYS as readonly string[]).includes(v)

/**
 * Compact header: back, the meal that receives the log (a control, not a form field), and what is left of the day
 * in one short line. Replaces the page title block of earlier versions.
 */
function SearchHeader({ day, meal, date, onMeal }: { day: DayNutrition | undefined; meal: MealKey; date: string; onMeal: () => void }) {
  const { label } = useMealSlots()
  const kcal = day?.totals.kcal ?? 0
  const budget = day?.kcalBudget ?? null
  let text = ''
  if (day) {
    if (day.logs.some((log) => log.nutrients.kcal === undefined)) {
      text = 'Nutrición parcial'
    } else if (budget !== null) {
      const left = budget - kcal
      text = `${left >= 0 ? 'Quedan' : 'Pasaste'} ${formatNumber(Math.abs(left), 0)} kcal`
    } else text = `Hoy: ${formatNumber(kcal, 0)} kcal`
  }
  const over = budget !== null && kcal > budget
  const when = dayLabel(date)
  return (
    <div className="flex items-center gap-1 pb-1" data-testid="budget-strip">
      <h1 className="sr-only">Agregar alimento</h1>
      <Link to={diaryPath(date)} aria-label="Volver al diario" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-state hover:bg-surface2 hover:text-ink">
        <Icon name="chevronLeft" size={22} />
      </Link>
      <button
        type="button"
        data-testid="strip-meal"
        aria-haspopup="dialog"
        aria-label={`Comida: ${label(meal)}. Cambiar`}
        onClick={onMeal}
        className="inline-flex min-h-11 min-w-0 items-center gap-1 rounded-xl px-2 text-heading font-semibold text-ink transition-colors duration-state hover:bg-surface2"
      >
        <span className="truncate">{label(meal)}</span>
        <Icon name="chevronDown" size={18} className="shrink-0 text-muted" />
      </button>
      {when !== 'Hoy' ? <span className="truncate text-label text-muted">{when}</span> : null}
      <p role="status" aria-live="polite" className={`num ml-auto shrink-0 text-label font-medium ${over ? 'text-warn' : 'text-ink'}`} data-testid="budget-text">
        {text}
      </p>
    </div>
  )
}

/** Desktop right pane while no food is open: what is left of the day, then the ideas for it. */
function RemainingPanel({ day, ideas }: { day: DayNutrition | undefined; ideas: ReactNode }) {
  const kcal = day?.totals.kcal ?? 0
  const budget = day?.kcalBudget ?? null
  const protein = day?.totals.protein ?? 0
  const proteinGoal = day?.goal?.protein ?? null
  const left = budget !== null ? budget - kcal : null
  const pLeft = proteinGoal !== null ? proteinGoal - protein : null
  return (
    <div className="space-y-6" data-testid="search-remaining">
      <section aria-label="Lo que queda del día">
        <h2 className="text-heading">Lo que queda del día</h2>
        <div className="mt-3 grid grid-cols-2 gap-x-6">
          <div>
            <div className="text-label font-medium text-muted">Energía</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={`readout text-display ${left !== null && left < 0 ? 'text-warn' : ''}`}>{left !== null ? formatNumber(Math.abs(left), 0) : formatNumber(kcal, 0)}</span>
              <span className="text-label text-muted">{left === null ? 'kcal hoy' : left < 0 ? 'kcal de más' : 'kcal'}</span>
            </div>
            {budget !== null ? (
              <div className="mt-2 max-w-[220px]">
                <Meter value={kcal} max={budget} colorVar="energy" variant="scale" label="Energía frente al objetivo" valueText={`${formatNumber(kcal, 0)} de ${formatNumber(budget, 0)} kcal`} />
              </div>
            ) : null}
          </div>
          <div>
            <div className="text-label font-medium text-muted">Proteína</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="readout text-display">{pLeft !== null ? formatNumber(Math.max(0, pLeft), 0) : formatNumber(protein, 0)}</span>
              <span className="text-label text-muted">{pLeft === null ? 'g hoy' : pLeft > 0 ? 'g por cubrir' : 'g · cubierta'}</span>
            </div>
            {proteinGoal !== null ? (
              <div className="mt-2 max-w-[220px]">
                <Meter value={protein} max={proteinGoal} colorVar="protein" variant="bar" label="Proteína frente al objetivo" valueText={`${formatNumber(protein, 0)} de ${formatNumber(proteinGoal, 0)} gramos`} />
              </div>
            ) : null}
          </div>
        </div>
      </section>
      {ideas}
      <p className="text-label text-muted">Busca un alimento y elígelo: aquí podrás ajustar la cantidad antes de registrarlo.</p>
    </div>
  )
}

/** /comida/buscar — remaining-budget strip, frequent and recent foods with one-tap adds, then the quantity sheet. */
export function FoodSearchPage() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const r = useRepo()
  const [date] = useDateParam()
  const mealParam = params.get('meal')
  const slots = useMealSlots()
  const fallbackMeal = slots.now.key
  const lower = slots.lower
  const meal: MealKey = isMeal(mealParam) ? mealParam : fallbackMeal
  const [keepAdding, setKeepAdding] = useKeepAdding(r.profileId)
  const [food, setFood] = useState<Food | null>(null)
  const [added, setAdded] = useState(0)
  const [clearSignal, setClearSignal] = useState(0)
  const [mealChooser, setMealChooser] = useState(false)
  const [textDraft, setTextDraft] = useState<string | null>(null)
  const desktop = useDesktop()
  const day = useDayNutrition(date)
  const logs = useRecentLogs(date, 180)

  const onLogged = useCallback(
    (batch: LoggedBatch) => {
      setAdded((n) => n + batch.ids.length)
      setClearSignal((n) => n + 1)
    },
    [],
  )
  const onUndone = useCallback((batch: LoggedBatch) => setAdded((n) => Math.max(0, n - batch.ids.length)), [])
  const quickLog = useQuickLog({ onLogged, onUndone })

  const ideas = useFoodIdeas(date, meal, day)
  function addIdea(idea: FoodIdea) {
    const same = routeGuard()
    void quickLog
      .add(`idea:${date}:${meal}:${idea.foodRef}`, [{ snapshot: idea.snapshot }], date, meal, `Agregado a ${lower(meal)}: ${idea.name} · ${shortQty(idea.snapshot)}`, 700)
      .then((ok) => {
        if (ok && !keepAdding && same()) nav(diaryPath(date))
      })
  }

  const inDiary = useMemo(() => new Set((day?.logs ?? []).filter((l) => l.meal === meal).map((l) => l.foodRef)), [day, meal])
  const quick = useMemo<QuickAddContext | undefined>(
    () =>
      logs
        ? {
            meal,
            date,
            logs,
            inDiary,
            onQuickAdd: (log, f) => {
              // The snapshot is copied as stored; nothing is recomputed from the catalog.
              const same = routeGuard()
              void quickLog
                .add(`search:${date}:${meal}:${log.foodRef}`, [{ snapshot: log }], date, meal, `Agregado a ${lower(meal)}: ${f.name} · ${shortQty(log)}`, 700)
                .then((ok) => {
                  if (ok && !keepAdding && same()) nav(diaryPath(date))
                })
            },
          }
        : undefined,
    [logs, meal, date, inDiary, quickLog, keepAdding, nav],
  )

  function setMeal(m: MealKey) {
    const p = new URLSearchParams(params)
    p.set('meal', m)
    setParams(p, { replace: true })
  }

  function saved(info?: SavedInfo, sameRoute = true) {
    if (!info) return
    if (!keepAdding && sameRoute) nav(diaryPath(date))
    quickLog.announce(`sheet:${info.batch.ids[0]}`, info.batch, `Agregado a ${lower(info.meal)} · ${info.qty}`)
  }

  // Escape in the side editor closes it and hands the keyboard back to the search field.
  function onPanelKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    setFood(null)
    document.querySelector<HTMLInputElement>('[data-testid="food-search"]')?.focus()
  }

  const dayLogCount = day?.logs.length ?? 0
  const ideasNode = ideas ? (
    <SearchIdeas
      result={{ ...ideas, ideas: ideas.ideas.filter((i) => !quickLog.done.has(`idea:${date}:${meal}:${i.foodRef}`)) }}
      meal={meal}
      date={date}
      dayLogs={dayLogCount}
      withNote={desktop}
      collapsed={!desktop}
      onAdd={addIdea}
    />
  ) : null

  return (
    <>
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:items-start lg:gap-x-10">
        <div className="min-w-0">
          <SearchHeader day={day} meal={meal} date={date} onMeal={() => setMealChooser(true)} />
          {added > 0 ? (
            <p role="status" className="mb-1 text-body text-good" data-testid="food-added-count">
              {added} {added === 1 ? 'alimento registrado' : 'alimentos registrados'}. <Link to={diaryPath(date)} className="underline">Ver diario</Link>
            </p>
          ) : null}
          <FoodSearch
            onSelect={setFood}
            onText={(text) => { setFood(null); setTextDraft(text) }}
            autoScan={params.get('scan') === '1'}
            quick={quick}
            ideas={desktop ? null : ideasNode}
            clearSignal={clearSignal}
            selectedRef={desktop ? food?.ref : undefined}
            filtersExtra={
              <div>
                <span className="label">Al agregar</span>
                <label className="flex min-h-11 items-center gap-2 text-body">
                  <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={keepAdding} onChange={(e) => setKeepAdding(e.target.checked)} data-testid="keep-adding" />
                  Seguir agregando alimentos
                </label>
              </div>
            }
          />
        </div>
        {desktop ? (
          <aside className="sticky top-6 min-w-0" aria-label="Detalle" onKeyDown={onPanelKey}>
            {food ? (
              <QuantitySheet key={food.ref} presentation="panel" open food={food} date={date} meal={meal} onClose={() => setFood(null)} onSaved={saved} />
            ) : (
              <RemainingPanel day={day} ideas={ideasNode} />
            )}
          </aside>
        ) : null}
      </div>
      {desktop ? null : <QuantitySheet open={!!food} food={food} date={date} meal={meal} onClose={() => setFood(null)} onSaved={saved} />}
      {textDraft !== null ? <TextFoodSheet startingText={textDraft} date={date} meal={meal} onClose={() => setTextDraft(null)} onSaved={saved} /> : null}
      <Chooser
        open={mealChooser}
        onClose={() => setMealChooser(false)}
        title="Agregar a"
        options={slots.choices(meal).map((m) => ({ key: m.key, label: m.label }))}
        value={meal}
        onSelect={(k) => setMeal(k as MealKey)}
      />
    </>
  )
}
