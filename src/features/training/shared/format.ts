import { formatDateEs } from '../../../domain/dates'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** "9 nov". */
export const shortDay = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`

/** "9 – 15 nov", or "30 nov – 6 dic" when the week crosses a month. */
export function weekRange(start: string, end: string): string {
  return start.slice(5, 7) === end.slice(5, 7) ? `${+start.slice(8, 10)} – ${shortDay(end)}` : `${shortDay(start)} – ${shortDay(end)}`
}

/** "lun 9 nov". */
export const weekdayDay = (d: string) => formatDateEs(d, 'weekday')


export function routineSummary(exerciseCount: number, plannedSets: number): string {
  return `${exerciseCount} ${exerciseCount === 1 ? 'ejercicio' : 'ejercicios'} · ${plannedSets} ${plannedSets === 1 ? 'serie' : 'series'}`
}
