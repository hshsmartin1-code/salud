import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProfiles, useRepo } from '../../app/profile'
import { NUTRIENTS, type NutrientCode, type NutrientMap } from '../../db/catalogTypes'
import { repo } from '../../db/repo'
import type { CustomFood } from '../../db/types'
import { formatNutrient } from '../../domain/nutrients'
import { todayLocal } from '../../domain/dates'
import { labelToPer100, validateLabel, type LabelInput } from '../../domain/units'
import { NumField, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Card, PageHeader, Segmented, Sheet } from '../../ui/kit'
import { fromCustomFood, type Food } from './food'
import { QuantitySheet } from './QuantitySheet'

const MAIN: NutrientCode[] = ['kcal', 'protein', 'carbs', 'fat', 'satFat', 'transFat', 'fiber', 'sugars', 'addedSugars', 'sodium']
const MORE: NutrientCode[] = ['monoFat', 'polyFat', 'cholesterol', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitA', 'vitC', 'vitD', 'vitE', 'vitB12', 'folate']
const META = Object.fromEntries(NUTRIENTS.map((n) => [n.code, n])) as Record<NutrientCode, (typeof NUTRIENTS)[number]>

type Basis = 'serving' | '100g' | '100ml'

/** Create or edit a food from a nutrition label. Blank = unknown (never 0). */
export function LabelPage() {
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const r = useRepo()
  const nav = useNavigate()
  const { profiles, active } = useProfiles()
  const existing = useLiveQuery(() => (editId ? r.get('customFoods', editId) : undefined), [r, editId])
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [barcode, setBarcode] = useState(params.get('barcode') ?? '')
  const [basis, setBasis] = useState<Basis>('serving')
  const [size, setSize] = useState('')
  const [unit, setUnit] = useState<'g' | 'ml'>('g')
  const [vals, setVals] = useState<Partial<Record<NutrientCode, string>>>({})
  const [more, setMore] = useState(false)
  const [saved, setSaved] = useState<Food | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)

  // Editing: show the stored values (stored per basis; serving size kept).
  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setBrand(existing.brand ?? '')
    setBarcode(existing.barcode ?? '')
    if (existing.basis === 'serving') {
      setBasis('serving')
      setSize('')
    } else {
      setBasis(existing.basis)
      setSize('')
    }
    setUnit(existing.basis === '100ml' ? 'ml' : 'g')
    const v: Partial<Record<NutrientCode, string>> = {}
    for (const [k, n] of Object.entries(existing.nutrients)) v[k as NutrientCode] = numStr(n, 2)
    setVals(v)
  }, [existing])

  const nutrients: NutrientMap = useMemo(() => {
    const out: NutrientMap = {}
    for (const [k, s] of Object.entries(vals)) {
      const n = toNum(s ?? '')
      if (n !== null) out[k as NutrientCode] = n
    }
    return out
  }, [vals])

  const label: LabelInput = { basis, servingSize: basis === 'serving' ? toNum(size) : null, servingUnit: basis === 'serving' ? unit : null, nutrients }
  const check = validateLabel(label)
  const conv = labelToPer100(label)
  const invalidField = Object.values(vals).some((s) => s && s.trim() !== '' && toNum(s) === null)
  const canSave = name.trim().length > 0 && check.errors.length === 0 && !invalidField

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
      servingSize: basis === 'serving' ? toNum(size) : null,
      servingUnit: basis === 'serving' && toNum(size) ? unit : null,
    }
    const row = existing ? await r.put('customFoods', { ...existing, ...data }) : await r.add('customFoods', data)
    setSaved(fromCustomFood(row))
  }

  const others = (profiles ?? []).filter((p) => p.id !== active?.id)

  return (
    <>
      <PageHeader title={existing ? 'Editar alimento' : 'Desde la etiqueta'} subtitle="Copia la tabla nutricional del empaque" back="/comida" />
      {saved ? (
        <Card className="mb-4 border-accent/40">
          <div className="flex items-center gap-2 font-semibold text-accent">
            <Icon name="check" /> Guardado: {saved.name}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setLogOpen(true)} data-testid="log-label-food">
              Registrar ahora
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setSaved(null)
                setName('')
                setBrand('')
                setBarcode('')
                setVals({})
                setSize('')
                nav('/comida/etiqueta', { replace: true })
              }}
            >
              Crear otro
            </button>
          </div>
        </Card>
      ) : null}

      <div className="space-y-4">
        <Card className="space-y-3">
          <TextField label="Nombre del producto" value={name} onChange={setName} autoFocus placeholder="p. ej. Yogur griego natural" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Marca" value={brand} onChange={setBrand} />
            <TextField label="Código de barras" value={barcode} onChange={setBarcode} />
          </div>
        </Card>

        <Card className="space-y-3">
          <span className="label">La etiqueta muestra los valores…</span>
          <Segmented<Basis>
            value={basis}
            onChange={setBasis}
            options={[
              { value: 'serving', label: 'Por porción' },
              { value: '100g', label: 'Por 100 g' },
              { value: '100ml', label: 'Por 100 ml' },
            ]}
          />
          {basis === 'serving' ? (
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <NumField label="Tamaño de la porción" value={size} onChange={setSize} hint="Si la etiqueta indica el peso o volumen" />
              <div className="pb-[22px]">
                <Segmented<'g' | 'ml'> value={unit} onChange={setUnit} size="sm" options={[{ value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }]} />
              </div>
            </div>
          ) : null}
          {basis === 'serving' && !toNum(size) ? (
            <p className="rounded-xl bg-surface2 px-3 py-2 text-xs text-muted">
              Sin tamaño de porción solo podrás registrar este alimento por porciones (no por gramos). No se inventa la densidad ni el peso.
            </p>
          ) : null}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Información nutricional</span>
            <span className="text-[11px] text-faint">Vacío = no indicado</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {(more ? [...MAIN, ...MORE] : MAIN).map((c) => (
              <NumField
                key={c}
                label={META[c].es}
                unit={META[c].unit}
                value={vals[c] ?? ''}
                onChange={(v) => setVals((s) => ({ ...s, [c]: v }))}
                name={`n-${c}`}
              />
            ))}
          </div>
          <button type="button" className="btn-ghost -ml-2 mt-2 px-2 py-1 text-xs" onClick={() => setMore((v) => !v)}>
            <Icon name={more ? 'chevronUp' : 'chevronDown'} size={16} /> {more ? 'Menos nutrientes' : 'Más nutrientes (minerales, vitaminas)'}
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
          <p className="text-xs text-muted">
            Se guardará{' '}
            {conv.basis === 'serving'
              ? 'por porción'
              : `por ${conv.basis === '100ml' ? '100 ml' : '100 g'}: ${formatNutrient('kcal', conv.nutrients.kcal)} · P ${formatNutrient('protein', conv.nutrients.protein)} · C ${formatNutrient('carbs', conv.nutrients.carbs)} · G ${formatNutrient('fat', conv.nutrients.fat)}`}
            .
          </p>
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
              await r.remove('customFoods', existing.id)
              nav('/comida')
            }}
          >
            <Icon name="trash" size={16} /> Eliminar alimento
          </button>
        ) : null}
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
      <p className="mb-3 text-sm text-muted">Se crea una copia independiente en el otro perfil. No se comparten registros.</p>
      {targets.map((t) => (
        <button
          key={t.id}
          className="btn-secondary mb-2 w-full justify-start"
          onClick={async () => {
            if (!food) return
            const { id: _i, profileId: _p, createdAt: _c, updatedAt: _u, ...rest } = food
            void _i
            void _p
            void _c
            void _u
            await repo(t.id).add('customFoods', rest)
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
