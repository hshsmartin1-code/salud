import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfile, useProfiles, useRepo } from '../../app/profile'
import { db } from '../../db/schema'
import type { HealthCategory, HealthMetric, HealthRecord } from '../../db/types'
import { APP_TZ, formatDateEs } from '../../domain/dates'
import {
  CATEGORIES,
  connect,
  disableCategory,
  disconnect,
  enableCategory,
  errMsg,
  getLinkedProfileId,
  grantedCategories,
  HealthConnect,
  integrationId,
  LinkError,
  runSync,
  type HcStatus,
  type HealthConnectPlugin,
} from '../../integrations/health-connect'
import { METRIC_LABELS, METRIC_ORDER, rowSubtitle, rowTitle } from '../../integrations/health-connect/format'
import { Icon, type IconName } from '../../ui/Icon'
import { Badge, Card, EmptyState, ListRow, PageHeader, Sheet, Toggle } from '../../ui/kit'

const PAGE = 40

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-CO', { timeZone: APP_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    : 'Nunca'

const METRIC_ICON: Record<HealthMetric, IconName> = {
  steps: 'activity',
  activeKcal: 'flame',
  totalKcal: 'flame',
  distanceM: 'activity',
  restingHr: 'heart',
  heartRateAvg: 'heart',
  exercise: 'dumbbell',
  sleep: 'bed',
  weight: 'scale',
  bodyFat: 'scale',
  leanMassKg: 'scale',
}

const UNAVAILABLE_TEXT: Record<string, { title: string; body: string }> = {
  web: {
    title: 'Disponible solo en la app Android',
    body: 'Health Connect es un servicio del teléfono Android: una página web no puede leerlo. Instala la app de Salud en Android para importar pasos, sueño, peso y entrenamientos. Aquí no hay nada que conectar.',
  },
  'android-version': {
    title: 'Tu Android es demasiado antiguo',
    body: 'Health Connect necesita Android 9 o superior.',
  },
  'not-installed': {
    title: 'Falta instalar Health Connect',
    body: 'En Android 9 a 13 es una app gratuita de Google Play. En Android 14 o superior ya viene incluida.',
  },
  'update-required': {
    title: 'Health Connect necesita una actualización',
    body: 'Actualízalo desde Google Play y vuelve aquí.',
  },
  unknown: {
    title: 'Health Connect no está disponible',
    body: 'Este dispositivo o perfil de usuario no permite usarlo.',
  },
}

export function HealthConnectPage({ plugin = HealthConnect }: { plugin?: HealthConnectPlugin } = {}) {
  const profile = useProfile()
  const { profiles } = useProfiles()
  const r = useRepo()

  const [status, setStatus] = useState<HcStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [picked, setPicked] = useState<HealthCategory[]>([])
  const [offFor, setOffFor] = useState<HealthCategory | null>(null)
  const [offDelete, setOffDelete] = useState(false)
  const [discOpen, setDiscOpen] = useState(false)
  const [discDelete, setDiscDelete] = useState(false)
  const [filter, setFilter] = useState<HealthMetric | 'all'>('all')
  const [limit, setLimit] = useState(PAGE)

  const state = useLiveQuery(() => r.get('integrations', integrationId(profile.id)), [profile.id], undefined)
  const linkedId = useLiveQuery(() => getLinkedProfileId(db), [], undefined)
  const rows = useLiveQuery(() => r.all('healthRecords'), [profile.id], undefined)

  const refreshStatus = useCallback(() => {
    plugin
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus({ available: false, reason: 'unknown' }))
  }, [plugin])
  useEffect(() => {
    refreshStatus()
    // coming back from Google Play / Health Connect settings
    const onVisible = () => document.visibilityState === 'visible' && refreshStatus()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshStatus])

  const linkedName = useMemo(() => profiles?.find((p) => p.id === linkedId)?.name ?? null, [profiles, linkedId])
  const connected = state?.status === 'connected' && linkedId === profile.id
  const linkedOther = !!linkedId && linkedId !== profile.id
  const grantedCats = useMemo(() => new Set(grantedCategories(state?.grantedPermissions ?? [])), [state?.grantedPermissions])

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const msg = await fn()
      if (msg) setNotice(msg)
    } catch (e) {
      setError(e instanceof LinkError ? e.message : errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  const deps = { plugin, db }

  const doConnect = () =>
    act('connect', async () => {
      const st = await connect(deps, profile.id, picked)
      if (!st) return 'No se concedió ningún permiso. No se conectó nada.'
      const res = await runSync(deps, profile.id)
      return res.ok ? 'Conectado y sincronizado.' : 'Conectado, pero la primera sincronización tuvo avisos (ver abajo).'
    })
  const doSync = () =>
    act('sync', async () => {
      const res = await runSync(deps, profile.id)
      return res.ok ? 'Sincronizado.' : undefined
    })
  const doEnable = (c: HealthCategory) =>
    act(`on-${c}`, async () => {
      const ok = await enableCategory(deps, profile.id, c)
      if (!ok) return 'No se concedieron todos los permisos de esa categoría.'
      await runSync(deps, profile.id)
      return 'Categoría activada.'
    })
  const doDisable = () =>
    act('off', async () => {
      if (!offFor) return
      const n = await disableCategory(deps, profile.id, offFor, offDelete)
      setOffFor(null)
      setOffDelete(false)
      return n ? `Categoría desactivada y ${n} registros borrados.` : 'Categoría desactivada. Los datos ya importados se conservan.'
    })
  const doDisconnect = () =>
    act('disc', async () => {
      const res = await disconnect(deps, profile.id, discDelete)
      setDiscOpen(false)
      setDiscDelete(false)
      const parts = ['Desconectado.']
      if (res.deleted) parts.push(`${res.deleted} registros importados borrados.`)
      if (res.revokeFailed) parts.push('No se pudieron revocar los permisos: quítalos en Ajustes > Health Connect.')
      return parts.join(' ')
    })

  const present = useMemo(() => {
    const set = new Set((rows ?? []).map((x) => x.metric))
    return METRIC_ORDER.filter((m) => set.has(m))
  }, [rows])
  const shown = useMemo(() => {
    const list = (rows ?? []).filter((x) => filter === 'all' || x.metric === filter)
    return list.sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? '').localeCompare(a.start ?? '') || a.metric.localeCompare(b.metric))
  }, [rows, filter])
  const toggleExcluded = (row: HealthRecord) => void r.update('healthRecords', row.id, { excluded: !row.excluded })

  const available = status?.available === true
  const unavailableKey = status && !status.available ? (status.reason ?? 'unknown') : null
  const lastLog = state?.log[0]

  return (
    <div data-testid="health-connect" className="pb-8">
      <PageHeader
        title="Health Connect"
        subtitle="Importa tus datos del teléfono. Solo lectura: Salud nunca escribe en Health Connect, y todo se queda en este dispositivo."
      />

      {/* availability */}
      <section data-testid="hc-status" aria-label="Disponibilidad" className="mb-4">
        {!status ? (
          <div className="card h-24 animate-pulse" />
        ) : available ? (
          <Card className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-good/10 text-good">
              <Icon name="check" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Health Connect disponible</div>
              <div className="text-sm text-muted">
                {connected ? `Conectado al perfil ${profile.name}.` : linkedOther ? `Vinculado a ${linkedName ?? 'otro perfil'}.` : 'Sin conectar.'}
              </div>
            </div>
            <Badge tone={connected ? 'good' : 'muted'}>{connected ? 'Conectado' : 'Desconectado'}</Badge>
          </Card>
        ) : (
          <EmptyState
            icon={unavailableKey === 'web' ? 'info' : 'alert'}
            title={UNAVAILABLE_TEXT[unavailableKey ?? 'unknown']?.title ?? UNAVAILABLE_TEXT.unknown!.title}
            action={
              unavailableKey === 'not-installed' || unavailableKey === 'update-required' ? (
                <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void act('install', () => plugin.openInstallOrUpdate())}>
                  <Icon name="download" size={16} /> {unavailableKey === 'not-installed' ? 'Instalar Health Connect' : 'Actualizar Health Connect'}
                </button>
              ) : undefined
            }
          >
            {UNAVAILABLE_TEXT[unavailableKey ?? 'unknown']?.body}
          </EmptyState>
        )}
      </section>

      {error ? (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/5 px-3 py-3 text-sm text-bad">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-good/40 bg-good/5 px-3 py-3 text-sm text-good">
          <Icon name="check" size={18} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      {available && linkedOther ? (
        <Card className="mb-4 space-y-2 border-warn/40">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="link" size={18} /> Health Connect ya está vinculado
          </div>
          <p className="text-sm text-muted">
            Los datos de Health Connect pertenecen al dueño de este teléfono y solo pueden vincularse a un perfil. Ahora están vinculados a <strong className="text-ink">{linkedName ?? 'otro perfil'}</strong>. Para
            usarlos con <strong className="text-ink">{profile.name}</strong>, primero desconéctalos desde el perfil de {linkedName ?? 'ese perfil'}.
          </p>
        </Card>
      ) : null}

      {/* consent */}
      {available && !linkedOther ? (
        <section className="mb-4" aria-labelledby="hc-cats">
          <h2 id="hc-cats" className="section-title mb-2">
            Qué importar
          </h2>
          <Card className="divide-y divide-line !p-0">
            {CATEGORIES.map((c) => {
              const enabled = connected ? !!state?.categories[c.id] : picked.includes(c.id)
              const lacksPermission = connected && enabled && !grantedCats.has(c.id)
              return (
                <div key={c.id} className="px-4 py-2">
                  <div className="flex items-center gap-2 pt-1 text-sm font-semibold">
                    <Icon name={c.icon} size={16} className="text-muted" /> {c.label}
                    {connected && enabled && grantedCats.has(c.id) ? <Badge tone="good">Permiso concedido</Badge> : null}
                    {lacksPermission ? <Badge tone="warn">Sin permiso</Badge> : null}
                  </div>
                  <Toggle
                    checked={enabled}
                    label={enabled ? 'Importando' : 'No importar'}
                    description={c.description}
                    onChange={(on) => {
                      if (busy) return
                      if (!connected) setPicked((p) => (on ? [...p, c.id] : p.filter((x) => x !== c.id)))
                      else if (on) void doEnable(c.id)
                      else {
                        setOffDelete(false)
                        setOffFor(c.id)
                      }
                    }}
                  />
                  {lacksPermission ? (
                    <button type="button" className="btn-ghost -ml-2 mb-1 text-sm" onClick={() => void act('open', () => plugin.openSettings())}>
                      Revisar permisos en Health Connect
                    </button>
                  ) : null}
                </div>
              )
            })}
          </Card>
          {!connected ? (
            <div className="mt-3 space-y-2">
              <p className="flex items-start gap-2 text-sm text-muted">
                <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
                Se vincularán al perfil <strong className="text-ink">{profile.name}</strong>. Android te pedirá permiso por separado. Se leen los últimos 30 días; no se pide historial más antiguo ni
                lectura en segundo plano, y no se usan las calorías totales.
              </p>
              <button type="button" className="btn-primary w-full sm:w-auto" disabled={picked.length === 0 || !!busy} onClick={() => void doConnect()}>
                <Icon name="link" size={16} /> {busy === 'connect' ? 'Conectando…' : 'Conectar y pedir permisos'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* sync */}
      {connected && state ? (
        <section className="mb-4" aria-labelledby="hc-sync">
          <h2 id="hc-sync" className="section-title mb-2">
            Sincronización
          </h2>
          <Card className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Última vez</dt>
                <dd className="num font-medium">{fmtDateTime(state.lastSyncAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Periodo</dt>
                <dd className="num font-medium">{state.lastSyncFrom && state.lastSyncTo ? `${formatDateEs(state.lastSyncFrom)} – ${formatDateEs(state.lastSyncTo)}` : '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Resultado</dt>
                <dd className="num font-medium">
                  {lastLog?.counts
                    ? `${lastLog.counts.diarios ?? 0} totales diarios · ${lastLog.counts.registros ?? 0} registros · ${lastLog.counts.borrados ?? 0} borrados`
                    : 'Aún no sincronizado'}
                </dd>
              </div>
            </dl>
            {state.lastError ? (
              <p role="alert" className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
                {state.lastError}
              </p>
            ) : null}
            <p className="text-xs text-muted">
              Las calorías activas son solo las de actividad, nunca el gasto total, y no se suman a las de los entrenamientos ni a tu meta de comida. Sincroniza a mano cuando quieras; nada corre en segundo plano.
            </p>
            <button type="button" className="btn-primary w-full sm:w-auto" disabled={!!busy} onClick={() => void doSync()}>
              <Icon name="refresh" size={16} /> {busy === 'sync' ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            {state.log.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Registro de sincronización</summary>
                <ul className="mt-2 space-y-1">
                  {state.log.slice(0, 6).map((l) => (
                    <li key={l.at} className="flex items-start gap-2">
                      <Icon name={l.ok ? 'check' : 'alert'} size={14} className={`mt-0.5 shrink-0 ${l.ok ? 'text-good' : 'text-warn'}`} />
                      <span className="min-w-0">
                        <span className="num text-xs text-muted">{fmtDateTime(l.at)}</span> {l.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        </section>
      ) : null}

      {/* review */}
      {rows && rows.length > 0 ? (
        <section className="mb-4" aria-labelledby="hc-review">
          <h2 id="hc-review" className="section-title mb-1">
            Datos importados
          </h2>
          <p className="mb-2 text-sm text-muted">Nunca se mezclan con lo que registras a mano. Si algo no te cuadra, exclúyelo de las estadísticas; queda guardado pero no cuenta.</p>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por dato">
            <button type="button" className={`chip ${filter === 'all' ? 'chip-on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              Todo
            </button>
            {present.map((m) => (
              <button key={m} type="button" className={`chip ${filter === m ? 'chip-on' : ''}`} aria-pressed={filter === m} onClick={() => setFilter(m)}>
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>
          <Card className="divide-y divide-line !p-0">
            {shown.slice(0, limit).map((row) => (
              <ListRow
                key={row.id}
                icon={METRIC_ICON[row.metric]}
                title={<span className={row.excluded ? 'text-faint line-through' : ''}>{rowTitle(row)}</span>}
                subtitle={rowSubtitle(row, (d) => formatDateEs(d))}
                right={
                  <button
                    type="button"
                    className={`btn-ghost shrink-0 px-2 text-xs ${row.excluded ? 'text-warn' : ''}`}
                    aria-pressed={!!row.excluded}
                    aria-label={row.excluded ? `Incluir en estadísticas: ${rowTitle(row)}` : `Excluir de estadísticas: ${rowTitle(row)}`}
                    onClick={() => toggleExcluded(row)}
                  >
                    {row.excluded ? (
                      <>
                        <Icon name="x" size={14} /> Excluido
                      </>
                    ) : (
                      'Excluir'
                    )}
                  </button>
                }
              />
            ))}
          </Card>
          {shown.length > limit ? (
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Ver más ({shown.length - limit})
            </button>
          ) : null}
        </section>
      ) : connected ? (
        <EmptyState icon="download" title="Aún no hay datos importados">
          Pulsa «Sincronizar ahora». Si tu reloj o báscula no escriben en Health Connect, no habrá nada que importar.
        </EmptyState>
      ) : null}

      {/* disconnect */}
      {connected ? (
        <div className="mt-6">
          <button type="button" className="btn-danger w-full sm:w-auto" disabled={!!busy} onClick={() => setDiscOpen(true)}>
            <Icon name="x" size={16} /> Desconectar
          </button>
        </div>
      ) : null}

      <Sheet
        open={offFor !== null}
        onClose={() => setOffFor(null)}
        title={offFor ? `Dejar de importar: ${CATEGORIES.find((c) => c.id === offFor)?.label}` : ''}
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setOffFor(null)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary flex-1" disabled={!!busy} onClick={() => void doDisable()}>
              Desactivar
            </button>
          </div>
        }
      >
        <p className="mb-2 text-sm text-muted">Salud dejará de leer esta categoría de inmediato. El permiso de Android sigue concedido hasta que lo quites en Health Connect.</p>
        <Toggle checked={offDelete} onChange={setOffDelete} label="Borrar también lo ya importado de esta categoría" description="Por defecto se conserva." />
      </Sheet>

      <Sheet
        open={discOpen}
        onClose={() => setDiscOpen(false)}
        title="Desconectar Health Connect"
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setDiscOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger flex-1" disabled={!!busy} onClick={() => void doDisconnect()}>
              Desconectar
            </button>
          </div>
        }
      >
        <p className="mb-2 text-sm text-muted">Se revocan los permisos, se detiene la sincronización y este teléfono queda libre para vincularse a otro perfil.</p>
        <Toggle
          checked={discDelete}
          onChange={setDiscDelete}
          label="Borrar también los datos importados"
          description={discDelete ? 'Se borrarán todos los datos importados de este perfil. No se puede deshacer.' : 'Por defecto se conservan para tus estadísticas.'}
        />
      </Sheet>
    </div>
  )
}
