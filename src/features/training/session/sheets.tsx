import { useSaveGuard } from './saveGuard'
import { useRef, type KeyboardEvent } from 'react'
import { useRepo } from '../../../app/profile'
import { updateProfile } from '../../../db/profiles'
import type { ExerciseSet, Profile, SessionExercise, TrainingSettings } from '../../../db/types'
import { setKind, SET_KIND_SHORT, type SetKind } from '../../../domain/setKind'
import { enableRestNotifications, resetRestNotificationPrompt } from '../../../integrations/notifications'
import { Icon, type IconName } from '../../../ui/Icon'
import { Segmented, Sheet, Toggle } from '../../../ui/kit'
import { Stepper } from '../../../ui/Stepper'
import { rovingIndex } from '../../../ui/roving'
import { formatDuration } from '../sets'
import { updateSessionExercise } from '../session'
import { useSetNoteDraft } from '../useSetDraft'
import { REST_PRESETS } from './model'
import { KIND_TONE } from './kinds'
import { wakeLockSupported } from './useWakeLock'

// ───────────── Set type menu ─────────────

const KIND_ITEMS: { kind: SetKind; label: string; hint: string }[] = [
  { kind: 'normal', label: 'Normal', hint: 'Cuenta en volumen y récords' },
  { kind: 'warmup', label: 'Calentamiento', hint: 'No cuenta en volumen ni récords' },
  { kind: 'drop', label: 'Descendente', hint: 'Bajando el peso sin descanso' },
  { kind: 'failure', label: 'Al fallo', hint: 'Hasta no poder otra repetición' },
]

/**
 * Menu of one set (opened from its type/number cell): set type, note, delete. Same contract as the kit
 * Menu (role="menu", arrow keys, Escape), drawn as an action sheet: the kit Menu only opens from its own
 * icon button, and here the trigger is the set number (reported as a kit gap).
 */
export function SetMenuSheet({
  set,
  title,
  onClose,
  onKind,
  onNote,
  onDelete,
  onPlates,
}: {
  set: ExerciseSet | null
  title: string
  onClose: () => void
  onKind: (kind: SetKind) => void
  onNote: () => void
  onDelete: () => void
  /** Barbell exercises only: opens the plate calculator for this set. */
  onPlates?: () => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = set ? setKind(set) : 'normal'
  const count = KIND_ITEMS.length + 2 + (onPlates ? 1 : 0)
  const at = KIND_ITEMS.length + (onPlates ? 1 : 0)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((el) => el === document.activeElement)
    const next = rovingIndex({ key: e.key, index: from, count, orientation: 'vertical' })
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
  }
  const item = 'flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left outline-none hover:bg-surface2 focus-visible:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent'
  return (
    <Sheet open={!!set} onClose={onClose} title={title}>
      <div role="menu" aria-label={title} onKeyDown={onKey} className="flex flex-col gap-0.5 pb-2" data-testid="set-menu">
        {KIND_ITEMS.map((k, i) => (
          <button
            key={k.kind}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="menuitemradio"
            aria-checked={current === k.kind}
            data-autofocus={current === k.kind ? '' : undefined}
            className={item}
            onClick={() => onKind(k.kind)}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-body font-bold ${KIND_TONE[k.kind]}`} aria-hidden>
              {k.kind === 'normal' ? '1' : SET_KIND_SHORT[k.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium">{k.label}</span>
              <span className="block text-label text-muted">{k.hint}</span>
            </span>
            {current === k.kind ? <Icon name="check" size={20} className="text-accent" strokeWidth={2.4} /> : null}
          </button>
        ))}
        <div className="my-1 border-t border-line" role="separator" />
        {onPlates ? (
          <MenuRow icon="dumbbell" label="Discos para este peso" onClick={onPlates} refFn={(el) => { refs.current[KIND_ITEMS.length] = el }} className={item} />
        ) : null}
        <MenuRow icon="pencil" label={set?.notes ? 'Editar nota de la serie' : 'Nota de la serie'} onClick={onNote} refFn={(el) => { refs.current[at] = el }} className={item} />
        <MenuRow icon="trash" label="Eliminar serie" danger onClick={onDelete} refFn={(el) => { refs.current[at + 1] = el }} className={item} />
      </div>
    </Sheet>
  )
}

function MenuRow({ icon, label, danger, onClick, refFn, className }: { icon: IconName; label: string; danger?: boolean; onClick: () => void; refFn: (el: HTMLButtonElement | null) => void; className: string }) {
  return (
    <button ref={refFn} type="button" role="menuitem" className={`${className} ${danger ? 'text-bad' : ''}`} onClick={onClick}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden>
        <Icon name={icon} size={20} className={danger ? 'text-bad' : 'text-muted'} />
      </span>
      <span className="text-body font-medium">{label}</span>
    </button>
  )
}

// ───────────── Set note ─────────────

export function SetNoteSheet({ set, title, onClose }: { set: ExerciseSet | null; title: string; onClose: () => void }) {
  return (
    <Sheet open={!!set} onClose={onClose} title={title}>
      {set ? <SetNoteBody set={set} onClose={onClose} /> : null}
    </Sheet>
  )
}

function SetNoteBody({ set, onClose }: { set: ExerciseSet; onClose: () => void }) {
  const r = useRepo()
  const note = useSetNoteDraft(r, set)
  return (
    <div className="pb-2">
      <textarea className="field min-h-[96px] resize-none" data-autofocus placeholder="Técnica, molestias, agarre…" aria-label="Nota de la serie" {...note.bind()} />
      <p className="mt-1.5 text-label text-muted">Se guarda mientras escribes.</p>
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        onClick={async () => {
          await note.flush()
          onClose()
        }}
      >
        Listo
      </button>
    </div>
  )
}

// ───────────── Per-exercise rest ─────────────

export function RestEditSheet({ sessionId, item, onClose }: { sessionId: string; item: SessionExercise | null; onClose: () => void }) {
  const r = useRepo()
  const guard = useSaveGuard()
  const set = (restSec: number) => item && void guard(updateSessionExercise(r, sessionId, item.exerciseId, { restSec }))
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? `Descanso · ${item.name}` : 'Descanso'}>
      {item ? (
        <div className="pb-2">
          <p className="readout text-center text-[56px]" aria-live="polite">
            {item.restSec ? formatDuration(item.restSec) : 'Sin descanso'}
          </p>
          <div className="mt-4">
            <Stepper label="Segundos de descanso" value={item.restSec} onChange={set} step={15} min={0} max={900} unit="s" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Valores frecuentes">
            {[0, ...REST_PRESETS].map((s) => (
              <button key={s} type="button" className={`chip ${item.restSec === s ? 'chip-on' : ''}`} aria-pressed={item.restSec === s} onClick={() => set(s)}>
                {s ? formatDuration(s) : 'Sin descanso'}
              </button>
            ))}
          </div>
          <p className="mt-3 text-label text-muted">Se aplica a este ejercicio en esta sesión. El descanso empieza solo al completar una serie de trabajo.</p>
          <button type="button" className="btn-primary mt-4 w-full" onClick={onClose}>
            Listo
          </button>
        </div>
      ) : null}
    </Sheet>
  )
}

// ───────────── Training settings ─────────────

export function TrainingSettingsSheet({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: Profile }) {
  const t = profile.settings.training ?? {}
  const guard = useSaveGuard()
  const save = (patch: Partial<TrainingSettings>) => guard(updateProfile(profile.id, { settings: { ...profile.settings, training: { ...profile.settings.training, ...patch } } }))
  return (
    <Sheet open={open} onClose={onClose} title="Ajustes del entreno">
      <div className="divide-rows pb-2" data-testid="training-settings">
        <Toggle label="Empezar el descanso al completar una serie" description="Solo en series de trabajo, con el descanso de cada ejercicio." checked={t.autoRest !== false} onChange={(v) => void save({ autoRest: v })} />
        <div className="py-3">
          <span className="block text-sm font-medium" id="effort-label">
            Columna de esfuerzo
          </span>
          <span className="mb-2 mt-0.5 block text-xs text-muted">RPE: esfuerzo de 1 a 10. RIR: repeticiones que te quedaban.</span>
          <Segmented
            ariaLabel="Columna de esfuerzo"
            value={t.effort ?? 'none'}
            onChange={(v) => void save({ effort: v })}
            options={[
              { value: 'none', label: 'Ninguna' },
              { value: 'rpe', label: 'RPE' },
              { value: 'rir', label: 'RIR' },
            ]}
          />
        </div>
        <Toggle
          label="Aviso al terminar el descanso"
          description="Vibración y sonido con la app abierta; notificación si lo permites."
          checked={t.restAlert !== false}
          onChange={(v) => {
            void save({ restAlert: v })
            if (v) {
              // Switching it back on may ask once more (the system still decides).
              resetRestNotificationPrompt()
              void enableRestNotifications()
            }
          }}
        />
        {wakeLockSupported() ? (
          <Toggle label="Mantener la pantalla encendida" description="Mientras la sesión está abierta en pantalla." checked={t.keepAwake === true} onChange={(v) => void save({ keepAwake: v })} />
        ) : null}
      </div>
    </Sheet>
  )
}

