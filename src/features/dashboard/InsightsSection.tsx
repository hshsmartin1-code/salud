import { Link } from 'react-router-dom'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { SectionHeader } from '../../ui/SectionHeader'
import type { Insight } from './insights'

const ICON = { attention: 'alert', good: 'check', info: 'info' } as const
const TONE = { attention: 'text-warn', good: 'text-good', info: 'text-muted' } as const
/** Visible without asking; the rest sits behind "Ver más". */
const INSIGHTS_VISIBLE = 2

function InsightRow({ it }: { it: Insight }) {
  return (
    <li>
      <Link to={it.href} title={it.text} className="flex min-h-11 items-center gap-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent" data-testid={`insight-${it.id}`}>
        <Icon name={ICON[it.tone]} size={18} className={`shrink-0 ${TONE[it.tone]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink">{it.short}</span>
          <span className="block truncate text-label text-muted">{it.basis}</span>
        </span>
        <Icon name="chevronRight" size={18} className="shrink-0 text-faint" />
      </Link>
    </li>
  )
}

/** "Para hoy": at most two observations in view, one line each with its basis; the rest behind "Ver más". Nothing when there are none. */
export function InsightsSection({ items }: { items: Insight[] }) {
  if (!items.length) return null
  const rest = items.slice(INSIGHTS_VISIBLE)
  return (
    <section aria-labelledby="insights-title" data-testid="insights">
      <SectionHeader title={<span id="insights-title">Para hoy</span>} />
      <ul className="divide-rows mt-1">
        {items.slice(0, INSIGHTS_VISIBLE).map((it) => (
          <InsightRow key={it.id} it={it} />
        ))}
      </ul>
      {rest.length ? (
        <Disclosure summary={`Ver más (${rest.length})`} testId="insights-more">
          <ul className="divide-rows">
            {rest.map((it) => (
              <InsightRow key={it.id} it={it} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  )
}
