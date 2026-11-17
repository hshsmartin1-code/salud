import { useId, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { atBound, formatStepperValue, parseStepperText, stepperTextError, stepValue } from './stepperLogic'

/**
 * Number with minus and plus buttons and an editable field (decimal comma accepted).
 * Buttons clamp to min/max; typed text outside min/max (or not a number) is NOT clamped: the field keeps
 * the text, shows why, and reports `onValidity(false)` so the parent can block saving. Arrow Up/Down step.
 */
export function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  unit,
  label,
  disabled = false,
  error,
  onValidity,
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  unit?: string
  /** Visible label; also the accessible name of the group and the field. */
  label: string
  disabled?: boolean
  error?: string
  /** Called with false while the typed text cannot be used, and true again once it can. */
  onValidity?: (valid: boolean) => void
}) {
  const id = useId()
  const bounds = { step, min, max }
  // What the person is typing; it only applies while the value it was typed against is unchanged,
  // so a change from outside (or a button press) shows the new value again.
  const [typed, setTyped] = useState<{ text: string; base: number } | null>(null)
  const draft = typed && typed.base === value ? typed.text : null
  const setDraft = (text: string | null) => setTyped(text === null ? null : { text, base: value })
  const shown = draft ?? formatStepperValue(value, step)
  const typedError = draft === null ? null : stepperTextError(draft, bounds, unit)
  const commit = (v: number) => {
    if (v !== value) onChange(v)
    setDraft(null)
    onValidity?.(true)
  }
  /** Applies typed text when usable; otherwise keeps it on screen (with its error) and changes nothing. */
  const commitTyped = () => {
    if (draft === null) return
    if (draft.trim() === '') return commit(value)
    const parsed = parseStepperText(draft, bounds)
    if (parsed !== null) commit(parsed)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      commit(stepValue(value, e.key === 'ArrowUp' ? 1 : -1, bounds))
    } else if (e.key === 'Enter') {
      commitTyped()
    }
  }
  const btn =
    'hit-44 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface2 text-ink transition-colors duration-state hover:bg-line active:scale-95 disabled:pointer-events-none disabled:opacity-40'
  return (
    <div role="group" aria-labelledby={`${id}-l`} className="min-w-0">
      <span id={`${id}-l`} className="label">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          aria-label={`Disminuir ${label.toLowerCase()}`}
          disabled={disabled || atBound(value, -1, bounds)}
          onClick={() => commit(stepValue(value, -1, bounds))}
        >
          <Icon name="minus" size={18} />
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            aria-labelledby={`${id}-l`}
            aria-invalid={!!error || !!typedError}
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            value={shown}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setDraft(e.target.value)
              onValidity?.(stepperTextError(e.target.value, bounds) === null)
            }}
            onBlur={commitTyped}
            onKeyDown={onKey}
            className={`field num text-center ${unit ? 'pr-10' : ''}`}
          />
          {unit ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-label text-muted">{unit}</span>
          ) : null}
        </div>
        <button
          type="button"
          className={btn}
          aria-label={`Aumentar ${label.toLowerCase()}`}
          disabled={disabled || atBound(value, 1, bounds)}
          onClick={() => commit(stepValue(value, 1, bounds))}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>
      {error || typedError ? (
        <p role="alert" className="mt-1 text-label text-bad">
          {error ?? typedError}
        </p>
      ) : null}
    </div>
  )
}
