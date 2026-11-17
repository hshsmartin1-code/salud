import type { ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * The one pattern for "advanced, on demand" content (V3.1 progressive disclosure): sources, formulas,
 * technical tools. Native <details>, so it works without script, is keyboard-operable and announced
 * as expanded/collapsed. Closed by default; nothing inside is removed from the product, only folded.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  tone = 'quiet',
  testId,
  className = '',
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** quiet = muted text row (inside a screen); section = heading-sized row (a folded section of a page). */
  tone?: 'quiet' | 'section'
  testId?: string
  className?: string
}) {
  const row = tone === 'section' ? 'text-heading text-ink font-semibold' : 'text-label text-muted font-medium'
  return (
    <details className={`group ${className}`} open={defaultOpen} data-testid={testId}>
      <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 ${row} [&::-webkit-details-marker]:hidden`}>
        <span>{summary}</span>
        <Icon name="chevronDown" size={tone === 'section' ? 18 : 14} className="shrink-0 transition-transform duration-state group-open:rotate-180" />
      </summary>
      <div className="pb-2 pt-1">{children}</div>
    </details>
  )
}
