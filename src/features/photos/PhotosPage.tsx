import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRepo } from '../../app/profile'
import type { PhotoPose, ProgressPhoto } from '../../db/types'
import { daysBetween, formatDateEs, todayLocal } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { TextArea, TextField } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { Badge, EmptyState, PageHeader, Segmented, Sheet } from '../../ui/kit'
import { POSES, POSE_LABEL, formatBytes, processPhotoFile, type ProcessedPhoto } from './image'

/** Gallery rows carry only the thumbnail; the full image is fetched when opened. */
type Thumb = Omit<ProgressPhoto, 'dataUrl'>
type PoseFilter = 'all' | PhotoPose

const PAGE = 48
const FILTERS: readonly { value: PoseFilter; label: string }[] = [{ value: 'all', label: 'Todas' }, ...POSES]

export function PhotosPage() {
  const r = useRepo()
  // Newest photos first, a page at a time: each row carries its full-size image, so loading all of them is the cost.
  const [limit, setLimit] = useState(PAGE)
  const rows = useLiveQuery(async () => (await r.latest('progressPhotos', limit)).map(({ dataUrl: _d, ...rest }): Thumb => rest), [r, limit])
  const total = useLiveQuery(() => r.count('progressPhotos'), [r])
  const [filter, setFilter] = useState<PoseFilter>('all')
  const [adding, setAdding] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)

  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [rows])
  const filtered = useMemo(() => sorted.filter((p) => filter === 'all' || p.pose === filter), [sorted, filter])
  const groups = useMemo(() => {
    const m = new Map<string, Thumb[]>()
    for (const p of filtered) m.set(p.date, [...(m.get(p.date) ?? []), p])
    return [...m.entries()]
  }, [filtered])
  const byId = useMemo(() => new Map(sorted.map((p) => [p.id, p])), [sorted])
  const firstPose = picked[0] ? byId.get(picked[0])?.pose : undefined

  // Drop selections whose photo no longer exists.
  useEffect(() => {
    if (rows) setPicked((p) => p.filter((id) => rows.some((x) => x.id === id)))
  }, [rows])

  const toggleCompare = () => {
    setCompare((c) => !c)
    setPicked([])
  }
  const onTile = (p: Thumb) => {
    if (!compare) return setViewId(p.id)
    setPicked((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : cur.length >= 2 ? [cur[1]!, p.id] : [...cur, p.id]))
  }

  return (
    <div data-testid="photos-page">
      <PageHeader
        title="Fotos de progreso"
        subtitle="Compara tu evolución con tus propias fotos."
        back="/salud"
        actions={
          <button className="btn-primary px-3" onClick={() => setAdding(true)} data-testid="new-photo">
            <Icon name="camera" size={18} /> Foto
          </button>
        }
      />
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-muted" data-testid="photos-privacy">
          <Icon name="shield" size={16} className="mt-px shrink-0 text-[rgb(var(--body))]" />
          <span>Las fotos se quedan en este dispositivo y solo se incluyen en las copias de seguridad cuando activas «Incluir fotos».</span>
        </p>

        {rows && rows.length === 0 ? (
          <EmptyState
            icon="camera"
            title="Aún no tienes fotos"
            action={
              <button className="btn-primary" onClick={() => setAdding(true)}>
                <Icon name="camera" size={18} /> Tomar la primera foto
              </button>
            }
          >
            Toma una foto con la misma pose, luz y distancia cada vez. Después podrás compararlas lado a lado o superpuestas.
          </EmptyState>
        ) : null}

        {rows && rows.length > 0 ? (
          <>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 overflow-x-auto">
                <Segmented ariaLabel="Filtrar por pose" size="sm" value={filter} onChange={setFilter} options={FILTERS} />
              </div>
              <button className={`chip shrink-0 ${compare ? 'chip-on' : ''}`} aria-pressed={compare} onClick={toggleCompare} disabled={sorted.length < 2} data-testid="compare-toggle">
                <Icon name="swap" size={14} /> Comparar
              </button>
            </div>

            {compare ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface2 px-3 py-2.5 text-sm" role="status" data-testid="compare-bar">
                <span className="text-muted">
                  {picked.length === 0 ? 'Elige dos fotos (idealmente la misma pose).' : picked.length === 1 ? 'Elige una segunda foto.' : 'Listas para comparar.'}
                </span>
                <button className="btn-primary px-3 py-1.5 text-sm" disabled={picked.length !== 2} onClick={() => setShowCompare(true)} data-testid="open-compare">
                  Ver comparación
                </button>
              </div>
            ) : null}

            {groups.length ? (
              <div className="space-y-4" data-testid="photos-gallery">
                {groups.map(([date, items]) => (
                  <section key={date} aria-label={formatDateEs(date, 'long')}>
                    <h2 className="section-title mb-1.5">{formatDateEs(date, 'weekday')}</h2>
                    <ul className="grid grid-cols-3 gap-2">
                      {items.map((p) => {
                        const sel = picked.indexOf(p.id)
                        const samePose = compare && firstPose && picked[0] !== p.id && p.pose === firstPose
                        return (
                          <li key={p.id}>
                            <button
                              className={`relative block w-full overflow-hidden rounded-xl border bg-surface2 ${sel >= 0 ? 'border-body ring-2 ring-body' : 'border-line'}`}
                              onClick={() => onTile(p)}
                              aria-pressed={compare ? sel >= 0 : undefined}
                              aria-label={`${compare ? 'Seleccionar foto' : 'Ver foto'} ${POSE_LABEL[p.pose]} del ${formatDateEs(p.date)}`}
                              data-testid="photo-tile"
                            >
                              <img src={p.thumbUrl} alt="" className="aspect-[3/4] w-full object-cover" loading="lazy" />
                              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-semibold text-white">
                                {POSE_LABEL[p.pose]}
                                {sel >= 0 ? <span className="rounded bg-body px-1">{sel + 1}</span> : samePose ? <span className="rounded bg-white/25 px-1">misma pose</span> : null}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            ) : total != null && rows && total > rows.length ? null : (
              <EmptyState icon="image" title="Sin fotos con esta pose">
                Cambia el filtro o toma una foto nueva con esta pose.
              </EmptyState>
            )}
            {total != null && rows && total > rows.length ? (
              <button className="btn-secondary w-full" onClick={() => setLimit((n) => n + PAGE)} data-testid="photos-more">
                Mostrar más fotos ({rows.length} de {total})
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <AddPhotoSheet open={adding} onClose={() => setAdding(false)} />
      <ViewSheet id={viewId} onClose={() => setViewId(null)} />
      <CompareSheet open={showCompare && picked.length === 2} ids={picked} onClose={() => setShowCompare(false)} />
    </div>
  )
}

// ───────────────────────── Add ─────────────────────────

function AddPhotoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useRepo()
  const [photo, setPhoto] = useState<ProcessedPhoto | null>(null)
  const [pose, setPose] = useState<PhotoPose>('front')
  const [date, setDate] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPhoto(null)
    setPose('front')
    setDate(todayLocal())
    setNotes('')
    setBusy(false)
    setError(null)
  }, [open])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      setPhoto(await processPhotoFile(f))
    } catch (e) {
      setPhoto(null)
      setError(e instanceof Error && e.message ? e.message : 'No se pudo leer la imagen. Prueba con otra.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!photo || !date || busy) return
    setBusy(true)
    try {
      const day = await r.onDate('bodyMeasurements', date)
      const withW = day.filter((m) => m.weightKg !== null).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
      await r.add('progressPhotos', {
        date,
        pose,
        dataUrl: photo.dataUrl,
        thumbUrl: photo.thumbUrl,
        width: photo.width,
        height: photo.height,
        bytes: photo.bytes,
        weightKg: withW[0]?.weightKg ?? null,
        notes: notes.trim() || undefined,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Nueva foto de progreso">
      <form
        className="space-y-3 pb-2"
        data-testid="photo-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Tomar foto con la cámara" data-testid="photo-input-camera" onChange={(e) => (void onFile(e.target.files?.[0]), (e.target.value = ''))} />
        <input ref={gal} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Elegir foto de la galería" data-testid="photo-input-gallery" onChange={(e) => (void onFile(e.target.files?.[0]), (e.target.value = ''))} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={() => cam.current?.click()} data-testid="take-photo">
            <Icon name="camera" size={18} /> Tomar foto
          </button>
          <button type="button" className="btn-secondary" onClick={() => gal.current?.click()} data-testid="pick-photo">
            <Icon name="image" size={18} /> Galería
          </button>
        </div>
        {busy && !photo ? <p className="text-sm text-muted">Procesando en el dispositivo…</p> : null}
        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
        {photo ? (
          <div className="flex items-center gap-3 rounded-xl border border-line p-2">
            <img src={photo.thumbUrl} alt="Vista previa de la foto" className="h-20 w-16 rounded-lg object-cover" />
            <div className="text-xs text-muted">
              <div>
                {photo.width} × {photo.height} px
              </div>
              <div>{formatBytes(photo.bytes)} · JPEG</div>
            </div>
          </div>
        ) : null}
        <div>
          <span className="label">Pose</span>
          <Segmented ariaLabel="Pose" size="sm" value={pose} onChange={setPose} options={POSES} />
        </div>
        <TextField label="Fecha" type="date" value={date} onChange={setDate} />
        <TextArea label="Notas (opcional)" value={notes} onChange={setNotes} placeholder="Ej.: en ayunas, misma luz" />
        <button className="btn-primary w-full" type="submit" disabled={!photo || !date || busy} data-testid="save-photo">
          Guardar foto
        </button>
        {!photo ? <p className="text-center text-xs text-faint">Toma o elige una foto para poder guardarla.</p> : null}
      </form>
    </Sheet>
  )
}

// ───────────────────────── View ─────────────────────────

function useFull(id: string | null) {
  const r = useRepo()
  return useLiveQuery(async () => (id ? ((await r.get('progressPhotos', id)) ?? null) : undefined), [r, id])
}

function ViewSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const r = useRepo()
  const p = useFull(id)
  return (
    <Sheet open={!!id} onClose={onClose} title={p ? `${POSE_LABEL[p.pose]} · ${formatDateEs(p.date)}` : 'Foto'}>
      {p ? (
        <div className="space-y-3 pb-2" data-testid="photo-view">
          <img src={p.dataUrl} alt={`Foto de progreso, pose ${POSE_LABEL[p.pose].toLowerCase()}, ${formatDateEs(p.date, 'long')}`} className="mx-auto max-h-[60dvh] w-auto max-w-full rounded-xl" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge>{POSE_LABEL[p.pose]}</Badge>
            {p.weightKg != null ? <span>Peso ese día: {formatNumber(p.weightKg, 1)} kg</span> : <span>Sin peso registrado ese día</span>}
            <span>
              · {p.width} × {p.height} px · {formatBytes(p.bytes)}
            </span>
          </div>
          {p.notes ? <p className="text-sm">{p.notes}</p> : null}
          <button
            className="btn-danger w-full"
            data-testid="delete-photo"
            onClick={async () => {
              if (!confirm('¿Eliminar esta foto? No se puede deshacer.')) return
              await r.remove('progressPhotos', p.id)
              onClose()
            }}
          >
            <Icon name="trash" size={16} /> Eliminar foto
          </button>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted">{p === null ? 'La foto ya no existe.' : 'Cargando…'}</p>
      )}
    </Sheet>
  )
}

// ───────────────────────── Compare ─────────────────────────

function CompareSheet({ open, ids, onClose }: { open: boolean; ids: string[]; onClose: () => void }) {
  const a = useFull(open ? (ids[0] ?? null) : null)
  const b = useFull(open ? (ids[1] ?? null) : null)
  const [mode, setMode] = useState<'side' | 'overlay'>('side')
  const [pos, setPos] = useState(50)
  useEffect(() => {
    if (open) {
      setMode('side')
      setPos(50)
    }
  }, [open])
  // Older first: "antes" → "después".
  const pair = a && b ? (a.date <= b.date ? [a, b] : [b, a]) : null
  const days = pair ? Math.abs(daysBetween(pair[0].date, pair[1].date)) : null
  const dKg = pair && pair[0].weightKg != null && pair[1].weightKg != null ? pair[1].weightKg - pair[0].weightKg : null
  const kgText = dKg === null ? null : `${dKg > 0 ? '+' : dKg < 0 ? '−' : ''}${formatNumber(Math.abs(dKg), 1)} kg`

  return (
    <Sheet open={open} onClose={onClose} title="Comparación" wide>
      {pair ? (
        <div className="space-y-3 pb-2" data-testid="compare-view">
          <Segmented
            ariaLabel="Modo de comparación"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'side', label: 'Lado a lado' },
              { value: 'overlay', label: 'Superpuesta' },
            ]}
          />
          {pair[0].pose !== pair[1].pose ? (
            <p className="text-xs text-warn" role="status">
              Las poses son distintas ({POSE_LABEL[pair[0].pose]} y {POSE_LABEL[pair[1].pose]}); la comparación es más útil con la misma pose.
            </p>
          ) : null}

          {mode === 'side' ? (
            <div className="grid grid-cols-2 gap-2" data-testid="compare-side">
              {pair.map((p, i) => (
                <figure key={p.id} className="min-w-0">
                  <img src={p.dataUrl} alt={`${i === 0 ? 'Antes' : 'Después'}: ${POSE_LABEL[p.pose]}, ${formatDateEs(p.date, 'long')}`} className="w-full rounded-xl" />
                  <figcaption className="mt-1 text-center text-xs text-muted">
                    {i === 0 ? 'Antes' : 'Después'} · {formatDateEs(p.date)}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div data-testid="compare-overlay">
              <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl bg-surface2" style={{ aspectRatio: `${pair[0].width} / ${pair[0].height}` }}>
                <img src={pair[0].dataUrl} alt={`Antes: ${formatDateEs(pair[0].date, 'long')}`} className="absolute inset-0 h-full w-full object-contain" />
                <img src={pair[1].dataUrl} alt={`Después: ${formatDateEs(pair[1].date, 'long')}`} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
                <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} aria-hidden />
              </div>
              <div className="mx-auto mt-2 max-w-sm">
                <label className="label" htmlFor="overlay-slider">
                  Deslizador: {formatDateEs(pair[1].date)} (izquierda) · {formatDateEs(pair[0].date)} (derecha)
                </label>
                <input id="overlay-slider" type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-full accent-[rgb(var(--body))]" data-testid="overlay-slider" />
              </div>
            </div>
          )}

          <div className="metric-strip grid-cols-2" data-testid="compare-stats">
            <div className="bg-surface p-3">
              <div className="text-[11px] text-muted">Tiempo entre fotos</div>
              <div className="readout text-[24px]">
                {days}
                <span className="ml-1 text-xs font-medium text-muted">{days === 1 ? 'día' : 'días'}</span>
              </div>
            </div>
            <div className="bg-surface p-3">
              <div className="text-[11px] text-muted">Cambio de peso</div>
              <div className="readout text-[24px]">{kgText ?? '—'}</div>
              {kgText === null ? <div className="text-[10px] text-faint">Falta el peso en una de las fechas</div> : <div className="text-[10px] text-faint">Solo como contexto</div>}
            </div>
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted">Cargando…</p>
      )}
    </Sheet>
  )
}
