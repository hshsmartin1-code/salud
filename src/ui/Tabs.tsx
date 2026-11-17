import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { rovingIndex, tabStopIndex } from './roving'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  /** Small count after the label, e.g. number of records. */
  count?: number
  disabled?: boolean
}

/** DOM ids for wiring a panel to its tab: `<div role="tabpanel" id={tabPanelId(base, v)} aria-labelledby={tabId(base, v)}>`. */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`
export const tabPanelId = (base: string, value: string) => `${base}-panel-${value}`

/**
 * Underlined tabs (role="tablist"). Arrow keys, Home and End move focus and select (automatic
 * activation); only the selected tab is in the Tab order. Scrolls sideways instead of wrapping.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  idBase,
  ariaLabel,
  fit = false,
}: {
  value: T
  onChange: (v: T) => void
  tabs: readonly TabItem<T>[]
  /** Pass to get ids and aria-controls that match `tabPanelId(idBase, value)`. */
  idBase?: string
  ariaLabel?: string
  /** Distribute the tabs evenly over the width with tighter padding (no sideways scrolling). Default off. */
  fit?: boolean
}) {
  const auto = useId()
  const base = idBase ?? auto
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const disabled = tabs.map((t) => !!t.disabled)
  const selected = tabs.findIndex((t) => t.value === value)
  const stop = tabStopIndex(selected, tabs.length, disabled)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = refs.current.findIndex((el) => el === document.activeElement)
    const next = rovingIndex({ key: e.key, index: from < 0 ? stop : from, count: tabs.length, orientation: 'horizontal', disabled })
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(tabs[next]!.value)
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t, i) => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={tabId(base, t.value)}
            aria-selected={on}
            aria-controls={idBase ? tabPanelId(base, t.value) : undefined}
            tabIndex={i === stop ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            className={`relative -mb-px inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap text-body ${fit ? 'min-w-0 flex-1 justify-center px-1' : 'shrink-0 px-4'} font-medium transition-colors duration-state after:absolute ${fit ? 'after:inset-x-1' : 'after:inset-x-3'} after:bottom-0 after:h-0.5 after:rounded-full disabled:opacity-40 ${
              on ? 'text-ink after:bg-accent' : 'text-muted after:bg-transparent hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined ? <span className="num text-label text-muted">{t.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
