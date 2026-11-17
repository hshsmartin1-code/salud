import { Link } from 'react-router-dom'
import { SectionHeader } from '../../../ui/SectionHeader'
import { streakText, type CalendarDay } from '../trainingCalendar'
import { weekdayDay } from '../shared/format'

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Last weeks as a 7-column grid (Monday first); a dot per day trained. A trained day opens its session, or the history of that day. */
export function TrainingCalendar({ weeks, streak }: { weeks: CalendarDay[][]; streak: number }) {
  const text = streakText(streak)
  const trained = weeks.flat().filter((d) => d.sessions.length).length
  return (
    <section aria-labelledby="cal-title" data-testid="training-calendar">
      <SectionHeader title={<span id="cal-title">Constancia</span>} hint={`Últimas ${weeks.length} semanas · ${trained} ${trained === 1 ? 'día entrenado' : 'días entrenados'}`} />
      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center lg:max-w-[336px]" role="grid" aria-label="Días entrenados">
        {DAYS.map((d, i) => (
          <span key={d} role="columnheader" aria-label={DAY_NAMES[i]} className="pb-1 text-micro text-muted">
            {d}
          </span>
        ))}
        {weeks.flat().map((d) => {
          const n = d.sessions.length
          const label = `${weekdayDay(d.date)}${n ? `: ${d.sessions.map((s) => s.name).join(', ')}` : d.future ? '' : ': sin entreno'}`
          const inner = (
            <>
              <span className={`num text-label ${d.today ? 'font-semibold text-ink' : 'text-muted'}`}>{+d.date.slice(8, 10)}</span>
              <span className={`mt-0.5 h-2 w-2 rounded-full ${n ? 'bg-[rgb(var(--train))]' : 'bg-transparent'}`} aria-hidden="true" />
            </>
          )
          const base = `mx-auto flex h-11 w-11 flex-col items-center justify-center rounded-xl ${d.today ? 'ring-1 ring-line-strong' : ''} ${d.future ? 'opacity-40' : ''}`
          return (
            <span key={d.date} role="gridcell" className="flex justify-center">
              {n ? (
                <Link to={n === 1 ? `/entreno/sesion/${d.sessions[0]!.id}` : `/entreno/historial?dia=${d.date}`} className={`${base} outline-none hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent`} aria-label={label} data-testid="calendar-day-trained">
                  {inner}
                </Link>
              ) : (
                <span className={base} aria-label={label || undefined}>
                  {inner}
                </span>
              )}
            </span>
          )
        })}
      </div>
      {text ? (
        <p className="mt-2 text-label text-muted" data-testid="week-streak">
          {text}
        </p>
      ) : null}
    </section>
  )
}
