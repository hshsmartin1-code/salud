import { useMemo, useState } from 'react'
import type { Goal, GoalInputs } from '../../db/types'
import type { NewRow } from '../../db/repo'
import { todayLocal } from '../../domain/dates'
import { ACTIVITY_LEVELS, GOAL_LABELS, computeTargets, type ActivityKey, type GoalType, type Sex } from '../../domain/energy'
import { formatNumber } from '../../domain/units'
import { NumField, SelectField, TextField, numStr, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Segmented } from '../../ui/kit'

export interface GoalSeed {
  sex: Sex
  heightCm: number | null
  ageYears: number | null
  weightKg: number | null
  activity: ActivityKey | null
  previous?: Goal | null
}

type Mode = 'calculated' | 'manual'
const GOALS: GoalType[] = ['lose', 'maintain', 'gain', 'recomp']

/** Calculated (Mifflin-St Jeor) or manual targets; the method is always visible and stored. */
export function GoalEditor({
  seed,
  onSave,
  onCancel,
  saveLabel = 'Guardar objetivo',
}: {
  seed: GoalSeed
  onSave: (g: NewRow<Goal>) => void | Promise<void>
  onCancel?: () => void
  saveLabel?: string
}) {
  const prev = seed.previous
  const [mode, setMode] = useState<Mode>(prev?.method ?? 'calculated')
  const [goal, setGoal] = useState<GoalType | ''>(prev?.goal ?? '')
  const [activity, setActivity] = useState<ActivityKey | ''>(prev?.inputs?.activity ?? seed.activity ?? '')
  const [weight, setWeight] = useState(numStr(seed.weightKg))
  const [height, setHeight] = useState(numStr(seed.heightCm))
  const [age, setAge] = useState(seed.ageYears !== null ? String(seed.ageYears) : '')
  const [deficit, setDeficit] = useState(numStr(prev?.inputs?.deficitKcal ?? 400))
  const [surplus, setSurplus] = useState(numStr(prev?.inputs?.surplusKcal ?? 250))
  const [protein, setProtein] = useState(numStr(prev?.inputs?.proteinGPerKg ?? 1.8))
  const [fatPct, setFatPct] = useState(numStr((prev?.inputs?.fatPct ?? 0.27) * 100))
  const [fiber1000, setFiber1000] = useState(numStr(prev?.inputs?.fiberPer1000 ?? 14))
  const [advanced, setAdvanced] = useState(false)
  // manual values
  const [mKcal, setMKcal] = useState(numStr(prev?.kcal))
  const [mP, setMP] = useState(numStr(prev?.protein))
  const [mC, setMC] = useState(numStr(prev?.carbs))
  const [mF, setMF] = useState(numStr(prev?.fat))
  const [mFiber, setMFiber] = useState(numStr(prev?.fiber))
  const [manualNote, setManualNote] = useState('')
  const [validFrom, setValidFrom] = useState(todayLocal())
  const [targetWeight, setTargetWeight] = useState(numStr(prev?.targetWeightKg))
  const [saving, setSaving] = useState(false)

  const calc = useMemo(() => {
    const w = toNum(weight)
    const h = toNum(height)
    const a = toNum(age)
    if (w === null || h === null || a === null || !activity || !goal) return { missing: true as const }
    try {
      const r = computeTargets({
        weightKg: w,
        heightCm: h,
        ageYears: Math.floor(a),
        sex: seed.sex,
        activity,
        goal,
        deficitKcal: toNum(deficit) ?? 400,
        surplusKcal: toNum(surplus) ?? 250,
        proteinGPerKg: toNum(protein) ?? (goal === 'recomp' ? 2.0 : 1.8),
        fatPct: (toNum(fatPct) ?? 27) / 100,
        fiberPer1000: toNum(fiber1000) ?? 14,
      })
      return { missing: false as const, r }
    } catch (e) {
      return { missing: false as const, error: (e as Error).message }
    }
  }, [weight, height, age, activity, goal, deficit, surplus, protein, fatPct, fiber1000, seed.sex])

  function switchToManualFromCalc() {
    if (!calc.missing && 'r' in calc && calc.r) {
      setMKcal(String(calc.r.kcal))
      setMP(String(calc.r.protein))
      setMC(String(calc.r.carbs))
      setMF(String(calc.r.fat))
      setMFiber(String(calc.r.fiber))
      setManualNote('Ajustado manualmente a partir del cálculo Mifflin-St Jeor.')
    }
    setMode('manual')
  }

  const manualKcal = toNum(mKcal)
  const manualMacroKcal = (toNum(mP) ?? 0) * 4 + (toNum(mC) ?? 0) * 4 + (toNum(mF) ?? 0) * 9
  const canSave =
    !!goal &&
    !!validFrom &&
    (mode === 'calculated'
      ? !calc.missing && 'r' in calc && !!calc.r
      : manualKcal !== null && toNum(mP) !== null && toNum(mC) !== null && toNum(mF) !== null)

  async function save() {
    if (!canSave || !goal) return
    setSaving(true)
    try {
      if (mode === 'calculated' && !calc.missing && 'r' in calc && calc.r) {
        const r = calc.r
        const inputs: GoalInputs = {
          weightKg: r.inputs.weightKg,
          heightCm: r.inputs.heightCm,
          ageYears: r.inputs.ageYears,
          sex: r.inputs.sex,
          activity: r.inputs.activity,
          goal: r.inputs.goal,
          deficitKcal: r.inputs.deficitKcal,
          surplusKcal: r.inputs.surplusKcal,
          proteinGPerKg: r.inputs.proteinGPerKg,
          fatPct: r.inputs.fatPct,
          fiberPer1000: r.inputs.fiberPer1000,
        }
        await onSave({
          validFrom,
          goal,
          method: 'calculated',
          kcal: r.kcal,
          protein: r.protein,
          carbs: r.carbs,
          fat: r.fat,
          fiber: r.fiber,
          inputs,
          methodText: r.method,
          warnings: r.warnings,
          targetWeightKg: toNum(targetWeight),
          origin: 'app',
        })
      } else {
        const lines = [
          'Objetivos ingresados manualmente.',
          manualNote,
          `Energía: ${formatNumber(manualKcal ?? 0, 0)} kcal; proteína ${mP} g; carbohidratos ${mC} g; grasa ${mF} g${mFiber ? `; fibra ${mFiber} g` : ''}.`,
          `Energía de los macronutrientes (4/4/9): ${formatNumber(manualMacroKcal, 0)} kcal.`,
        ].filter(Boolean)
        const warnings: string[] = []
        if (manualKcal && Math.abs(manualMacroKcal - manualKcal) / manualKcal > 0.1)
          warnings.push('Los macronutrientes no suman la energía indicada (diferencia > 10 %).')
        await onSave({
          validFrom,
          goal,
          method: 'manual',
          kcal: manualKcal as number,
          protein: toNum(mP) as number,
          carbs: toNum(mC) as number,
          fat: toNum(mF) as number,
          fiber: toNum(mFiber),
          inputs: null,
          methodText: lines.join('\n'),
          warnings,
          targetWeightKg: toNum(targetWeight),
          origin: 'app',
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="label">Objetivo</span>
        <div className="grid grid-cols-2 gap-2">
          {GOALS.map((g) => (
            <button
              type="button"
              key={g}
              onClick={() => setGoal(g)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                goal === g ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface hover:bg-surface2'
              }`}
            >
              {GOAL_LABELS[g]}
            </button>
          ))}
        </div>
      </div>

      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        ariaLabel="Método"
        options={[
          { value: 'calculated', label: 'Calcular (Mifflin-St Jeor)' },
          { value: 'manual', label: 'Ingresar manualmente' },
        ]}
      />

      {mode === 'calculated' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Peso" unit="kg" value={weight} onChange={setWeight} placeholder="—" />
            <NumField label="Estatura" unit="cm" value={height} onChange={setHeight} placeholder="—" />
            <NumField label="Edad" unit="años" value={age} onChange={setAge} placeholder="—" />
          </div>
          <SelectField<ActivityKey>
            label="Nivel de actividad"
            value={activity}
            onChange={setActivity}
            placeholder="Selecciona…"
            options={ACTIVITY_LEVELS.map((a) => ({ value: a.key, label: `${a.es} (×${formatNumber(a.factor, 3)}) — ${a.description}` }))}
          />
          <button type="button" className="btn-ghost -ml-2 px-2 py-1 text-xs" onClick={() => setAdvanced((v) => !v)}>
            <Icon name={advanced ? 'chevronUp' : 'chevronDown'} size={16} /> Parámetros
          </button>
          {advanced ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <NumField label="Déficit" unit="kcal" value={deficit} onChange={setDeficit} />
              <NumField label="Superávit" unit="kcal" value={surplus} onChange={setSurplus} />
              <NumField label="Proteína" unit="g/kg" value={protein} onChange={setProtein} />
              <NumField label="Grasa" unit="%" value={fatPct} onChange={setFatPct} />
              <NumField label="Fibra" unit="g/1000" value={fiber1000} onChange={setFiber1000} />
            </div>
          ) : null}

          {calc.missing ? (
            <p className="rounded-xl bg-surface2 px-3 py-2 text-sm text-muted">
              Completa objetivo, peso, estatura, edad y actividad para calcular.
            </p>
          ) : 'error' in calc && calc.error ? (
            <p className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{calc.error}</p>
          ) : 'r' in calc && calc.r ? (
            <div className="rounded-2xl border border-line bg-surface2/50 p-3">
              <div className="grid grid-cols-5 gap-2 text-center">
                <TargetCell label="kcal" value={calc.r.kcal} />
                <TargetCell label="Proteína" value={calc.r.protein} unit="g" />
                <TargetCell label="Carbos" value={calc.r.carbs} unit="g" />
                <TargetCell label="Grasa" value={calc.r.fat} unit="g" />
                <TargetCell label="Fibra" value={calc.r.fiber} unit="g" />
              </div>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{calc.r.method}</pre>
              {calc.r.warnings.map((w) => (
                <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-warn">
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
              <button type="button" className="btn-ghost mt-2 px-2 py-1 text-xs" onClick={switchToManualFromCalc}>
                <Icon name="edit" size={14} /> Ajustar valores manualmente
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <NumField label="Energía" unit="kcal" value={mKcal} onChange={setMKcal} />
            <NumField label="Proteína" unit="g" value={mP} onChange={setMP} />
            <NumField label="Carbos" unit="g" value={mC} onChange={setMC} />
            <NumField label="Grasa" unit="g" value={mF} onChange={setMF} />
            <NumField label="Fibra" unit="g" value={mFiber} onChange={setMFiber} hint="Opcional" />
          </div>
          <p className="text-xs text-muted">
            Energía de los macros (4/4/9): <span className="num font-medium text-ink">{formatNumber(manualMacroKcal, 0)} kcal</span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <TextField label="Vigente desde" type="date" value={validFrom} onChange={setValidFrom} />
        <NumField label="Peso meta" unit="kg" value={targetWeight} onChange={setTargetWeight} hint="Opcional" />
      </div>

      <div className="flex gap-2 pt-1">
        {onCancel ? (
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
        <button type="button" className="btn-primary flex-1" disabled={!canSave || saving} onClick={() => void save()}>
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

function TargetCell({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div>
      <div className="readout text-[22px]">{formatNumber(value, 0)}</div>
      <div className="text-[11px] text-muted">
        {label}
        {unit ? ` (${unit})` : ''}
      </div>
    </div>
  )
}
