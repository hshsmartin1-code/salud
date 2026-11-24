import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { useProfile, useRepo } from '../../app/profile'
import { todayLocal } from '../../domain/dates'
import { normalize } from '../../domain/search'
import { Icon } from '../../ui/Icon'
import { Badge, Card, Segmented } from '../../ui/kit'
import { useExercises, type Exercise } from '../training/exercises'
import { FORMAT_EXCEL_ES, FORMAT_STANDARD, type CsvFormat } from './csv/csv'
import { buildBodyCsv, buildFoodCsv, buildTrainingCsv, csvFileName, type CsvKind } from './csv/exportCsv'
import {
  SOURCE_LABEL,
  applyTrainingImport,
  parseTrainingCsv,
  planTrainingImport,
  undoTrainingImport,
  type ExerciseChoice,
  type ImportReceipt,
  type ParseOk,
  type ParsedWorkout,
  type WeightUnit,
} from './csv/importTraining'
import { AUTO_THRESHOLD, buildIndex, matchExercise, type LibraryEntry, type Match } from './csv/matchExercise'
import { savedMessage, saveTextFile } from './saveFile'

// ───────────── export ─────────────

type FormatId = 'excel' | 'standard'
const FORMATS: Record<FormatId, CsvFormat> = { excel: FORMAT_EXCEL_ES, standard: FORMAT_STANDARD }
const FORMAT_KEY = 'salud.csvFormat'
function readFormat(): FormatId {
  try {
    return localStorage.getItem(FORMAT_KEY) === 'standard' ? 'standard' : 'excel'
  } catch {
    return 'excel'
  }
}

export function ExportCsvCard() {
  const r = useRepo()
  const profile = useProfile()
  const [fmt, setFmt] = useState<FormatId>(readFormat)
  const [busy, setBusy] = useState<CsvKind | null>(null)
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  async function run(kind: CsvKind) {
    setBusy(kind)
    setMsg(null)
    try {
      const f = FORMATS[fmt]
      let text: string
      if (kind === 'entrenamientos') text = buildTrainingCsv(await r.all('trainingSessions'), await r.all('exerciseSets'), f)
      else if (kind === 'comida') text = buildFoodCsv(await r.all('foodLogs'), f)
      else text = buildBodyCsv(await r.all('bodyMeasurements'), f)
      const out = await saveTextFile(text, csvFileName(kind, profile.name, todayLocal()), 'text/csv;charset=utf-8')
      setMsg(out.ok ? { tone: 'good', text: savedMessage(out).replace('Respaldo descargado', 'Archivo descargado').replace('Respaldo entregado', 'Archivo entregado') } : { tone: 'bad', text: out.message })
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof Error && e.message ? `No se pudo exportar: ${e.message}` : 'No se pudo exportar. Inténtalo de nuevo.' })
    } finally {
      setBusy(null)
    }
  }
  const btn = (kind: CsvKind, label: string, hint: string) => (
    <button className="btn-secondary w-full justify-start text-left" disabled={busy !== null} onClick={() => void run(kind)} data-testid={`export-csv-${kind}`}>
      <Icon name="download" size={18} />
      <span>
        {label}
        <span className="block text-xs font-normal text-muted">{hint}</span>
      </span>
    </button>
  )
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Exportar CSV</h2>
      <p className="text-sm text-muted">Tablas para Excel u otras apps, del perfil de {profile.name}. No sirven para restaurar: para eso usa el respaldo.</p>
      <div>
        <span className="label">Formato</span>
        <Segmented<FormatId>
          value={fmt}
          onChange={(v) => {
            setFmt(v)
            try {
              localStorage.setItem(FORMAT_KEY, v)
            } catch {
              /* a remembered choice is a convenience only */
            }
          }}
          ariaLabel="Formato del CSV"
          options={[
            { value: 'excel', label: 'Excel en español' },
            { value: 'standard', label: 'Estándar' },
          ]}
        />
        <p className="mt-1.5 text-xs text-faint" data-testid="csv-format-note">
          {fmt === 'excel'
            ? 'Separador «;» y coma decimal (1,5): se abre directo en Excel con configuración regional de Colombia.'
            : 'Separador «,» y punto decimal (1.5): para Google Sheets, scripts o Excel en inglés. En Excel en español, impórtalo desde Datos → Desde texto/CSV.'}
        </p>
      </div>
      <div className="grid gap-2">
        {btn('entrenamientos', 'Entrenamientos', 'Una fila por serie')}
        {btn('comida', 'Comida', 'Una fila por registro, con nutrientes')}
        {btn('peso-medidas', 'Peso y medidas', 'Peso, grasa % y perímetros')}
      </div>
      {msg ? (
        <p className={`text-sm ${msg.tone === 'bad' ? 'text-bad' : 'text-good'}`} role={msg.tone === 'bad' ? 'alert' : 'status'} data-testid="export-csv-message">
          {msg.text}
        </p>
      ) : null}
    </Card>
  )
}

// ───────────── import ─────────────

interface Row {
  key: string
  name: string
  sets: number
  matches: Match[]
}

const LEVEL_LABEL = { exact: 'Exacta', probable: 'Probable', possible: 'Posible' } as const

function rowsOf(workouts: readonly ParsedWorkout[], index: ReturnType<typeof buildIndex>): Row[] {
  const by = new Map<string, Row>()
  for (const w of workouts)
    for (const e of w.exercises) {
      const cur = by.get(e.key)
      if (cur) cur.sets += e.sets.length
      else by.set(e.key, { key: e.key, name: e.name, sets: e.sets.length, matches: matchExercise(e.name, index) })
    }
  return [...by.values()].sort((a, b) => b.sets - a.sets)
}

const toChoice = (e: Exercise | LibraryEntry & { trackingType?: Exercise['trackingType'] }, byId: Map<string, Exercise>): ExerciseChoice => {
  const full = byId.get(e.id)
  return { kind: 'library', exerciseId: e.id, name: e.nameEs, trackingType: full?.trackingType ?? 'weight_reps' }
}

export function ImportTrainingCard() {
  const r = useRepo()
  const ex = useExercises()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [unit, setUnit] = useState<WeightUnit>('kg')
  const [err, setErr] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, ExerciseChoice>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ receipt: ImportReceipt; skipped: number; undone: boolean } | null>(null)

  const sessions = useLiveQuery(() => r.all('trainingSessions'), [r])
  const customs = useLiveQuery(() => r.all('customExercises'), [r])

  const parsed = useMemo(() => (text === null ? null : parseTrainingCsv(text, { unit })), [text, unit])
  const ok: ParseOk | null = parsed && parsed.ok ? parsed : null
  const entries = useMemo<LibraryEntry[]>(() => ex.list.map((e) => ({ id: e.id, nameEs: e.nameEs, nameEn: e.nameEn, aliases: e.aliases, custom: e.custom })), [ex.list])
  const index = useMemo(() => buildIndex(entries), [entries])
  const rows = useMemo(() => (ok ? rowsOf(ok.workouts, index) : []), [ok, index])

  const choices = useMemo(() => {
    const out: Record<string, ExerciseChoice> = {}
    for (const row of rows) {
      const top = row.matches[0]
      out[row.key] = overrides[row.key] ?? (top && top.score >= AUTO_THRESHOLD ? toChoice(top.entry, ex.byId) : { kind: 'create' })
    }
    return out
  }, [rows, overrides, ex.byId])

  const plan = useMemo(() => {
    if (!ok || !sessions || !customs) return null
    return planTrainingImport(ok.workouts, r.profileId, choices, new Set(sessions.map((s) => s.id)), new Set(customs.map((c) => c.id)))
  }, [ok, sessions, customs, choices, r.profileId])

  function reset() {
    setText(null)
    setErr(null)
    setOverrides({})
    setDone(null)
    setUnit('kg')
  }

  async function onFile(input: HTMLInputElement) {
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    reset()
    const t = await f.text()
    const p = parseTrainingCsv(t)
    if (!p.ok) {
      setErr(p.error)
      return
    }
    setText(t)
  }

  async function apply() {
    if (!plan || !ok) return
    setBusy(true)
    setErr(null)
    try {
      const receipt = await applyTrainingImport(r, plan, ok.source)
      setDone({ receipt, skipped: plan.skippedSets, undone: false })
      setText(null)
      setOverrides({})
    } catch (e) {
      setErr(e instanceof Error ? `No se pudo importar: ${e.message}` : 'No se pudo importar.')
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!done) return
    setBusy(true)
    try {
      await undoTrainingImport(r, done.receipt)
      setDone({ ...done, undone: true })
    } catch (e) {
      setErr(e instanceof Error ? `No se pudo deshacer: ${e.message}` : 'No se pudo deshacer.')
    } finally {
      setBusy(false)
    }
  }

  const unmatched = rows.filter((x) => choices[x.key]?.kind !== 'library')
  const matched = rows.filter((x) => choices[x.key]?.kind === 'library')

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Importar entrenamientos (Hevy o Strong)</h2>
      <p className="text-sm text-muted">Usa el CSV que exporta tu app. Las sesiones se agregan a tu historial; si repites la importación del mismo archivo no se duplican.</p>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-training-file" onChange={(e) => void onFile(e.currentTarget)} />
      <button className="btn-secondary w-full" onClick={() => fileRef.current?.click()} disabled={busy}>
        <Icon name="upload" size={18} /> Elegir archivo CSV
      </button>
      {err ? (
        <p className="text-sm text-bad" role="alert" data-testid="import-training-error">
          {err}
        </p>
      ) : null}

      {ok ? (
        <div className="space-y-3" data-testid="import-training-review">
          <p className="text-sm">
            Archivo de <b>{SOURCE_LABEL[ok.source]}</b>: {ok.workouts.length} entrenamientos, {ok.workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0)} series.
          </p>
          {!ok.unitFromFile ? (
            <div>
              <span className="label">Unidad del peso en el archivo</span>
              <Segmented<WeightUnit>
                value={unit}
                onChange={setUnit}
                ariaLabel="Unidad del peso"
                options={[
                  { value: 'kg', label: 'Kilogramos' },
                  { value: 'lb', label: 'Libras' },
                ]}
              />
              <p className="mt-1 text-xs text-faint">El archivo no lo indica. Se guardará en kg.</p>
            </div>
          ) : (
            <p className="text-xs text-faint">Pesos en {ok.unit === 'kg' ? 'kilogramos' : 'libras'} (según el archivo); se guardan en kg.</p>
          )}
          {ok.warnings.map((w) => (
            <p key={w} className="text-xs text-warn">
              {w}
            </p>
          ))}
          <p className="text-xs text-faint">Las horas del archivo se leen como hora de Colombia.</p>

          {!ex.ready ? <p className="text-sm text-muted">Cargando biblioteca de ejercicios…</p> : null}
          {ex.ready && unmatched.length ? (
            <section aria-label="Ejercicios sin coincidencia" data-testid="import-unmatched">
              <h3 className="mb-1 text-sm font-semibold">Revisa estos ejercicios ({unmatched.length})</h3>
              <p className="mb-1 text-xs text-muted">No encontré una coincidencia clara. Elige uno de la biblioteca, créalo como ejercicio propio u omítelo.</p>
              <ul className="divide-y divide-line">
                {unmatched.map((row) => (
                  <ReviewRow key={row.key} row={row} choice={choices[row.key]!} list={ex.list} byId={ex.byId} onChange={(c) => setOverrides((o) => ({ ...o, [row.key]: c }))} />
                ))}
              </ul>
            </section>
          ) : null}
          {ex.ready && matched.length ? (
            <details data-testid="import-matched">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Coinciden con la biblioteca ({matched.length})</summary>
              <ul className="divide-y divide-line">
                {matched.map((row) => (
                  <ReviewRow key={row.key} row={row} choice={choices[row.key]!} list={ex.list} byId={ex.byId} onChange={(c) => setOverrides((o) => ({ ...o, [row.key]: c }))} />
                ))}
              </ul>
            </details>
          ) : null}

          {plan ? (
            <div className="rounded-xl bg-surface2 p-3 text-sm" data-testid="import-training-counts">
              <p>
                <b data-testid="count-new">{plan.newSessions}</b> sesiones nuevas · <b data-testid="count-known">{plan.knownSessions}</b> ya importadas
              </p>
              <p className="text-xs text-muted">
                {plan.newSets} series por agregar{plan.customs.length ? ` · ${plan.customs.length} ejercicios propios nuevos` : ''}
                {plan.skippedSets ? ` · ${plan.skippedSets} series omitidas` : ''}
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={reset} disabled={busy}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={() => void apply()} disabled={busy || !plan || plan.newSessions === 0} data-testid="import-training-apply">
              Importar {plan ? plan.newSessions : ''}
            </button>
          </div>
        </div>
      ) : null}

      {done ? (
        <div className="space-y-2 rounded-xl bg-surface2 p-3 text-sm" role="status" data-testid="import-training-result">
          {done.undone ? (
            <p>Importación deshecha: se quitaron las sesiones y series que se habían agregado.</p>
          ) : (
            <>
              <p>
                Listo: {done.receipt.sessionIds.length} sesiones y {done.receipt.setIds.length} series importadas
                {done.receipt.customIds.length ? `, ${done.receipt.customIds.length} ejercicios propios creados` : ''}
                {done.skipped ? `. ${done.skipped} series omitidas.` : '.'}
              </p>
              <button className="btn-secondary" onClick={() => void undo()} disabled={busy} data-testid="import-training-undo">
                Deshacer esta importación
              </button>
            </>
          )}
        </div>
      ) : null}
    </Card>
  )
}

function ReviewRow({ row, choice, list, byId, onChange }: { row: Row; choice: ExerciseChoice; list: Exercise[]; byId: Map<string, Exercise>; onChange: (c: ExerciseChoice) => void }) {
  const [q, setQ] = useState('')
  const top = row.matches[0]
  const found = useMemo(() => {
    const toks = normalize(q).split(' ').filter(Boolean)
    if (!toks.length) return []
    return list.filter((e) => toks.every((t) => e.search.includes(t))).slice(0, 6)
  }, [q, list])
  const options = new Map<string, Exercise>()
  for (const m of row.matches) {
    const e = byId.get(m.entry.id)
    if (e) options.set(e.id, e)
  }
  for (const e of found) options.set(e.id, e)
  if (choice.kind === 'library') {
    const e = byId.get(choice.exerciseId)
    if (e) options.set(e.id, e)
  }
  const value = choice.kind === 'library' ? choice.exerciseId : choice.kind
  const badge = choice.kind === 'library' ? (top && top.entry.id === choice.exerciseId ? <Badge tone={top.level === 'possible' ? 'warn' : 'good'}>{LEVEL_LABEL[top.level]} · {Math.round(top.score * 100)} %</Badge> : <Badge tone="accent">Elegido</Badge>) : choice.kind === 'create' ? <Badge tone="muted">Ejercicio propio</Badge> : <Badge tone="bad">Omitido</Badge>
  return (
    <li className="space-y-1.5 py-2.5" data-testid="import-review-row">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-medium">{row.name}</span>
        <span className="shrink-0">{badge}</span>
      </div>
      <p className="text-xs text-faint">{row.sets} series</p>
      <select
        className="field"
        aria-label={`Ejercicio para «${row.name}»`}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'create' || v === 'skip') onChange({ kind: v })
          else {
            const picked = options.get(v)
            if (picked) onChange(toChoice(picked, byId))
          }
        }}
      >
        {[...options.values()].map((e) => (
          <option key={e.id} value={e.id}>
            {e.nameEs}
            {e.custom ? ' (propio)' : ''}
          </option>
        ))}
        <option value="create">Crear como ejercicio propio</option>
        <option value="skip">Omitir este ejercicio</option>
      </select>
      <input className="field" type="search" placeholder="Buscar otro en la biblioteca" aria-label={`Buscar ejercicio para «${row.name}»`} value={q} onChange={(e) => setQ(e.target.value)} />
    </li>
  )
}
