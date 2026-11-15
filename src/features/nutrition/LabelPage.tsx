import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProfiles, useRepo } from '../../app/profile'
import { NUTRIENTS, type NutrientCode, type NutrientMap } from '../../db/catalogTypes'
import { repo } from '../../db/repo'
import type { CustomFood } from '../../db/types'
import { todayLocal } from '../../domain/dates'
import { checkLabelDraft, convertLabel, type LabelBasis, type LabelDraft } from '../../domain/labelConvert'
import { parseLabelText, type LabelColumnBasis, type ParsedLabel } from '../../domain/labelText'
import { formatNutrient } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'
import { NumField, TextArea, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Card, PageHeader, Segmented, Sheet, Toggle } from '../../ui/kit'
import { fromCustomFood, type Food } from './food'
import { LabelCapture, toStoredPhoto } from './LabelCapture'
import { QuantitySheet } from './QuantitySheet'

const MAIN: NutrientCode[] = ['kcal', 'protein', 'carbs', 'fat', 'satFat', 'transFat', 'fiber', 'sugars', 'addedSugars', 'sodium']
const MORE: NutrientCode[] = ['kj', 'carbsAvail', 'monoFat', 'polyFat', 'cholesterol', 'potassium', 'calcium', 'iron', 'magnesium', 'phosphorus', 'zinc', 'vitA', 'vitC', 'vitD', 'vitE', 'vitB12', 'folate']
const META = Object.fromEntries(NUTRIENTS.map((n) => [n.code, n])) as Record<NutrientCode, (typeof NUTRIENTS)[number]>
const BASIS_ES: Record<LabelColumnBasis, string> = { '100g': 'Por 100 g', '100ml': 'Por 100 ml', serving: 'Por porción', package: 'Por envase' }

type Entry = 'manual' | 'text' | 'photo'
type Vals = Partial<Record<NutrientCode, string>>

/** Preferred column when a label prints several: per 100 is the most precise. */
function defaultColumn(p: ParsedLabel): LabelColumnBasis | null {
  for (const c of ['100g', '100ml', 'serving', 'package'] as const) if (p.columns.includes(c) && p.byBasis[c] && Object.keys(p.byBasis[c]!).length) return c
  return null
}

/**
 * Create or edit a food from a nutrition label: typed by hand, pasted text, or a photo read with
 * local OCR. Parsed values only pre-fill this form — the user reviews and confirms before saving.
 * Blank = not stated (never 0).
 */
export function LabelPage() {
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const r = useRepo()
  const nav = useNavigate()
  const { profiles, active } = useProfiles()
  const existing = useLiveQuery(() => (editId ? r.get('customFoods', editId) : undefined), [r, editId])
  const existingPhoto = useLiveQuery(() => (existing?.labelImageId ? r.get('labelImages', existing.labelImageId) : undefined), [r, existing?.labelImageId])

  const [entry, setEntry] = useState<Entry>('manual')
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [barcode, setBarcode] = useState(params.get('barcode') ?? '')
  const [basis, setBasis] = useState<LabelBasis>('serving')
  const [size, setSize] = useState('')
  const [unit, setUnit] = useState<'g' | 'ml'>('g')
  const [servingLabel, setServingLabel] = useState('')
  const [perPack, setPerPack] = useState('')
  const [perPackApprox, setPerPackApprox] = useState(false)
  const [packSize, setPackSize] = useState('')
  const [packUnit, setPackUnit] = useState<'g' | 'ml'>('g')
  const [vals, setVals] = useState<Vals>({})
  const [more, setMore] = useState(false)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedLabel | null>(null)
  const [column, setColumn] = useState<LabelColumnBasis | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [keepPhoto, setKeepPhoto] = useState(true)
  const photo = useRef<HTMLCanvasElement | null>(null)
  const [hasPhoto, setHasPhoto] = useState(false)
  const [saved, setSaved] = useState<Food | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // Editing: restore the label exactly as printed when we have it; older foods show stored values.
  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setBrand(existing.brand ?? '')
    setBarcode(existing.barcode ?? '')
    setServingLabel(existing.servingLabel && existing.servingLabel !== 'envase completo' ? existing.servingLabel : '')
    setPerPack(numStr(existing.servingsPerPackage ?? null, 2))
    setPackSize(numStr(existing.packageSize ?? null, 2))
    setPackUnit(existing.packageUnit ?? 'g')
    setText(existing.sourceText ?? '')
    const printed = existing.labelBasis && existing.labelNutrients ? existing.labelNutrients : existing.nutrients
    setBasis(existing.labelBasis ?? (existing.basis === 'serving' ? 'serving' : existing.basis))
    setSize(existing.labelBasis ? numStr(existing.servingSize, 2) : '')
    setUnit(existing.servingUnit ?? (existing.basis === '100ml' ? 'ml' : 'g'))
    const v: Vals = {}
    for (const [k, n] of Object.entries(printed)) v[k as NutrientCode] = numStr(n, 3)
    setVals(v)
    if (Object.keys(v).some((k) => MORE.includes(k as NutrientCode))) setMore(true)
  }, [existing])

  const nutrients: NutrientMap = useMemo(() => {
    const out: NutrientMap = {}
    for (const [k, s] of Object.entries(vals)) {
      const n = toNum(s ?? '')
      if (n !== null) out[k as NutrientCode] = n
    }
    return out
  }, [vals])

  const draft: LabelDraft = {
    basis,
    nutrients,
    servingSize: toNum(size),
    servingUnit: toNum(size) ? unit : null,
    servingLabel: servingLabel.trim() || null,
    servingsPerPackage: toNum(perPack),
    servingsPerPackageApprox: perPackApprox,
    packageSize: toNum(packSize),
    packageUnit: toNum(packSize) ? packUnit : null,
  }
  const check = checkLabelDraft(draft)
  const conv = convertLabel(draft)
  const invalidField = Object.values(vals).some((s) => s && s.trim() !== '' && toNum(s) === null)
  const canSave = name.trim().length > 0 && check.errors.length === 0 && !invalidField

  /** Flags for fields the parser was unsure about (only for the column in use). */
  const flags = useMemo(() => {
    const out: Partial<Record<NutrientCode, string>> = {}
    if (!parsed || !column) return out
    for (const n of parsed.nutrients) {
      if (n.basis !== column) continue
      if (n.uncertain) out[n.code] = n.note ?? 'Revisa este valor'
      else if (n.converted && n.note) out[n.code] = n.note
    }
    return out
  }, [parsed, column])

  function fillFromParsed(p: ParsedLabel, col: LabelColumnBasis) {
    const values = p.byBasis[col] ?? {}
    const v: Vals = {}
    for (const [k, n] of Object.entries(values)) if (typeof n === 'number') v[k as NutrientCode] = numStr(n, 3)
    setVals(v)
    setBasis(col)
    if (Object.keys(v).some((k) => MORE.includes(k as NutrientCode))) setMore(true)
    setSize(numStr(p.servingSize, 2))
    if (p.servingUnit) setUnit(p.servingUnit)
    setServingLabel(p.servingLabel ?? '')
    setPerPack(numStr(p.servingsPerPackage, 2))
    setPerPackApprox(p.servingsPerPackageApprox)
    setPackSize(numStr(p.packageSize, 2))
    if (p.packageUnit) setPackUnit(p.packageUnit)
  }

  function interpret() {
    setParseError(null)
    const p = parseLabelText(text)
    const col = defaultColumn(p)
    if (!col) {
      setParsed(null)
      setParseError('No se encontraron valores nutricionales en el texto. Revisa el texto o escribe los valores a mano.')
      return
    }
    setParsed(p)
    setColumn(col)
    fillFromParsed(p, col)
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function save() {
    if (!canSave) return
    const data = {
      source: 'label' as const,
      name: name.trim(),
      brand: brand.trim() || null,
      barcode: barcode.replace(/\D/g, '') || null,
      category: null,
      kind: 'packaged' as const,
      basis: conv.basis,
      nutrients: conv.nutrients,
      portions: conv.portions,
      servingSize: conv.servingSize,
      servingUnit: conv.servingUnit,
      servingLabel: conv.servingLabel,
      labelBasis: basis,
      labelNutrients: nutrients,
      servingsPerPackage: draft.servingsPerPackage,
      packageSize: draft.packageSize,
      packageUnit: draft.packageUnit,
      entryMethod: parsed ? (entry === 'photo' ? ('ocr' as const) : ('text' as const)) : (existing?.entryMethod ?? ('manual' as const)),
      sourceText: parsed || existing?.sourceText ? text || null : null,
      validation: 'confirmed' as const,
      labelImageId: existing?.labelImageId ?? null,
    }
    let row: CustomFood = existing ? await r.put('customFoods', { ...existing, ...data }) : await r.add('customFoods', data)
    if (photo.current && keepPhoto && entry === 'photo') {
      const ph = toStoredPhoto(photo.current)
      if (existing?.labelImageId) await r.remove('labelImages', existing.labelImageId).catch(() => undefined)
      const img = await r.add('labelImages', { foodId: row.id, ...ph })
      await r.update('customFoods', row.id, { labelImageId: img.id })
      row = { ...row, labelImageId: img.id }
    }
    setSaved(fromCustomFood(row))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    setSaved(null)
    setName('')
    setBrand('')
    setBarcode('')
    setVals({})
    setSize('')
    setServingLabel('')
    setPerPack('')
    setPerPackApprox(false)
    setPackSize('')
    setText('')
    setParsed(null)
    setColumn(null)
    setOcrConfidence(null)
    nav('/comida/etiqueta', { replace: true })
  }

  const others = (profiles ?? []).filter((p) => p.id !== active?.id)
  const showServing = basis === 'serving' || basis === '100g' || basis === '100ml' || basis === 'package'
  const kjOnly = nutrients.kcal === undefined && nutrients.kj !== undefined

  return (
    <>
      <PageHeader title={existing ? 'Editar alimento' : 'Crear desde etiqueta'} subtitle="Tabla nutricional del empaque" back="/comida" />
      {saved ? (
        <Card className="mb-4 border-accent/50">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Icon name="check" size={16} />
            </span>
            Guardado: {saved.name}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setLogOpen(true)} data-testid="log-label-food">
              Registrar ahora
            </button>
            <button className="btn-secondary" onClick={reset}>
              Crear otro
            </button>
          </div>
        </Card>
      ) : null}

      <div className="space-y-4">
        {!existing ? (
          <Card className="space-y-3">
            <span className="label mb-0">¿Cómo quieres ingresar la etiqueta?</span>
            <Segmented<Entry>
              value={entry}
              onChange={(e) => {
                setEntry(e)
                setParseError(null)
              }}
              ariaLabel="Forma de ingreso"
              options={[
                { value: 'manual', label: 'Escribir' },
                { value: 'text', label: 'Pegar texto' },
                { value: 'photo', label: 'Foto' },
              ]}
            />
            {entry === 'photo' ? (
              <LabelCapture
                onPhoto={(c) => {
                  photo.current = c
                  setHasPhoto(!!c)
                }}
                onText={(t, conf) => {
                  setText(t)
                  setOcrConfidence(conf)
                  setParsed(null)
                }}
              />
            ) : null}
            {entry === 'text' || (entry === 'photo' && text) ? (
              <div className="space-y-2">
                <TextArea
                  label={entry === 'photo' ? 'Texto reconocido (corrige lo que haga falta)' : 'Texto de la etiqueta'}
                  value={text}
                  onChange={setText}
                  rows={entry === 'photo' ? 9 : 7}
                  resize
                  testId="label-text"
                  placeholder={'Información nutricional\nTamaño de porción: 30 g\nCalorías: 120 kcal\nProteína: 8 g\n…'}
                  hint={entry === 'photo' && ocrConfidence !== null ? `Confianza del reconocimiento: ${formatNumber(ocrConfidence, 0)} %. Revisa sobre todo los números y las unidades.` : undefined}
                />
                <button type="button" className="btn-primary w-full" disabled={!text.trim()} onClick={interpret} data-testid="parse-label">
                  <Icon name="clipboard" size={18} /> Interpretar texto
                </button>
                {parseError ? (
                  <p className="flex gap-1.5 text-sm text-bad">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {parseError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        {parsed ? (
          <div className="rounded-2xl border border-warn/50 bg-warn/5 p-4" data-testid="parse-review">
            <div className="flex items-center gap-2 font-semibold">
              <Icon name="alert" size={18} className="text-warn" /> Revisa los valores antes de guardar
            </div>
            <p className="mt-1 text-sm text-muted">
              Se leyeron {parsed.nutrients.filter((n) => n.basis === column).length} valores de la columna «{column ? BASIS_ES[column] : ''}». Nada se guarda hasta que pulses «Guardar alimento».
            </p>
            {parsed.columns.length > 1 ? (
              <div className="mt-3">
                <span className="label">La etiqueta tiene varias columnas; usar:</span>
                <Segmented<LabelColumnBasis>
                  value={column ?? parsed.columns[0]!}
                  onChange={(c) => {
                    setColumn(c)
                    fillFromParsed(parsed, c)
                  }}
                  size="sm"
                  options={parsed.columns.map((c) => ({ value: c, label: BASIS_ES[c] }))}
                />
              </div>
            ) : null}
            {parsed.warnings.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {parsed.warnings.map((w) => (
                  <li key={w} className="flex gap-1.5">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden /> {w}
                  </li>
                ))}
              </ul>
            ) : null}
            {parsed.unrecognizedLines.length ? (
              <details className="mt-2 text-sm text-muted">
                <summary className="cursor-pointer">Líneas con números no reconocidas ({parsed.unrecognizedLines.length})</summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {parsed.unrecognizedLines.map((l, i) => (
                    <li key={`${i}-${l}`} className="truncate">
                      {l}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <div ref={formRef} className="scroll-mt-20 space-y-4">
          <Card className="space-y-3">
            <TextField label="Nombre del producto" value={name} onChange={setName} autoFocus={entry === 'manual'} placeholder="p. ej. Yogur griego natural" />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Marca" value={brand} onChange={setBrand} />
              <TextField label="Código de barras" value={barcode} onChange={setBarcode} />
            </div>
          </Card>

          <Card className="space-y-3">
            <span className="label mb-0">La etiqueta muestra los valores…</span>
            <Segmented<LabelBasis>
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'serving', label: 'Por porción' },
                { value: '100g', label: 'Por 100 g' },
                { value: '100ml', label: 'Por 100 ml' },
                { value: 'package', label: 'Por envase' },
              ]}
            />
            {showServing ? (
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <NumField
                  label="Tamaño de la porción"
                  value={size}
                  onChange={setSize}
                  hint={basis === 'serving' ? 'Si la etiqueta indica el peso o volumen' : 'Opcional: agrega la porción como medida rápida'}
                />
                <div className="pb-[22px]">
                  <Segmented<'g' | 'ml'> value={unit} onChange={setUnit} size="sm" options={[{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }]} />
                </div>
              </div>
            ) : null}
            <details className="group" open={!!(perPack || packSize || servingLabel || basis === 'package')}>
              <summary className="cursor-pointer list-none text-sm font-medium text-muted hover:text-ink">
                <span className="inline-flex items-center gap-1">
                  <Icon name="chevronDown" size={16} className="transition-transform group-open:rotate-180" /> Porción y envase
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                <TextField label="Descripción de la porción" value={servingLabel} onChange={setServingLabel} placeholder="p. ej. 2 galletas, 1 vaso" />
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Porciones por envase" value={perPack} onChange={setPerPack} />
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <NumField label="Contenido del envase" value={packSize} onChange={setPackSize} />
                    <div className="pb-0.5">
                      <Segmented<'g' | 'ml'> value={packUnit} onChange={setPackUnit} size="sm" options={[{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }]} />
                    </div>
                  </div>
                </div>
                <Toggle checked={perPackApprox} onChange={setPerPackApprox} label="Las porciones por envase son aproximadas" description="La etiqueta dice «aprox.»: no se usan para dividir valores." />
              </div>
            </details>
            {conv.warnings.length ? (
              <ul className="space-y-1 rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">
                {conv.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <span className="section-title">Información nutricional</span>
              <span className="text-xs text-faint">Vacío = no indicado</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
              {(more ? [...MAIN, ...MORE] : MAIN).map((c) => (
                <NumField
                  key={c}
                  label={META[c].es}
                  unit={META[c].unit}
                  value={vals[c] ?? ''}
                  onChange={(v) => setVals((s) => ({ ...s, [c]: v }))}
                  name={`n-${c}`}
                  flag={flags[c]}
                />
              ))}
            </div>
            {kjOnly ? (
              <button
                type="button"
                className="btn-secondary mt-3 w-full text-sm"
                onClick={() => setVals((s) => ({ ...s, kcal: numStr((nutrients.kj as number) / 4.184, 0) }))}
              >
                Calcular kcal desde kJ (÷ 4,184)
              </button>
            ) : null}
            <button type="button" className="btn-ghost -ml-2 mt-2 px-2 py-1 text-xs" onClick={() => setMore((v) => !v)}>
              <Icon name={more ? 'chevronUp' : 'chevronDown'} size={16} /> {more ? 'Menos nutrientes' : 'Más nutrientes (kJ, minerales, vitaminas)'}
            </button>
          </Card>

          {check.errors.length || check.warnings.length ? (
            <div className="space-y-1">
              {check.errors.map((e) => (
                <p key={e} className="flex gap-1.5 text-sm text-bad">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {e}
                </p>
              ))}
              {check.warnings.map((w) => (
                <p key={w} className="flex gap-1.5 text-sm text-warn">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          ) : null}

          {nutrients.kcal !== undefined ? (
            <p className="text-xs text-muted" data-testid="label-preview">
              Se guardará{' '}
              {conv.basis === 'serving'
                ? `por ${conv.servingLabel ?? 'porción'} (solo se registra por porciones)`
                : `por ${conv.basis === '100ml' ? '100 ml' : '100 g'}: ${formatNutrient('kcal', conv.nutrients.kcal)} · P ${formatNutrient('protein', conv.nutrients.protein)} · C ${formatNutrient('carbs', conv.nutrients.carbs)} · G ${formatNutrient('fat', conv.nutrients.fat)}`}
              . Valores impresos conservados ({BASIS_ES[basis].toLowerCase()}).
            </p>
          ) : null}

          {entry === 'photo' && hasPhoto && !existing ? (
            <Toggle checked={keepPhoto} onChange={setKeepPhoto} label="Guardar la foto con el alimento" description="Se guarda reducida, solo en este dispositivo y en tus respaldos." />
          ) : null}
          {existingPhoto ? (
            <details className="card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Foto de la etiqueta</summary>
              <img src={existingPhoto.dataUrl} alt={`Etiqueta de ${existing?.name ?? 'producto'}`} className="mt-2 max-h-80 w-full rounded-lg object-contain" />
            </details>
          ) : null}

          <div className="flex gap-2">
            {existing && others.length ? (
              <button className="btn-secondary" onClick={() => setCopyOpen(true)}>
                <Icon name="copy" size={16} /> Copiar a otro perfil
              </button>
            ) : null}
            <button className="btn-primary flex-1" disabled={!canSave} onClick={() => void save()} data-testid="save-label">
              {existing ? 'Guardar cambios' : 'Guardar alimento'}
            </button>
          </div>
          {existing ? (
            <button
              className="btn-danger w-full"
              onClick={async () => {
                if (!confirm('¿Eliminar este alimento? Los registros ya hechos conservan sus valores.')) return
                if (existing.labelImageId) await r.remove('labelImages', existing.labelImageId).catch(() => undefined)
                await r.remove('customFoods', existing.id)
                nav('/comida')
              }}
            >
              <Icon name="trash" size={16} /> Eliminar alimento
            </button>
          ) : null}
        </div>
      </div>

      <QuantitySheet open={logOpen && !!saved} food={saved} onClose={() => setLogOpen(false)} date={todayLocal()} onSaved={() => nav('/comida')} />
      <CopySheet open={copyOpen} onClose={() => setCopyOpen(false)} food={existing ?? null} targets={others.map((p) => ({ id: p.id, name: p.name }))} />
    </>
  )
}

function CopySheet({ open, onClose, food, targets }: { open: boolean; onClose: () => void; food: CustomFood | null; targets: { id: string; name: string }[] }) {
  const [done, setDone] = useState<string | null>(null)
  return (
    <Sheet open={open} onClose={onClose} title="Copiar a otro perfil">
      <p className="mb-3 text-sm text-muted">Se crea una copia independiente en el otro perfil (sin la foto). No se comparten registros.</p>
      {targets.map((t) => (
        <button
          key={t.id}
          className="btn-secondary mb-2 w-full justify-start"
          onClick={async () => {
            if (!food) return
            const { id: _i, profileId: _p, createdAt: _c, updatedAt: _u, labelImageId: _img, ...rest } = food
            void _i
            void _p
            void _c
            void _u
            void _img
            await repo(t.id).add('customFoods', { ...rest, labelImageId: null })
            setDone(t.name)
          }}
        >
          <Icon name="copy" size={16} /> {t.name}
        </button>
      ))}
      {done ? <p className="text-sm text-good">Copiado a {done}.</p> : null}
    </Sheet>
  )
}
