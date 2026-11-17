import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE, isSwipeBlocked, SWIPE_CLICK_GUARD_MS, swallowsClick, swipeStep, type SwipeEvent } from './swipeLogic'

afterEach(() => vi.unstubAllGlobals())

function element(selector: string, parentElement: Element | null = null): Element {
  return { parentElement, matches: (selectors: string) => selectors.split(',').map((s) => s.trim()).includes(selector) } as unknown as Element
}

describe('diary interactive surfaces', () => {
  it.each(['[data-no-swipe]', 'input', 'select'])('a drag starting on a control marked %s never changes the date', (selector) => {
    vi.stubGlobal('HTMLElement', class {})
    const target = element('span', element(selector))
    const blocked = isSwipeBlocked(target, null)
    let state = swipeStep(IDLE, { type: 'down', x: 250, y: 400, t: 0, pointerType: 'touch', viewportWidth: 360, blocked }).state
    state = swipeStep(state, { type: 'move', x: 180, y: 400, t: 50 }).state
    expect(swipeStep(state, { type: 'up', x: 100, y: 400, t: 150 }).fire).toBeNull()
  })

  it.each(['button', 'a', '[role="button"]'])('a drag starting on a row (%s) changes the date, and the click of that same gesture is swallowed', (selector) => {
    vi.stubGlobal('HTMLElement', class {})
    const blocked = isSwipeBlocked(element('span', element(selector)), null)
    expect(blocked).toBe(false)
    let state = swipeStep(IDLE, { type: 'down', x: 250, y: 400, t: 0, pointerType: 'touch', viewportWidth: 360, blocked }).state
    state = swipeStep(state, { type: 'move', x: 180, y: 400, t: 50 }).state
    expect(swipeStep(state, { type: 'up', x: 100, y: 400, t: 150 }).fire).toBe('next')
    expect(swallowsClick(1000, 1000)).toBe(true)
    expect(swallowsClick(1000, 1000 + SWIPE_CLICK_GUARD_MS - 1)).toBe(true)
    expect(swallowsClick(1000, 1000 + SWIPE_CLICK_GUARD_MS)).toBe(false) // a later, deliberate tap opens the row
    expect(swallowsClick(null, 1000)).toBe(false) // no swipe: taps are never swallowed
    expect(swallowsClick(1000, 900)).toBe(false) // clock moved backwards
  })

  it('one gesture fires once even if release is delivered twice', () => {
    let state = IDLE
    const fired: string[] = []
    const events: SwipeEvent[] = [
      { type: 'down', x: 250, y: 400, t: 0, pointerType: 'touch', viewportWidth: 360, blocked: false },
      { type: 'up', x: 100, y: 400, t: 200 },
      { type: 'up', x: 100, y: 400, t: 201 },
    ]
    for (const event of events) {
      const step = swipeStep(state, event)
      state = step.state
      if (step.fire) fired.push(step.fire)
    }
    expect(fired).toEqual(['next'])
  })
})
