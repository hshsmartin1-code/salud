import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../db/schema'
import { SYNC_CONFIG } from '../../sync/config'
import type { Account, AccountPreview } from '../../sync/link'
import { Icon } from '../../ui/Icon'

/**
 * First screen of a fresh install: what the app is for and two ways in. "Continuar con Google" only exists
 * when this build has sync configured. Signing in here uses the PENDING session (no profile yet): this
 * component reads what the account holds and hands the result to the onboarding; it creates and links nothing.
 * "Continuar sin cuenta" needs no network at all.
 */
export function Welcome({
  onLocal,
  onSignedIn,
}: {
  onLocal: () => void
  onSignedIn: (account: Account, preview: AccountPreview) => void
}) {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const alive = useRef(true)
  const staleCleanup = useRef<Promise<void> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const emulator = !!SYNC_CONFIG?.emulatorHost
  const [emuEmail, setEmuEmail] = useState('persona.prueba@example.test')

  // A session left behind by a tab that was closed midway is ended before anything else (and loads
  // nothing at all when there is none).
  useEffect(() => {
    alive.current = true
    if (SYNC_CONFIG) staleCleanup.current = import('../../sync/auth').then((a) => a.signOutPending({ onlyIfStale: true }))
    // Keep cleanup errors observable by google(), which must not sign in over a stale session.
    void staleCleanup.current?.catch(() => undefined)
    return () => { alive.current = false }
  }, [])

  async function google() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setErr(null)
    let signedIn = false
    let handedOff = false
    try {
      const auth = await import('../../sync/auth')
      await staleCleanup.current
      if (!alive.current) return
      const local = emuEmail.split('@')[0] || 'prueba'
      const account = await auth.signInPending(emulator ? { emulatorIdentity: { sub: `emu-${local}`, email: emuEmail, name: local } } : {})
      signedIn = true
      if (!alive.current) return
      const [{ remoteFor }, { previewAccount }, { PENDING_SESSION }] = await Promise.all([import('../../sync/service'), import('../../sync/link'), import('../../sync/firebase')])
      const preview = await previewAccount(db, await remoteFor(PENDING_SESSION))
      if (!alive.current) return
      onSignedIn(account, preview)
      handedOff = true
    } catch (e) {
      const known = e instanceof Error && e.name === 'AuthError'
      if (alive.current) setErr(known ? e.message : 'No se pudo leer tu cuenta. Revisa la conexión e inténtalo de nuevo, o continúa sin cuenta.')
    } finally {
      if (signedIn && !handedOff) await (await import('../../sync/auth')).signOutPending().catch(() => undefined)
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-sm flex-col justify-center gap-8" data-testid="welcome">
      <div>
        <img src="./favicon.svg" alt="" className="mb-4 h-12 w-12" />
        <h1 className="text-3xl font-bold tracking-tight">Salud</h1>
        <p className="mt-2 text-base text-muted">Registra tu comida, tu entrenamiento y tu cuerpo en un solo lugar, incluso sin internet.</p>
      </div>

      <div className="space-y-4">
        {SYNC_CONFIG ? (
          <div className="space-y-2">
            {emulator ? (
              <label className="block text-sm">
                <span className="label">Identidad de prueba (solo emulador local)</span>
                <input className="field mt-1 w-full" value={emuEmail} onChange={(e) => setEmuEmail(e.target.value)} data-testid="emu-email" />
              </label>
            ) : null}
            <button type="button" className="btn-primary w-full" onClick={() => void google()} disabled={busy} data-testid="welcome-google">
              <Icon name="user" size={18} /> {busy ? 'Abriendo Google…' : 'Continuar con Google'}
            </button>
            <p className="text-center text-xs text-muted">Sincroniza tus datos entre dispositivos. Los respaldos siguen siendo tuyos.</p>
          </div>
        ) : null}
        {err ? (
          <p role="alert" className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm" data-testid="welcome-error">
            {err}
          </p>
        ) : null}
        <button type="button" className={`${SYNC_CONFIG ? 'btn-secondary' : 'btn-primary'} w-full`} onClick={onLocal} disabled={busy} data-testid="welcome-local">
          Continuar sin cuenta
        </button>
        <p className="text-center">
          <Link to="/respaldo" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted underline underline-offset-2" data-testid="restore-link">
            <Icon name="upload" size={14} /> Restaurar un respaldo
          </Link>
        </p>
      </div>
    </div>
  )
}
