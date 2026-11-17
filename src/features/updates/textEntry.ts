export interface FocusLike { tagName?: string; type?: string; isContentEditable?: boolean; readOnly?: boolean; disabled?: boolean }

const NO_KEYBOARD = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'])

/**
 * True when the focused element takes typed text, so the Android soft keyboard is (about to be) open. On the device the WebView
 * RESIZES with the keyboard, so `visualViewport` and `innerHeight` shrink together and useKeyboardInset reads 0: this is the signal
 * the notice uses to get out of the way (found on the tablet: the notice rode above the keyboard next to the navigation).
 */
export function isTextEntry(el: FocusLike | null | undefined): boolean {
  if (!el || el.disabled || el.readOnly) return false
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NO_KEYBOARD.has((el.type ?? 'text').toLowerCase())
  return !!el.isContentEditable
}
