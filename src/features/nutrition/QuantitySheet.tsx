import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { Repo } from '../../db/repo'
import type { FoodLog, FoodSnapshot, MealKey } from '../../db/types'
import { nowLocalTime } from '../../domain/dates'
import { formatNutrient } from '../../domain/nutrients'
import { NumField, SelectField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, Sheet } from '../../ui/kit'
import { buildSnapshot, defaultMeal, KIND_LABEL, MEALS, SOURCE_LABEL, unitOptions, type Food } from './food'
import { MacroLine, NutrientTable } from './NutrientView'

export const recentId = (profileId: string, ref: string) => `${profileId}|${ref}`

export async function touchRecent(r: Repo, snap: FoodSnapshot) {
  const id = recentId(r.profileId, snap.foodRef)
  const prev = await r.get('recents', id)
  await r.put('recents', {
    id,
    foodRef: snap.foodRef,
    name: snap.name,
    source: snap.source,
    lastUsedAt: new Date().toISOString(),
    count: (prev?.count ?? 0) + 1,
    lastQty: snap.qty,
    lastUnit: snap.unit,
    lastPortionLabel: snap.portionLabel ?? null,
  })
}

export function QuantitySheet({
  food,
  open,
  onClose,
  date,
  meal: initialMeal,
  existing,
  mode = 'log',
  onPicked,
  onSaved,
  onDelete,
}: {
  food: Food | null
  open: boolean
  onClose: () => void
  date?: string
  meal?: MealKey
  existing?: FoodLog | null
  mode?: 'log' | 'pick'
  onPicked?: (snap: FoodSnapshot) => void
  onSaved?: () => void
  onDelete?: () => void
}) {
  const r = useRepo()
  const recent = useLiveQuery(() => (food ? r.get('recents', recentId(r.profileId, food.ref)) : undefined), [r, food?.ref])
  const fav = useLiveQuery(() => (food ? r.get('favorites', recentId(r.profileId, food.ref)) : undefined), [r, food?.ref])
  const options = useMemo(() => (food ? unitOptions(food) : []), [food])
  const [unitKey, setUnitKey] = useState('')
  const [qty, setQty] = useState('')
  const [meal, setMeal] = useState<MealKey>(initialMeal ?? defaultMeal(nowLocalTime()))
  const [details, setDetails] = useState(false)
  const [saving, setSaving] = useState(false)

  // Initialise from the entry being edited, then from the last use, then from defaults.
  useEffect(() => {
    if (!food || !open) return
    const pick = (unit: string, label?: string | null) =>
      options.find((o) => o.unit === unit && (o.unit !== 'portion' || o.portionLabel === label)) ?? options[0]
    if (existing) {
      const o = pick(existing.unit, existing.portionLabel)
      setUnitKey(o?.key ?? '')
      setQty(numStr(existing.qty, 3))
      setMeal(existing.meal)
    } else if (recent) {
      const o = pick(recent.lastUnit, recent.lastPortionLabel)
      setUnitKey(o?.key ?? '')
      setQty(numStr(o && o.unit === recent.lastUnit ? recent.lastQty : o?.defaultQty, 3))
    } else {
      const o = options[0]
      setUnitKey(o?.key ?? '')
      setQty(String(o?.defaultQty ?? 1))
    }
    setDetails(false)
  }, [food?.ref, open, existing?.id, recent === undefined])

  useEffect(() => {
    if (initialMeal && !existing) setMeal(initialMeal)
  }, [initialMeal, existing])

  if (!food) return null
  const opt = options.find((o) => o.key === unitKey) ?? options[0]
  const q = toNum(qty)
  const snap = opt && q !== null ? buildSnapshot(food, q, opt) : null
  const err = snap && 'error' in snap ? snap.error : q === null && qty.trim() !== '' ? 'Cantidad no válida' : null
  const ok = snap && !('error' in snap) ? snap : null

  async function save() {
    if (!ok || !food) return
    setSaving(true)
    try {
      if (mode === 'pick') {
        onPicked?.(ok)
      } else if (existing) {
        await r.update('foodLogs', existing.id, { ...ok, meal })
      } else {
        await r.add('foodLogs', { ...ok, date: date as string, meal, time: nowLocalTime(), origin: 'app' })
      }
      await touchRecent(r, ok)
      onSaved?.()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function toggleFav() {
    if (!food) return
    const id = recentId(r.profileId, food.ref)
    if (fav) await r.remove('favorites', id)
    else await r.put('favorites', { id, foodRef: food.ref, name: food.name, source: food.source })
  }

  const per = food.basis === 'serving' ? 'por porción' : food.basis === '100ml' ? 'por 100 ml' : 'por 100 g'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="line-clamp-2">{food.name}</span>
        </span>
      }
      footer={
        <div className="flex items-center gap-2">
          {onDelete ? (
            <button type="button" className="btn-ghost p-2.5 text-bad" aria-label="Eliminar registro" onClick={onDelete}>
              <Icon name="trash" />
            </button>
          ) : null}
          <button type="button" className="btn-ghost p-2.5" aria-label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'} onClick={() => void toggleFav()}>
            <Icon name="star" className={fav ? 'fill-current text-warn' : ''} />
          </button>
          <button type="button" className="btn-primary flex-1" disabled={!ok || saving} onClick={() => void save()} data-testid="save-food">
            {mode === 'pick' ? 'Agregar' : existing ? 'Guardar cambios' : 'Registrar'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone="accent">{SOURCE_LABEL[food.source]}</Badge>
          <Badge>{KIND_LABEL[food.kind]}</Badge>
          {food.brand ? <Badge>{food.brand}</Badge> : null}
          {food.englishOnly ? <span className="text-faint">Nombre original: {food.nameOrig}</span> : null}
        </div>

        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <NumField label="Cantidad" value={qty} onChange={setQty} autoFocus name="qty" />
          <SelectField label="Unidad" value={opt?.key ?? ''} onChange={setUnitKey} options={options.map((o) => ({ value: o.key, label: o.label }))} />
        </div>
        <div className="-mt-1 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Cantidades rápidas">
          {quickQtys(opt?.unit).map((v) => (
            <button
              key={v}
              type="button"
              className={`chip num shrink-0 ${toNum(qty) === v ? 'chip-on' : ''}`}
              onClick={() => setQty(numStr(v, 3))}
            >
              {numStr(v, 3)}
              {opt && (opt.unit === 'g' || opt.unit === 'ml') ? ` ${opt.unit}` : ''}
            </button>
          ))}
        </div>
        {mode === 'log' ? (
          <div>
            <span className="label" id="meal-label">
              Comida
            </span>
            <div role="radiogroup" aria-labelledby="meal-label" className="flex flex-wrap gap-1.5">
              {MEALS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={meal === m.key}
                  className={`chip ${meal === m.key ? 'chip-on' : ''}`}
                  onClick={() => setMeal(m.key)}
                >
                  {m.es}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-line bg-surface2/50 p-3.5">
          {err ? (
            <p className="text-sm text-bad">{err}</p>
          ) : ok ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="readout text-[40px]">{formatNutrient('kcal', ok.nutrients.kcal, false)}</span>
                <span className="text-sm text-muted">kcal</span>
              </div>
              <div className="mt-2">
                <MacroLine n={ok.nutrients} hideKcal />
              </div>
              {ok.missing.length ? (
                <p className="mt-2 text-xs text-warn">Sin dato en la fuente: {ok.missing.map((c) => nutrientEs(c)).join(', ')}.</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">Ingresa una cantidad.</p>
          )}
        </div>

        <DataNotes food={food} />

        <button type="button" className="btn-ghost -ml-2 px-2 py-1 text-xs" onClick={() => setDetails((v) => !v)}>
          <Icon name={details ? 'chevronUp' : 'chevronDown'} size={16} /> Valores nutricionales {per}
        </button>
        {details ? <NutrientTable n={food.nutrients} /> : null}
        {details && food.datasetVersion ? <p className="text-[11px] text-faint">Fuente: {SOURCE_LABEL[food.source]} · {food.datasetVersion} · {food.ref}</p> : null}
      </div>
    </Sheet>
  )
}

/** One-tap amounts for the selected unit (grams/ml or servings). */
function quickQtys(unit: string | undefined): number[] {
  if (unit === 'g' || unit === 'ml') return [50, 100, 150, 200, 250, 300]
  if (unit === 'kg' || unit === 'l') return [0.25, 0.5, 1]
  if (unit === 'oz') return [1, 2, 4, 8]
  if (unit === 'lb') return [0.25, 0.5, 1]
  return [0.5, 1, 1.5, 2, 3]
}

const ES_N: Record<string, string> = {
  kcal: 'energía',
  protein: 'proteína',
  carbs: 'carbohidratos',
  fat: 'grasa',
  fiber: 'fibra',
  sugars: 'azúcares',
  satFat: 'grasa saturada',
  sodium: 'sodio',
}
const nutrientEs = (c: string) => ES_N[c] ?? c

export function DataNotes({ food }: { food: Food }) {
  const notes: string[] = []
  if (food.flags.includes('kcal_from_kj')) notes.push('Energía calculada desde kJ (estimada).')
  if (food.flags.includes('sodium_from_salt')) notes.push('Sodio calculado desde la sal (sal ÷ 2,5).')
  if (food.flags.includes('atwater_mismatch')) notes.push('Las kcal declaradas no coinciden con los macronutrientes (>25 %). Revisa la etiqueta.')
  if (food.flags.includes('kcal_atwater_general') || food.flags.includes('kcal_atwater_specific')) notes.push('Energía según factores Atwater de la fuente.')
  if (food.flags.includes('partial')) notes.push('Receta con ingredientes sin algunos datos: totales parciales.')
  if (food.flags.includes('trace_as_zero')) notes.push('Valores «trazas» de la tabla registrados como 0.')
  if (food.kind === 'raw') notes.push('Valores para el alimento CRUDO. Pesa en crudo o elige la versión cocida.')
  if (food.kind === 'cooked') notes.push('Valores para el alimento COCIDO. Pesa ya cocinado.')
  if (notes.length === 0) return null
  return (
    <ul className="space-y-1 text-xs text-muted">
      {notes.map((n) => (
        <li key={n} className="flex gap-1.5">
          <Icon name="info" size={14} className="mt-0.5 shrink-0 text-faint" />
          {n}
        </li>
      ))}
    </ul>
  )
}
