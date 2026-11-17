import { useSyncExternalStore } from 'react'
import { nowLocalTime } from '../../domain/dates'
import { defaultMeal } from './food'

export const currentMeal = () => defaultMeal(nowLocalTime())

export function subscribeMealClock(changed: () => void): () => void {
  const timer = window.setInterval(changed, 60_000)
  document.addEventListener('visibilitychange', changed)
  window.addEventListener('focus', changed)
  window.addEventListener('pageshow', changed)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', changed)
    window.removeEventListener('focus', changed)
    window.removeEventListener('pageshow', changed)
  }
}

/** The implicit meal follows the clock; an explicit selection remains the person's choice. */
export function useMealOfHour() {
  return useSyncExternalStore(subscribeMealClock, currentMeal, currentMeal)
}
