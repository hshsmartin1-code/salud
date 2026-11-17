import { useState } from 'react'
import { TextField } from './fields'
import { Sheet, Segmented } from './kit'
import { CUSTOM_PERIOD, isCustomPeriod, makeCustomPeriod, parseCustomPeriod, validateCustomRange } from './period'

export interface PeriodOption {
  value: string
  /** Short label, e.g. "7 d". */
  label: string
}

/**
 * Period selector ("7 d | 30 d | 90 d | Otro"). With `allowCustom` the last option opens a sheet to
 * pick a date range; the chosen range comes back as `custom:AAAA-MM-DD..AAAA-MM-DD`
 * (see `parseCustomPeriod`). The same value should feed every panel on the screen.
 */
export function PeriodPicker({
  value,
  onChange,
  options,
  allowCustom = false,
  ariaLabel = 'Periodo',
}: {
  value: string
  onChange: (v: string) => void
  options: readonly PeriodOption[]
  allowCustom?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const current = parseCustomPeriod(value)
  const [from, setFrom] = useState(current?.from ?? '')
  const [to, setTo] = useState(current?.to ?? '')
  const [error, setError] = useState<string | null>(null)

  const all: PeriodOption[] = allowCustom ? [...options, { value: CUSTOM_PERIOD, label: 'Otro' }] : [...options]
  const selected = isCustomPeriod(value) ? CUSTOM_PERIOD : value

  return (
    <>
      <Segmented
        ariaLabel={ariaLabel}
        size="sm"
        value={selected}
        options={all}
        onChange={(v) => {
          if (v === CUSTOM_PERIOD) {
            setError(null)
            setOpen(true)
          } else onChange(v)
        }}
      />
      {allowCustom ? (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="Rango de fechas"
          footer={
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                const err = validateCustomRange(from, to)
                setError(err)
                if (err) return
                onChange(makeCustomPeriod(from, to))
                setOpen(false)
              }}
            >
              Aplicar rango
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3 pb-2">
            <TextField label="Desde" type="date" value={from} onChange={setFrom} autoFocus />
            <TextField label="Hasta" type="date" value={to} onChange={setTo} />
          </div>
          {error ? (
            <p role="alert" className="pb-2 text-label text-bad">
              {error}
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </>
  )
}
