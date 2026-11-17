import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import { dayLabel, useDateParam } from '../../app/useDate'
import { uuid } from '../../db/repo'
import type { MealKey, MealTemplate, Recipe, RecipeIngredient } from '../../db/types'
import { formatNumber, textRangeError } from '../../domain/units'
import { useConfirm } from '../../ui/Confirm'
import { NumField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Card, EmptyState, PageHeader, Sheet } from '../../ui/kit'
import { FoodSearch } from './FoodSearch'
import { describeQty, fromRecipe, recipeTotals, type Food } from './food'
import { useMealSlots } from './useMealSlots'
import { MacroLine, NutrientTable } from './NutrientView'
import { dateQuery, diaryPath, routeGuard } from './paths'
import { QuantitySheet } from './QuantitySheet'
import { logSnapshots } from './quickAdd'
import { useQuickLog } from './useQuickLog'
import { sumNutrients } from '../../domain/nutrients'
import { createRecipeSaver, recipeServingsError } from './recipeSave'

export function RecipesPage() {
  const r = useRepo()
  const [date] = useDateParam()
  const dq = dateQuery(date)
  const recipes = useLiveQuery(() => r.all('recipes'), [r])
  return (
    <>
      <PageHeader
        title="Recetas"
        back={diaryPath(date)}
        actions={
          <Link className="btn-primary px-3" to={`/comida/recetas/nueva${dq}`}>
            <Icon name="plus" size={18} /> Nueva
          </Link>
        }
      />
      {recipes && recipes.length ? (
        <ul className="card divide-y divide-line overflow-hidden lg:max-w-3xl">
          {recipes
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((rc) => {
              const t = recipeTotals(rc)
              return (
                <li key={rc.id}>
                  <Link to={`/comida/recetas/${rc.id}${dq}`} className="block px-4 py-3 hover:bg-surface2/60">
                    <div className="font-medium">{rc.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {rc.ingredients.length} ingredientes · {formatNumber(rc.servings, 1)} porciones
                      {rc.cookedWeightG ? ` · ${formatNumber(rc.cookedWeightG, 0)} g cocido` : ''}
                    </div>
                    <div className="mt-1">
                      <MacroLine n={t.perServing} partial={t.partial} /> <span className="text-micro text-muted">por porción</span>
                    </div>
                    {rc.notes?.trim() ? <p className="mt-1 line-clamp-2 text-label text-muted" data-testid="recipe-note">{rc.notes}</p> : null}
                  </Link>
                </li>
              )
            })}
        </ul>
      ) : (
        <EmptyState icon="book" title="Sin recetas" action={<Link className="btn-primary" to={`/comida/recetas/nueva${dq}`}>Crear receta</Link>}>
          Combina ingredientes pesados en crudo; registra la receta por porciones o por gramos si pesas el resultado cocinado.
        </EmptyState>
      )}
    </>
  )
}

export function RecipeEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'nueva'
  const r = useRepo()
  const nav = useNavigate()
  const confirm = useConfirm()
  const [date] = useDateParam()
  const dq = dateQuery(date)
  const existing = useLiveQuery(() => (isNew ? undefined : r.get('recipes', id as string)), [r, id])
  const [name, setName] = useState('')
  const [servings, setServings] = useState('1')
  const [cooked, setCooked] = useState('')
  const [notes, setNotes] = useState('')
  const [ings, setIngs] = useState<RecipeIngredient[]>([])
  const [picker, setPicker] = useState(false)
  const [pickFood, setPickFood] = useState<Food | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const saveRecipe = useRef(createRecipeSaver()).current
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setServings(numStr(existing.servings))
    setCooked(numStr(existing.cookedWeightG))
    setNotes(existing.notes ?? '')
    setIngs(existing.ingredients)
  }, [existing])

  const draft: Pick<Recipe, 'ingredients' | 'servings' | 'cookedWeightG'> = {
    ingredients: ings,
    servings: toNum(servings) ?? 1,
    cookedWeightG: toNum(cooked),
  }
  const t = recipeTotals(draft)
  const servingsErr = recipeServingsError(servings)
  const cookedErr = textRangeError(cooked, 1, 50000, 'g')
  const canSave = name.trim() && ings.length > 0 && !servingsErr && !cookedErr

  async function save(): Promise<Recipe | null> {
    if (!canSave) return null
    const same = routeGuard()
    setSaving(true)
    setSaveError(null)
    const data = { name: name.trim(), servings: toNum(servings) as number, cookedWeightG: toNum(cooked), ingredients: ings, notes }
    try {
      const row = await saveRecipe(r, data, existing?.id)
      setSavedId(row.id)
      if (isNew && same()) nav(`/comida/recetas/${row.id}${dq}`, { replace: true })
      return row
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo guardar la receta.')
      return null
    } finally { setSaving(false) }
  }

  const recipeForLog = existing && savedId === existing.id ? existing : existing
  return (
    <>
      <PageHeader title={isNew ? 'Nueva receta' : 'Receta'} back={`/comida/recetas${dq}`} />
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-x-8">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        <Card className="space-y-3">
          <TextField label="Nombre" value={name} onChange={setName} autoFocus={isNew} placeholder="p. ej. Arroz con pollo" />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Porciones" value={servings} onChange={setServings} error={servings.trim() ? (servingsErr ?? undefined) : undefined} />
            <NumField label="Peso cocido total" unit="g" value={cooked} onChange={setCooked} hint="Opcional: permite registrar por gramos" error={cookedErr ?? undefined} />
          </div>
          <TextArea label="Notas" value={notes} onChange={setNotes} rows={3} placeholder="Preparación, marca de los ingredientes, cómo medir el plato…" testId="recipe-notes" resize />
        </Card>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Ingredientes</h2>
            <button className="btn-secondary px-3 py-2" onClick={() => setPicker(true)} data-testid="add-ingredient">
              <Icon name="plus" size={16} /> Ingrediente
            </button>
          </div>
          {ings.length ? (
            <ul className="card divide-y divide-line overflow-hidden">
              {ings.map((i) => (
                <li key={i.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.name}</div>
                    <div className="text-xs text-muted">{describeQty(i)}</div>
                  </div>
                  <MacroLine n={i.nutrients} />
                  <button className="btn-ghost p-1.5" aria-label="Quitar ingrediente" onClick={() => setIngs((s) => s.filter((x) => x.key !== i.key))}>
                    <Icon name="x" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Agrega ingredientes con su cantidad.</p>
          )}
        </div>

        </div>
        <div className="contents lg:sticky lg:top-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
        {ings.length ? (
          <Card className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted">
              <div>
                <div className="readout text-title text-ink">{t.totals.kcal !== undefined ? formatNumber(t.totals.kcal, 0) : '—'}</div>
                kcal total
              </div>
              <div>
                <div className="readout text-title text-ink">{t.perServing.kcal !== undefined ? formatNumber(t.perServing.kcal, 0) : '—'}</div>
                kcal / porción
              </div>
              <div>
                <div className="readout text-title text-ink">{t.per100g?.kcal !== undefined ? formatNumber(t.per100g.kcal, 0) : '—'}</div>
                kcal / 100 g cocido
              </div>
            </div>
            {!draft.cookedWeightG ? (
              <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">
                Sin peso cocido no se calculan valores por 100 g: el peso crudo de los ingredientes
                {t.rawWeightG !== null ? ` (${formatNumber(t.rawWeightG, 0)} g)` : ''} no equivale al peso del plato cocinado (agua, cocción).
              </p>
            ) : null}
            {t.partial.length ? <p className="text-xs text-faint">Totales parciales: algún ingrediente no tiene todos los datos.</p> : null}
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted">Valores por porción</summary>
              <div className="mt-2">
                <NutrientTable n={t.perServing} partial={t.partial} />
              </div>
            </details>
          </Card>
        ) : null}

        <div className="flex gap-2">
          {existing ? (
            <button className="btn-secondary flex-1" onClick={() => setLogOpen(true)} data-testid="log-recipe">
              <Icon name="utensils" size={16} /> Registrar
            </button>
          ) : null}
          <button className="btn-primary flex-1" disabled={!canSave || saving} onClick={() => void save()} data-testid="save-recipe">
            Guardar receta
          </button>
        </div>
        {saveError ? <p role="alert" className="text-body text-bad">{saveError}</p> : null}
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!(await confirm({ title: '¿Eliminar esta receta?', body: 'Los registros ya hechos conservan sus valores.', confirmLabel: 'Eliminar receta', tone: 'danger' }))) return
              await r.remove('recipes', existing.id)
              nav(`/comida/recetas${dq}`)
            }}
          >
            <Icon name="trash" size={16} /> Eliminar receta
          </button>
        ) : null}
        </div>
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Agregar ingrediente" wide>
        <FoodSearch inSheet onSelect={(f) => setPickFood(f)} />
      </Sheet>
      <QuantitySheet
        open={!!pickFood}
        food={pickFood}
        mode="pick"
        onClose={() => setPickFood(null)}
        onPicked={(snap) => {
          setIngs((s) => [...s, { ...snap, key: uuid() }])
          setPicker(false)
        }}
      />
      {recipeForLog ? (
        <QuantitySheet open={logOpen} food={fromRecipe(recipeForLog)} date={date} onClose={() => setLogOpen(false)} onSaved={(_, same) => same && nav(diaryPath(date))} />
      ) : null}
    </>
  )
}

export function TemplatesPage() {
  const r = useRepo()
  const nav = useNavigate()
  const confirm = useConfirm()
  const [date] = useDateParam()
  const templates = useLiveQuery(() => r.all('mealTemplates'), [r])
  const [view, setView] = useState<MealTemplate | null>(null)
  const slots = useMealSlots()
  const [meal, setMeal] = useState<MealKey>(() => slots.now.key)
  const quickLog = useQuickLog()

  function open(t: MealTemplate) {
    setMeal(t.meal ?? slots.now.key)
    setView(t)
  }

  async function apply() {
    if (!view) return
    const t = view
    const same = routeGuard()
    const ok = await quickLog.run(
      `tpl-page:${date}:${meal}:${t.id}`,
      () => logSnapshots(r, t.items.map((snapshot) => ({ snapshot, time: null })), date, meal),
      (b) => `Plantilla «${t.name}» aplicada a ${slots.lower(meal)}: ${b.ids.length} ${b.ids.length === 1 ? 'alimento' : 'alimentos'}`,
      800,
    )
    if (ok) {
      setView(null)
      if (same()) nav(diaryPath(date))
    }
  }

  return (
    <>
      <PageHeader title="Plantillas de comidas" back={diaryPath(date)} />
      {templates && templates.length ? (
        <ul className="card divide-y divide-line overflow-hidden">
          {templates.map((t) => {
            const { totals, partial } = sumNutrients(t.items)
            return (
              <li key={t.id} className="flex items-center gap-1 pl-4 pr-1">
                <button className="min-h-[52px] min-w-0 flex-1 py-3 text-left" onClick={() => open(t)} data-testid="template-open">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-label text-muted">
                    {t.items.length} alimentos{t.meal ? ` · ${slots.label(t.meal)}` : ''}
                  </div>
                  <div className="mt-1">
                    <MacroLine n={totals} partial={partial} />
                  </div>
                </button>
                <IconButton
                  icon="trash"
                  tone="danger"
                  label={`Eliminar plantilla ${t.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `¿Eliminar la plantilla «${t.name}»?`, body: 'Las comidas ya registradas no cambian.', confirmLabel: 'Eliminar plantilla', tone: 'danger' })) await r.remove('mealTemplates', t.id)
                  }}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon="layers" title="Sin plantillas">
          En la vista del día, abre el menú «⋯» de una comida y elige «Guardar como plantilla». Luego aplícala con un toque.
        </EmptyState>
      )}
      <Sheet
        open={!!view}
        onClose={() => setView(null)}
        title={view?.name}
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void apply()} data-testid="apply-template">
            Aplicar a {dayLabel(date).toLowerCase()} · {slots.lower(meal)}
          </button>
        }
      >
        <ul className="space-y-2 pb-3">
          {view?.items.map((i, k) => (
            <li key={k} className="flex items-center justify-between gap-3 text-body">
              <span className="min-w-0">
                <span className="block truncate font-medium">{i.name}</span>
                <span className="text-label text-muted">{describeQty(i)}</span>
              </span>
              <MacroLine n={i.nutrients} />
            </li>
          ))}
        </ul>
        <span className="label" id="tpl-meal-label">Comida</span>
        <div role="radiogroup" aria-labelledby="tpl-meal-label" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {slots.choices(view?.meal, meal).map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={meal === m.key} className={`chip min-h-11 shrink-0 ${meal === m.key ? 'chip-on' : ''}`} onClick={() => setMeal(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}
