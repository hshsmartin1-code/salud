import { groupLabel } from '../muscles'
import { minutesText, type RoutineStats } from '../trainingStats'
import { weekdayDay } from './format'

/** "Piernas · Glúteos" for the (up to 3) groups with most planned sets. */
export const groupsText = (stats: RoutineStats) => stats.groups.slice(0, 3).map((g) => groupLabel(g.group)).join(' · ')

/** "Última vez: lun 9 nov · ~58 min": the duration only appears when the estimate is backed by enough sessions. */
export function lastTimeText(stats: Pick<RoutineStats, 'lastDate' | 'estimatedMin'>): string {
  const last = stats.lastDate ? `Última vez: ${weekdayDay(stats.lastDate)}` : 'Aún sin hacer'
  return stats.estimatedMin !== null ? `${last} · ~${minutesText(stats.estimatedMin)}` : last
}
