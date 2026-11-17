import { describe, expect, it } from 'vitest'
import { IDLE, swipeStep, type SwipeEvent, type SwipeState } from './swipeLogic'

const W = 360
const down = (x: number, y = 400, extra: Partial<Extract<SwipeEvent, { type: 'down' }>> = {}): SwipeEvent => ({ type: 'down', x, y, t: 0, pointerType: 'touch', blocked: false, viewportWidth: W, ...extra })
const move = (x: number, y: number, t = 50): SwipeEvent => ({ type: 'move', x, y, t })
const up = (x: number, y: number, t = 300): SwipeEvent => ({ type: 'up', x, y, t })

/** Runs a gesture and returns what fired on release. */
function run(events: SwipeEvent[]): string | null {
  let s: SwipeState = IDLE
  let fired: string | null = null
  for (const e of events) {
    const out = swipeStep(s, e)
    s = out.state
    if (out.fire) fired = out.fire
  }
  return fired
}

describe('swipeStep', () => {
  it('swipe left is next, swipe right is previous, from 64 px', () => {
    expect(run([down(250), move(220, 402), move(150, 405), up(150, 405)])).toBe('next')
    expect(run([down(100), move(130, 402), move(180, 405), up(180, 405)])).toBe('prev')
  })
  it('does not fire below 64 px when slow', () => {
    expect(run([down(250), move(215, 400), up(190, 400, 900)])).toBeNull()
  })
  it('fires a fast flick below 64 px', () => {
    expect(run([down(250), move(225, 400, 40), up(205, 400, 80)])).toBe('next') // 45 px in 80 ms
    expect(run([down(250), up(235, 400, 20)])).toBeNull() // under the flick minimum and under the lock
  })
  it('locks vertical when |dx| is not above 1.5 x |dy| and then never fires', () => {
    expect(run([down(250), move(230, 360), move(130, 330), up(130, 330)])).toBeNull() // dy 40 vs dx 20 at the lock
    expect(run([down(250), move(236, 395), move(150, 400), up(150, 402)])).toBe('next') // dx 14 vs dy 5 locks horizontal
  })
  it('a mostly vertical drag with a little sideways drift does not fire', () => {
    expect(run([down(250), move(245, 330), move(180, 200), up(170, 150)])).toBeNull()
  })
  it('a diagonal drag at exactly 1.5 ratio is not horizontal', () => {
    expect(run([down(250), move(235, 390), up(100, 300)])).toBeNull()
  })
  it('needs to still be horizontal at release', () => {
    expect(run([down(250), move(230, 398), move(150, 520), up(100, 560)])).toBeNull()
  })
  it('ignores a mouse', () => {
    expect(run([down(250, 400, { pointerType: 'mouse' }), move(150, 400), up(100, 400)])).toBeNull()
  })
  it('ignores gestures that start within 24 px of either edge', () => {
    expect(run([down(23), move(80, 400), up(160, 400)])).toBeNull()
    expect(run([down(24), move(80, 400), up(160, 400)])).toBe('prev')
    expect(run([down(W - 23), move(250, 400), up(150, 400)])).toBeNull()
    expect(run([down(W - 24), move(250, 400), up(150, 400)])).toBe('next')
  })
  it('ignores a gesture the caller marks as blocked', () => {
    expect(run([down(250, 400, { blocked: true }), move(150, 400), up(100, 400)])).toBeNull()
  })
  it('never fires after a cancelled pointer, and a cancel resets the gesture', () => {
    expect(run([down(250), move(180, 400), { type: 'cancel' }, up(100, 400)])).toBeNull()
    expect(run([down(250), move(150, 400), { type: 'cancel' }, down(250), move(190, 400), up(150, 400)])).toBe('next')
  })
  it('a tap never fires', () => {
    expect(run([down(200), up(200, 400, 80)])).toBeNull()
    expect(run([down(200), up(203, 402, 80)])).toBeNull()
  })
  it('moves or releases with no gesture started are ignored', () => {
    expect(run([move(200, 400), up(100, 400)])).toBeNull()
  })
})
