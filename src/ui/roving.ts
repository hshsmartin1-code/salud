/** Roving-focus helpers shared by Segmented, Tabs and Menu (pure, unit-tested). */

export type RovingOrientation = 'horizontal' | 'vertical' | 'both'

/**
 * Index to move to for a navigation key, or null if the key is not a navigation key here.
 * Wraps around at the ends and skips disabled entries. `rtl` flips horizontal arrows.
 */
export function rovingIndex(opts: {
  key: string
  index: number
  count: number
  orientation?: RovingOrientation
  disabled?: readonly boolean[]
  rtl?: boolean
}): number | null {
  const { key, index, count, orientation = 'both', disabled, rtl = false } = opts
  if (count <= 0) return null
  const horizontal = orientation === 'horizontal' || orientation === 'both'
  const vertical = orientation === 'vertical' || orientation === 'both'
  let step = 0
  let edge: 'first' | 'last' | null = null
  if (key === 'Home') edge = 'first'
  else if (key === 'End') edge = 'last'
  else if (key === 'ArrowRight' && horizontal) step = rtl ? -1 : 1
  else if (key === 'ArrowLeft' && horizontal) step = rtl ? 1 : -1
  else if (key === 'ArrowDown' && vertical) step = 1
  else if (key === 'ArrowUp' && vertical) step = -1
  else return null
  const ok = (i: number) => !disabled?.[i]
  if (edge) {
    const all = Array.from({ length: count }, (_, i) => i)
    const found = (edge === 'first' ? all : all.reverse()).find(ok)
    return found ?? null
  }
  for (let n = 1; n <= count; n++) {
    const i = (((index + step * n) % count) + count) % count
    if (ok(i)) return i
  }
  return null
}

/** Which entry carries tabIndex 0: the selected one, else the first enabled one. */
export function tabStopIndex(selected: number, count: number, disabled?: readonly boolean[]): number {
  if (selected >= 0 && selected < count && !disabled?.[selected]) return selected
  const first = Array.from({ length: count }, (_, i) => i).find((i) => !disabled?.[i])
  return first ?? 0
}
