import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRepo } from '../../app/profile'
import type { FoodLog, FoodSnapshot, MealKey } from '../../db/types'
import { saveFoodPortion } from '../../db/foodPortions'
import { resizeSnapshot } from '../../domain/foodSnapshot'
import { isCalendarDate } from '../../domain/dates'
import { formatNutrient } from '../../domain/nutrients'
import { NumField, TextField, numStr } from '../../ui/fields'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Sheet } from '../../ui/kit'
import { AmountField, stepFor } from './AmountField'
import { amountError } from './amountRange'
import { parseAmount } from './amountParse'
import { Chooser, type ChoiceOption } from './Chooser'
import { buildSnapshot, formatLogAmount, isRealPortion, KIND_LABEL, NOT_A_PORTION, measureText, shortQty, SOURCE_LABEL, unitOptions, type Food, type UnitOption } from './food'
import { FoodGlyph } from './FoodGlyph'
import { FoodThumbnail } from './FoodThumbnail'
import { foodGlyph } from './glyphKind'
import { NutrientTable } from './NutrientView'
import { routeGuard } from './paths'
import { useMealSlots } from './useMealSlots'
import { logSnapshots, recentId, touchRecent, type LoggedBatch } from './quickAdd'
import { useFoodSheetClose } from './useFoodSheetClose'

export { recentId, touchRecent }

/** What a new log reports when saved: the batch (rows created, undo) and a short description for the toast. */
export interface SavedInfo {
  batch: LoggedBatch
  name: string
  qty: string
  meal: MealKey
}

/** Mass and volume units a person rarely needs: they sit behind "Más unidades" in the unit chooser. */
const RARE_UNITS = new Set(['kg', 'oz', 'lb', 'l'])

/** Portions are counted in halves and quarters: ½, 1, 1½ and 2. For grams and millilitres there are no quick values. */
const QUICK_PORTIONS: { v: number; label: string; aria: string }[] = [
  { v: 0.5, label: '½', aria: '0,5' },
  { v: 1, label: '1', aria: '1' },
  { v: 1.5, label: '1½', aria: '1,5' },
  { v: 2, label: '2', aria: '2' },
]

const NUTRIENT_ES: Record<string, string> = {
  kcal: 'energía',
  protein: 'proteína',
  carbs: 'carbohidratos',
  fat: 'grasa',
  fiber: 'fibra',
  sugars: 'azúcares',
  satFat: 'grasa saturada',
  sodium: 'sodio',
}
const nutrientEs = (c: string) => NUTRIENT_ES[c] ?? c

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
  onCompleteNutrition,
  presentation = 'sheet',
}: {
  /** Null with `existing` = the food is not on this device: the stored snapshot is scaled proportionally. */
  food: Food | null
  open: boolean
  onClose: () => void
  date?: string
  meal?: MealKey
  existing?: FoodLog | null
  mode?: 'log' | 'pick'
  onPicked?: (snap: FoodSnapshot) => void
  /** A new log carries its batch (rows created, undo); an edit calls it with nothing. */
  /** `sameRoute` is false when the person left this screen while the save was running: do not navigate then. */
  onSaved?: (saved?: SavedInfo, sameRoute?: boolean) => void
  onDelete?: () => void
  onCompleteNutrition?: () => void
  /** 'panel' renders the same detail inline (desktop right pane) instead of in a modal sheet. */
  presentation?: 'sheet' | 'panel'
}) {
  const r = useRepo()
  const slotsApi = useMealSlots()
  const frozen = !food && !!existing
  const recent = useLiveQuery(() => (food ? r.get('recents', recentId(r.profileId, food.ref)) : undefined), [r, food?.ref])
  const fav = useLiveQuery(() => (food ? r.get('favorites', recentId(r.profileId, food.ref)) : undefined), [r, food?.ref])
  const customPortions = useLiveQuery(() => (food ? r.byProfileIndex('foodPortions', 'foodRef', food.ref) : []), [r, food?.ref])
  const options = useMemo<UnitOption[]>(() => {
    const recorded: UnitOption | null = existing
      ? {
          key: 'recorded',
          label: existing.unit === 'portion' ? measureText(existing).text : existing.unit === 'serving' ? 'porción (etiqueta)' : existing.unit === 'l' ? 'litros' : existing.unit,
          unit: existing.unit,
          defaultQty: existing.qty,
        }
      : null
    if (!food) return recorded ? [recorded] : []
    const units = unitOptions({ ...food, householdPortions: [...(customPortions ?? []), ...(food.householdPortions ?? [])] })
    const sorted = [...units.filter((o) => o.unit === 'portion'), ...units.filter((o) => o.unit !== 'portion')]
    // A historical snapshot is an explicit choice, independent of changing catalog/custom measures. It stands in for
    // the catalog option that reads the same, so a measure is never listed twice.
    if (recorded) return [recorded, ...sorted.filter((o) => o.label.toLowerCase() !== recorded.label.toLowerCase())]
    return sorted
  }, [food, customPortions, existing])
  const [unitKey, setUnitKey] = useState('')
  const [qty, setQty] = useState('')
  const [meal, setMeal] = useState<MealKey>(initialMeal ?? slotsApi.now.key)
  const [logDate, setLogDate] = useState(existing?.date ?? '')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [chooser, setChooser] = useState<'unit' | 'meal' | null>(null)
  const [portionForm, setPortionForm] = useState<{ id?: string; label: string; amount: string } | null>(null)
  const [portionError, setPortionError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { leaving, close } = useFoodSheetClose()
  const defaultOption = () => options.find(isRealPortion) ?? options.find((o) => o.unit === 'g' || o.unit === 'ml') ?? options[0]

  // Initialise from the entry being edited, then from the last use, then from defaults.
  const recentLoaded = recent !== undefined
  const portionsLoaded = customPortions !== undefined
  useEffect(() => {
    if ((!food && !existing) || !open) return
    // Old recents stored the raw catalog label: compare through the normaliser so they still find their measure.
    const sameLabel = (o: UnitOption, label?: string | null) => !!label && (o.portionLabel === label || o.name === label || o.label.startsWith(`${label} (`))
    const pick = (unit: string, label?: string | null, id?: string | null) =>
      options.find((o) => id && o.portionId === id) ?? options.find((o) => o.unit === unit && (o.unit !== 'portion' || sameLabel(o, label))) ?? defaultOption()
    if (existing) {
      setUnitKey('recorded')
      setQty(numStr(existing.qty, 3))
      setMeal(existing.meal)
      setLogDate(existing.date)
    } else if (recent) {
      const o = pick(recent.lastUnit, recent.lastPortionLabel, recent.lastPortionId)
      setUnitKey(o?.key ?? '')
      const sameMeasure = o?.unit === recent.lastUnit && (o.unit !== 'portion' || (recent.lastPortionId ? o.portionId === recent.lastPortionId : sameLabel(o, recent.lastPortionLabel)))
      setQty(numStr(sameMeasure ? recent.lastQty : o?.defaultQty, 3))
    } else {
      const o = defaultOption()
      setUnitKey(o?.key ?? '')
      setQty(String(o?.defaultQty ?? 1))
    }
    setPortionForm(null)
    setPortionError(null)
    setSaveError(null)
    setChooser(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [food?.ref, open, existing?.id, recentLoaded, portionsLoaded])

  useEffect(() => {
    if (initialMeal && !existing) setMeal(initialMeal)
  }, [initialMeal, existing])

  if (!food && !existing) return null
  const title = food?.name ?? existing?.name ?? ''
  const brand = food?.brand ?? existing?.brand ?? null
  const opt = options.find((o) => o.key === unitKey) ?? options[0]
  const q = parseAmount(qty)
  const qErr = amountError(q, opt?.unit, mode)
  const snap = opt && q !== null && !qErr ? (existing && opt.key === 'recorded' ? resizeSnapshot(existing, q) : food ? buildSnapshot(food, q, opt) : null) : null
  const err = qErr ?? (snap && 'error' in snap ? snap.error : q === null && qty.trim() !== '' ? 'Cantidad no válida' : null)
  const ok = snap && !('error' in snap) ? snap : null
  const dateOk = !existing || isCalendarDate(logDate)

  function selectUnit(key: string) {
    const selected = options.find((o) => o.key === key)
    setUnitKey(key)
    setQty(numStr(selected?.defaultQty ?? 1, 3))
  }

  async function savePortion() {
    if (!portionForm || !food) return
    setPortionError(null)
    const eq = parseAmount(portionForm.amount)
    const eqErr = eq === null ? 'Indica la equivalencia en g o ml.' : amountError(eq, food.basis === '100ml' ? 'ml' : 'g')
    if (eqErr) return setPortionError(eqErr)
    try {
      const portion = await saveFoodPortion(r, food, {
        id: portionForm.id, label: portionForm.label, equivalentAmount: eq ?? 0,
        equivalentUnit: food.basis === '100ml' ? 'ml' : 'g',
      })
      setUnitKey(`household:${portion.id}`)
      setQty('1')
      setPortionForm(null)
    } catch (e) { setPortionError(e instanceof Error ? e.message : 'No se pudo guardar la medida.') }
  }

  async function save() {
    if (!ok || !dateOk || savingRef.current || leaving) return
    savingRef.current = true
    const sameRoute = routeGuard()
    setSaving(true)
    setSaveError(null)
    try {
      let saved: SavedInfo | undefined
      if (mode === 'pick') {
        // Choosing a recipe ingredient is not eating it: it must not count as a use of the food.
        onPicked?.(ok)
      } else if (existing) {
        await r.update('foodLogs', existing.id, { ...ok, meal, date: logDate })
        if (!frozen) await touchRecent(r, ok)
      } else {
        saved = { batch: await logSnapshots(r, [{ snapshot: ok }], date as string, meal), name: ok.name, qty: shortQty(ok), meal }
      }
      close(() => { onSaved?.(saved, sameRoute()); onClose() }, presentation === 'sheet')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function toggleFav() {
    if (!food) return
    const id = recentId(r.profileId, food.ref)
    if (fav) await r.remove('favorites', id)
    else await r.put('favorites', { id, foodRef: food.ref, name: food.name, source: food.source })
  }

  const per = food?.basis === 'serving' ? 'por porción' : food?.basis === '100ml' ? 'por 100 ml' : 'por 100 g'
  const isMeasure = opt?.unit === 'portion' || opt?.unit === 'serving'
  // Reference quantities ("cantidad no especificada") are not something a person eats: never offered, unless already chosen.
  const offered = options.filter((o) => o.key === unitKey || !(o.unit === 'portion' && NOT_A_PORTION.test(o.label)))
  const unitChoices: ChoiceOption[] = offered.filter((o) => !RARE_UNITS.has(o.unit) || o.key === 'recorded').map((o) => ({ key: o.key, label: o.label, hint: o.key === 'recorded' ? 'registro guardado' : undefined }))
  const moreChoices: ChoiceOption[] = offered.filter((o) => RARE_UNITS.has(o.unit) && o.key !== 'recorded').map((o) => ({ key: o.key, label: o.label }))
  const mealName = slotsApi.label(meal)
  const Frame = presentation === 'panel' ? PanelFrame : Sheet
  const compact = presentation === 'sheet' && !!globalThis.window?.matchMedia?.('(pointer: coarse)').matches
  const Details = compact ? 'details' : 'div'
  const glyph = food ? <FoodThumbnail food={food} /> : <FoodGlyph size={40} kind={existing ? foodGlyph({ name: existing.name, category: null, kind: existing.kind ?? 'generic', source: existing.source, brand: existing.brand }) : 'generic'} />
  const cell = (label: string, code: 'kcal' | 'protein' | 'carbs' | 'fat', color: string, unit?: string) => (
    <div className="min-w-0 px-1 py-1 text-center">
      <div className="num text-[17px] font-semibold leading-6" style={code === 'kcal' ? undefined : { color: `rgb(var(--${color}))` }}>
        {ok ? formatNutrient(code, ok.nutrients[code], false) : '—'}
        {ok && unit && ok.nutrients[code] !== undefined ? <span className="ml-0.5 text-micro font-normal text-muted">{unit}</span> : null}
      </div>
      <div className="whitespace-nowrap text-micro text-muted">{label}</div>
    </div>
  )
  return (
    <>
      <Frame
        open={open}
        leaving={leaving}
        onClose={() => { if (!savingRef.current) close(onClose, presentation === 'sheet') }}
        title={
          <span className="flex min-w-0 items-center gap-3">
            {glyph}
            <span className="min-w-0">
              <span className="line-clamp-2 leading-snug">{title}</span>
              {brand || food?.packageLabel ? <span className="block truncate text-label font-normal text-muted">{[brand, food?.packageLabel].filter(Boolean).join(' · ')}</span> : null}
            </span>
          </span>
        }
        footer={
          <div className="flex items-center gap-2">
            {onDelete ? (
              <button type="button" className="btn-ghost p-2.5 text-bad" aria-label="Eliminar registro" onClick={onDelete}>
                <Icon name="trash" />
              </button>
            ) : null}
            {food ? (
              <button type="button" className="btn-ghost p-2.5" aria-label={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'} onClick={() => void toggleFav()}>
                <Icon name="star" className={fav ? 'fill-current text-warn' : ''} />
              </button>
            ) : null}
            {mode === 'log' ? (
              <div className="flex min-w-0 flex-1 items-stretch">
                <button type="button" className="btn-primary min-w-0 flex-1" disabled={!ok || !dateOk || saving || leaving} onClick={() => void save()} data-testid="save-food">
                  <span className="truncate">{existing ? `Guardar en ${mealName.toLowerCase()}` : `Agregar a ${mealName.toLowerCase()}`}</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary hit-44 ml-2 w-11 shrink-0 px-0"
                  aria-label={`Cambiar la comida, ahora ${mealName.toLowerCase()}`}
                  aria-haspopup="dialog"
                  data-testid="meal-change"
                  onClick={() => setChooser('meal')}
                >
                  <Icon name="chevronDown" size={18} />
                </button>
              </div>
            ) : (
              <button type="button" className="btn-primary flex-1" disabled={!ok || !dateOk || saving} onClick={() => void save()} data-testid="save-food">
                Agregar
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <div data-testid="qty-preview" aria-live="polite" className="grid grid-cols-[1fr_1fr_1.4fr_1fr] gap-1 rounded-2xl bg-accent/10 px-1 py-1.5">
            {cell('kcal', 'kcal', 'ink')}
            {cell('proteína', 'protein', 'protein', 'g')}
            {cell('carbohidratos', 'carbs', 'carbs', 'g')}
            {cell('grasa', 'fat', 'fat', 'g')}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-end gap-3">
            <AmountField value={qty} onChange={setQty} step={stepFor(opt?.unit)} onEnter={() => void save()} fractions={isMeasure}
              autoFocus={!compact} />
            <div className="min-w-0">
              <span className="label !mb-1" id="unit-label">
                Unidad
              </span>
              <button
                type="button"
                aria-labelledby="unit-label unit-value"
                aria-haspopup="dialog"
                data-testid="unit-button"
                onClick={() => setChooser('unit')}
                className="flex h-11 w-full items-center justify-between gap-1 rounded-xl border border-line-strong bg-surface2/50 px-3 text-left text-body font-medium text-ink transition-colors duration-state hover:border-ink/40"
              >
                <span id="unit-value" className="truncate" title={opt?.label}>
                  {opt?.label ?? ''}
                </span>
                <Icon name="chevronDown" size={16} className="shrink-0 text-muted" />
              </button>
            </div>
          </div>

          {isMeasure ? (
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Cantidades rápidas">
              {QUICK_PORTIONS.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  aria-label={p.aria}
                  aria-pressed={q === p.v}
                  className={`chip num min-h-11 justify-center text-body ${q === p.v ? 'border-accent bg-accent/15 text-ink' : ''}`}
                  onClick={() => setQty(numStr(p.v, 3))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : null}

          {err ? (
            <p role="alert" className="text-label text-bad">
              {err}
            </p>
          ) : !ok ? (
            <p className="text-label text-muted">Ingresa una cantidad.</p>
          ) : opt?.unit === 'portion' ? (
            <p className="num text-label text-muted" data-testid="portion-equivalence">
              {numStr(ok.qty, 3)} × {measureText({ ...ok, portionEquivalentAmount: undefined }).name} = {numStr(ok.grams ?? ok.ml, 2)} {ok.grams !== null ? 'g' : 'ml'}
            </p>
          ) : null}
          {saveError ? <p role="alert" className="text-label text-bad">{saveError}</p> : null}
          {ok && opt?.unit !== 'portion' ? <p className="text-label font-medium text-muted">{formatLogAmount(ok)}</p> : null}
          {onCompleteNutrition ? <button type="button" className="btn-secondary w-full" onClick={() => close(onCompleteNutrition)}>Completar nutrición</button> : null}
          {food?.source === 'off' && (ok?.missing.length || food.flags.includes('off_basis_conflict') || food.flags.includes('atwater_mismatch')) ? (
            <p className="text-label text-warn">Datos incompletos o inconsistentes. Verifica la etiqueta del producto.</p>
          ) : null}

          <Details className="divide-rows border-t border-line">
            {compact ? <summary className="min-h-11 cursor-pointer py-3 text-label font-medium text-muted">Más detalles</summary> : null}
            <Disclosure summary="Información nutricional" testId="detail-nutrition">
              <div className="space-y-3">
                {ok?.missing.length ? <p className="text-label text-warn">Sin dato en la fuente: {ok.missing.map((c) => nutrientEs(c)).join(', ')}.</p> : null}
                {frozen ? (
                  <p className="text-label text-muted">
                    El alimento original no está en este dispositivo. Al cambiar la cantidad se escalan en proporción los valores guardados en el registro.
                  </p>
                ) : existing && opt?.key === 'recorded' ? (
                  <p className="text-label text-muted">Se conservan los nutrientes del registro original. Cambiar de unidad usa los valores actuales del alimento.</p>
                ) : null}
                <p className="text-label font-medium text-muted">{food ? `Valores ${per}` : 'Valores de este registro'}</p>
                <NutrientTable n={food ? food.nutrients : (existing?.nutrients ?? {})} />
              </div>
            </Disclosure>

            <Disclosure summary="Fuente" testId="detail-source">
              <dl className="space-y-1 text-label text-muted">
                <div className="flex justify-between gap-3"><dt>Base de datos</dt><dd className="text-right text-ink">{SOURCE_LABEL[food?.source ?? existing!.source]}</dd></div>
                {(food?.kind ?? existing?.kind) ? <div className="flex justify-between gap-3"><dt>Estado</dt><dd className="text-right text-ink">{KIND_LABEL[(food?.kind ?? existing?.kind)!]}</dd></div> : null}
                {food?.datasetVersion ? <div className="flex justify-between gap-3"><dt>Versión</dt><dd className="text-right text-ink">{food.datasetVersion}</dd></div> : null}
                {food ? <div className="flex justify-between gap-3"><dt>Referencia</dt><dd className="break-all text-right text-ink">{food.ref}</dd></div> : null}
                {opt?.unit === 'portion' ? <div className="flex justify-between gap-3"><dt>Medida</dt><dd className="text-right text-ink" data-testid="portion-source">{opt.key === 'recorded' ? 'valores guardados en el registro' : opt.portionVerification === 'custom' ? 'equivalencia personalizada' : 'equivalencia de la fuente'}</dd></div> : null}
                {food?.source.startsWith('usda_') ? <div className="flex justify-between gap-3"><dt>Nombre original</dt><dd className="text-right text-ink">{food.nameOrig}</dd></div> : null}
                {food?.source === 'off' && food.barcode && /^\d{6,14}$/.test(food.barcode) ? (
                  <div className="pt-2">
                    <a className="font-semibold underline" href={`https://world.openfoodfacts.org/product/${food.barcode}`} target="_blank" rel="noreferrer">Ver ficha y créditos</a>
                    {food.imageUrl ? <p className="mt-1">Foto de colaboradores de Open Food Facts · <a className="underline" href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a></p> : null}
                  </div>
                ) : null}
              </dl>
            </Disclosure>

            {food && food.basis !== 'serving' ? (
              <Disclosure summary="Mi medida" testId="detail-my-measure">
                <div>
                  {customPortions?.map((p) => (
                    <div key={p.id} className="flex items-center gap-1 border-b border-line py-0.5" data-testid="custom-portion-row">
                      <span className="min-w-0 flex-1 text-label">{p.label} = {numStr(p.equivalentAmount, 2)} {p.equivalentUnit}</span>
                      <button type="button" className="btn-ghost p-3" aria-label={`Editar medida ${p.label}`} onClick={() => { setPortionForm({ id: p.id, label: p.label, amount: numStr(p.equivalentAmount, 3) }); setPortionError(null) }}><Icon name="edit" size={16} /></button>
                      <button type="button" className="btn-ghost p-3 text-bad" aria-label={`Eliminar medida ${p.label}`} onClick={async () => { await r.remove('foodPortions', p.id); if (opt?.portionId === p.id) selectUnit(food.basis === '100ml' ? 'ml' : 'g') }}><Icon name="trash" size={16} /></button>
                    </div>
                  ))}
                  {portionForm ? (
                    <fieldset className="mt-2 space-y-2" data-testid="custom-portion-form">
                      <legend className="text-body font-semibold">Medida solo para este alimento y perfil</legend>
                      <TextField label="Nombre de la medida" value={portionForm.label} onChange={(label) => setPortionForm({ ...portionForm, label })} placeholder="Mi taza de arroz cocido" />
                      <NumField label={food.basis === '100ml' ? 'Equivalencia en mililitros' : 'Equivalencia en gramos'} value={portionForm.amount} onChange={(amount) => setPortionForm({ ...portionForm, amount })} />
                      <p className="text-label text-muted">Usa una equivalencia medida por ti o documentada para esta presentación. No se aplica a otros alimentos.</p>
                      {portionError ? <p role="alert" className="text-label text-bad">{portionError}</p> : null}
                      <div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => setPortionForm(null)}>Cancelar medida</button><button type="button" className="btn-primary flex-1" onClick={() => void savePortion()} data-testid="custom-portion-save">Guardar porción</button></div>
                    </fieldset>
                  ) : (
                    <button type="button" className="btn-ghost -ml-2 px-2 text-label" onClick={() => { setPortionForm({ label: '', amount: '' }); setPortionError(null) }} data-testid="custom-portion-toggle">
                      <Icon name="plus" size={16} /> Agregar mi medida
                    </button>
                  )}
                </div>
              </Disclosure>
            ) : null}

            <Disclosure summary={existing ? 'Fecha y notas' : 'Notas'} testId="detail-notes">
              <div className="space-y-3">
                {existing ? (
                  <label className="label">
                    Fecha del registro
                    <input type="date" className="field mt-1" value={logDate} onChange={(e) => setLogDate(e.target.value)} aria-invalid={!dateOk} />
                  </label>
                ) : null}
                {food ? <DataNotes food={food} /> : null}
                {!existing && !food ? <p className="text-label text-muted">Sin notas.</p> : null}
              </div>
            </Disclosure>
          </Details>
        </div>
      </Frame>
      <Chooser
        open={chooser === 'unit'}
        onClose={() => setChooser(null)}
        title="Unidad"
        options={unitChoices}
        more={moreChoices}
        moreLabel="Más unidades"
        value={opt?.key ?? ''}
        onSelect={selectUnit}
      />
      <Chooser
        open={chooser === 'meal'}
        onClose={() => setChooser(null)}
        title="Agregar a"
        options={slotsApi.choices(existing?.meal, meal).map((m) => ({ key: m.key, label: m.label }))}
        value={meal}
        onSelect={(k) => setMeal(k as MealKey)}
      />
    </>
  )
}

/** The detail without the modal: a bordered panel with the same title, body and footer as the sheet. */
function PanelFrame({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; leaving?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const [maxH, setMaxH] = useState<number | null>(null)
  // The panel lives in the page, so an on-screen keyboard (which shrinks the visible area, sometimes by more than half on a
  // landscape tablet) can push its footer out of sight. Fit the panel into what is visible BELOW ITS TOP: the body scrolls
  // and the footer stays pinned inside the visible area.
  useEffect(() => {
    if (!open) return
    const fit = () => {
      const el = ref.current
      if (!el) return
      const vv = window.visualViewport
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
      const top = Math.max(el.getBoundingClientRect().top, 12)
      setMaxH(Math.max(240, Math.floor(visibleBottom - top - 12)))
    }
    fit()
    const vv = window.visualViewport
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, { passive: true })
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || !e.target.matches('input, select, textarea')) return
      const field = e.target
      window.setTimeout(() => { fit(); if (field.isConnected) field.scrollIntoView({ block: 'nearest' }) }, 150)
    }
    ref.current?.addEventListener('focusin', onFocus)
    const node = ref.current
    return () => {
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit)
      node?.removeEventListener('focusin', onFocus)
    }
  }, [open])
  if (!open) return null
  return (
    <section ref={ref} className="card flex max-h-[calc(100dvh-3rem)] flex-col" style={maxH ? { maxHeight: Math.min(maxH, window.innerHeight - 48) } : undefined} data-testid="quantity-panel" aria-label="Cantidad">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h2 className="min-w-0 text-[19px] font-semibold tracking-tight">{title}</h2>
        <IconButton icon="x" label="Cerrar" onClick={onClose} className="-mr-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
    </section>
  )
}

export function DataNotes({ food }: { food: Food }) {
  const notes: string[] = []
  if (food.flags.includes('kcal_from_kj')) notes.push('Energía calculada desde kJ (estimada).')
  if (food.flags.includes('sodium_from_salt')) notes.push('Sodio calculado desde la sal (sal ÷ 2,5).')
  if (food.flags.includes('kj_inconsistent_nulled')) notes.push('Se omitieron los kJ por discrepancia con las kcal declaradas.')
  if (food.flags.includes('off_salt_conflict')) notes.push('La sal y el sodio declarados no concuerdan. Se conserva el sodio declarado.')
  if (food.flags.includes('off_basis_conflict')) notes.push('Los valores por porción y por 100 g/ml difieren. Se usaron los datos por porción de la etiqueta.')
  if (food.flags.includes('off_serving_unverified')) notes.push('La ficha no permite verificar la equivalencia de la porción en gramos o mililitros.')
  if (food.flags.includes('atwater_mismatch')) notes.push('Las kcal declaradas no coinciden con los macronutrientes (>25 %). Revisa la etiqueta.')
  if (food.flags.includes('kcal_atwater_general') || food.flags.includes('kcal_atwater_specific')) notes.push('Energía según factores Atwater de la fuente.')
  if (food.flags.includes('partial')) notes.push('Receta con ingredientes sin algunos datos: totales parciales.')
  if (food.flags.includes('trace_as_zero')) notes.push('Valores «trazas» de la tabla registrados como 0.')
  if (food.kind === 'raw') notes.push('Valores para el alimento crudo. Pesa en crudo o elige la versión cocida.')
  if (food.kind === 'cooked') notes.push('Valores para el alimento cocido. Pesa ya cocinado.')
  if (notes.length === 0) return <p className="text-label text-muted">Sin notas.</p>
  return (
    <ul className="space-y-1 text-label text-muted">
      {notes.map((n) => (
        <li key={n} className="flex gap-1.5">
          <Icon name="info" size={14} className="mt-0.5 shrink-0 text-faint" />
          {n}
        </li>
      ))}
    </ul>
  )
}
