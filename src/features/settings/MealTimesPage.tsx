import { useState } from 'react'
import { IconButton } from '../../ui/IconButton'
import { PageHeader } from '../../ui/kit'
import { moveSlot, renameSlot, setSlotTime, slotNameMax, toggleSlot, toPrefs, type MealSlot } from '../nutrition/mealSlots'
import { useMealSlots } from '../nutrition/useMealSlots'
import type { MealKey } from '../../db/types'

function NameField({ slot, muted, onCommit }: { slot: MealSlot; muted: boolean; onCommit: (name: string) => void }) {
  const [text, setText] = useState(slot.renamed ? slot.label : '')
  const commit = () => {
    if (text.trim() !== (slot.renamed ? slot.label : '')) onCommit(text)
  }
  return (
    <input
      type="text"
      className={`field min-w-0 flex-1 ${muted ? 'text-muted' : ''}`}
      value={text}
      maxLength={slotNameMax}
      placeholder={slot.defaultLabel}
      aria-label={`Nombre de ${slot.defaultLabel.toLowerCase()}`}
      data-testid={`slot-name-${slot.key}`}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/** Ajustes → Tiempos de comida: which meals the diary offers, what they are called, when they usually happen and their order. */
export function MealTimesPage() {
  const api = useMealSlots()
  // What was just asked for stays on screen until the database shows it, so two quick presses build on each other.
  const [draft, setDraft] = useState<MealSlot[] | null>(null)
  if (draft && JSON.stringify(toPrefs(draft)) === JSON.stringify(toPrefs(api.slots))) setDraft(null)
  const slots = draft ?? api.slots
  const activeCount = slots.filter((s) => s.on).length

  const change = (next: MealSlot[]) => {
    setDraft(next)
    void api.save(next).catch(() => setDraft(null))
  }
  // Keeps the keyboard where it was after a row changes place (the list re-renders in a new order).
  const move = (key: MealKey, dir: -1 | 1) => {
    change(moveSlot(slots, key, dir))
    window.setTimeout(() => {
      const same = document.querySelector<HTMLButtonElement>(`[data-move="${key}:${dir}"]`)
      const other = document.querySelector<HTMLButtonElement>(`[data-move="${key}:${-dir}"]`)
      ;(same && !same.disabled ? same : other)?.focus()
    }, 0)
  }

  return (
    <>
      <PageHeader title="Tiempos de comida" back="/ajustes" />
      <p className="-mt-2 mb-2 text-label text-muted">Ocultar una comida no borra sus registros.</p>
      <ul className="divide-rows" data-testid="meal-slots">
        {slots.map((s, i) => {
          const lastOn = s.on && activeCount <= 1
          return (
            <li key={s.key} className="py-1" data-testid={`slot-${s.key}`}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.on}
                  aria-disabled={lastOn || undefined}
                  aria-label={`Mostrar ${s.defaultLabel.toLowerCase()}`}
                  data-testid={`slot-on-${s.key}`}
                  onClick={() => change(toggleSlot(slots, s.key))}
                  className="hit-44 relative -ml-1 h-11 w-12 shrink-0"
                >
                  <span className={`absolute left-1 top-1/2 h-6 w-11 -translate-y-1/2 rounded-full transition ${s.on ? 'bg-accent' : 'bg-line-strong'} ${lastOn ? 'opacity-60' : ''}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.on ? 'left-[22px]' : 'left-0.5'}`} />
                  </span>
                </button>
                <NameField key={`${s.key}|${s.renamed ? s.label : ''}|${s.on}`} slot={s} muted={!s.on} onCommit={(name) => change(renameSlot(slots, s.key, name))} />
                <IconButton icon="chevronUp" label={`Subir ${s.label.toLowerCase()}`} disabled={i === 0} data-move={`${s.key}:-1`} onClick={() => move(s.key, -1)} />
                <IconButton icon="chevronDown" label={`Bajar ${s.label.toLowerCase()}`} disabled={i === slots.length - 1} data-move={`${s.key}:1`} onClick={() => move(s.key, 1)} />
              </div>
              {s.on ? (
                <div className="flex items-center pl-12">
                  <label className="relative inline-flex min-h-11 items-center rounded-lg pr-2 text-label focus-within:outline focus-within:outline-2 focus-within:outline-accent">
                    <span aria-hidden className={s.time ? 'num font-medium text-ink' : 'text-muted underline underline-offset-2'}>
                      {s.time ?? 'Añadir hora'}
                    </span>
                    {/* The native field sits invisibly over the text: tapping opens the system picker; it is never shown empty. */}
                    <input
                      type="time"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      value={s.time ?? ''}
                      aria-label={`Hora habitual de ${s.label.toLowerCase()}`}
                      data-testid={`slot-time-${s.key}`}
                      onChange={(e) => change(setSlotTime(slots, s.key, e.target.value || null))}
                    />
                  </label>
                  {s.time ? (
                    <IconButton icon="x" size={16} label={`Quitar la hora de ${s.label.toLowerCase()}`} onClick={() => change(setSlotTime(slots, s.key, null))} />
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {activeCount <= 1 ? (
        <p className="mt-2 text-label text-muted" role="status" data-testid="slot-last-note">
          Debe quedar al menos un tiempo de comida activo.
        </p>
      ) : null}
      <button type="button" className="btn-ghost mt-3 w-full text-muted" disabled={!api.customised} data-testid="slots-reset" onClick={() => void api.save(null)}>
        Restablecer
      </button>
    </>
  )
}
