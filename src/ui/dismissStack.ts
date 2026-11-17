/**
 * Central stack of open overlays (sheets, confirmations, popover menus, enlarged views). Each one
 * registers its own `close` when it opens and leaves when it closes, so a single consumer (the Android
 * hardware Back handler) can close the topmost one without knowing the components. Pure: no DOM, no React.
 */
export interface DismissEntry {
  id: number
  close: () => void
}

export interface DismissStack {
  /** Registers an overlay on top; returns a function that removes it (idempotent, any order). */
  push(close: () => void): () => void
  /** Removes and returns the topmost entry (without calling its `close`). */
  pop(): DismissEntry | undefined
  top(): DismissEntry | undefined
  size(): number
}

export function createDismissStack(): DismissStack {
  let items: DismissEntry[] = []
  let next = 1
  return {
    push(close) {
      const entry = { id: next++, close }
      items = [...items, entry]
      return () => {
        items = items.filter((e) => e.id !== entry.id)
      }
    },
    pop() {
      const top = items[items.length - 1]
      if (top) items = items.slice(0, -1)
      return top
    },
    top: () => items[items.length - 1],
    size: () => items.length,
  }
}

/** The app-wide stack. */
export const dismissStack: DismissStack = createDismissStack()
