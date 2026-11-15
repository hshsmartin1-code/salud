import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PROFILE_COLORS, useProfiles } from '../../app/profile'
import { createProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import type { Profile, ProfileColor } from '../../db/types'
import { ageFromBirthDate, ACTIVITY_LEVELS, type ActivityKey, type Sex } from '../../domain/energy'
import { todayLocal } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { NumField, SelectField, TextField, toNum } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Segmented } from '../../ui/kit'
import { GoalEditor } from './GoalEditor'

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[]

/** Create a profile: basics → targets (optional) → done. Nothing is pre-filled with invented values. */
export function Onboarding({ embedded = false, onFinish }: { embedded?: boolean; onFinish?: () => void }) {
  const { profiles, setActive } = useProfiles()
  const nav = useNavigate()
  const used = new Set((profiles ?? []).map((p) => p.color))
  const [step, setStep] = useState<'basics' | 'goal' | 'done'>('basics')
  const [name, setName] = useState('')
  const [sex, setSex] = useState<Sex | ''>('')
  const [birth, setBirth] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [activity, setActivity] = useState<ActivityKey | ''>('')
  const [color, setColor] = useState<ProfileColor>(COLORS.find((c) => !used.has(c)) ?? 'emerald')
  const [created, setCreated] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const today = todayLocal()
  const age = birth ? safeAge(birth, today) : null
  const basicsOk = name.trim().length > 0 && !!sex && (height === '' || toNum(height) !== null) && (weight === '' || toNum(weight) !== null)

  async function saveBasics() {
    if (!basicsOk || !sex) return
    setError(null)
    try {
      const h = toNum(height)
      const p = await createProfile({
        name: name.trim(),
        sex,
        birthDate: birth || null,
        heightCm: h,
        activity: activity || null,
        color,
        settings: { addActivityKcal: false },
      })
      const w = toNum(weight)
      if (w !== null) {
        await repo(p.id).add('bodyMeasurements', {
          date: today,
          weightKg: w,
          circumferences: {},
          skinfolds: {},
          protocol: null,
          derived: null,
          origin: 'app',
        })
      }
      setCreated(p)
      setActive(p.id)
      setStep('goal')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className={embedded ? '' : 'min-h-dvh bg-bg px-4 py-8'}>
      <div className="mx-auto max-w-lg">
        {!embedded ? (
          <div className="mb-6 flex items-center gap-3">
            <img src="./favicon.svg" alt="" className="h-10 w-10" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Salud</h1>
              <p className="text-sm text-muted">Nutrición, entrenamiento y cuerpo — para dos perfiles independientes.</p>
            </div>
          </div>
        ) : null}

        <Stepper step={step} />

        {step === 'basics' ? (
          <div className="card space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">{(profiles?.length ?? 0) === 0 ? 'Primer perfil' : 'Nuevo perfil'}</h2>
              <p className="text-sm text-muted">Cada perfil tiene sus propios registros, objetivos e historial.</p>
            </div>
            <TextField label="Nombre" value={name} onChange={setName} autoFocus placeholder="Nombre o apodo" />
            <div>
              <span className="label">Sexo (para las fórmulas)</span>
              <Segmented<Sex | ''>
                value={sex}
                onChange={setSex}
                ariaLabel="Sexo"
                options={[
                  { value: 'male', label: 'Hombre' },
                  { value: 'female', label: 'Mujer' },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Fecha de nacimiento"
                type="date"
                value={birth}
                onChange={setBirth}
                hint={age !== null ? `${age} años` : 'Opcional'}
              />
              <NumField label="Estatura" unit="cm" value={height} onChange={setHeight} hint="Opcional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Peso actual" unit="kg" value={weight} onChange={setWeight} hint="Opcional · se guarda como medición de hoy" />
              <SelectField<ActivityKey>
                label="Actividad habitual"
                value={activity}
                onChange={setActivity}
                placeholder="Selecciona…"
                options={ACTIVITY_LEVELS.map((a) => ({ value: a.key, label: `${a.es} (×${formatNumber(a.factor, 3)})` }))}
              />
            </div>
            <div>
              <span className="label">Color</span>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition ${color === c ? 'ring-2 ring-ink' : ''}`}
                    style={{ background: PROFILE_COLORS[c] }}
                  />
                ))}
              </div>
            </div>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={!basicsOk} onClick={() => void saveBasics()}>
              Continuar
            </button>
            {(profiles?.length ?? 0) === 0 ? (
              <p className="text-center text-xs text-muted">
                ¿Tienes un respaldo?{' '}
                <Link to="/respaldo" className="font-medium text-accent">
                  Restaurar desde archivo
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 'goal' && created ? (
          <div className="card p-5">
            <h2 className="text-lg font-semibold">Objetivos de {created.name}</h2>
            <p className="mb-4 text-sm text-muted">Calculados con la ecuación de Mifflin-St Jeor o ingresados a mano. Siempre editables.</p>
            <GoalEditor
              seed={{
                sex: created.sex,
                heightCm: created.heightCm,
                ageYears: age,
                weightKg: toNum(weight),
                activity: activity || null,
              }}
              saveLabel="Guardar y continuar"
              onSave={async (g) => {
                await repo(created.id).add('goals', g)
                setStep('done')
              }}
            />
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => setStep('done')}>
              Configurar después
            </button>
          </div>
        ) : null}

        {step === 'done' && created ? (
          <div className="card p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Icon name="check" size={26} />
            </div>
            <h2 className="text-lg font-semibold">Perfil de {created.name} listo</h2>
            <p className="mt-1 text-sm text-muted">Los datos se guardan solo en este dispositivo. Haz respaldos periódicos desde «Respaldo».</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {(profiles?.length ?? 0) < 2 ? (
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => {
                    setStep('basics')
                    setName('')
                    setSex('')
                    setBirth('')
                    setHeight('')
                    setWeight('')
                    setActivity('')
                    setCreated(null)
                    setColor(COLORS.find((c) => c !== created.color && !used.has(c)) ?? 'violet')
                  }}
                >
                  <Icon name="users" size={18} /> Agregar segundo perfil
                </button>
              ) : null}
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={() => {
                  onFinish?.()
                  nav('/')
                }}
              >
                Empezar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function safeAge(birth: string, today: string): number | null {
  try {
    const a = ageFromBirthDate(birth, today)
    return a >= 0 && a < 120 ? a : null
  } catch {
    return null
  }
}

function Stepper({ step }: { step: 'basics' | 'goal' | 'done' }) {
  const steps = ['basics', 'goal', 'done'] as const
  const labels = { basics: 'Datos', goal: 'Objetivos', done: 'Listo' }
  const idx = steps.indexOf(step)
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs font-medium">
      {steps.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 ${i <= idx ? 'text-accent' : 'text-faint'}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${i <= idx ? 'bg-accent text-accent-ink' : 'bg-surface2'}`}>
            {i + 1}
          </span>
          {labels[s]}
          {i < steps.length - 1 ? <span className="h-px w-6 bg-line" /> : null}
        </li>
      ))}
    </ol>
  )
}
