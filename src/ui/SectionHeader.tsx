import type { ReactNode } from 'react'

/** Section title (17 px, semibold) with an optional line of context and one action on the right. */
export function SectionHeader({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-balance break-words text-heading text-ink">{title}</h2>
        {hint ? <p className="text-label text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  )
}
