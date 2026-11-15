import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useProfiles } from '../../app/profile'
import { backupFileName, backupStats, downloadJson, exportBackup, importBackup, parseBackup, type Backup, type ImportResult } from '../../db/backup'
import { createProfile, getMeta, setMeta } from '../../db/profiles'
import { repo } from '../../db/repo'
import { requestPersistentStorage } from '../../db/schema'
import { refFoods } from '../../db/shared'
import type { PersonalTable } from '../../db/tables'
import type { Profile, ProfileColor } from '../../db/types'
import { todayLocal } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { Badge, Card, PageHeader, Segmented } from '../../ui/kit'
import { mapPhase0, parsePhase0, type P0File } from './phase0'
import { importTcac, parseTcac } from './tcac'

export const TABLE_LABEL: Record<PersonalTable, string> = {
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
      <PageHeader title="Respaldo e importación" subtitle="Los datos viven solo en este dispositivo" back={active ? '/mas' : undefined} />
      <div className="space-y-5">
        <Card className="flex gap-3 border-warn/30 bg-warn/5">
          <Icon name="shield" className="mt-0.5 shrink-0 text-warn" />
          <p className="text-sm text-muted">
            No hay sincronización ni nube: cada dispositivo guarda sus datos en el navegador. Exporta un respaldo con frecuencia y guárdalo en un lugar
            seguro. Los archivos contienen datos de salud: no los compartas.
          </p>
        </Card>
        {profiles && profiles.length ? <ExportCard profiles={profiles} active={active} /> : null}
        <ImportCard profiles={profiles ?? []} onCreated={(id) => !active && setActive(id)} />
        <Phase0Card profiles={profiles ?? []} onCreated={(id) => !active && setActive(id)} />
        <TcacCard />
        <StorageCard />
      </div>
    </>
  )
}

function ExportCard({ profiles, active }: { profiles: Profile[]; active: Profile | null }) {
  const [last, setLast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void getMeta<string>('lastExport').then((v) => setLast(v ?? null))
  }, [])
  async function run(scope: { profileId: string } | 'all', label: string) {
    setBusy(true)
    try {
      const b = await exportBackup(scope)
      downloadJson(b, backupFileName(b, label))
      const now = new Date().toISOString()
      await setMeta('lastExport', now)
      setLast(now)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Exportar</h2>
      <p className="text-sm text-muted">
        Archivo JSON versionado con todos los registros. Último respaldo: {last ? new Date(last).toLocaleString('es-CO') : 'nunca'}.
      </p>
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
    </Card>
  )
}

function ImportCard({ profiles, onCreated }: { profiles: Profile[]; onCreated: (id: string) => void }) {
  const [b, setB] = useState<Backup | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)

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
      if (mode === 'replace') {
        // Safety net: export whatever is about to be replaced.
        for (const target of Object.values(plan)) {
          if (target === 'new') continue
          const p = profiles.find((x) => x.id === target)
          const cur = await exportBackup({ profileId: target })
          downloadJson(cur, backupFileName(cur, `antes-de-reemplazar-${p?.name ?? 'perfil'}`))
        }
      }
      const res = await importBackup(b, { mode, mapping: plan })
      setResult(res)
      const created = await (await import('../../db/profiles')).listProfiles()
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
      {err ? <p className="text-sm text-bad">{err}</p> : null}
      {b ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <div className="text-sm">
            Respaldo del {new Date(b.exportedAt).toLocaleString('es-CO')} · {b.scope === 'all' ? 'todos los perfiles' : 'un perfil'} · versión {b.schemaVersion}
          </div>
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
              { value: 'merge', label: 'Combinar' },
              { value: 'replace', label: 'Reemplazar' },
            ]}
          />
          <p className="text-xs text-muted">
            {mode === 'merge'
              ? 'Combinar: agrega lo que falta y, si un registro existe en ambos, conserva la versión más reciente.'
              : 'Reemplazar: borra los datos del perfil de destino y deja solo los del archivo. Antes se descarga automáticamente un respaldo de lo que se reemplaza.'}
          </p>
          <button className="btn-primary w-full" disabled={busy || Object.values(mapping).every((v) => v === 'skip')} onClick={() => void apply()} data-testid="apply-import">
            Importar
          </button>
        </div>
      ) : null}
      {result ? (
        <p className="text-sm text-good" data-testid="import-result">
          Listo: {result.inserted} nuevos, {result.updated} actualizados, {result.skipped} sin cambios
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
        <p className="text-xs text-faint">
          En uso: {mb(info.usage)} MB{info.quota ? ` de ${mb(info.quota)} MB disponibles` : ''}.
        </p>
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
