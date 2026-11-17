/**
 * Self-contained importer for a device-private media pack (mounted by Settings). The person picks ONE .zip
 * (folder pickers do not work in the Android WebView); the app shows what it contains, imports it into the
 * device's Cache Storage and lets them switch between it and the bundled pack. Nothing here touches
 * Dexie, sync or backups. See the project notes.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { importPackZip, inspectPackZip, loadPrivateState, removePrivatePack, setPrivateActive, usePrivatePack, type ImportProgress, type PackInspection } from './privateStore'
import { DEFAULT_ZIP_LIMITS } from './zip'

const mb = (n: number) => `${(n / (1024 * 1024)).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`
const limitsText = `Máximo ${DEFAULT_ZIP_LIMITS.maxEntries} archivos, ${mb(DEFAULT_ZIP_LIMITS.maxFileBytes)} por archivo y ${mb(DEFAULT_ZIP_LIMITS.maxTotalBytes)} en total.`

type Phase = { kind: 'idle' } | { kind: 'inspecting' } | { kind: 'review'; file: File; insp: PackInspection } | { kind: 'importing'; progress: ImportProgress } | { kind: 'error'; message: string }

export function PrivatePackImporter() {
  const priv = usePrivatePack()
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  // Read the cache the first time this section is shown.
  useEffect(() => {
    void loadPrivateState()
  }, [])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setPhase({ kind: 'inspecting' })
    try {
      setPhase({ kind: 'review', file, insp: await inspectPackZip(file) })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'No se pudo leer el archivo.' })
    }
    if (input.current) input.current.value = ''
  }

  const doImport = async (file: File, insp: PackInspection) => {
    setPhase({ kind: 'importing', progress: { done: 0, total: insp.validation.files.length, bytes: 0 } })
    try {
      await importPackZip(file, insp, (progress) => setPhase({ kind: 'importing', progress }))
      setPhase({ kind: 'idle' })
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError'
      setPhase({ kind: 'error', message: quota ? 'No hay espacio suficiente en el dispositivo.' : e instanceof Error ? e.message : 'No se pudo importar el paquete.' })
    }
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const pack = priv.pack
  return (
    <section aria-labelledby={`${inputId}-h`} className="space-y-3" data-testid="private-pack">
      <h3 id={`${inputId}-h`} className="text-body font-semibold">
        Paquete de medios privado
      </h3>
      <p className="text-label text-muted">
        Un paquete .zip con imágenes o animaciones que tú tienes derecho a usar. Se guarda <strong className="font-medium text-ink">solo en este dispositivo</strong>: no se sube a la nube, no se sincroniza y no entra en las copias de seguridad.
        Al desinstalar la app o borrar sus datos se elimina. Mientras esté activo, la app usa solo este paquete (nunca mezcla con el incluido).
      </p>

      {priv.status === 'unavailable' ? <p className="text-label text-warn" role="status">{priv.error}</p> : null}

      {priv.status === 'corrupt' ? (
        <div className="rounded-xl border border-line-strong p-3 text-label" role="alert" data-testid="private-pack-corrupt">
          <p className="font-medium text-ink">El paquete guardado está dañado y se ha desactivado.</p>
          <p className="mt-0.5 text-muted">{priv.error}</p>
        </div>
      ) : null}

      {pack && priv.status === 'ready' ? (
        <div className="space-y-3 rounded-xl border border-line-strong p-3" data-testid="private-pack-installed">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
            <dt className="text-muted">Paquete</dt>
            <dd className="min-w-0 break-words font-medium text-ink">{pack.id}</dd>
            <dt className="text-muted">Estilo</dt>
            <dd className="min-w-0 break-words text-ink">{pack.style}</dd>
            <dt className="text-muted">Atribución</dt>
            <dd className="min-w-0 break-words text-ink">{pack.attribution}</dd>
            <dt className="text-muted">Ejercicios</dt>
            <dd className="text-ink" data-testid="private-pack-count">{Object.keys(pack.records).length}</dd>
            <dt className="text-muted">Tamaño</dt>
            <dd className="text-ink">{mb(priv.bytes)}</dd>
            <dt className="text-muted">En uso</dt>
            <dd className="font-medium text-ink" data-testid="private-pack-state">{priv.active ? 'Paquete privado' : 'Paquete incluido'}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {priv.active ? (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act(() => setPrivateActive(false))} data-testid="private-pack-bundled">
                Volver al paquete incluido
              </button>
            ) : (
              <button type="button" className="btn-accent" disabled={busy} onClick={() => void act(() => setPrivateActive(true))} data-testid="private-pack-use">
                Usar este paquete
              </button>
            )}
            {confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar eliminación">
                <span className="text-label text-muted">¿Eliminar del dispositivo?</span>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => void act(async () => { await removePrivatePack(); setConfirmDelete(false) })} data-testid="private-pack-delete-confirm">
                  Sí, eliminar
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirmDelete(true)} data-testid="private-pack-delete">
                Eliminar paquete del dispositivo
              </button>
            )}
          </div>
        </div>
      ) : null}

      {phase.kind === 'review' ? (
        <div className="space-y-3 rounded-xl border border-line-strong p-3" data-testid="private-pack-review">
          <p className="text-label font-medium text-ink">Esto es lo que se va a importar</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
            <dt className="text-muted">Paquete</dt>
            <dd className="min-w-0 break-words font-medium text-ink">{phase.insp.validation.summary.name}</dd>
            <dt className="text-muted">Estilo</dt>
            <dd className="min-w-0 break-words text-ink">{phase.insp.validation.summary.style}</dd>
            <dt className="text-muted">Atribución</dt>
            <dd className="min-w-0 break-words text-ink">{phase.insp.validation.summary.attribution}</dd>
            <dt className="text-muted">Ejercicios</dt>
            <dd className="text-ink">{phase.insp.validation.summary.exercises}</dd>
            <dt className="text-muted">Tamaño</dt>
            <dd className="text-ink">{mb(phase.insp.bytes)}</dd>
          </dl>
          {phase.insp.ignored > 0 ? <p className="text-label text-muted">{phase.insp.ignored} archivos del ZIP no están en el manifiesto y se ignorarán.</p> : null}
          {pack ? <p className="text-label text-muted">Reemplaza al paquete privado actual.</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-accent" onClick={() => void doImport(phase.file, phase.insp)} data-testid="private-pack-import">
              Importar paquete
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPhase({ kind: 'idle' })}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'importing' ? (
        <div role="status" className="space-y-1.5" data-testid="private-pack-progress">
          <p className="text-label text-ink">
            Importando… {phase.progress.done} de {phase.progress.total} archivos ({mb(phase.progress.bytes)})
          </p>
          <progress className="h-2 w-full" max={Math.max(1, phase.progress.total)} value={phase.progress.done} aria-label="Progreso de la importación" />
        </div>
      ) : null}

      {phase.kind === 'inspecting' ? (
        <p role="status" className="text-label text-muted">
          Revisando el archivo…
        </p>
      ) : null}

      {phase.kind === 'error' ? (
        <p role="alert" className="text-label text-bad" data-testid="private-pack-error">
          {phase.message}
        </p>
      ) : null}

      <div>
        <input ref={input} id={inputId} type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} data-testid="private-pack-file" />
        <label htmlFor={inputId} className="btn-secondary cursor-pointer" data-testid="private-pack-choose">
          {pack ? 'Elegir otro .zip' : 'Elegir un .zip'}
        </label>
        <p className="mt-1.5 text-micro text-muted">{limitsText}</p>
      </div>
    </section>
  )
}
