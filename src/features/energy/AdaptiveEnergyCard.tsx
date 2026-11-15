import { useState } from 'react'
import { useProfile, useRepo } from '../../app/profile'
import { updateProfile } from '../../db/profiles'
import type { StoredAdaptiveSettings } from '../../db/types'
import { CONFIDENCE_LABELS, MODE_LABELS, PHASE_LABELS, PHASE_RATE_LIMITS, type AdaptiveMode, type EnergyPhase } from '../../domain/adaptiveEnergy'
import { formatDateEs } from '../../domain/dates'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { Badge, Card, ScaleBar, Segmented, Sheet } from '../../ui/kit'
import { applyProposal, useAdaptiveEnergy } from './adaptive'

const RATES: Record<EnergyPhase, number[]> = { deficit: [-0.25, -0.5, -0.75, -1], maintenance: [0], surplus: [0.1, 0.25, 0.5] }
const f0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatNumber(Math.round(n / 10) * 10, 0))
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNumber(Math.abs(n), 2)} %`

/**
 * "Adaptación energética": formula TDEE vs. the estimate from this profile's own intake and weight logs,
 * with opt-in suggestions or automatic changes. Off by default; never presented as a measurement.
 */
export function AdaptiveEnergyCard() {
  const profile = useProfile()
  const r = useRepo()
  const s = useAdaptiveEnergy()
  const [autoAsk, setAutoAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  if (!s) return <div className="card h-40 animate-pulse" />

  const { settings, observed, proposal, formula, goal } = s
  const save = (patch: Partial<StoredAdaptiveSettings>) => {
    const next: StoredAdaptiveSettings = {
      mode: settings.mode,
      phase: settings.phase,
      targetRatePctPerWeek: settings.targetRatePctPerWeek,
      windowDays: settings.windowDays,
      maxStepKcal: settings.maxStepKcal,
      cooldownDays: settings.cooldownDays,
      minKcalFloor: s.stored?.minKcalFloor ?? null,
      ...patch,
    }
    return updateProfile(profile.id, { settings: { ...profile.settings, adaptive: next } })
  }
  const setMode = (m: AdaptiveMode) => {
    if (m === 'auto' && settings.mode !== 'auto') setAutoAsk(true)
    else void save({ mode: m })
  }
  const setPhase = (p: EnergyPhase) => void save({ phase: p, targetRatePctPerWeek: PHASE_RATE_LIMITS[p].default })

  const last = s.history[0] ?? null
  const canAccept = proposal && (proposal.status === 'suggest' || proposal.status === 'manual_locked' || proposal.status === 'auto_apply') && proposal.proposedKcal !== null
  const statusBadge =
    !observed ? null : observed.status === 'ok' ? (
      <Badge tone={observed.confidence === 'high' ? 'good' : observed.confidence === 'medium' ? 'accent' : 'warn'}>Confianza {CONFIDENCE_LABELS[observed.confidence]}</Badge>
    ) : observed.status === 'inconsistent' ? (
      <Badge tone="warn">Registros inconsistentes</Badge>
    ) : (
      <Badge tone="muted">Datos insuficientes</Badge>
    )

  return (
    <section aria-labelledby="adaptive-title" data-testid="adaptive-energy">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="adaptive-title" className="section-title">
          Adaptación energética
        </h2>
        {statusBadge}
      </div>
      <Card className="space-y-4">
        <div className="metric-strip grid-cols-3 overflow-hidden rounded-xl border border-line">
          <Readout label="Gasto por fórmula" value={f0(formula?.tdee)} sub={formula ? `TMB ${f0(formula.bmr)} × ${formatNumber(formula.factor, 3)}` : 'Faltan datos'} />
          <Readout
            label="Gasto adaptativo"
            value={observed?.status === 'ok' ? f0(observed.blendedTdee) : '—'}
            sub={observed?.status === 'ok' ? `Observado ${f0(observed.observedTdee)} ± ${f0(observed.observedSe)}` : 'Sin estimación aún'}
            testId="adaptive-tdee"
          />
          <Readout label="Meta actual" value={goal ? formatNumber(goal.kcal, 0) : '—'} sub={goal ? (goal.method === 'manual' ? 'Manual' : goal.adaptive ? 'Ajustada' : 'Calculada') : 'Sin objetivo'} />
        </div>

        {s.missing.length ? (
          <p className="text-sm text-muted">Para estimar el gasto falta {s.missing.join(', ')} en tu perfil o tus medidas.</p>
        ) : null}

        {observed ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>Días de comida válidos</span>
                <span className="num">
                  {observed.validIntakeDays} de {observed.requiredValidIntakeDays}
                </span>
              </div>
              <ScaleBar value={observed.validIntakeDays} target={observed.requiredValidIntakeDays} colorVar="accent" height={8} label="Días de comida válidos" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>Días con peso</span>
                <span className="num">
                  {observed.weighIns} de {settings.minWeighIns}
                </span>
              </div>
              <ScaleBar value={observed.weighIns} target={settings.minWeighIns} colorVar="accent" height={8} label="Días con peso" />
            </div>
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Item k="Fase" v={PHASE_LABELS[settings.phase]} />
          <Item k="Ritmo" v={settings.phase === 'maintenance' ? 'Mantener peso' : `${pct(settings.targetRatePctPerWeek)} / semana`} />
          <Item k="Periodo" v={observed ? `${formatDateEs(observed.window.from)} – ${formatDateEs(observed.window.to)}` : `${settings.windowDays} días`} />
          <Item k="Tendencia del peso" v={observed?.trendKgPerWeek !== null && observed?.trendKgPerWeek !== undefined ? `${observed.trendKgPerWeek > 0 ? '+' : ''}${formatNumber(observed.trendKgPerWeek, 2)} kg/sem` : '—'} />
          <Item k="Promedio ingerido" v={observed?.meanIntakeKcal ? `${f0(observed.meanIntakeKcal)} kcal` : '—'} />
          <Item k="Último ajuste" v={last ? `${formatDateEs(last.date)} (${last.applied === 'auto' ? 'automático' : 'aceptado'})` : 'Ninguno'} />
        </dl>

        {proposal ? (
          <div className={`rounded-xl px-3 py-3 text-sm ${canAccept ? 'border border-accent/40 bg-accent/5' : 'bg-surface2'}`} data-testid="adaptive-explanation">
            <p className="leading-relaxed">{proposal.explanation}</p>
            {canAccept ? (
              <button
                type="button"
                className="btn-primary mt-3 w-full sm:w-auto"
                disabled={busy}
                data-testid="adaptive-accept"
                onClick={async () => {
                  setBusy(true)
                  try {
                    const g = await applyProposal(r, s, 'accepted')
                    if (g) setDone(`Nueva meta: ${formatNumber(g.kcal, 0)} kcal desde hoy.`)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Icon name="check" size={16} /> Aplicar {formatNumber(proposal.proposedKcal as number, 0)} kcal
              </button>
            ) : null}
          </div>
        ) : observed && settings.mode === 'off' ? (
          <p className="text-sm text-muted">Activa «Sugerir» para recibir propuestas de ajuste. Nada cambia sin tu permiso.</p>
        ) : !goal ? (
          <p className="text-sm text-muted">Define un objetivo para poder proponer ajustes.</p>
        ) : null}
        {done ? <p className="text-sm text-good">{done}</p> : null}
        {observed && observed.excludedIntakeDays.length ? (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Días excluidos del cálculo ({observed.excludedIntakeDays.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {observed.excludedIntakeDays.map((d) => (
                <li key={d.date}>
                  {formatDateEs(d.date)}: {d.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="space-y-3 border-t border-line pt-4">
          <div>
            <span className="label" id="adaptive-mode">
              Modo
            </span>
            <Segmented<AdaptiveMode>
              value={settings.mode}
              onChange={setMode}
              ariaLabel="Modo de adaptación"
              options={(['off', 'suggest', 'auto'] as const).map((m) => ({ value: m, label: MODE_LABELS[m] }))}
            />
            <p className="mt-1 text-xs text-muted">
              {settings.mode === 'off'
                ? 'Solo se muestra la estimación; tu meta no cambia.'
                : settings.mode === 'suggest'
                  ? 'Se propone un cambio cuando hay datos suficientes; tú decides si aplicarlo.'
                  : 'Con confianza media o alta, la meta se ajusta sola (máx. ' + formatNumber(settings.maxStepKcal, 0) + ' kcal cada ' + settings.cooldownDays + ' días). Las metas manuales nunca se cambian solas.'}
            </p>
          </div>
          <div>
            <span className="label">Fase</span>
            <Segmented<EnergyPhase>
              value={settings.phase}
              onChange={setPhase}
              ariaLabel="Fase"
              options={(['deficit', 'maintenance', 'surplus'] as const).map((p) => ({ value: p, label: PHASE_LABELS[p] }))}
            />
          </div>
          {settings.phase !== 'maintenance' ? (
            <div>
              <span className="label">Ritmo por semana (% del peso corporal)</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Ritmo por semana">
                {RATES[settings.phase].map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={settings.targetRatePctPerWeek === v}
                    className={`chip ${settings.targetRatePctPerWeek === v ? 'chip-on' : ''}`}
                    onClick={() => void save({ targetRatePctPerWeek: v })}
                  >
                    {pct(v)}
                    {formula ? <span className="text-[11px] opacity-70">≈ {formatNumber((formula.weightKg * Math.abs(v)) / 100, 2)} kg</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <SmallChoice label="Ventana" value={settings.windowDays} options={[28, 42, 56]} unit="días" onChange={(v) => void save({ windowDays: v })} />
            <SmallChoice label="Cambio máx." value={settings.maxStepKcal} options={[100, 150, 200]} unit="kcal" onChange={(v) => void save({ maxStepKcal: v })} />
            <SmallChoice label="Espera" value={settings.cooldownDays} options={[14, 21, 28]} unit="días" onChange={(v) => void save({ cooldownDays: v })} />
          </div>
          <p className="text-xs text-faint">
            El gasto adaptativo combina tus promedios de comida con la tendencia del peso (≈ 7700 kcal por kg) y la fórmula. Es una estimación: no mide tu metabolismo. La actividad registrada no se suma, porque ya se refleja en el peso.
          </p>
        </div>

        {s.history.length ? (
          <details className="border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-medium">Historial de ajustes ({s.history.length})</summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {s.history.map((h) => (
                <li key={h.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    {formatDateEs(h.date)} · <span className="text-muted">{h.applied === 'auto' ? 'Automático' : 'Aceptado'}</span>
                  </span>
                  <span className="num">
                    {formatNumber(h.fromKcal, 0)} → <strong>{formatNumber(h.toKcal, 0)}</strong> kcal
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Sheet open={autoAsk} onClose={() => setAutoAsk(false)} title="¿Activar el ajuste automático?">
        <div className="space-y-2 text-sm text-muted">
          <p>Cuando haya datos suficientes y la confianza sea media o alta, la app cambiará tu meta de calorías sin preguntarte:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              como máximo {formatNumber(settings.maxStepKcal, 0)} kcal por ajuste y uno cada {settings.cooldownDays} días;
            </li>
            <li>nunca por debajo de tu mínimo de seguridad;</li>
            <li>nunca si tu objetivo actual es manual.</li>
          </ul>
          <p>Cada cambio queda en el historial y puedes volver a «Sugerir» o «Desactivado» cuando quieras.</p>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => setAutoAsk(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            data-testid="adaptive-auto-confirm"
            onClick={async () => {
              await save({ mode: 'auto' })
              setAutoAsk(false)
            }}
          >
            Activar automático
          </button>
        </div>
      </Sheet>
    </section>
  )
}

function Readout({ label, value, sub, testId }: { label: string; value: string; sub: string; testId?: string }) {
  return (
    <div className="bg-surface px-3 py-3">
      <div className="text-[12px] leading-tight text-muted">{label}</div>
      <div className="readout mt-1 text-[26px] leading-none" data-testid={testId}>
        {value}
        {value !== '—' ? <span className="ml-1 text-xs font-medium text-muted">kcal</span> : null}
      </div>
      <div className="mt-1 truncate text-[11px] text-faint">{sub}</div>
    </div>
  )
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="truncate font-medium">{v}</dd>
    </div>
  )
}

function SmallChoice({ label, value, options, unit, onChange }: { label: string; value: number; options: number[]; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="field py-2" value={options.includes(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))}>
        {options.includes(value) ? null : <option value="">{value}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o} {unit}
          </option>
        ))}
      </select>
    </label>
  )
}
