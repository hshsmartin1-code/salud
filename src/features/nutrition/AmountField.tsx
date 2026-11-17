import { useId, type KeyboardEvent } from 'react'
import { numStr } from '../../ui/fields'
import { Icon } from '../../ui/Icon'
import { parseAmount } from './amountParse'

const BTN =
  'hit-44 flex h-11 w-9 shrink-0 items-center justify-center text-muted transition-colors duration-state hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-40'

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * Amount as one compact control: minus, the typed value, plus. What is typed is never rounded to the step:
 * 0,25 of a portion, 152,5 g and "1 1/2" must reach the snapshot exactly, and the preview follows every
 * keystroke. Fractions ("1/2", "1 1/2") are accepted next to the app's number rule (`parseAmount`).
 * Enter calls `onEnter` (the keyboard "Listo").
 */
export function AmountField({
  value,
  onChange,
  step,
  onEnter,
  label = 'Cantidad',
  fractions = false,
}: {
  value: string
  onChange: (v: string) => void
  step: number
  onEnter?: () => void
  label?: string
  /** Measures are counted in halves and quarters: the phone keyboard then offers "/" (text) instead of the decimal pad. */
  fractions?: boolean
}) {
  const id = useId()
  const n = parseAmount(value)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter?.()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (n ?? 0) + (e.key === 'ArrowUp' ? step : -step)
      if (next > 0) onChange(numStr(round3(next), 3))
    }
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label !mb-1">
        {label}
      </label>
      <div className="flex h-11 items-center rounded-xl border border-line-strong bg-surface2/50 focus-within:border-accent">
        <button type="button" className={BTN} aria-label={`Disminuir ${label.toLowerCase()}`} disabled={n === null || n - step <= 0} onClick={() => onChange(numStr(round3((n ?? 0) - step), 3))}>
          <Icon name="minus" size={16} />
        </button>
        <input
          id={id}
          name="qty"
          data-autofocus=""
          autoFocus
          inputMode={fractions ? 'text' : 'decimal'}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={value.trim() !== '' && n === null}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={onKey}
          className="num h-full min-w-0 flex-1 bg-transparent text-center text-body font-semibold text-ink outline-none"
        />
        <button type="button" className={BTN} aria-label={`Aumentar ${label.toLowerCase()}`} onClick={() => onChange(numStr(round3((n ?? 0) + step), 3))}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  )
}

/** Step of the minus and plus buttons for a unit. */
export function stepFor(unit: string | undefined): number {
  if (unit === 'g' || unit === 'ml') return 10
  if (unit === 'kg' || unit === 'l' || unit === 'lb') return 0.25
  if (unit === 'oz') return 1
  return 0.5
}
