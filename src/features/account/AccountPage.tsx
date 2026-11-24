import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useProfiles } from '../../app/profile'
import { backupFileName, exportBackup } from '../../db/backup'
import { db } from '../../db/schema'
import type { PersonalTable } from '../../db/tables'
import type { Profile, SyncConflict, SyncLink } from '../../db/types'
import { formatNumber } from '../../domain/units'
import { SYNC_CONFIG } from '../../sync/config'
import { CONFLICT_TEXT, SYNC_ERROR_TEXT } from '../../sync/copy'
import { resolveSlots } from '../nutrition/mealSlots'
import { choiceHelp, choiceLabel, conflictFields, conflictTitle, discardSentence, removalSentence, type MealNames } from '../../sync/fieldLabels'
import { canKeepBoth, canMerge, conflictGroups, isSessionDeletedElsewhere, isSessionDeletedHere, resolveConflict, restoreDeletedFromCloud, type ConflictChoice } from '../../sync/engine'
import type { Account, DuplicateSummary, LinkPreview } from '../../sync/link'
import { refreshScheduler, remoteFor, runSync } from '../../sync/service'
import { deriveStatus, STATUS_LABEL, STATUS_TONE, type SyncStatus } from '../../sync/status'
import { NOT_SYNCED, PROFILE_TABLE } from '../../sync/syncTables'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Row } from '../../ui/Row'
import { SectionHeader } from '../../ui/SectionHeader'
import { useConfirm } from '../../ui/Confirm'
import { Badge, Card, PageHeader, Sheet } from '../../ui/kit'
import { TABLE_LABEL } from '../backup/BackupPage'
import { savedMessage, saveJsonFile } from '../backup/saveFile'
import { useAccount, useOnline, useSyncLive } from './useAccount'

const tableLabel = (t: string) => (t === PROFILE_TABLE ? 'Perfil' : (TABLE_LABEL[t as PersonalTable] ?? t))
const TONE_BADGE = { ok: 'good', muted: 'muted', warn: 'warn', bad: 'bad' } as const
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo salió mal. Inténtalo de nuevo.')
const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es }) : 'nunca')

export function AccountPage() {
  const profile = useProfile()
  return (
    <>
      <PageHeader title="Cuenta y sincronización" subtitle={profile.name} back="/ajustes" />
      {SYNC_CONFIG ? <ProfileAccount key={profile.id} profile={profile} /> : <NotConfigured />}
    </>
  )
}

function NotConfigured() {
  return (
    <Card className="space-y-2">
      <h2 className="font-semibold" data-testid="sync-not-configured">Sin cuenta: tus datos están en este dispositivo</h2>
      <p className="text-sm text-muted">Esta versión de la app no incluye sincronización, y todo funciona igual sin conexión. Usa los respaldos para guardar una copia.</p>
      <Link to="/respaldo" className="btn-secondary w-full">
        <Icon name="database" size={18} /> Datos y respaldos
      </Link>
      <Disclosure summary="Detalles técnicos">
        <p className="text-label text-muted">
          Esta compilación no incluye un proyecto de Firebase. Para activar la sincronización hay que crear uno y compilar la app con su configuración (ver
          docs/V22_FIREBASE_SETUP.md).
        </p>
      </Disclosure>
    </Card>
  )
}

function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const cls = { muted: 'border-line', warn: 'border-warn/30 bg-warn/5', bad: 'border-bad/30 bg-bad/5', good: 'border-good/30 bg-good/5' }[tone]
  return <div className={`rounded-xl border p-3 text-sm ${cls}`}>{children}</div>
}

function ProfileAccount({ profile }: { profile: Profile }) {
  const { account, error } = useAccount(profile.id)
  // null = not linked; undefined = still loading (useLiveQuery returns undefined while loading).
  const link = useLiveQuery(async () => (await db.syncLinks.get(profile.id)) ?? null, [profile.id])
  // While a link runs (and until its result is dismissed) the wizard stays on screen even though the
  // link record or the session changes underneath it.
  const [held, setHeld] = useState<Account | null>(null)
  if (error) return <Notice tone="bad">{error}</Notice>
  const wizardAccount = held ?? (link === null && account ? account : null)
  if (wizardAccount) return <LinkWizard profile={profile} account={wizardAccount} onStart={() => setHeld(wizardAccount)} onFinish={() => setHeld(null)} />
  if (account === undefined || link === undefined) return <p className="text-sm text-muted">Cargando…</p>
  if (link) return <LinkedView profile={profile} link={link} account={account} />
  return <SignInCard profile={profile} />
}

function SignInCard({ profile, expectedEmail, onSignedIn }: { profile: Profile; expectedEmail?: string | null; onSignedIn?: (a: Account) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [emuEmail, setEmuEmail] = useState('persona.prueba@example.test')
  const emulator = !!SYNC_CONFIG?.emulatorHost
  async function go() {
    setBusy(true)
    setErr(null)
    try {
      const { signInProfile } = await import('../../sync/auth')
      const local = emuEmail.split('@')[0] || 'prueba'
      const a = await signInProfile(profile.id, emulator ? { emulatorIdentity: { sub: `emu-${local}`, email: emuEmail, name: local } } : {})
      onSignedIn?.(a)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{expectedEmail !== undefined ? 'Vuelve a iniciar sesión' : 'Sin cuenta: este perfil está solo en este dispositivo'}</h2>
      <p className="text-sm text-muted">
        {expectedEmail !== undefined
          ? `Usa la misma cuenta${expectedEmail ? ` (${expectedEmail})` : ''}. Si eliges otra, no se sincroniza nada.`
          : `Con una cuenta de Google puedes sincronizar a ${profile.name} entre dispositivos. Antes de subir nada verás qué hay en cada lado y confirmarás que la cuenta es suya.`}
      </p>
      {emulator ? (
        <label className="block text-sm">
          <span className="label">Identidad de prueba (solo emulador local)</span>
          <input className="field mt-1 w-full" value={emuEmail} onChange={(e) => setEmuEmail(e.target.value)} data-testid="emu-email" />
        </label>
      ) : null}
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <button className="btn-primary w-full" onClick={go} disabled={busy} data-testid="sign-in">
        <Icon name="user" size={18} /> {busy ? 'Abriendo Google…' : 'Iniciar sesión con Google'}
      </button>
    </Card>
  )
}

function Counts({ title, counts, total }: { title: string; counts: Record<string, number>; total: number }) {
  const rows = Object.entries(counts).filter(([t]) => t !== PROFILE_TABLE)
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-sm tabular-nums">{formatNumber(total, 0)} registros</span>
      </div>
      {rows.length ? (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer">Detalle</summary>
          <ul className="mt-1 space-y-0.5">
            {rows.map(([t, n]) => (
              <li key={t} className="flex justify-between gap-2">
                <span>{tableLabel(t)}</span>
                <span className="tabular-nums">{formatNumber(n, 0)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

type Strategy = 'merge' | 'new-profile'

/** Probable duplicates found before "Unir", with the option to leave them out (on by default). */
function LinkDuplicates({ summary, failed, skip, onSkip }: { summary: DuplicateSummary | null; failed: boolean; skip: boolean; onSkip: (v: boolean) => void }) {
  if (failed) return <Notice tone="warn">No se pudo revisar si hay registros repetidos en los dos lados. Si unes, se conservan todos.</Notice>
  if (!summary?.pairs.length) return null
  const parts = Object.entries(summary.byTable).map(([t, n]) => `${formatNumber(n, 0)} en ${tableLabel(t).toLowerCase()}`)
  return (
    <div className="space-y-2" data-testid="link-duplicates">
      <Notice tone="warn">
        Posibles duplicados: {parts.join(', ')}. Son registros iguales guardados por separado aquí y en la cuenta (por ejemplo, la misma comida, el mismo día y la misma cantidad). Si se unen
        los dos, se cuentan dos veces.
      </Notice>
      {summary.skippable > 0 ? (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={skip} onChange={(e) => onSkip(e.target.checked)} data-testid="skip-duplicates" />
          <span>
            <strong>Omitir duplicados probables</strong>
            <span className="block text-xs text-muted">
              No se sube la copia de este dispositivo ni se descarga la de la cuenta: cada lado conserva la suya y no se borra nada. Si después cambias una de las dos, ese cambio se
              sincroniza como cualquier otro.
            </span>
          </span>
        </label>
      ) : null}
      {summary.byTable.trainingSessions ? (
        <p className="text-xs text-muted">Las sesiones de entrenamiento se unen igual, porque cada una lleva sus series. Si sobra una, bórrala después en Entreno.</p>
      ) : null}
    </div>
  )
}

function LinkWizard({ profile, account, onStart, onFinish }: { profile: Profile; account: Account; onStart: () => void; onFinish: () => void }) {
  const { setActive } = useProfiles()
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [strategy, setStrategy] = useState<Strategy>('merge')
  const [owner, setOwner] = useState(false)
  const [sameName, setSameName] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [done, setDone] = useState<{ ok: boolean; newProfileId?: string; detail: string } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { previewLink } = await import('../../sync/link')
        const p = await previewLink(db, profile.id, await remoteFor(profile.id), { duplicates: true })
        if (!alive) return
        setPreview(p)
        if (p.nameMismatch) setStrategy('new-profile')
      } catch (e) {
        if (alive) setLoadErr(errText(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [profile.id])

  async function cancel() {
    const { signOutProfile } = await import('../../sync/auth')
    await signOutProfile(profile.id)
  }

  async function backupFirst() {
    const b = await exportBackup({ profileId: profile.id })
    const out = await saveJsonFile(b, backupFileName(b, profile.name))
    setSavedNote(out.ok && out.method !== 'download' ? savedMessage(out) : null)
    if (!out.ok) setErr(out.message)
  }

  async function run() {
    onStart()
    setBusy(true)
    setErr(null)
    try {
      const link = await import('../../sync/link')
      const remote = await remoteFor(profile.id)
      if (strategy === 'merge') {
        const r = await link.linkProfile(db, profile.id, remote, account, {
          confirmNameMismatch: sameName,
          skipDuplicates: skipDuplicates ? preview?.duplicates?.pairs : undefined,
        })
        const n = r.skippedDuplicates
        const skipped = !n ? '' : n === 1 ? ' Se omitió 1 duplicado probable: cada lado conserva su copia.' : ` Se omitieron ${n} duplicados probables: cada lado conserva su copia.`
        setDone({
          ok: r.verify.ok,
          detail:
            (r.verify.ok
              ? `Vinculado y verificado: ${r.sync.pushed} registros subidos, ${r.sync.applied} recibidos.`
              : r.verify.conflicts
                ? `Vinculado. Hay ${r.verify.conflicts} registros distintos en ambos lados: revísalos abajo; no se sobrescribió nada.`
                : 'Vinculado, pero la verificación aún no cuadra. Se completa sola en la próxima sincronización.') + skipped,
        })
      } else {
        const r = await link.createProfileFromAccount(db, remote, account)
        const { moveSession } = await import('../../sync/auth')
        await moveSession(profile.id, r.profileId)
        setDone({ ok: r.verify.ok, newProfileId: r.profileId, detail: `Se creó un perfil nuevo con los datos de la cuenta. «${profile.name}» quedó igual y sin vincular.` })
      }
      refreshScheduler()
    } catch (e) {
      setErr(errText(e))
      onFinish()
    } finally {
      setBusy(false)
    }
  }

  if (loadErr)
    return (
      <Card className="space-y-3">
        <Notice tone="bad">{loadErr}</Notice>
        <button className="btn-secondary w-full" onClick={cancel}>
          Cerrar sesión
        </button>
      </Card>
    )
  if (!preview) return <p className="text-sm text-muted">Revisando la cuenta…</p>
  if (done)
    return (
      <Card className="space-y-3">
        <Notice tone={done.ok ? 'good' : 'warn'}>{done.detail}</Notice>
        {done.newProfileId ? (
          <button className="btn-primary w-full" onClick={() => setActive(done.newProfileId!)}>
            Abrir el perfil nuevo
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={onFinish}>
            Ver estado de la sincronización
          </button>
        )}
      </Card>
    )

  const remoteHasData = Object.keys(preview.remote).length > 0
  const usedBy = preview.accountUsedBy
  const canRun = owner && !usedBy && (strategy === 'new-profile' || !preview.nameMismatch || sameName)
  return (
    <div className="space-y-4" data-testid="link-wizard">
      <Card className="space-y-3">
        <div>
          <h2 className="font-semibold">Revisa antes de vincular</h2>
          <p className="text-sm text-muted">
            Cuenta: <strong>{account.email ?? account.displayName ?? account.uid}</strong>
          </p>
        </div>
        <Counts title={`En este dispositivo (${profile.name})`} counts={preview.local} total={preview.localTotal} />
        <Counts
          title={remoteHasData ? `En la cuenta${preview.remoteMeta?.profileName ? ` (perfil «${preview.remoteMeta.profileName}»)` : ''}` : 'En la cuenta'}
          counts={preview.remote}
          total={preview.remoteTotal}
        />
        {usedBy ? (
          <Notice tone="bad">Esta cuenta ya está vinculada a otro perfil de este dispositivo. Cada persona necesita su propia cuenta; cierra sesión y usa otra.</Notice>
        ) : null}
        {preview.nameMismatch ? (
          <Notice tone="warn">
            La cuenta ya tiene datos del perfil «{preview.remoteMeta?.profileName}», que no coincide con «{profile.name}». Si es otra persona, no la uses aquí.
          </Notice>
        ) : null}
      </Card>

      {!usedBy ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">¿Qué hacer con los datos?</h2>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="radio" name="strategy" className="mt-1" checked={strategy === 'merge'} onChange={() => setStrategy('merge')} data-testid="strategy-merge" />
            <span>
              <strong>Unir con «{profile.name}»</strong>
              <span className="block text-xs text-muted">
                Se combinan los registros de ambos lados sin borrar nada. Si el mismo registro es distinto en los dos, se guardan ambas versiones para que elijas.
              </span>
            </span>
          </label>
          {remoteHasData ? (
            <label className="flex items-start gap-2.5 text-sm">
              <input type="radio" name="strategy" className="mt-1" checked={strategy === 'new-profile'} onChange={() => setStrategy('new-profile')} data-testid="strategy-new" />
              <span>
                <strong>Descargar en un perfil nuevo</strong>
                <span className="block text-xs text-muted">Crea otro perfil con los datos de la cuenta. «{profile.name}» queda igual y sin vincular.</span>
              </span>
            </label>
          ) : null}
          {strategy === 'merge' ? (
            <LinkDuplicates summary={preview.duplicates} failed={preview.duplicatesFailed} skip={skipDuplicates} onSkip={setSkipDuplicates} />
          ) : null}
          <Notice>
            Recomendado: guarda un respaldo antes.{' '}
            <button className="font-semibold text-accent underline" onClick={backupFirst} data-testid="backup-first">
              Descargar respaldo de {profile.name}
            </button>
          </Notice>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={owner} onChange={(e) => setOwner(e.target.checked)} data-testid="confirm-owner" />
            <span>Confirmo que esta cuenta de Google es de {strategy === 'merge' ? profile.name : 'la persona dueña de esos datos'} y de nadie más.</span>
          </label>
          {strategy === 'merge' && preview.nameMismatch ? (
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={sameName} onChange={(e) => setSameName(e.target.checked)} />
              <span>
                «{preview.remoteMeta?.profileName}» y «{profile.name}» son la misma persona.
              </span>
            </label>
          ) : null}
          {err ? <Notice tone="bad">{err}</Notice> : null}
          {savedNote ? <Notice>{savedNote}</Notice> : null}
          <button className="btn-primary w-full" disabled={!canRun || busy} onClick={run} data-testid="link-run">
            {busy ? 'Vinculando… puedes seguir usando la app' : strategy === 'merge' ? 'Vincular y sincronizar' : 'Descargar en un perfil nuevo'}
          </button>
        </Card>
      ) : null}
      <button className="btn-ghost w-full" onClick={cancel} disabled={busy}>
        Cancelar y cerrar sesión
      </button>
    </div>
  )
}

function LinkedView({ profile, link, account }: { profile: Profile; link: SyncLink; account: Account | null }) {
  const live = useSyncLive(profile.id)
  const online = useOnline()
  const conflicts = useLiveQuery(() => db.syncConflicts.where('profileId').equals(profile.id).toArray(), [profile.id]) ?? []
  const mealNames = useMemo(() => Object.fromEntries(resolveSlots(profile.settings.meals).map((m) => [m.key, m.label])), [profile.settings.meals])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(null)
  const [sheet, setSheet] = useState<null | 'unlink' | 'delete'>(null)
  const status: SyncStatus = deriveStatus(link, { syncing: live.syncing || busy, sessionUid: account ? account.uid : null }, conflicts.length, online)
  const sessionOk = !!account && account.uid === link.uid

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      if (ok) setMsg({ tone: 'good', text: ok })
    } catch (e) {
      const code = (e as { code?: string })?.code
      setMsg({ tone: 'bad', text: (code && SYNC_ERROR_TEXT[code]) || errText(e) })
    } finally {
      setBusy(false)
    }
  }

  async function signInAgain(a: Account) {
    if (a.uid !== link.uid) {
      const { signOutProfile } = await import('../../sync/auth')
      await signOutProfile(profile.id)
      setMsg({ tone: 'bad', text: `Esa no es la cuenta vinculada${link.email ? ` (${link.email})` : ''}. Se cerró la sesión y no se sincronizó nada.` })
      return
    }
    refreshScheduler()
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">Cuenta vinculada</p>
            <p className="truncate font-semibold">{link.email ?? link.displayName ?? 'Cuenta de Google'}</p>
          </div>
          <span data-testid="sync-status">
            <Badge tone={TONE_BADGE[STATUS_TONE[status]]}>{STATUS_LABEL[status]}</Badge>
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Última sincronización</dt>
            <dd>{ago(link.lastSyncAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Cambios pendientes</dt>
            <dd className="tabular-nums">{link.pending}</dd>
          </div>
        </dl>
        {link.lastErrorCode && status !== 'offline' ? <Notice tone="warn">{(link.lastErrorCode === 'partial' && link.lastError) || SYNC_ERROR_TEXT[link.lastErrorCode] || SYNC_ERROR_TEXT.unknown}</Notice> : null}
        {status === 'account-mismatch' ? <Notice tone="bad">La sesión abierta es de {account?.email ?? 'otra cuenta'}. No se sincroniza nada hasta que cierres esa sesión.</Notice> : null}
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        {sessionOk ? (
          <button className="btn-secondary w-full" disabled={busy || live.syncing || !online} onClick={() => act(() => runSync(profile.id), 'Sincronizado.')} data-testid="sync-now">
            <Icon name="refresh" size={18} /> {live.syncing || busy ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        ) : null}
      </Card>

      {!account ? <SignInCard profile={profile} expectedEmail={link.email} onSignedIn={(a) => void signInAgain(a)} /> : null}

      {link.heldDeletes > 0 && sessionOk ? (
        <Card className="space-y-3 border-warn/30">
          <h2 className="font-semibold">{link.heldDeletes} borrados esperan confirmación</h2>
          <p className="text-sm text-muted">
            Se detuvieron porque son muchos de una vez (por ejemplo, tras restaurar un respaldo antiguo o borrar un historial). Nada se borró aún de la nube.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-secondary" disabled={busy} onClick={() => act(async () => restoreDeletedFromCloud(db, profile.id, await remoteFor(profile.id)), 'Registros recuperados desde la nube.')}>
              Recuperarlos desde la nube
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => act(() => runSync(profile.id, { confirmDeletes: true }), 'Borrados aplicados en la nube.')}>
              Borrarlos también en la nube
            </button>
          </div>
        </Card>
      ) : null}

      {conflicts.length ? (
        <section className="space-y-2" data-testid="conflicts">
          <ConflictSummary conflicts={conflicts} />
          {conflictGroups(conflicts).map(({ conflict: c, dependents }) => (
            <ConflictRow key={c.id} c={c} mealNames={mealNames} dependents={dependents.length} disabled={busy} onChoose={(choice) =>
                act(async () => {
                  await resolveConflict(db, profile.id, c.id, choice)
                  if (sessionOk) await runSync(profile.id)
                })
              } />
          ))}
        </section>
      ) : null}

      <Card className="space-y-1">
        <Disclosure summary="Qué se sincroniza" tone="section" testId="sync-what">
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Perfil, objetivos, comida, alimentos y porciones propias, recetas, plantillas, entrenos, mediciones, actividad, sueño, recuperación, hábitos,
              signos vitales e hidratación. Se quedan solo en este dispositivo:
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
              {Object.values(NOT_SYNCED).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Firestore cifra los datos en tránsito y en sus servidores, pero no es cifrado de extremo a extremo: el proveedor del proyecto podría técnicamente leerlos.
            </p>
          </div>
        </Disclosure>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">Sesión y datos</h2>
        <Link to="/respaldo" className="btn-secondary w-full">
          <Icon name="download" size={18} /> Exportar mis datos (respaldo)
        </Link>
        {account ? (
          <button
            className="btn-secondary w-full"
            disabled={busy}
            onClick={() => act(async () => (await import('../../sync/auth')).signOutProfile(profile.id), 'Sesión cerrada. Los datos siguen en este dispositivo.')}
            data-testid="sign-out"
          >
            Cerrar sesión
          </button>
        ) : null}
        <p className="text-xs text-muted">Cerrar sesión no borra nada de este dispositivo ni de la nube.</p>
        <Disclosure summary="Gestionar datos de este perfil" testId="manage-data">
          <div className="space-y-2">
            <p className="text-xs text-muted">
              En un dispositivo compartido, si quieres quitar también los datos de aquí, comprueba que no queden cambios pendientes y elimina el perfil desde
              «Perfil y objetivos»: eso no toca la nube.
            </p>
            <button className="btn-ghost w-full" disabled={busy} onClick={() => setSheet('unlink')} data-testid="unlink">
              Desvincular este perfil
            </button>
            {sessionOk ? (
              <button className="btn-ghost w-full text-bad" disabled={busy} onClick={() => setSheet('delete')} data-testid="delete-cloud">
                Borrar los datos de la nube
              </button>
            ) : null}
          </div>
        </Disclosure>
      </Card>

      <UnlinkSheet open={sheet === 'unlink'} onClose={() => setSheet(null)} profile={profile} />
      <DeleteCloudSheet open={sheet === 'delete'} onClose={() => setSheet(null)} profile={profile} />
    </div>
  )
}

type Choice = ConflictChoice

export function ConflictSummary({ conflicts }: { conflicts: readonly SyncConflict[] }) {
  const counts = new Map<string, number>()
  for (const c of conflicts) counts.set(c.table, (counts.get(c.table) ?? 0) + 1)
  const tables = [...counts].sort(([a], [b]) => tableLabel(a).localeCompare(tableLabel(b), 'es'))
  return (
    <>
      <SectionHeader title={`Registros con dos versiones (${conflictGroups(conflicts).length})`}
        hint="Otro dispositivo cambió estos registros a la vez que este. Elige qué conservar; hasta entonces no se suben ni se sobrescriben." />
      <ul className="divide-rows" aria-label="Conflictos por tipo de registro">
        {tables.map(([table, count]) => (
          <li key={table}><Row dense title={tableLabel(table)} trailing={formatNumber(count, 0)} /></li>
        ))}
      </ul>
      {conflicts.some((c) => c.table === 'exerciseSets') ? (
        <p className="text-label text-muted">Las series vinculadas a una sesión borrada se resuelven junto con ella.</p>
      ) : null}
    </>
  )
}

export function ConflictRow({ c, dependents, onChoose, disabled, mealNames }: { c: SyncConflict; mealNames?: MealNames; dependents: number; onChoose: (choice: ConflictChoice) => void; disabled: boolean }) {
  const confirm = useConfirm()
  const l = c.local as Record<string, unknown> | null
  const r = c.remote as Record<string, unknown> | null
  const isSession = c.table === 'trainingSessions'
  // Sets of this session on this device: deleting the session deletes them all (resolveConflict).
  const localSets = useLiveQuery(
    async () => (isSession ? (await db.exerciseSets.where('sessionId').equals(c.rowId).toArray()).filter((s) => s.profileId === c.profileId).length : 0),
    [isSession, c.rowId, c.profileId],
  )
  const title = conflictTitle(c.table, l ?? r, mealNames)
  const fields = l && r ? conflictFields(c.table, l, r, mealNames) : []
  const choices: Choice[] = [...(canMerge(c) ? (['merge'] as const) : []), 'local', 'remote', ...(canKeepBoth(c) ? (['both'] as const) : [])]

  async function choose(choice: Choice) {
    // A session deleted here has its local sets already gone: the count in the cloud is unknown.
    const setCount = isSession && isSessionDeletedHere(c) ? null : (localSets ?? null)
    const input = { table: c.table, tableLabel: tableLabel(c.table), local: l, remote: r, setCount, mealNames }
    const removal = removalSentence(input, choice)
    const sentence = removal ?? discardSentence(input, choice)
    if (sentence) {
      const ok = await confirm({ title: choiceLabel(choice, l, r), body: sentence + ' No se puede deshacer.', confirmLabel: removal ? 'Eliminar' : 'Conservar versión', tone: 'danger' })
      if (!ok) return
    }
    onChoose(choice)
  }

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-body font-semibold">{tableLabel(c.table)}</p>
        {title ? <p className="text-label text-muted">{title}</p> : null}
      </div>
      {isSessionDeletedHere(c) || isSessionDeletedElsewhere(c) ? (
        <p className="text-label text-muted">
          {isSessionDeletedHere(c) ? CONFLICT_TEXT.sessionDeletedHere : CONFLICT_TEXT.sessionDeletedElsewhere}
          {dependents ? ` ${CONFLICT_TEXT.includesSets(dependents)}` : ''}
        </p>
      ) : !l || !r ? (
        <p className="text-label text-muted">{!r ? 'En otro dispositivo se borró; aquí se modificó.' : 'Aquí se borró; en otro dispositivo se modificó.'}</p>
      ) : fields.length ? (
        <table className="w-full text-label" data-testid="conflict-diff">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Dato</th>
              <th className="text-left font-normal">Este dispositivo</th>
              <th className="text-left font-normal">Nube</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key} className="align-top">
                <td className="pr-2 text-muted" title={f.known ? undefined : f.key}>
                  {f.label}
                  {f.known ? null : <span className="block text-label text-muted">{f.key}</span>}
                </td>
                <td className="pr-2 break-words">{f.local}</td>
                <td className="break-words">{f.remote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-label text-muted">Las dos versiones solo difieren en datos internos.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map((choice) => (
          <div key={choice} className="space-y-1">
            <button
              className={`${choice === 'merge' ? 'btn-primary' : 'btn-secondary'} w-full`}
              disabled={disabled}
              onClick={() => void choose(choice)}
              data-testid={`conflict-${choice}`}
            >
              {choiceLabel(choice, l, r)}
            </button>
            <p className="text-label text-muted">{choiceHelp(choice, l, r)}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function UnlinkSheet({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile }) {
  const [busy, setBusy] = useState(false)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Desvincular perfil"
      footer={
        <button
          className="btn-primary w-full"
          disabled={busy}
          data-testid="unlink-confirm"
          onClick={async () => {
            setBusy(true)
            try {
              const [{ unlinkProfile }, { signOutProfile }] = await Promise.all([import('../../sync/link'), import('../../sync/auth')])
              await unlinkProfile(db, profile.id)
              await signOutProfile(profile.id).catch(() => undefined)
              onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          Desvincular
        </button>
      }
    >
      <p className="text-sm text-muted">
        «{profile.name}» deja de sincronizarse en este dispositivo y se cierra su sesión. Los datos de aquí no se borran y la copia en la nube tampoco.
        Puedes volver a vincularlo después (se repetirá la revisión).
      </p>
    </Sheet>
  )
}

function DeleteCloudSheet({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ok = typed.trim().toLocaleLowerCase('es') === profile.name.trim().toLocaleLowerCase('es')
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Borrar los datos de la nube"
      footer={
        <button
          className="btn-danger w-full"
          disabled={!ok || busy}
          data-testid="delete-cloud-confirm"
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              const { deleteCloudData } = await import('../../sync/link')
              await deleteCloudData(db, profile.id, await remoteFor(profile.id))
              onClose()
            } catch (e) {
              setErr(errText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          Borrar definitivamente de la nube
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Se eliminan todos los registros de esta cuenta en Firestore y el perfil queda desvinculado. Los datos de este dispositivo no se tocan. Otros
          dispositivos vinculados a la cuenta dejarán de sincronizar y te pedirán desvincular. No se puede deshacer.
        </p>
        <label className="block text-sm">
          <span className="label">Escribe «{profile.name}» para confirmar</span>
          <input className="field mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="delete-cloud-name" />
        </label>
        {err ? <Notice tone="bad">{err}</Notice> : null}
      </div>
    </Sheet>
  )
}
