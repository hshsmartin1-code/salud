import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useProfiles } from '../../app/profile'
import { backupFileName, backupSize, backupStats, exportBackup, importBackup, parseBackup, previewImport, type Backup, type ImportResult } from '../../db/backup'
import { checkIntegrity, repairIntegrity, type IntegrityReport } from '../../db/integrity'
import { createProfile, getMeta, listProfiles, setMeta } from '../../db/profiles'
import { repo } from '../../db/repo'
import { requestPersistentStorage } from '../../db/schema'
import { refFoods } from '../../db/shared'
import type { PersonalTable } from '../../db/tables'
import type { Profile, ProfileColor } from '../../db/types'
import { todayLocal } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { useConfirm } from '../../ui/Confirm'
import { Badge, Card, PageHeader, Segmented } from '../../ui/kit'
import { ExportCsvCard, ImportTrainingCard } from './CsvCards'
import { IMPORT_MERGE_HELP, IMPORT_MERGE_LABEL, replaceConfirmText, replaceWithSafetyCopy } from './replaceFlow'
import { savedMessage, saveJsonFile, shareSavedFile } from './saveFile'
import { mapPhase0, parsePhase0, type P0File } from './phase0'
import { importTcac, parseTcac } from './tcac'
import { SYNC_CONFIG } from '../../sync/config'
import { BACKUP_NOTE } from '../../sync/copy'

export const TABLE_LABEL: Record<PersonalTable, string> = {
  foodPortions: 'Porciones personalizadas',
  goals: 'Objetivos',
  foodLogs: 'Registros de comida',
  customFoods: 'Alimentos propios',
  recipes: 'Recetas',
  mealTemplates: 'Plantillas',
  favorites: 'Favoritos',
  recents: 'Recientes',
  routines: 'Rutinas',
  trainingSessions: 'Sesiones de entreno',
  exerciseSets: 'Series',
  customExercises: 'Ejercicios propios',
  bodyMeasurements: 'Mediciones',
  activityLogs: 'Actividad',
  sleepLogs: 'Sueño',
  recoveryLogs: 'Recuperación',
  habits: 'Hábitos',
  habitLogs: 'Registros de hábitos',
  importedDaily: 'Valores diarios importados',
  labelImages: 'Fotos de etiquetas',
  dayMarks: 'Días marcados como completos',
  energyAdjustments: 'Ajustes de energía',
  healthRecords: 'Datos de Health Connect',
  integrations: 'Conexiones (Health Connect)',
  vitals: 'Signos vitales',
  hydrationLogs: 'Hidratación',
  progressPhotos: 'Fotos de progreso',
  exerciseFavorites: 'Ejercicios favoritos',
}

const COLORS: ProfileColor[] = ['emerald', 'violet', 'amber', 'sky', 'rose']

async function readFile(input: HTMLInputElement): Promise<string | null> {
  const f = input.files?.[0]
  input.value = ''
  if (!f) return null
  return f.text()
}

function FilePick({ label, onText, testId }: { label: ReactNode; onText: (t: string) => void; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid={testId}
        onChange={async (e) => {
          const t = await readFile(e.currentTarget)
          if (t !== null) onText(t)
        }}
      />
      <button className="btn-secondary w-full" onClick={() => ref.current?.click()}>
        <Icon name="upload" size={18} /> {label}
      </button>
    </>
  )
}

export function BackupPage() {
  const { profiles, active, setActive } = useProfiles()
  return (
    <>
      <PageHeader title="Datos y respaldos" subtitle={SYNC_CONFIG ? 'Copias manuales de tus datos' : 'Tus datos viven en este dispositivo'} back={active ? '/mas' : '/'} />
      <div className="space-y-5">
        {profiles && profiles.length ? <ExportCard profiles={profiles} active={active} /> : null}
        <ImportCard profiles={profiles ?? []} onCreated={(id) => !active && setActive(id)} />
        {active ? <ExportCsvCard key={`csv-${active.id}`} /> : null}
        {active ? <ImportTrainingCard key={`csv-in-${active.id}`} /> : null}
        <p className="flex items-start gap-2 px-1 text-label text-muted" data-testid="backup-note">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
          <span>{BACKUP_NOTE}</span>
        </p>
        <div className="tile">
          <Disclosure summary="Herramientas avanzadas" tone="section" testId="backup-advanced">
            <div className="space-y-5 pt-2">
              <Phase0Card profiles={profiles ?? []} onCreated={(id) => !active && setActive(id)} />
              <TcacCard />
              <StorageCard />
              <IntegrityCard />
            </div>
          </Disclosure>
        </div>
      </div>
    </>
  )
}

function ExportCard({ profiles, active }: { profiles: Profile[]; active: Profile | null }) {
  const [last, setLast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [media, setMedia] = useState(true)
  const [size, setSize] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [shareable, setShareable] = useState<{ uri: string; fileName: string } | null>(null)
  useEffect(() => {
    void getMeta<string>('lastExport').then((v) => setLast(v ?? null))
  }, [])
  async function run(scope: { profileId: string } | 'all', label: string) {
    setBusy(true)
    setMsg(null)
    setShareable(null)
    try {
      const b = await exportBackup(scope, undefined, { includeMedia: media })
      const out = await saveJsonFile(b, backupFileName(b, label))
      // The date of the last backup is recorded only once a file was really handed to the platform.
      if (!out.ok) {
        setMsg({ tone: 'bad', text: out.message })
        return
      }
      setSize(backupSize(b))
      const now = new Date().toISOString()
      await setMeta('lastExport', now)
      setLast(now)
      setMsg({ tone: 'good', text: savedMessage(out) })
      if (out.method === 'documents') setShareable({ uri: out.uri, fileName: out.fileName })
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof Error && e.message ? `No se pudo exportar: ${e.message}` : 'No se pudo exportar. Inténtalo de nuevo.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Exportar</h2>
      <p className="text-sm text-muted">
        Archivo JSON versionado con todos los registros. Último respaldo: <span data-testid="last-export">{last ? new Date(last).toLocaleString('es-CO') : 'nunca'}</span>.
      </p>
      <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={media} onChange={(e) => setMedia(e.target.checked)} data-testid="export-media" />
        <span>
          Incluir fotos (etiquetas y progreso)
          <span className="block text-xs text-muted">Sin fotos el archivo es mucho más liviano. Al restaurarlo, las fotos que ya tengas se conservan.</span>
        </span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {active ? (
          <button className="btn-primary" disabled={busy} onClick={() => void run({ profileId: active.id }, active.name)} data-testid="export-profile">
            <Icon name="download" size={18} /> Perfil de {active.name}
          </button>
        ) : null}
        {profiles.length > 1 ? (
          <button className="btn-secondary" disabled={busy} onClick={() => void run('all', 'todo')} data-testid="export-all">
            <Icon name="download" size={18} /> Todos los perfiles
          </button>
        ) : null}
      </div>
      {msg ? (
        <p className={`text-sm ${msg.tone === 'bad' ? 'text-bad' : 'text-good'}`} role={msg.tone === 'bad' ? 'alert' : 'status'} data-testid="export-message">
          {msg.text}
        </p>
      ) : null}
      {shareable ? (
        <button
          type="button"
          className="btn-secondary"
          data-testid="share-backup"
          onClick={() =>
            void shareSavedFile(shareable.uri, shareable.fileName).then((r) => {
              if (!r.ok && r.message) setMsg({ tone: 'bad', text: r.message })
            })
          }
        >
          Compartir
        </button>
      ) : null}
      {size !== null ? (
        <p className="text-xs text-faint" data-testid="export-size">
          Último archivo: {formatNumber(size / 1024 / 1024, 2)} MB.
        </p>
      ) : null}
    </Card>
  )
}

function PreviewTable({ res }: { res: ImportResult }) {
  const rows = Object.entries(res.byTable) as [PersonalTable, NonNullable<ImportResult['byTable'][PersonalTable]>][]
  if (!rows.length) return <p className="text-sm text-muted">No hay registros para importar con esta selección.</p>
  return (
    <div className="overflow-x-auto" data-testid="import-preview">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Vista previa de la importación por tabla</caption>
        <thead className="text-faint">
          <tr>
            <th className="py-1 pr-2 font-medium">Tabla</th>
            <th className="px-1 py-1 text-right font-medium">Nuevos</th>
            <th className="px-1 py-1 text-right font-medium">Actualiza</th>
            <th className="px-1 py-1 text-right font-medium">Se borran</th>
            <th className="py-1 pl-1 text-right font-medium">Se conservan</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map(([t, c]) => (
            <tr key={t} className="border-t border-line">
              <td className="py-1 pr-2 text-muted">{TABLE_LABEL[t]}</td>
              <td className="px-1 py-1 text-right">{c.inserted || '·'}</td>
              <td className="px-1 py-1 text-right">{c.updated || '·'}</td>
              <td className={`px-1 py-1 text-right ${c.removed ? 'font-semibold text-bad' : ''}`}>{c.removed || '·'}</td>
              <td className="py-1 pl-1 text-right">{c.skipped || '·'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {res.conflicts ? (
        <p className="mt-2 text-xs text-muted">
          {res.conflicts} registros locales son más recientes que los del archivo: se conserva la versión local.
        </p>
      ) : null}
    </div>
  )
}

function ImportCard({ profiles, onCreated }: { profiles: Profile[]; onCreated: (id: string) => void }) {
  const [b, setB] = useState<Backup | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    if (!b) {
      setPreview(null)
      return
    }
    let alive = true
    const plan = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== 'skip'))
    previewImport(b, { mode, mapping: plan })
      .then((p) => {
        if (alive) setPreview(p)
      })
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [b, mapping, mode])

  function load(text: string) {
    setResult(null)
    setErr(null)
    try {
      const parsed = parseBackup(text)
      setB(parsed)
      const m: Record<string, string> = {}
      for (const p of parsed.profiles) m[p.id] = profiles.some((x) => x.id === p.id) ? p.id : 'new'
      setMapping(m)
    } catch (e) {
      setB(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function apply() {
    if (!b) return
    setBusy(true)
    setErr(null)
    try {
      const plan = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== 'skip'))
      let res: ImportResult
      if (mode === 'replace') {
        const targets = [...new Set(Object.values(plan))].filter((t) => t !== 'new').map((id) => ({ id, name: profiles.find((x) => x.id === id)?.name ?? 'perfil' }))
        const ok = await confirm({
          title: 'Reemplazar datos',
          body: replaceConfirmText(targets.map((t) => t.name), preview?.removed ?? null),
          confirmLabel: 'Reemplazar',
          tone: 'danger',
        })
        if (!ok) return
        // Safety net: save whatever is about to be replaced, and abort if that copy cannot be saved.
        const out = await replaceWithSafetyCopy(targets, {
          saveSafetyCopy: async (t) => {
            const cur = await exportBackup({ profileId: t.id })
            return saveJsonFile(cur, backupFileName(cur, `antes-de-reemplazar-${t.name}`))
          },
          runImport: () => importBackup(b, { mode, mapping: plan }),
        })
        if (!out.ok) {
          setErr(out.message)
          return
        }
        res = out.result
      } else {
        res = await importBackup(b, { mode, mapping: plan })
      }
      setResult(res)
      const created = await listProfiles()
      const firstNew = created.find((p) => !profiles.some((x) => x.id === p.id))
      if (firstNew) onCreated(firstNew.id)
      setB(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Importar respaldo</h2>
      <FilePick label="Elegir archivo de respaldo" onText={load} testId="import-backup-file" />
      {err ? <p className="text-sm text-bad" role="alert" data-testid="import-error">{err}</p> : null}
      {b ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <div className="text-sm">
            Respaldo del {new Date(b.exportedAt).toLocaleString('es-CO')} · {b.scope === 'all' ? 'todos los perfiles' : 'un perfil'} · versión {b.schemaVersion}
          </div>
          {!b.media ? (
            <p className="text-xs text-muted">Este respaldo no incluye fotos: las fotos que ya tienes en este dispositivo se conservan.</p>
          ) : null}
          <ul className="flex flex-wrap gap-1.5">
            {backupStats(b).map((s) => (
              <li key={s.table}>
                <Badge>
                  {TABLE_LABEL[s.table]}: {s.count}
                </Badge>
              </li>
            ))}
          </ul>
          {b.profiles.map((p) => (
            <label key={p.id} className="block">
              <span className="label">Datos de «{p.name}» →</span>
              <select className="field" value={mapping[p.id] ?? 'skip'} onChange={(e) => setMapping((m) => ({ ...m, [p.id]: e.target.value }))} data-testid="import-target">
                {profiles.map((x) => (
                  <option key={x.id} value={x.id}>
                    Perfil existente: {x.name}
                    {x.id === p.id ? ' (mismo perfil)' : ''}
                  </option>
                ))}
                <option value="new">Crear perfil nuevo «{p.name}»</option>
                <option value="skip">No importar</option>
              </select>
            </label>
          ))}
          <Segmented<'merge' | 'replace'>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: IMPORT_MERGE_LABEL },
              { value: 'replace', label: 'Reemplazar' },
            ]}
          />
          <p className="text-xs text-muted">
            {mode === 'merge'
              ? IMPORT_MERGE_HELP
              : 'Reemplazar: borra los datos del perfil de destino (solo de las tablas que trae el archivo) y deja los del archivo. Antes se guarda automáticamente una copia de lo que se reemplaza; si no se puede guardar, no se reemplaza nada.'}
          </p>
          {preview ? <PreviewTable res={preview} /> : null}
          <button className="btn-primary w-full" disabled={busy || Object.values(mapping).every((v) => v === 'skip')} onClick={() => void apply()} data-testid="apply-import">
            Importar
          </button>
        </div>
      ) : null}
      {result ? (
        <p className="text-sm text-good" data-testid="import-result">
          Listo: {result.inserted} nuevos, {result.updated} actualizados, {result.skipped} sin cambios
          {result.removed ? `, ${result.removed} reemplazados` : ''}
          {result.profilesCreated ? `, ${result.profilesCreated} perfil(es) creados` : ''}.
        </p>
      ) : null}
    </Card>
  )
}

function Phase0Card({ profiles, onCreated }: { profiles: Profile[]; onCreated: (id: string) => void }) {
  const [file, setFile] = useState<P0File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [done, setDone] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayLocal()

  function load(text: string) {
    setErr(null)
    setDone(null)
    try {
      const f = parsePhase0(text)
      setFile(f)
      setMapping(Object.fromEntries(f.profiles.map((p) => [p.profile_id, 'skip'])))
    } catch (e) {
      setFile(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function previewFor(letter: string) {
    if (!file) return null
    const t = mapping[letter]
    if (!t || t === 'skip') return null
    const p0 = file.profiles.find((p) => p.profile_id === letter)!
    const target = t === 'new' ? { id: 'preview', sex: p0.sex, birthDate: p0.birth_date, heightCm: p0.height_cm } : profiles.find((p) => p.id === t)
    if (!target) return null
    return mapPhase0(file, letter, target, today)
  }

  async function apply() {
    if (!file) return
    setBusy(true)
    setErr(null)
    const lines: string[] = []
    try {
      let n = profiles.length
      for (const p0 of file.profiles) {
        const t = mapping[p0.profile_id]
        if (!t || t === 'skip') continue
        let target = profiles.find((p) => p.id === t) ?? null
        if (t === 'new') {
          target = await createProfile({
            name: p0.display_name,
            sex: p0.sex,
            birthDate: p0.birth_date,
            heightCm: p0.height_cm,
            activity: null,
            color: COLORS[n++ % COLORS.length]!,
            settings: { addActivityKcal: false },
          })
          onCreated(target.id)
        }
        if (!target) continue
        const rows = mapPhase0(file, p0.profile_id, target, today)
        const r = repo(target.id)
        await r.bulkPut('bodyMeasurements', rows.bodyMeasurements)
        await r.bulkPut('trainingSessions', rows.trainingSessions)
        await r.bulkPut('activityLogs', rows.activityLogs)
        await r.bulkPut('sleepLogs', rows.sleepLogs)
        await r.bulkPut('importedDaily', rows.importedDaily)
        lines.push(
          `${target.name}: ${Object.entries(rows.summary.byKind)
            .map(([k, v]) => `${v} ${k.toLowerCase()}`)
            .join(', ')} (${rows.summary.kept} registros usados, ${rows.summary.dropped} descartados por el filtro).`,
        )
      }
      setDone(lines)
      setFile(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Historial previo (fase 0)</h2>
      <p className="text-sm text-muted">
        Importa el archivo <code className="text-xs">15_personal_health_os_import.json</code> generado en la extracción. Se leen solo en este dispositivo.
        Se descartan duplicados, valores inválidos, planificados o de plantilla y fechas sin precisión; las lecturas de gráficas quedan marcadas como
        aproximadas y fuera de los promedios. Reimportar no duplica nada.
      </p>
      <FilePick label="Elegir archivo de la fase 0" onText={load} testId="import-phase0-file" />
      {err ? <p className="text-sm text-bad">{err}</p> : null}
      {file ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          {file.profiles.map((p) => {
            const prev = previewFor(p.profile_id)
            return (
              <div key={p.profile_id} className="space-y-1">
                <label className="block">
                  <span className="label">
                    Perfil {p.profile_id} · {p.display_name} →
                  </span>
                  <select className="field" value={mapping[p.profile_id]} onChange={(e) => setMapping((m) => ({ ...m, [p.profile_id]: e.target.value }))}>
                    <option value="skip">No importar</option>
                    {profiles.map((x) => (
                      <option key={x.id} value={x.id}>
                        Perfil existente: {x.name}
                      </option>
                    ))}
                    <option value="new">Crear perfil «{p.display_name}» con sus datos</option>
                  </select>
                </label>
                {prev ? (
                  <p className="text-xs text-muted">
                    {Object.entries(prev.summary.byKind)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
            )
          })}
          <p className="text-xs text-faint">
            No se importan: objetivos ni planes (defínelos en Perfil), métricas derivadas (la app las recalcula), alimentos «recientes» sin fecha ni series con valores
            prellenados.
          </p>
          <button className="btn-primary w-full" disabled={busy || Object.values(mapping).every((v) => v === 'skip')} onClick={() => void apply()}>
            Importar historial
          </button>
        </div>
      ) : null}
      {done ? (
        <ul className="space-y-1 text-sm text-good">
          {done.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

function TcacCard() {
  const count = useLiveQuery(() => refFoods.count('icbf_tcac2015'), [])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Tabla ICBF (TCAC 2015)</h2>
        <Badge tone={count ? 'good' : 'muted'}>{count ? `${formatNumber(count, 0)} alimentos` : 'No cargada'}</Badge>
      </div>
      <p className="text-sm text-muted">
        La tabla colombiana del ICBF no se publica con la app. Genera <code className="text-xs">tcac2015.json</code> con el script local y cárgalo aquí en cada
        dispositivo; aparecerá primero en las búsquedas en español.
      </p>
      <FilePick
        label={count ? 'Volver a cargar tcac2015.json' : 'Cargar tcac2015.json'}
        testId="import-tcac-file"
        onText={async (t) => {
          setErr(null)
          setMsg(null)
          try {
            const n = await importTcac(parseTcac(t))
            setMsg(`Cargados ${formatNumber(n, 0)} alimentos del ICBF.`)
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          }
        }}
      />
      {count ? (
        <button
          className="btn-ghost w-full text-sm"
          onClick={async () => {
            if (!confirm('¿Quitar la tabla ICBF de este dispositivo? Los registros ya hechos conservan sus valores.')) return
            await refFoods.clearSource('icbf_tcac2015')
          }}
        >
          Quitar tabla de este dispositivo
        </button>
      ) : null}
      {msg ? <p className="text-sm text-good">{msg}</p> : null}
      {err ? <p className="text-sm text-bad">{err}</p> : null}
    </Card>
  )
}

function StorageCard() {
  const [info, setInfo] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null }>({ persisted: null, usage: null, quota: null })
  async function refresh() {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null
    setInfo({ persisted, usage: est?.usage ?? null, quota: est?.quota ?? null })
  }
  useEffect(() => {
    void refresh()
  }, [])
  const mb = (n: number) => formatNumber(n / 1024 / 1024, 1)
  return (
    <Card className="space-y-2">
      <h2 className="font-semibold">Almacenamiento</h2>
      <p className="text-sm text-muted">
        {info.persisted ? 'Almacenamiento persistente activado: el navegador no borrará los datos por falta de espacio.' : 'El navegador podría borrar datos si se queda sin espacio. Activa el almacenamiento persistente (instalar la app ayuda).'}
      </p>
      {info.usage !== null ? (
        <div className="space-y-1.5" data-testid="storage-usage">
          {info.quota ? (
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface2"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((info.usage / info.quota) * 100)}
              aria-label="Espacio usado"
            >
              <div className={`h-full rounded-full ${info.usage / info.quota > 0.8 ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${Math.max(1, Math.min(100, (info.usage / info.quota) * 100))}%` }} />
            </div>
          ) : null}
          <p className="text-xs text-faint">
            En uso: {mb(info.usage)} MB{info.quota ? ` de ${mb(info.quota)} MB disponibles` : ''}.
          </p>
          {info.quota && info.usage / info.quota > 0.8 ? <p className="text-xs text-bad">Queda poco espacio. Exporta un respaldo y considera quitar fotos antiguas.</p> : null}
        </div>
      ) : null}
      {!info.persisted ? (
        <button
          className="btn-secondary w-full"
          onClick={async () => {
            await requestPersistentStorage()
            await refresh()
          }}
        >
          Solicitar almacenamiento persistente
        </button>
      ) : null}
    </Card>
  )
}

function IntegrityCard() {
  const [rep, setRep] = useState<IntegrityReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fixable = rep?.issues.filter((i) => i.code !== 'invalid_date') ?? []
  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      setRep(await checkIntegrity())
    } finally {
      setBusy(false)
    }
  }
  async function repair() {
    if (!window.confirm('Se aplicarán las reparaciones indicadas. Conviene exportar un respaldo antes. ¿Continuar?')) return
    setBusy(true)
    try {
      const n = await repairIntegrity(fixable)
      setMsg(`Reparación aplicada: ${n} registros corregidos.`)
      setRep(await checkIntegrity())
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3" data-testid="integrity">
      <h2 className="font-semibold">Verificar datos</h2>
      <p className="text-sm text-muted">Revisa que no haya registros huérfanos, referencias rotas ni importaciones duplicadas. La verificación no cambia nada.</p>
      <button className="btn-secondary w-full" disabled={busy} onClick={() => void run()} data-testid="integrity-run">
        <Icon name="shield" size={18} /> Verificar ahora
      </button>
      {rep && rep.issues.length ? (
        <div className="space-y-2">
          <ul className="space-y-2 text-sm">
            {rep.issues.map((i) => (
              <li key={i.code + i.table} className="rounded-xl border border-line p-3">
                <div className="font-medium">{TABLE_LABEL[i.table]}</div>
                <div className="text-muted">{i.message}</div>
                <div className="mt-1 text-xs text-faint">Reparación: {i.repair}</div>
              </li>
            ))}
          </ul>
          {fixable.length ? (
            <button className="btn-danger w-full" disabled={busy} onClick={() => void repair()}>
              Reparar
            </button>
          ) : null}
        </div>
      ) : null}
      {rep && !rep.issues.length ? (
        <p className="text-sm text-good" data-testid="integrity-ok">
          Todo en orden: {formatNumber(rep.rows, 0)} registros revisados.
        </p>
      ) : null}
      {msg ? <p className="text-sm text-good">{msg}</p> : null}
    </Card>
  )
}
