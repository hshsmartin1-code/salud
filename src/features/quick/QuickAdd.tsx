/**
 * The app's universal "+" ("Registrar"): one sheet, reachable from any screen, that never navigates for the
 * frequent in-place logs. Row 1 holds the two big needs (food for the meal of the hour, training: continue
 * the session in progress or start the habitual routine in one tap through the same path as Hoy/Entreno).
 * Below, water containers log in one tap; weight, sleep, blood pressure, glucose and activity open the
 * existing Salud quick sheets (QuickLogHost) on top of the current screen, each with its undo toast; the
 * rest are links to their full forms.
 */
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile, useRepo } from '../../app/profile'
import type { Routine, TrainingSession } from '../../db/types'
import { useToday } from '../../app/useToday'
import { formatNumber } from '../../domain/units'
import { Icon } from '../../ui/Icon'
import { Sheet } from '../../ui/kit'
import { QuickLogHost, type QuickTarget } from '../health/QuickLog'
import { useSavedToast } from '../health/useSavedToast'
import { addWater } from '../health/writers'
import { containersOf } from '../hydration/containers'
import { useMealSlots } from '../nutrition/useMealSlots'
import { searchPath } from '../nutrition/paths'
import { offeredRoutine } from '../training/plan/startSuggestion'
import { useStartSuggestion } from '../training/plan/useStartSuggestion'
import { useStartTraining } from '../training/shared/useStartTraining'
import { useActiveSession } from '../training/useTraining'
import { QUICK_LINKS, QUICK_SHEETS } from './entries'
import { useLatestWeight } from './useLatestWeight'

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-accent'
const TILE = `flex min-h-[48px] min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-left text-label font-medium text-ink transition-colors duration-state hover:bg-surface2/60 active:bg-surface2 ${FOCUS}`
const CHIP = `flex min-h-[56px] min-w-0 flex-col items-center justify-center rounded-xl border border-line bg-surface px-1 transition-colors duration-state hover:bg-surface2/60 active:bg-surface2 ${FOCUS}`
const BIG = `flex min-h-[88px] min-w-0 flex-1 flex-col items-start justify-between gap-2 rounded-2xl border p-3 text-left transition-colors duration-state ${FOCUS}`
const SMALL = `flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-label font-medium text-muted transition-colors duration-state hover:bg-surface2/60 hover:text-ink ${FOCUS}`

/** Mount once (in the app shell). `open` shows the "Registrar" sheet; the Salud sheets it opens live here too. */
export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = useRepo()
  const profile = useProfile()
  const nav = useNavigate()
  const saved = useSavedToast()
  const start = useStartTraining()
  const [target, setTarget] = useState<QuickTarget | null>(null)
  const latestWeight = useLatestWeight(open || target?.kind === 'weight')

  const go = (to: string) => {
    onClose()
    nav(to)
  }
  const sheet = (t: QuickTarget) => {
    // Same render: the "+" sheet closes (its focus returns to "+") and the Salud sheet opens on top.
    onClose()
    setTarget(t)
  }
  const water = async (ml: number, drink: string) => {
    onClose()
    saved(`+${formatNumber(ml, 0)} ml de agua`, await addWater(r, ml, drink))
  }
  const train = (routine?: Routine) => {
    onClose()
    void start(routine)
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Registrar">
        {open ? (
          <QuickAddBody
            containers={containersOf(profile.settings)}
            onGo={go}
            onSheet={sheet}
            onWater={(ml, drink) => void water(ml, drink)}
            onTrain={train}
          />
        ) : null}
      </Sheet>
      <QuickLogHost target={target} onTarget={setTarget} latestWeight={latestWeight} />
    </>
  )
}

function useTrainingChoice(): { active: TrainingSession | null; habitual: Routine | null; planned: boolean } | undefined {
  const active = useActiveSession()
  const suggestion = useStartSuggestion()
  if (active === undefined || suggestion === undefined) return undefined
  // Today's planned routine when the plan asks for one, else the habitual routine (see startSuggestion).
  return { active, habitual: offeredRoutine(suggestion), planned: suggestion.kind === 'planned' }
}

function QuickAddBody({
  containers,
  onGo,
  onSheet,
  onWater,
  onTrain,
}: {
  containers: { label: string; ml: number }[]
  onGo: (to: string) => void
  onSheet: (t: QuickTarget) => void
  onWater: (ml: number, drink: string) => void
  onTrain: (routine?: Routine) => void
}) {
  const today = useToday()
  const { now: mealSlot } = useMealSlots()
  const meal = mealSlot.key
  const training = useTrainingChoice()
  return (
    <div className="space-y-4 pb-2" data-testid="plus-sheet">
      {/* Row 1: the two most frequent needs */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <button type="button" className={`${BIG} border-line bg-surface hover:bg-surface2/60`} onClick={() => onGo(searchPath(today, meal, today))} aria-label={`Comida: buscar para ${mealSlot.label}`} data-testid="plus-meal">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon name="utensils" size={18} />
            </span>
            <span className="min-w-0 max-w-full">
              <span className="block text-body font-semibold text-ink">Comida</span>
              <span className="block truncate text-label text-muted">{mealSlot.label}</span>
            </span>
          </button>
          <button type="button" className={SMALL} onClick={() => onGo('/comida/buscar?scan=1')} data-testid="plus-barcode">
            <Icon name="barcode" size={16} className="shrink-0" />
            <span className="truncate">Código de barras</span>
          </button>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <TrainingTile training={training} onGo={onGo} onTrain={onTrain} />
          <button type="button" className={SMALL} onClick={() => onGo('/entreno?iniciar=1')} data-testid="plus-choose-routine">
            <Icon name="list" size={16} className="shrink-0" />
            <span className="truncate">Elegir rutina</span>
          </button>
        </div>
      </div>

      {/* Water: one tap per container */}
      <Group title="Agua">
        <div className="grid grid-cols-3 gap-2">
          {containers.map((c) => (
            <button
              key={c.ml}
              type="button"
              className={`${CHIP} border-accent/30`}
              onClick={() => onWater(c.ml, c.label.toLowerCase())}
              aria-label={`Agua: añadir ${formatNumber(c.ml, 0)} ml (${c.label})`}
              data-testid={`plus-water-${c.ml}`}
            >
              <span className="num flex items-center gap-1 whitespace-nowrap text-body font-semibold text-ink">
                <Icon name="droplet" size={15} className="shrink-0 text-accent" />+{formatNumber(c.ml, 0)} ml
              </span>
              <span className="max-w-full truncate text-label text-muted">{c.label}</span>
            </button>
          ))}
          <button type="button" className={CHIP} onClick={() => onSheet({ kind: 'water' })} aria-label="Agua: otra cantidad" data-testid="plus-water-other">
            <span className="text-body font-semibold text-ink">Otra</span>
            <span className="text-label text-muted">cantidad</span>
          </button>
        </div>
      </Group>

      <Group title="Salud">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_SHEETS.map((s) => (
            <button key={s.kind} type="button" className={TILE} onClick={() => onSheet({ kind: s.kind, vital: s.vital })} data-testid={`plus-${s.kind}`}>
              <Icon name={s.icon} size={18} className="shrink-0 text-muted" />
              <span className="min-w-0 break-words leading-tight">{s.label}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Más">
        <div className="grid grid-cols-2 gap-2">
          {QUICK_LINKS.map((l) => (
            <button key={l.to} type="button" className={TILE} onClick={() => onGo(l.to)} data-testid="plus-link" data-to={l.to}>
              <Icon name={l.icon} size={18} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 break-words leading-tight">{l.label}</span>
              <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
            </button>
          ))}
        </div>
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-label font-medium text-muted">{title}</h3>
      {children}
    </section>
  )
}

function TrainingTile({ training, onGo, onTrain }: { training: ReturnType<typeof useTrainingChoice>; onGo: (to: string) => void; onTrain: (routine?: Routine) => void }) {
  const tone = 'border-accent/40 bg-accent/10 hover:border-accent'
  const body = (secondary: string) => (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-ink-contrast">
        <Icon name={training?.active ? 'play' : 'dumbbell'} size={18} />
      </span>
      <span className="min-w-0 max-w-full">
        <span className="block text-body font-semibold text-ink">Entrenamiento</span>
        <span className="line-clamp-2 block break-words text-label text-muted">{secondary}</span>
      </span>
    </>
  )
  if (!training)
    return (
      <button type="button" className={`${BIG} ${tone}`} disabled aria-busy="true" data-testid="plus-training">
        {body('Cargando…')}
      </button>
    )
  const { active, habitual, planned } = training
  if (active)
    return (
      <button type="button" className={`${BIG} ${tone}`} onClick={() => onGo(`/entreno/sesion/${active.id}`)} aria-label={`Continuar ${active.name}`} data-testid="plus-training" data-mode="continue">
        {body(`Continuar ${active.name}`)}
      </button>
    )
  if (habitual)
    return (
      <button type="button" className={`${BIG} ${tone}`} onClick={() => onTrain(habitual)} aria-label={`Iniciar ${habitual.name}`} data-testid="plus-training" data-mode="start">
        {body(planned ? `Iniciar · ${habitual.name}` : `Iniciar ${habitual.name}`)}
      </button>
    )
  return (
    <button type="button" className={`${BIG} ${tone}`} onClick={() => onTrain()} aria-label="Iniciar entrenamiento libre" data-testid="plus-training" data-mode="free">
      {body('Entrenamiento libre')}
    </button>
  )
}
