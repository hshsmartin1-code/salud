import { useMemo, useState } from 'react'
import { useProfile, useRepo } from '../../../app/profile'
import { updateProfile } from '../../../db/profiles'
import type { ExerciseSet, TrainingSettings } from '../../../db/types'
import { BARS, calcPlates, DEFAULT_BAR, describeSide, plateDenominations, plateIncrement, plateInventory, MAX_PAIRS } from '../../../domain/plates'
import { formatNumber } from '../../../domain/units'
import { Icon } from '../../../ui/Icon'
import { Segmented, Sheet } from '../../../ui/kit'
import { Stepper } from '../../../ui/Stepper'
import { useToast } from '../../../ui/Toast'
import { applyAndTouch } from '../sessionWork'
import { useSaveGuard } from './saveGuard'

const fmt = (n: number) => formatNumber(n, 2)

/** Plate calculator of one barbell set: plates per side for its weight, and "Usar este peso". */
export function PlateSheet({ set, title, onClose }: { set: ExerciseSet | null; title: string; onClose: () => void }) {
  return (
    <Sheet open={!!set} onClose={onClose} title={title}>
      {set ? <PlateBody key={set.id} set={set} onClose={onClose} /> : null}
    </Sheet>
  )
}

/** One side of the bar, heaviest plate next to the collar; height grows with the weight, the number is always printed. */
export function PlateStack({ perSide }: { perSide: readonly { plate: number; count: number }[] }) {
  const plates = perSide.flatMap((p) => Array.from({ length: p.count }, () => p.plate))
  const tone = (p: number) => (p >= 20 ? 'bg-ink text-ink-contrast border-ink' : p >= 10 ? 'bg-train text-ink-contrast border-train' : 'bg-surface2 text-ink border-line-strong')
  return (
    <div className="flex h-[112px] items-center overflow-x-auto rounded-2xl bg-surface2/60 px-3" role="img" aria-label={plates.length ? `Por lado: ${describeSide(perSide, fmt)} kilos` : 'Solo la barra'} data-testid="plate-stack">
      <div className="h-3 w-5 shrink-0 rounded-l bg-line-strong" aria-hidden />
      <div className="h-[72px] w-2 shrink-0 rounded-sm bg-line-strong" aria-hidden />
      {plates.map((p, i) => (
        <div
          key={i}
          className={`mr-[3px] flex w-[26px] shrink-0 items-center justify-center rounded-md border text-[11px] font-bold leading-none ${tone(p)}`}
          style={{ height: 36 + Math.round((p / 25) * 64) }}
          aria-hidden
          data-testid="plate"
        >
          <span className="num [writing-mode:vertical-rl]">{fmt(p)}</span>
        </div>
      ))}
      <div className="h-3 min-w-6 flex-1 rounded-r bg-line-strong" aria-hidden />
    </div>
  )
}

function PlateBody({ set, onClose }: { set: ExerciseSet; onClose: () => void }) {
  const r = useRepo()
  const profile = useProfile()
  const toast = useToast()
  const guard = useSaveGuard()
  const training = profile.settings.training ?? {}
  const bar = training.barKg ?? DEFAULT_BAR.kg
  const stock = useMemo(() => plateInventory(training.plates), [training.plates])
  const step = plateIncrement(stock)
  const [target, setTarget] = useState(set.weight && set.weight > 0 ? set.weight : bar)
  const [mine, setMine] = useState(false)
  const res = useMemo(() => calcPlates(target, bar, stock), [target, bar, stock])
  const save = (patch: Partial<TrainingSettings>) => guard(updateProfile(profile.id, { settings: { ...profile.settings, training: { ...profile.settings.training, ...patch } } }))

  const use = async () => {
    const { count } = await applyAndTouch(r, set.sessionId, [set.id], { weight: res.achieved })
    toast.show({ message: count ? `${fmt(res.achieved)} kg en la serie` : `La serie ya tenía ${fmt(res.achieved)} kg` })
    onClose()
  }

  return (
    <div className="pb-2" data-testid="plate-sheet">
      <PlateStack perSide={res.perSide} />
      <p className="mt-3 text-center text-heading" aria-live="polite" data-testid="plate-side">
        {res.perSide.length ? <>Por lado: {describeSide(res.perSide, fmt)}</> : 'Solo la barra'}
      </p>
      <p className="text-center text-label text-muted">
        Barra {fmt(bar)} kg · total <span className="num font-semibold text-ink">{fmt(res.achieved)} kg</span>
      </p>

      <div className="mt-4">
        <Stepper label="Peso total" value={target} onChange={setTarget} step={step} min={bar} max={600} unit="kg" />
      </div>
      {!res.exact ? (
        <div className="mt-2 rounded-xl bg-warn/10 px-3 py-2" role="status" data-testid="plate-inexact">
          <p className="text-label text-ink">Con tus discos no se puede cargar {fmt(target)} kg exactos.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {res.lower !== null && res.lower !== res.achieved ? (
              <button type="button" className="chip min-h-11" onClick={() => setTarget(res.lower!)}>
                Bajar a {fmt(res.lower)} kg
              </button>
            ) : null}
            {res.higher !== null && res.higher !== res.achieved ? (
              <button type="button" className="chip min-h-11" onClick={() => setTarget(res.higher!)}>
                Subir a {fmt(res.higher)} kg
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button type="button" className="btn-primary mt-4 w-full" onClick={() => void guard(use())} disabled={set.done} data-testid="plate-use">
        Usar este peso · {fmt(res.achieved)} kg
      </button>
      {set.done ? <p className="mt-1 text-center text-label text-muted">La serie ya está hecha: desmárcala para cambiar su peso.</p> : null}

      <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-between rounded-xl px-2 text-label font-semibold text-muted hover:bg-surface2 hover:text-ink" aria-expanded={mine} onClick={() => setMine((m) => !m)}>
        <span>Mi barra y mis discos</span>
        <Icon name={mine ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {mine ? (
        <div className="space-y-3 pt-1" data-testid="plate-inventory">
          <Segmented ariaLabel="Barra" value={String(bar)} onChange={(v) => void save({ barKg: Number(v) })} options={BARS.kg.map((b) => ({ value: String(b), label: `${b} kg` }))} />
          <ul className="divide-rows">
            {stock.map((s) => (
              <li key={s.plate} className="flex min-h-12 items-center gap-2 py-1">
                <span className="num min-w-0 flex-1 text-body font-medium">{fmt(s.plate)} kg</span>
                <button
                  type="button"
                  className="hit-44 flex h-11 w-11 items-center justify-center rounded-xl bg-surface2 disabled:opacity-40"
                  aria-label={`Menos pares de ${fmt(s.plate)} kg`}
                  disabled={s.pairs <= 0}
                  onClick={() => void save({ plates: { ...Object.fromEntries(stock.map((x) => [String(x.plate), x.pairs])), [String(s.plate)]: s.pairs - 1 } })}
                >
                  <Icon name="minus" size={18} />
                </button>
                <span className="num w-16 text-center text-body" aria-live="polite">
                  {s.pairs} {s.pairs === 1 ? 'par' : 'pares'}
                </span>
                <button
                  type="button"
                  className="hit-44 flex h-11 w-11 items-center justify-center rounded-xl bg-surface2 disabled:opacity-40"
                  aria-label={`Más pares de ${fmt(s.plate)} kg`}
                  disabled={s.pairs >= MAX_PAIRS}
                  onClick={() => void save({ plates: { ...Object.fromEntries(stock.map((x) => [String(x.plate), x.pairs])), [String(s.plate)]: s.pairs + 1 } })}
                >
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-label text-muted">Pares disponibles de cada disco ({plateDenominations('kg').length} tamaños). Se guarda en este perfil.</p>
        </div>
      ) : null}
    </div>
  )
}
