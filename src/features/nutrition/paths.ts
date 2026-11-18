import { todayLocal } from '../../domain/dates'

/** Where a flow that logs for `date` returns to: the diary on that same day (no `?d=` for today). */
export function diaryPath(date: string, today: string = todayLocal()): string {
  return date === today ? '/comida' : `/comida?d=${date}`
}

/** Search page for `date` and `meal`. */
export function searchPath(date: string, meal?: string, today: string = todayLocal()): string {
  const p = new URLSearchParams()
  if (date !== today) p.set('d', date)
  if (meal) p.set('meal', meal)
  const q = p.toString()
  return `/comida/buscar${q ? `?${q}` : ''}`
}

/** `?d=` suffix that keeps the viewed day across the nutrition screens (nothing for today). */
export function dateQuery(date: string, today: string = todayLocal()): string {
  return date === today ? '' : `?d=${date}`
}

export function labelPath(options: { date?: string; meal?: string; barcode?: string; name?: string; edit?: string } = {}) {
  const params = new URLSearchParams(options.date ? dateQuery(options.date) : '')
  for (const key of ['meal', 'barcode', 'name', 'edit'] as const) {
    const value = options[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return `/comida/etiqueta${query ? `?${query}` : ''}`
}

/**
 * Remembers the route a save started on. Call it when the save starts; the returned function says, once the
 * save has resolved, whether the person is still there. The app's own "back to the diary" only happens then,
 * so a late navigation can never pull someone back from where they already went.
 */
export function routeGuard(): () => boolean {
  const start = window.location.href
  return () => window.location.href === start
}
