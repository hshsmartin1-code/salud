import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, PROFILE_COLORS, useProfile, useProfiles, useRepo } from '../../app/profile'
import { deleteProfile, updateProfile } from '../../db/profiles'
import { latestWeight, pickGoalForDate } from '../../db/queries'
import type { Goal, ProfileColor } from '../../db/types'
import { ageFromBirthDate, ACTIVITY_LEVELS, GOAL_LABELS, PHYSIOLOGICAL_STATE_LABELS, type ActivityKey, type PhysiologicalState, type Sex } from '../../domain/energy'
import { formatDateEs, todayLocal } from '../../domain/dates'
import { formatNumber, rangeError } from '../../domain/units'
import { validateGoalMl } from '../../domain/hydration'
import { useSafeSave } from '../../app/safeSave'
import { NumField, SelectField, TextField, numStr, toNum } from '../../ui/fields'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Badge, Card, EmptyState, PageHeader, Segmented, Sheet, Toggle } from '../../ui/kit'
import { GoalEditor } from './GoalEditor'
import { AdaptiveEnergyCard } from '../energy/AdaptiveEnergyCard'
import { db } from '../../db/schema'
import { SYNC_CONFIG } from '../../sync/config'

export function ProfilePage() {
  const profile = useProfile()
  const { setActive, profiles } = useProfiles()
  const r = useRepo()
  const nav = useNavigate()
  const today = todayLocal()
  const goals = useLiveQuery(() => r.all('goals'), [r])
  const weight = useLiveQuery(() => latestWeight(r), [r])
  const [editing, setEditing] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const syncLink = useLiveQuery(() => db.syncLinks.get(profile.id), [profile.id])
  const current = goals ? pickGoalForDate(goals, today) : null
  const history = (goals ?? []).slice().sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.createdAt.localeCompare(a.createdAt))
  const age = profile.birthDate ? safeAge(profile.birthDate, today) : null

  return (
    <>
      <PageHeader title="Perfil y objetivos" />
      <Card className="mb-4">
        <div className="flex items-center gap-3">
          <Avatar profile={profile} size={48} />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">{profile.name}</div>
            <div className="text-sm text-muted">
              {profile.sex === 'male' ? 'Hombre' : 'Mujer'}
              {age !== null ? ` · ${age} años` : ''}
              {profile.heightCm ? ` · ${formatNumber(profile.heightCm, 1)} cm` : ''}
              {weight ? ` · ${formatNumber(weight.weightKg, 1)} kg (${formatDateEs(weight.date)})` : ''}
              {profile.physiologicalState && profile.physiologicalState !== 'none' ? ` · ${PHYSIOLOGICAL_STATE_LABELS[profile.physiologicalState]}` : ''}
            </div>
          </div>
          <button type="button" className="btn-secondary px-3" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Editar
          </button>
        </div>
      </Card>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="section-title">Objetivo vigente</h2>
        <button type="button" className="btn-primary px-3 py-2" onClick={() => setGoalOpen(true)}>
          <Icon name="plus" size={16} /> Nuevo objetivo
        </button>
      </div>
      {current ? (
        <GoalCard goal={current} />
      ) : (
        <EmptyState icon="target" title="Sin objetivos definidos" action={<button className="btn-primary" onClick={() => setGoalOpen(true)}>Definir objetivos</button>}>
          No se muestran metas hasta que las calcules o ingreses.
        </EmptyState>
      )}

      {history.length > 1 ? (
        <>
          <h2 className="section-title mb-2 mt-6">Historial de objetivos</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {history.map((g) => (
              <div key={g.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">
                    {GOAL_LABELS[g.goal]} · <span className="num">{formatNumber(g.kcal, 0)} kcal</span>
                  </div>
                  <div className="text-xs text-muted">
                    Desde {formatDateEs(g.validFrom)} · {g.adaptive ? 'Ajuste adaptativo' : g.method === 'calculated' ? 'Calculado' : 'Manual'}
                    {g.origin === 'phase0' ? ' · Importado' : ''}
                  </div>
                </div>
                {g.id === current?.id ? <Badge tone="accent">Vigente</Badge> : null}
                <button
                  type="button"
                  className="btn-ghost p-2"
                  aria-label="Eliminar objetivo"
                  onClick={() => {
                    if (confirm('¿Eliminar este objetivo del historial?')) void r.remove('goals', g.id)
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-6">
        <AdaptiveEnergyCard />
      </div>

      <h2 className="section-title mb-2 mt-6">Preferencias del perfil</h2>
      <Card>
        <Toggle
          checked={profile.settings.addActivityKcal}
          onChange={(v) => void updateProfile(profile.id, { settings: { ...profile.settings, addActivityKcal: v } })}
          label="Sumar las kcal de actividad al presupuesto diario"
          description="Desactivado por defecto: las kcal de actividad registradas son solo informativas, porque el factor de actividad ya está incluido en el objetivo."
        />
        <DailyGoals />
      </Card>

      <div className="mt-8 border-t border-line pt-4">
        <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={16} /> Eliminar perfil
        </button>
      </div>

      <Sheet open={goalOpen} onClose={() => setGoalOpen(false)} title="Nuevo objetivo" wide>
        <GoalEditor
          seed={{
            sex: profile.sex,
            heightCm: profile.heightCm,
            ageYears: age,
            weightKg: weight?.weightKg ?? null,
            activity: profile.activity,
            physiologicalState: profile.physiologicalState ?? null,
            previous: current,
          }}
          onCancel={() => setGoalOpen(false)}
          onSave={async (g) => {
            await r.add('goals', g)
            setGoalOpen(false)
          }}
        />
      </Sheet>

      <EditProfileSheet open={editing} onClose={() => setEditing(false)} />

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Eliminar a ${profile.name}`}>
        <p className="text-sm text-muted">
          Se borrarán permanentemente de este dispositivo todos los registros de este perfil (comidas, entrenamientos, medidas, objetivos…). No se puede deshacer. Te recomendamos exportar un respaldo antes.
        </p>
        {syncLink ? (
          <p className="mt-2 text-sm text-muted" data-testid="delete-linked-note">
            Este perfil está vinculado a {syncLink.email ?? 'una cuenta de Google'}: la copia en la nube no se borra y se cerrará su sesión aquí.
            {syncLink.pending ? ` Atención: hay ${syncLink.pending} cambios sin subir que se perderán.` : ''}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => nav('/respaldo')}>
            Ir a respaldo
          </button>
          <button
            className="btn-danger flex-1"
            onClick={async () => {
              if (SYNC_CONFIG) {
                // End this profile's session on the device; the cloud copy is never touched here.
                const [{ signOutProfile }, { disposeProfileServices }] = await Promise.all([import('../../sync/auth'), import('../../sync/firebase')])
                await signOutProfile(profile.id).catch(() => undefined)
                await disposeProfileServices(profile.id)
              }
              await deleteProfile(profile.id)
              const other = (profiles ?? []).find((p) => p.id !== profile.id)
              if (other) setActive(other.id)
              setConfirmDelete(false)
              nav('/')
            }}
          >
            Eliminar definitivamente
          </button>
        </div>
      </Sheet>
    </>
  )
}

export function GoalCard({ goal }: { goal: Goal }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{GOAL_LABELS[goal.goal]}</span>
        <Badge tone={goal.method === 'calculated' ? 'accent' : 'muted'}>{goal.adaptive ? 'Ajuste adaptativo' : goal.method === 'calculated' ? 'Calculado' : 'Manual'}</Badge>
        <span className="text-xs text-muted">desde {formatDateEs(goal.validFrom)}</span>
      </div>
      <div className="grid grid-cols-5 gap-2 text-center">
        <Cell v={goal.kcal} l="kcal" />
        <Cell v={goal.protein} l="Proteína" u="g" />
        <Cell v={goal.carbs} l="Carbos" u="g" />
        <Cell v={goal.fat} l="Grasa" u="g" />
        <Cell v={goal.fiber} l="Fibra" u="g" />
      </div>
      {goal.targetWeightKg ? <p className="mt-3 text-xs text-muted">Peso meta: {formatNumber(goal.targetWeightKg, 1)} kg</p> : null}
      <Disclosure summary="Cómo calculamos tus objetivos" className="mt-1" testId="goal-method-card">
        <pre className="whitespace-pre-wrap rounded-xl bg-surface2 p-3 font-sans text-xs leading-relaxed text-muted">{goal.methodText}</pre>
      </Disclosure>
      {goal.warnings.map((w) => (
        <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-warn">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" /> {w}
        </p>
      ))}
    </Card>
  )
}

function Cell({ v, l, u }: { v: number | null; l: string; u?: string }) {
  return (
    <div>
      <div className="readout text-[22px]">{v === null ? '—' : formatNumber(v, 0)}</div>
      <div className="text-[11px] text-muted">
        {l}
        {u ? ` (${u})` : ''}
      </div>
    </div>
  )
}

function EditProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = useProfile()
  const [name, setName] = useState(p.name)
  const [sex, setSex] = useState<Sex>(p.sex)
  const [birth, setBirth] = useState(p.birthDate ?? '')
  const [height, setHeight] = useState(numStr(p.heightCm))
  const [activity, setActivity] = useState<ActivityKey | ''>(p.activity ?? '')
  const [color, setColor] = useState<ProfileColor>(p.color)
  const [physio, setPhysio] = useState<PhysiologicalState>(p.physiologicalState ?? 'none')
  const [busy, setBusy] = useState(false)
  const save = useSafeSave()
  const heightErr = height.trim() ? rangeError(toNum(height), 100, 250, 'cm') : null
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Editar perfil"
      footer={
        <button
          className="btn-primary w-full"
          disabled={!name.trim() || !!heightErr || busy}
          onClick={async () => {
            setBusy(true)
            const ok = await save(() =>
              updateProfile(p.id, {
                name: name.trim(),
                sex,
                birthDate: birth || null,
                heightCm: height.trim() ? toNum(height) : null,
                activity: activity || null,
                color,
                // Only stored when it says something (absent = none); pregnancy/lactation only for women.
                ...(sex === 'female' && physio !== 'none' ? { physiologicalState: physio } : p.physiologicalState ? { physiologicalState: 'none' as const } : {}),
              }),
            )
            setBusy(false)
            // A failed write keeps the sheet open with what was typed.
            if (ok) onClose()
          }}
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3">
        <TextField label="Nombre" value={name} onChange={setName} />
        <Segmented<Sex> value={sex} onChange={setSex} options={[{ value: 'male', label: 'Hombre' }, { value: 'female', label: 'Mujer' }]} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Fecha de nacimiento" type="date" value={birth} onChange={setBirth} />
          <NumField label="Estatura" unit="cm" value={height} onChange={setHeight} error={heightErr ?? undefined} />
        </div>
        <SelectField<ActivityKey>
          label="Actividad habitual"
          value={activity}
          onChange={setActivity}
          placeholder="Sin definir"
          options={ACTIVITY_LEVELS.map((a) => ({ value: a.key, label: `${a.es} (×${formatNumber(a.factor, 3)})` }))}
        />
        {sex === 'female' ? (
          <SelectField<PhysiologicalState>
            label="Estado fisiológico"
            value={physio}
            onChange={setPhysio}
            hint="Con embarazo o lactancia no se proponen déficits ni ajustes automáticos de calorías."
            options={(['none', 'pregnant', 'lactating'] as const).map((k) => ({ value: k, label: PHYSIOLOGICAL_STATE_LABELS[k] }))}
          />
        ) : null}
        <div className="flex gap-3">
          {(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={`hit-44 h-8 w-8 rounded-full ring-offset-2 ring-offset-surface ${color === c ? 'ring-2 ring-ink' : ''}`}
              style={{ background: PROFILE_COLORS[c] }}
            />
          ))}
        </div>
      </div>
    </Sheet>
  )
}

function safeAge(birth: string, today: string): number | null {
  try {
    return ageFromBirthDate(birth, today)
  } catch {
    return null
  }
}

/** Optional daily goals shown on the control center (steps, water). Empty = no goal: nothing is assumed. */
function DailyGoals() {
  const profile = useProfile()
  const [steps, setSteps] = useState(numStr(profile.settings.stepGoal ?? null, 0))
  const [water, setWater] = useState(numStr(profile.settings.waterGoalMl ? profile.settings.waterGoalMl / 1000 : null, 2))
  const [msg, setMsg] = useState<string | null>(null)
  const st = toNum(steps)
  const wa = toNum(water)
  const stepsErr = steps.trim() && (st === null || st < 500 || st > 60000) ? 'Entre 500 y 60 000 pasos' : undefined
  // Same goal range as the water screen (validateGoalMl: 500–10 000 ml), shown here in litres.
  const waterErr = water.trim() && (wa === null || validateGoalMl(Math.round(wa * 1000)) !== null) ? 'Entre 0,5 y 10 L' : undefined
  const save = useSafeSave()
  const dirty = (st ?? null) !== (profile.settings.stepGoal ?? null) || (wa !== null ? Math.round(wa * 1000) : null) !== (profile.settings.waterGoalMl ?? null)
  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="daily-goals">
      <div className="text-sm font-medium">Metas diarias opcionales</div>
      <p className="mt-0.5 text-xs text-muted">Se muestran en el Centro de control. Déjalas vacías si no quieres una meta.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumField label="Pasos" value={steps} onChange={setSteps} unit="pasos" error={stepsErr} name="step-goal" />
        <NumField label="Agua" value={water} onChange={setWater} unit="L" error={waterErr} name="water-goal" />
      </div>
      <button
        type="button"
        className="btn-secondary mt-3"
        disabled={!dirty || !!stepsErr || !!waterErr}
        data-testid="save-daily-goals"
        onClick={async () => {
          setMsg(null)
          const ok = await save(() => updateProfile(profile.id, { settings: { ...profile.settings, stepGoal: st !== null ? Math.round(st) : null, waterGoalMl: wa !== null ? Math.round(wa * 1000) : null } }))
          if (ok) setMsg('Metas guardadas.')
        }}
      >
        Guardar metas
      </button>
      {msg ? <span className="ml-3 text-sm text-good">{msg}</span> : null}
    </div>
  )
}
