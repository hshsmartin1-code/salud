import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PROFILE_COLORS, useProfiles } from '../../app/profile'
import { createProfile, deleteProfile } from '../../db/profiles'
import { repo } from '../../db/repo'
import { db } from '../../db/schema'
import type { Profile, ProfileColor } from '../../db/types'
import { ageFromBirthDate, ACTIVITY_LEVELS, type ActivityKey, type Sex } from '../../domain/energy'
import { todayLocal } from '../../domain/dates'
import { formatNumber, rangeError } from '../../domain/units'
import type { Account, AccountPreview } from '../../sync/link'
import { PROFILE_TABLE } from '../../sync/syncTables'
import { NumField, SelectField, TextField, toNum } from '../../ui/fields'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Segmented } from '../../ui/kit'
import { TABLE_LABEL } from '../backup/BackupPage'
import { GoalEditor } from './GoalEditor'
import { Welcome } from './Welcome'

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[]

/**
 * "Agregar perfil" (embedded) creates the profile once at "Continuar" but does NOT make it active until
 * the person presses "Empezar": activating it mid-wizard changes `active.id`, and App.tsx keys the whole
 * route tree by it, which would remount this component and lose the wizard. The created profile is
 * remembered here (module + sessionStorage) so leaving the wizard at the goals step and reopening it
 * resumes that same profile instead of creating a duplicate.
 */
interface Draft {
  id: string
  birth: string
  weight: string
  activity: ActivityKey | ''
}
const DRAFT_KEY = 'salud-new-profile-draft'
let memoryDraft: Draft | null = null
function readDraft(): Draft | null {
  if (memoryDraft) return memoryDraft
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}
function writeDraft(d: Draft | null) {
  memoryDraft = d
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

type Step = 'welcome' | 'existing' | 'basics' | 'link' | 'goal' | 'done'
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo salió mal. Inténtalo de nuevo.')

/**
 * First run: welcome → (Google: restore an existing cloud profile, OR basics → explicit link) → goals → done.
 * "Agregar perfil" (embedded) skips the welcome and never touches accounts: linking an existing local
 * profile is only possible from the account screen, with its guards.
 * Nothing is pre-filled with invented values.
 */
export function Onboarding({ embedded = false, onFinish }: { embedded?: boolean; onFinish?: () => void }) {
  const { profiles, setActive } = useProfiles()
  const nav = useNavigate()
  const used = new Set((profiles ?? []).map((p) => p.color))
  // Resume a profile created by an earlier visit to this wizard that never reached its goals.
  const [resume] = useState(() => {
    if (!embedded) return null
    const d = readDraft()
    const p = d ? (profiles ?? []).find((x) => x.id === d.id) : undefined
    if (d && !p) writeDraft(null)
    return d && p ? { d, p } : null
  })
  const [step, setStep] = useState<Step>(resume ? 'goal' : !embedded && (profiles?.length ?? 0) === 0 ? 'welcome' : 'basics')
  const [name, setName] = useState('')
  const [sex, setSex] = useState<Sex | ''>('')
  const [birth, setBirth] = useState(resume?.d.birth ?? '')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState(resume?.d.weight ?? '')
  const [activity, setActivity] = useState<ActivityKey | ''>(resume?.d.activity ?? '')
  const [color, setColor] = useState<ProfileColor>(COLORS.find((c) => !used.has(c)) ?? 'emerald')
  const [created, setCreated] = useState<Profile | null>(resume?.p ?? null)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)

  // Google first: the session that belongs to no profile yet, and the account's cloud state.
  const [pending, setPending] = useState<{ account: Account; preview: AccountPreview } | null>(null)
  const pendingRef = useRef(false)
  const [linkedTo, setLinkedTo] = useState<string | null>(null)
  // The session adopted by `created` while its link has not been verified yet (rolled back if the person leaves).
  const adoptedRef = useRef<string | null>(null)
  useEffect(
    () => () => {
      // Leaving midway never keeps a session: the pending one is signed out, a half-done link is undone.
      if (pendingRef.current) void import('../../sync/auth').then((a) => a.signOutPending()).catch(() => undefined)
      const adopted = adoptedRef.current
      if (adopted) void rollbackAdopted(adopted)
    },
    [],
  )
  function setPendingSession(p: { account: Account; preview: AccountPreview } | null) {
    pendingRef.current = !!p
    setPending(p)
  }
  async function endPending() {
    pendingRef.current = false
    setPending(null)
    await (await import('../../sync/auth')).signOutPending().catch(() => undefined)
  }

  const today = todayLocal()
  const age = birth ? safeAge(birth, today) : null
  // "1.200" reads as 1200 (thousands): an impossible height or weight is rejected, never stored.
  const heightErr = height.trim() ? rangeError(toNum(height), 100, 250, 'cm') : null
  const weightErr = weight.trim() ? rangeError(toNum(weight), 20, 400, 'kg') : null
  const basicsOk = name.trim().length > 0 && !!sex && !heightErr && !weightErr

  async function saveBasics() {
    if (!basicsOk || !sex || busy.current) return
    busy.current = true
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
      if (embedded) writeDraft({ id: p.id, birth, weight, activity })
      else setActive(p.id)
      setStep(pending ? 'link' : 'goal')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
    }
  }

  return (
    <div className={embedded ? '' : 'min-h-dvh bg-bg px-4 py-8'}>
      <div className="mx-auto max-w-lg">
        {step === 'welcome' ? (
          <Welcome
            onLocal={() => setStep('basics')}
            onSignedIn={(account, preview) => {
              setPendingSession({ account, preview })
              setStep(preview.hasData ? 'existing' : 'basics')
            }}
          />
        ) : null}

        {step === 'existing' && pending ? (
          <ExistingAccount
            pending={pending}
            onRestored={(id) => {
              pendingRef.current = false
              setActive(id)
              onFinish?.()
              nav('/')
            }}
            onFresh={async () => {
              await endPending()
              setStep('basics')
            }}
            onBack={async () => {
              await endPending()
              setStep('welcome')
            }}
          />
        ) : null}

        {step !== 'welcome' && step !== 'existing' ? <Stepper step={step === 'link' ? 'basics' : step} /> : null}

        {step === 'basics' ? (
          <div className="card space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">{embedded || (profiles?.length ?? 0) > 0 ? 'Nuevo perfil' : 'Cuéntanos de ti'}</h2>
              <p className="text-sm text-muted">
                {pending ? `Se vinculará a ${pending.account.email ?? 'tu cuenta'} al terminar, si lo confirmas.` : 'Solo lo necesario para calcular tus objetivos.'}
              </p>
            </div>
            <TextField label="Nombre" value={name} onChange={setName} autoFocus placeholder="Nombre o apodo" />
            <div>
              <span className="label">Sexo</span>
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
              <TextField label="Fecha de nacimiento" type="date" value={birth} onChange={setBirth} hint={age !== null ? `${age} años` : 'Opcional'} />
              <NumField label="Estatura" unit="cm" value={height} onChange={setHeight} hint="Opcional" error={heightErr ?? undefined} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Peso actual" unit="kg" value={weight} onChange={setWeight} hint="Opcional" error={weightErr ?? undefined} />
              <SelectField<ActivityKey>
                label="Actividad habitual"
                value={activity}
                onChange={setActivity}
                placeholder="Selecciona…"
                options={ACTIVITY_LEVELS.map((a) => ({ value: a.key, label: a.es }))}
              />
            </div>
            <Disclosure summary="Color del perfil" testId="profile-color">
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    className={`hit-44 h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition ${color === c ? 'ring-2 ring-ink' : ''}`}
                    style={{ background: PROFILE_COLORS[c] }}
                  />
                ))}
              </div>
            </Disclosure>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={!basicsOk} onClick={() => void saveBasics()}>
              Continuar
            </button>
          </div>
        ) : null}

        {step === 'link' && created && pending ? (
          <LinkStep
            profile={created}
            account={pending.account}
            adoptedRef={adoptedRef}
            onLinked={() => {
              pendingRef.current = false
              adoptedRef.current = null
              setPending(null)
              setLinkedTo(pending.account.email ?? 'tu cuenta')
              setStep('goal')
            }}
            onSkip={async () => {
              await endPending()
              setStep('goal')
            }}
          />
        ) : null}

        {step === 'goal' && created ? (
          <div className="card p-5">
            <h2 className="text-lg font-semibold">Objetivos de {created.name}</h2>
            <p className="mb-4 text-sm text-muted">Elige tu objetivo y te damos tus cifras diarias. Siempre puedes ajustarlas.</p>
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
                if (busy.current) return
                busy.current = true
                try {
                  await repo(created.id).add('goals', g)
                  writeDraft(null)
                  setStep('done')
                } finally {
                  busy.current = false
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost mt-2 w-full"
              onClick={() => {
                writeDraft(null)
                setStep('done')
              }}
            >
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
            <p className="mt-1 text-sm text-muted">
              {linkedTo
                ? `Vinculado a ${linkedTo}: tus datos se sincronizan. Haz respaldos de vez en cuando desde «Datos y respaldos».`
                : 'Tus datos se guardan en este dispositivo. Haz respaldos de vez en cuando desde «Datos y respaldos».'}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => {
                  writeDraft(null)
                  setActive(created.id)
                  onFinish?.()
                  nav('/')
                }}
              >
                Empezar
              </button>
              {(profiles?.length ?? 0) < 2 ? (
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => {
                    setStep('basics')
                    setName('')
                    setSex('')
                    setBirth('')
                    setHeight('')
                    setWeight('')
                    setActivity('')
                    setCreated(null)
                    setLinkedTo(null)
                    setColor(COLORS.find((c) => c !== created.color && !used.has(c)) ?? 'violet')
                  }}
                >
                  <Icon name="users" size={18} /> Agregar segundo perfil
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Undoes a link that was started but not verified: the profile stays, local only, and signed out. */
async function rollbackAdopted(profileId: string) {
  try {
    const [{ unlinkProfile }, { signOutProfile }] = await Promise.all([import('../../sync/link'), import('../../sync/auth')])
    await unlinkProfile(db, profileId)
    await signOutProfile(profileId).catch(() => undefined)
  } catch {
    /* nothing more to undo */
  }
}

/** The account already holds a profile: restore it here, or start fresh WITHOUT using (or touching) it. */
export function ExistingAccount({
  pending,
  onRestored,
  onFresh,
  onBack,
}: {
  pending: { account: Account; preview: AccountPreview }
  onRestored: (profileId: string) => void
  onFresh: () => void | Promise<void>
  onBack: () => void | Promise<void>
}) {
  const { account, preview } = pending
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // A profile downloaded from the account but not yet given the session (retry only repeats that last step).
  const restoredId = useRef<string | null>(null)
  const alive = useRef(true)
  const restoring = useRef(false)
  const handedOff = useRef(false)
  async function discardDownload() {
    const id = restoredId.current
    restoredId.current = null
    if (!id) return
    await rollbackAdopted(id)
    await deleteProfile(id, db)
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (!restoring.current && !handedOff.current) void discardDownload().catch(() => undefined)
    }
  }, [])
  const cloudName = preview.meta?.profileName || account.displayName || 'tu perfil'
  const rows = Object.entries(preview.counts).filter(([t, n]) => t !== PROFILE_TABLE && n > 0)

  async function restore() {
    if (restoring.current) return
    restoring.current = true
    setBusy(true)
    setErr(null)
    try {
      const [link, auth, svc, fb] = await Promise.all([import('../../sync/link'), import('../../sync/auth'), import('../../sync/service'), import('../../sync/firebase')])
      if (!alive.current) return
      if (!restoredId.current) {
        const r = await link.createProfileFromAccount(db, await svc.remoteFor(fb.PENDING_SESSION), account)
        restoredId.current = r.profileId
      }
      if (!alive.current) return
      await auth.adoptPendingSession(restoredId.current)
      if (!alive.current) return
      svc.refreshScheduler()
      handedOff.current = true
      onRestored(restoredId.current)
    } catch (e) {
      if (alive.current) setErr(errText(e))
    } finally {
      if (!alive.current && !handedOff.current) await discardDownload()
      restoring.current = false
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="card space-y-4 p-5" data-testid="existing-account">
      <div>
        <p className="text-sm text-muted">Cuenta {account.email ?? account.displayName ?? ''}</p>
        <h2 className="text-lg font-semibold">Encontramos tu perfil «{cloudName}»</h2>
        <p className="text-sm text-muted" data-testid="existing-count">
          {formatNumber(preview.total, 0)} registros guardados en tu cuenta.
        </p>
      </div>
      {rows.length ? (
        <Disclosure summary="Ver detalle" testId="existing-detail">
          <ul className="space-y-0.5 text-xs text-muted">
            {rows.map(([t, n]) => (
              <li key={t} className="flex justify-between gap-2">
                <span>{TABLE_LABEL[t as keyof typeof TABLE_LABEL] ?? t}</span>
                <span className="tabular-nums">{formatNumber(n, 0)}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      {preview.usedBy ? (
        <p className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm">Esta cuenta ya está vinculada a otro perfil de este dispositivo. Cada persona necesita su propia cuenta.</p>
      ) : null}
      {err ? (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm" data-testid="existing-error">
          {err}
        </p>
      ) : null}
      <div className="space-y-2">
        {!preview.usedBy ? (
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void restore()} data-testid="restore-account">
            {busy ? 'Restaurando…' : `Restaurar «${cloudName}» en este dispositivo`}
          </button>
        ) : null}
        <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void onFresh()} data-testid="fresh-profile">
          Empezar un perfil nuevo sin usar esos datos
        </button>
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void onBack()}>
          Volver
        </button>
      </div>
      <p className="text-xs text-muted">Tus datos de la cuenta no se modifican ni se borran con ninguna de estas opciones.</p>
    </div>
  )
}

/** Cloud is empty: the new profile is linked only after one explicit confirmation. */
export function LinkStep({
  profile,
  account,
  adoptedRef,
  onLinked,
  onSkip,
}: {
  profile: Profile
  account: Account
  adoptedRef: { current: string | null }
  onLinked: () => void
  onSkip: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const alive = useRef(true)
  const linking = useRef(false)
  const completed = useRef(false)
  async function discardLink() {
    if (adoptedRef.current !== profile.id) return
    adoptedRef.current = null
    await rollbackAdopted(profile.id)
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (!linking.current && !completed.current) void discardLink()
    }
  }, [])
  const label = account.email ?? account.displayName ?? 'tu cuenta'

  async function link() {
    if (linking.current) return
    linking.current = true
    setBusy(true)
    setErr(null)
    try {
      const [auth, linkMod, svc] = await Promise.all([import('../../sync/auth'), import('../../sync/link'), import('../../sync/service')])
      if (!alive.current) return
      if (adoptedRef.current !== profile.id) {
        await auth.adoptPendingSession(profile.id)
        adoptedRef.current = profile.id
      }
      if (!alive.current) return
      const r = await linkMod.linkProfile(db, profile.id, await svc.remoteFor(profile.id), account, { expectEmptyAccount: true })
      if (!alive.current) return
      if (!r.verify.ok) throw new Error('La vinculación no se pudo verificar todavía. Inténtalo de nuevo.')
      svc.refreshScheduler()
      completed.current = true
      onLinked()
    } catch (e) {
      if (alive.current) setErr(errText(e))
    } finally {
      if (!alive.current && !completed.current) await discardLink()
      linking.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function skip() {
    if (linking.current) return
    linking.current = true
    setBusy(true)
    if (adoptedRef.current) {
      const id = adoptedRef.current
      adoptedRef.current = null
      await rollbackAdopted(id)
    }
    await onSkip()
    linking.current = false
    if (alive.current) setBusy(false)
  }

  return (
    <div className="card space-y-4 p-5" data-testid="link-step">
      <div>
        <h2 className="text-lg font-semibold">Vincular a tu cuenta</h2>
        <p className="text-sm text-muted">
          Tu cuenta {label} todavía no tiene datos. Si lo confirmas, «{profile.name}» se guardará también en ella y se sincronizará entre tus dispositivos.
        </p>
      </div>
      {err ? (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm" data-testid="link-error">
          {err}
        </p>
      ) : null}
      <div className="space-y-2">
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void link()} data-testid="pending-link">
          {busy ? 'Vinculando…' : `Vincular este perfil a ${label}`}
        </button>
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void skip()} data-testid="pending-skip">
          Ahora no, seguir sin cuenta
        </button>
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

function Stepper({ step }: { step: 'basics' | 'goal' | 'done' | 'link' }) {
  const steps = ['basics', 'goal', 'done'] as const
  const labels = { basics: 'Datos', goal: 'Objetivos', done: 'Listo' }
  const idx = steps.indexOf(step === 'link' ? 'basics' : step)
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
