import { useId, type ReactNode } from 'react'
import { formatNumber, parseDecimal } from '../domain/units'

/** Numbers are edited as strings (Colombian "72,5" accepted) and parsed on use. */
export function numStr(n: number | null | undefined, maxDecimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return formatNumber(n, maxDecimals).replace(/\./g, '')
}
export function toNum(s: string): number | null {
  return parseDecimal(s)
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="min-w-0">
      {label ? (
        <label htmlFor={htmlFor} className="label">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-bad">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  )
}

export function NumField({
  label,
  value,
  onChange,
  unit,
  placeholder,
  hint,
  error,
  autoFocus,
  name,
  ariaLabel,
  className = '',
  compact = false,
}: {
  label?: ReactNode
  value: string
  onChange: (v: string) => void
  unit?: ReactNode
  placeholder?: string
  hint?: ReactNode
  error?: ReactNode
  autoFocus?: boolean
  name?: string
  ariaLabel?: string
  className?: string
  compact?: boolean
}) {
  const id = useId()
  const invalid = value.trim() !== '' && parseDecimal(value) === null
  return (
    <Field label={label} hint={hint} error={error ?? (invalid ? 'Número no válido' : undefined)} htmlFor={id}>
      <div className={`relative ${className}`}>
        <input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          aria-label={ariaLabel}
          aria-invalid={invalid || !!error}
          data-autofocus={autoFocus ? '' : undefined}
          className={`field num ${unit ? 'pr-12' : ''} ${compact ? 'px-2 py-2 text-center' : ''}`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-faint">{unit}</span>
        ) : null}
      </div>
    </Field>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  autoFocus,
  type = 'text',
  name,
}: {
  label?: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: ReactNode
  error?: ReactNode
  autoFocus?: boolean
  type?: 'text' | 'date' | 'time' | 'search'
  name?: string
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        name={name}
        type={type}
        data-autofocus={autoFocus ? '' : undefined}
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  placeholder,
}: {
  label?: ReactNode
  value: T | ''
  onChange: (v: T) => void
  options: readonly { value: T; label: string }[]
  hint?: ReactNode
  placeholder?: string
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className="field appearance-none" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label?: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id}>
      <textarea id={id} rows={rows} className="field resize-none" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}
