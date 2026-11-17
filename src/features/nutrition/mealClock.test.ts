import { afterEach, expect, it, vi } from 'vitest'
import { currentMeal, subscribeMealClock } from './mealClock'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('the same meal reader follows Bogotá midnight and the morning without remounting', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-16T04:59:00Z'))
  expect(currentMeal()).toBe('otro')
  vi.setSystemTime(new Date('2026-11-16T05:01:00Z'))
  expect(currentMeal()).toBe('desayuno')
  vi.setSystemTime(new Date('2026-11-16T17:00:00Z'))
  expect(currentMeal()).toBe('almuerzo')
})

it('refreshes on a minute tick and resume, and removes its listeners on close', () => {
  vi.useFakeTimers()
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval })
  const doc = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  const changed = vi.fn()
  const close = subscribeMealClock(changed)
  vi.advanceTimersByTime(60_000)
  win.dispatchEvent(new Event('focus'))
  win.dispatchEvent(new Event('pageshow'))
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(changed).toHaveBeenCalledTimes(4)
  close()
  vi.advanceTimersByTime(60_000)
  win.dispatchEvent(new Event('focus'))
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(changed).toHaveBeenCalledTimes(4)
})
