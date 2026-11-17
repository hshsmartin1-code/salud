import { describe, expect, it, vi } from 'vitest'
import { createDismissStack } from './dismissStack'

describe('dismiss stack', () => {
  it('starts empty', () => {
    const s = createDismissStack()
    expect(s.size()).toBe(0)
    expect(s.top()).toBeUndefined()
    expect(s.pop()).toBeUndefined()
  })

  it('pops in last-in first-out order', () => {
    const s = createDismissStack()
    const a = vi.fn()
    const b = vi.fn()
    s.push(a)
    s.push(b)
    expect(s.size()).toBe(2)
    s.top()!.close()
    expect(b).toHaveBeenCalledOnce()
    expect(a).not.toHaveBeenCalled()
    s.pop()
    expect(s.top()!.close).toBe(a)
    s.pop()
    expect(s.size()).toBe(0)
  })

  it('an overlay can leave from the middle and leaving twice is harmless', () => {
    const s = createDismissStack()
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    const leaveA = s.push(a)
    s.push(b)
    s.push(c)
    leaveA()
    leaveA()
    expect(s.size()).toBe(2)
    s.pop()
    s.top()!.close()
    expect(b).toHaveBeenCalledOnce()
  })

  it('ids are unique even after entries leave', () => {
    const s = createDismissStack()
    const leave = s.push(() => undefined)
    const first = s.top()!.id
    leave()
    s.push(() => undefined)
    expect(s.top()!.id).not.toBe(first)
  })
})
