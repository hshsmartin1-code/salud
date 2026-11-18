import { useRef, useState } from 'react'
import { useRepo } from '../../app/profile'
import { NUTRIENTS, type NutrientCode, type NutrientMap } from '../../db/catalogTypes'
import type { FoodLog, MealKey } from '../../db/types'
import { formatNutrient } from '../../domain/nutrients'
import { useToast } from '../../ui/Toast'
import { Icon } from '../../ui/Icon'
import { TextArea, TextField, numStr } from '../../ui/fields'
import { Sheet } from '../../ui/kit'
import { AmountField, stepFor } from './AmountField'
import { parseAmount } from './amountParse'
import { Chooser } from './Chooser'
import { formatLogAmount } from './food'
import { readFoodText, type TextBasis, type TextUnit } from './foodText'
import { routeGuard } from './paths'
import type { SavedInfo } from './QuantitySheet'
import { previewTextFood, saveTextFood } from './textFoodDraft'
import { useMealSlots } from './useMealSlots'
import { useFoodSheetClose } from './useFoodSheetClose'

const BASIS: Record<TextBasis, string> = {
  '100g': 'Por 100 g', '100ml': 'Por 100 ml', serving: 'Por una porción', package: 'Por envase', consumed: 'Por todo lo que comí',
}
const CORE = ['kcal', 'protein', 'carbs', 'fat'] as const

function draftFrom(text: string, existing?: FoodLog) {
  const parsed = readFoodText(text)
  const unit = existing ? (existing.unit === 'g' || existing.unit === 'ml' ? existing.unit : 'serving') : parsed.unit
  const knownPhysical = existing?.grams != null ? { qty: existing.grams, unit: 'g' as const }
    : existing?.ml != null ? { qty: existing.ml, unit: 'ml' as const } : null
  const portion = parsed.portion ?? (parsed.original.servingSize && parsed.original.servingUnit
    ? { qty: parsed.original.servingSize, unit: parsed.original.servingUnit } : null)
  const pack = parsed.original.packageSize && parsed.original.packageUnit
    ? { qty: parsed.original.packageSize, unit: parsed.original.packageUnit } : null
  const choice = parsed.groups.findIndex((group) => group.basis === '100g' || group.basis === '100ml')
  const selected = Math.max(choice, 0)
  const group = parsed.groups[selected]
  return {
    parsed, selected, basis: group?.basis ?? '',
    name: existing?.name ?? parsed.name,
    amount: numStr(existing?.qty ?? parsed.qty, 6),
    unit: existing ? unit : parsed.qty === null && group?.basis === '100ml' ? 'ml' as const : unit,
    portion: portion ?? (unit === 'serving' && knownPhysical && existing ? { ...knownPhysical, qty: knownPhysical.qty / existing.qty } : null),
    pack,
    values: Object.fromEntries(Object.entries(group?.nutrients ?? existing?.nutrients ?? {}).map(([key, val]) => [key, numStr(val, 6)])) as Partial<Record<NutrientCode, string>>,
  }
}

export function TextFoodSheet({ startingText, date, meal: initialMeal, existing, onClose, onSaved }: {
  startingText: string; date: string; meal: MealKey; existing?: FoodLog; onClose: () => void; onSaved?: (info: SavedInfo, sameRoute: boolean) => void
}) {
  const r = useRepo()
  const slots = useMealSlots()
  const toast = useToast()
  const [text, setText] = useState(startingText)
  const [draft, setDraft] = useState(() => startingText.trim() ? draftFrom(startingText, existing) : null)
  const [meal, setMeal] = useState(existing?.meal ?? initialMeal)
  const [chooseMeal, setChooseMeal] = useState(false)
  const [editNutrition, setEditNutrition] = useState(false)
  const [editMeasures, setEditMeasures] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const { leaving, close } = useFoodSheetClose()
  const nutrientValues: NutrientMap = {}
  let invalidValue = false
  for (const [key, raw] of Object.entries(draft?.values ?? {})) {
    if (!raw.trim()) continue
    const value = parseAmount(raw)
    if (value === null || !Number.isFinite(value) || value < 0) invalidValue = true
    else nutrientValues[key as NutrientCode] = value
  }
  const result = draft && previewTextFood({
    ...draft, qty: parseAmount(draft.amount), package: draft.pack, nutrients: nutrientValues, sourceText: text,
  })
  const preview = result && 'snapshot' in result ? result : null
  const pending = preview?.snapshot.nutrients.kcal === undefined
  const detectedWarnings = draft?.parsed.groups[draft.selected]?.warnings ?? []
  const warnings = [...new Set([...detectedWarnings, ...(preview?.warnings ?? [])])]
  const name = slots.label(meal)
  const needsBasis = Object.keys(nutrientValues).length > 0 && !draft?.basis
  const showNutrients = editNutrition || needsBasis || invalidValue

  function reviewText() {
    setDraft(draftFrom(text, existing))
    setReviewed(false)
    setEditNutrition(false)
    setEditMeasures(false)
    setError('')
  }

  function writeNutrient(code: NutrientCode, value: string) {
    setDraft((d) => d && ({ ...d, values: { ...d.values, [code]: value } }))
    setReviewed(false)
  }

  async function save() {
    if (!preview || busy.current || invalidValue || (warnings.length && !reviewed) || (existing && pending)) return
    busy.current = true
    setSaving(true)
    setError('')
    const sameRoute = routeGuard()
    try {
      const batch = await saveTextFood(r, preview, date, meal, existing)
      close(() => {
        onClose()
        if (batch) onSaved?.({ batch, meal, name: preview.snapshot.name, qty: formatLogAmount(preview.snapshot) }, sameRoute())
        else toast.show({ message: 'Información nutricional completada' })
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el alimento.')
      busy.current = false
      setSaving(false)
    }
  }

  const field = ({ code, es, unit }: typeof NUTRIENTS[number], keyLabel?: string) => (
    <label key={code} className="min-w-0 text-label text-muted">
      {keyLabel ?? es}
      <span className="relative mt-1 block">
        <input className="field num pr-8" inputMode="decimal" value={draft?.values[code] ?? ''}
          onChange={(e) => writeNutrient(code, e.currentTarget.value)} />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-micro">{unit}</span>
      </span>
    </label>
  )

  return (
    <>
      <Sheet open leaving={leaving} onClose={() => { if (!busy.current) close(onClose) }} title={existing ? 'Completar nutrición' : 'Registrar por texto'} footer={draft ? (
        <button className="btn-primary !bg-accent !text-accent-ink w-full" type="button" disabled={!preview || invalidValue || saving || (!!warnings.length && !reviewed) || (!!existing && pending)}
          onClick={() => void save()} data-testid="save-text-food">
          {existing ? 'Guardar nutrición' : pending ? 'Agregar con nutrición pendiente' : `Agregar a ${name.toLowerCase()}`}
        </button>
      ) : (
        <button className="btn-primary !bg-accent !text-accent-ink w-full" type="button" disabled={!text.trim()} onClick={reviewText}>Revisar</button>
      )}>
        <div className="space-y-4 py-1" data-testid="text-food-editor">
          {!draft ? (
            <TextArea label={existing ? 'Escribe o pega los datos nutricionales' : '¿Qué comiste?'} value={text} onChange={setText} rows={5}
              testId="food-text-input" placeholder={existing ? 'Por 100 g tiene 210 kcal, 5 g de proteína…' : 'Comí media arepa casera de 80 g. Por 100 g: 210 kcal y 5 g de proteína.'} />
          ) : (
            <>
              <TextField label="Alimento" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
              <div className="grid grid-cols-2 items-end gap-3">
                <AmountField value={draft.amount} onChange={(amount) => setDraft({ ...draft, amount })} step={stepFor(draft.unit)} fractions autoFocus={false} />
                <label className="text-label text-muted">Unidad
                  <select className="field mt-1" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.currentTarget.value as TextUnit })}>
                    <option value="g">Gramos</option><option value="ml">Mililitros</option><option value="serving">Porciones</option>
                  </select>
                </label>
              </div>
              <button className="flex min-h-11 w-full items-center justify-between rounded-xl bg-accent/10 px-3 text-body text-ink" type="button"
                aria-haspopup="dialog" onClick={() => setChooseMeal(true)}><span className="text-muted">Comida</span><span className="flex items-center gap-2 font-semibold">{name}<Icon name="chevronDown" size={16} /></span></button>
              <div className="space-y-2 rounded-2xl bg-surface2 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">Nutrición</h3>
                  <button type="button" className="min-h-9 px-1 text-label font-medium text-muted underline" onClick={() => setEditNutrition((open) => !open)}>
                    {editNutrition ? 'Ver resumen' : 'Editar valores'}
                  </button>
                </div>
                {draft.parsed.groups.length > 1 ? (
                  <label className="text-label text-muted">Valores detectados
                    <select className="field mt-1" value={draft.selected} onChange={(event) => {
                      const selected = Number(event.currentTarget.value)
                      const group = draft.parsed.groups[selected]!
                      setDraft({ ...draft, selected, basis: group.basis, values: Object.fromEntries(Object.entries(group.nutrients).map(([key, val]) => [key, numStr(val, 6)])) })
                      setReviewed(false)
                    }}>{draft.parsed.groups.map((group, i) => <option value={i} key={i}>{group.basis ? BASIS[group.basis] : 'Base pendiente'}</option>)}</select>
                  </label>
                ) : null}
                {showNutrients ? <label className="block text-label text-muted">¿A qué cantidad corresponden los datos?
                  <select className="field mt-1" value={draft.basis} onChange={(event) => { setDraft({ ...draft, basis: event.currentTarget.value as TextBasis | '' }); setReviewed(false) }}>
                    <option value="">Elegir cuando haya valores</option>
                    {Object.entries(BASIS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
                  </select>
                </label> : draft.basis ? <p className="text-label text-muted">{BASIS[draft.basis]}</p> : null}
                {showNutrients ? <div className="grid grid-cols-2 gap-2">{CORE.map((code) => field(NUTRIENTS.find((n) => n.code === code)!, code === 'kcal' ? 'Energía' : code === 'carbs' ? 'Carbohidratos' : undefined))}</div>
                : <p className="text-body">{CORE.flatMap((code, i) => nutrientValues[code] === undefined ? [] : [
                  `${formatNutrient(code, nutrientValues[code])} ${['', 'proteína', 'carbos', 'grasa'][i]}`.trim(),
                ]).join(' · ') || 'Nutrición pendiente'}</p>}
                {showNutrients ? <details>
                  <summary className="cursor-pointer py-2 text-label font-medium text-muted">Más detalles</summary>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {NUTRIENTS.filter((n) => !(CORE as readonly string[]).includes(n.code)).map((n) => field(n))}
                    {draft.parsed.original.unrecognizedLines.length ? <p className="col-span-2 break-words text-label text-warn">Por revisar: {draft.parsed.original.unrecognizedLines.slice(0, 3).join(' · ')}</p> : null}
                  </div>
                </details> : null}
              </div>
              {draft.unit === 'serving' || draft.basis === 'serving' || draft.basis === 'package' ? (
                editMeasures || (!!result && 'error' in result && /equivalencia|envase/.test(result.error)) ? (
                  <div className="space-y-2">
                    {(draft.unit === 'serving' || draft.basis === 'serving') ? <Equivalent label="Equivalencia de una porción" measure={draft.portion} onChange={(portion) => setDraft({ ...draft, portion })} /> : null}
                    {draft.basis === 'package' ? <Equivalent label="Contenido del envase" measure={draft.pack} onChange={(pack) => setDraft({ ...draft, pack })} /> : null}
                  </div>
                ) : (
                  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-1 text-left text-label text-muted" onClick={() => setEditMeasures(true)}>
                    <span>{draft.portion ? `Una unidad equivale a ${numStr(draft.portion.qty, 2)} ${draft.portion.unit}`
                      : draft.pack ? `Envase de ${numStr(draft.pack.qty, 2)} ${draft.pack.unit}` : 'Añadir equivalencia de porción'}</span><Icon name="edit" size={15} />
                  </button>
                )
              ) : null}
              {preview ? (
                <p className="rounded-xl bg-accent/10 px-3 py-2 text-body font-medium" data-testid="text-food-preview" aria-live="polite">
                  {formatLogAmount(preview.snapshot)} · {pending ? 'Nutrición pendiente' : `${formatNutrient('kcal', preview.snapshot.nutrients.kcal, false)} kcal`}
                </p>
              ) : <p className="text-label text-warn" role="status">{invalidValue ? 'Revisa los valores numéricos.' : result && 'error' in result ? result.error : ''}</p>}
              {existing && pending && preview ? <p className="text-label text-warn">Indica la energía para completar este registro.</p> : null}
              {warnings.length ? (
                <div className="rounded-xl bg-warn/10 px-3 py-2 text-label text-warn">
                  {warnings.some((warning) => /totales o disponibles/.test(warning)) ? <p>Confirma si los carbohidratos son totales.</p> : null}
                  <label className="flex min-h-10 items-center gap-2 font-medium"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.currentTarget.checked)} />Revisé los datos señalados</label>
                  <details><summary className="cursor-pointer pb-1">Qué revisar</summary><p className="py-1">{warnings.join(' ')}</p></details>
                </div>
              ) : null}
              {error ? <p className="text-label text-bad" role="alert">{error}</p> : null}
              <button type="button" className="btn-ghost min-h-11 px-1 text-label text-muted" onClick={() => setDraft(null)}>Volver al texto</button>
            </>
          )}
        </div>
      </Sheet>
      <Chooser open={chooseMeal} onClose={() => setChooseMeal(false)} title="Comida"
        options={slots.choices(existing?.meal, meal).map((slot) => ({ key: slot.key, label: slot.label }))}
        value={meal} onSelect={(key) => setMeal(key as MealKey)} />
    </>
  )
}

type Measure = { qty: number; unit: 'g' | 'ml' }

function Equivalent({ label, measure, onChange }: { label: string; measure: Measure | null; onChange: (m: Measure | null) => void }) {
  const [amount, setAmount] = useState(() => numStr(measure?.qty, 6))
  const [unit, setUnit] = useState(measure?.unit ?? 'g')
  function update(value: string, nextUnit: Measure['unit']) {
    const qty = parseAmount(value)
    onChange(qty !== null && qty > 0 ? { qty, unit: nextUnit } : null)
  }
  return (
    <div className="grid grid-cols-[1fr_5rem] items-end gap-2">
      <label className="text-label text-muted">{label}<input value={amount} inputMode="decimal" className="field mt-1" placeholder="Opcional"
        onChange={(e) => { setAmount(e.currentTarget.value); update(e.currentTarget.value, unit) }} /></label>
      <select className="field" aria-label={`Unidad de ${label.toLowerCase()}`} value={unit}
        onChange={(event) => { const next = event.currentTarget.value as Measure['unit']; setUnit(next); update(amount, next) }}><option>g</option><option>ml</option></select>
    </div>
  )
}
