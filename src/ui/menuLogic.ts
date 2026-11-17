/**
 * Where to put a popover so it stays inside the viewport: below the trigger when it fits, above it
 * otherwise, right-aligned to the trigger and shifted left/right to keep an 8 px margin.
 */
export function popoverPosition(
  trigger: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { top: number; left: number } {
  const below = trigger.bottom + 4
  const fitsBelow = below + size.height <= viewport.height - margin
  const above = trigger.top - 4 - size.height
  let top = fitsBelow ? below : above >= margin ? above : Math.max(margin, viewport.height - margin - size.height)
  top = Math.min(top, Math.max(margin, viewport.height - margin - size.height))
  let left = trigger.right - size.width
  left = Math.min(left, viewport.width - margin - size.width)
  left = Math.max(margin, left)
  return { top, left }
}
