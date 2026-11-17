import { useSearchParams } from 'react-router-dom'
import { addDays, formatDateEs, todayLocal } from '../domain/dates'
import { useToday } from './useToday'
import { IconButton } from '../ui/IconButton'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Selected day from ?d=YYYY-MM-DD (defaults to today in Bogotá). */
export function useDateParam(): [string, (d: string) => void] {
  const [params, setParams] = useSearchParams()
  // Without ?d= the day follows the clock: it rolls over at local midnight and on resume.
  const today = useToday()
  const d = params.get('d')
  const date = d && DATE_RE.test(d) ? d : today
  return [
    date,
    (next) => {
      const p = new URLSearchParams(params)
      if (next === todayLocal()) p.delete('d')
      else p.set('d', next)
      setParams(p, { replace: true })
    },
  ]
}

export function dayLabel(date: string): string {
  const t = todayLocal()
  if (date === t) return 'Hoy'
  if (date === addDays(t, -1)) return 'Ayer'
  if (date === addDays(t, 1)) return 'Mañana'
  return formatDateEs(date, 'weekday')
}

export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const today = useToday()
  const isToday = date === today
  return (
    <div className="flex items-center gap-1">
      <IconButton icon="chevronLeft" label="Día anterior" className="-mx-1" onClick={() => onChange(addDays(date, -1))} />
      <label className="relative cursor-pointer rounded-xl px-2 py-1 text-center hover:bg-surface2">
        <span className="block text-sm font-semibold">{dayLabel(date)}</span>
        <span className="block text-[11px] text-muted">{formatDateEs(date, 'short')}</span>
        <input
          type="date"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Elegir fecha"
        />
      </label>
      <IconButton icon="chevronRight" label="Día siguiente" className="-mx-1" onClick={() => onChange(addDays(date, 1))} />
      {!isToday ? (
        <button type="button" className="chip ml-1" onClick={() => onChange(todayLocal())}>
          Hoy
        </button>
      ) : null}
    </div>
  )
}
