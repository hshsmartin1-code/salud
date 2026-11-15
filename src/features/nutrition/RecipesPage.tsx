import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRepo } from '../../app/profile'
import { uuid } from '../../db/repo'
import type { MealTemplate, Recipe, RecipeIngredient } from '../../db/types'
import { todayLocal } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { NumField, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Card, EmptyState, PageHeader, Sheet } from '../../ui/kit'
import { FoodSearch } from './FoodSearch'
import { describeQty, fromRecipe, MEAL_LABEL, recipeTotals, SOURCE_SHORT, type Food } from './food'
import { MacroLine, NutrientTable } from './NutrientView'
import { QuantitySheet } from './QuantitySheet'
import { sumNutrients } from '../../domain/nutrients'

export function RecipesPage() {
  const r = useRepo()
  const recipes = useLiveQuery(() => r.all('recipes'), [r])
  return (
    <>
      <PageHeader
        title="Recetas"
        back="/comida"
        actions={
          <Link className="btn-primary px-3" to="/comida/recetas/nueva">
            <Icon name="plus" size={18} /> Nueva
          </Link>
        }
      />
      {recipes && recipes.length ? (
        <ul className="card divide-y divide-line overflow-hidden">
          {recipes
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((rc) => {
              const t = recipeTotals(rc)
              return (
                <li key={rc.id}>
                  <Link to={`/comida/recetas/${rc.id}`} className="block px-4 py-3 hover:bg-surface2/60">
                    <div className="font-medium">{rc.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {rc.ingredients.length} ingredientes · {formatNumber(rc.servings, 1)} porciones
                      {rc.cookedWeightG ? ` · ${formatNumber(rc.cookedWeightG, 0)} g cocido` : ''}
                    </div>
                    <div className="mt-1">
                      <MacroLine n={t.perServing} partial={t.partial} /> <span className="text-[11px] text-faint">por porción</span>
                    </div>
                  </Link>
                </li>
              )
            })}
        </ul>
      ) : (
        <EmptyState icon="book" title="Sin recetas" action={<Link className="btn-primary" to="/comida/recetas/nueva">Crear receta</Link>}>
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
  const canSave = name.trim() && ings.length > 0 && (toNum(servings) ?? 0) > 0

  async function save(): Promise<Recipe | null> {
    if (!canSave) return null
    const data = { name: name.trim(), servings: toNum(servings) as number, cookedWeightG: toNum(cooked), ingredients: ings, notes }
    const row = existing ? await r.put('recipes', { ...existing, ...data }) : await r.add('recipes', data)
    setSavedId(row.id)
    if (isNew) nav(`/comida/recetas/${row.id}`, { replace: true })
    return row
  }

  const recipeForLog = existing && savedId === existing.id ? existing : existing
  return (
    <>
      <PageHeader title={isNew ? 'Nueva receta' : 'Receta'} back="/comida/recetas" />
      <div className="space-y-4">
        <Card className="space-y-3">
          <TextField label="Nombre" value={name} onChange={setName} autoFocus={isNew} placeholder="p. ej. Arroz con pollo" />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Porciones" value={servings} onChange={setServings} />
            <NumField label="Peso cocido total" unit="g" value={cooked} onChange={setCooked} hint="Opcional: permite registrar por gramos" />
          </div>
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
                    <div className="text-xs text-muted">
                      {describeQty(i)} · <Badge>{SOURCE_SHORT[i.source]}</Badge>
                    </div>
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

        {ings.length ? (
          <Card className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted">
              <div>
                <div className="readout text-[22px] text-ink">{t.totals.kcal !== undefined ? formatNumber(t.totals.kcal, 0) : '—'}</div>
                kcal total
              </div>
              <div>
                <div className="readout text-[22px] text-ink">{t.perServing.kcal !== undefined ? formatNumber(t.perServing.kcal, 0) : '—'}</div>
                kcal / porción
              </div>
              <div>
                <div className="readout text-[22px] text-ink">{t.per100g?.kcal !== undefined ? formatNumber(t.per100g.kcal, 0) : '—'}</div>
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
          <button className="btn-primary flex-1" disabled={!canSave} onClick={() => void save()} data-testid="save-recipe">
            Guardar receta
          </button>
        </div>
        {existing ? (
          <button
            className="btn-danger w-full"
            onClick={async () => {
              if (!confirm('¿Eliminar esta receta? Los registros ya hechos conservan sus valores.')) return
              await r.remove('recipes', existing.id)
              nav('/comida/recetas')
            }}
          >
            <Icon name="trash" size={16} /> Eliminar receta
          </button>
        ) : null}
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title="Agregar ingrediente" wide>
        <FoodSearch onSelect={(f) => setPickFood(f)} />
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
        <QuantitySheet open={logOpen} food={fromRecipe(recipeForLog)} date={todayLocal()} onClose={() => setLogOpen(false)} onSaved={() => nav('/comida')} />
      ) : null}
    </>
  )
}

export function TemplatesPage() {
  const r = useRepo()
  const templates = useLiveQuery(() => r.all('mealTemplates'), [r])
  const [view, setView] = useState<MealTemplate | null>(null)
  return (
    <>
      <PageHeader title="Plantillas de comidas" back="/comida" />
      {templates && templates.length ? (
        <ul className="card divide-y divide-line overflow-hidden">
          {templates.map((t) => {
            const { totals, partial } = sumNutrients(t.items)
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setView(t)}>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted">
                    {t.items.length} alimentos{t.meal ? ` · ${MEAL_LABEL[t.meal]}` : ''}
                  </div>
                  <div className="mt-1">
                    <MacroLine n={totals} partial={partial} />
                  </div>
                </button>
                <button
                  className="btn-ghost p-2"
                  aria-label="Eliminar plantilla"
                  onClick={() => {
                    if (confirm(`¿Eliminar la plantilla «${t.name}»?`)) void r.remove('mealTemplates', t.id)
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon="layers" title="Sin plantillas">
          En la vista del día, abre el menú «⋯» de una comida y elige «Guardar como plantilla». Luego aplícala con un toque.
        </EmptyState>
      )}
      <Sheet open={!!view} onClose={() => setView(null)} title={view?.name}>
        <ul className="space-y-2 pb-2">
          {view?.items.map((i, k) => (
            <li key={k} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{i.name}</span>
                <span className="text-xs text-muted">{describeQty(i)}</span>
              </span>
              <MacroLine n={i.nutrients} />
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
