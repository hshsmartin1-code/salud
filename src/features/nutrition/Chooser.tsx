import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { Sheet } from '../../ui/kit'
import { rovingIndex } from '../../ui/roving'

export interface ChoiceOption {
  key: string
  label: string
  /** Muted second line ("registro guardado"). */
  hint?: string
}

/**
 * A small chooser: one list of options in a compact sheet, no taller than about 45 % of the screen (it scrolls
 * inside). It closes on the outside tap (the sheet backdrop), Escape and selection. Roving focus: only the
 * selected option is a tab stop, arrows move between the visible options, Enter or Space picks. The options in
 * `more` sit behind a "Más unidades"-style disclosure, closed by default.
 */
export function Chooser({
  open,
  onClose,
  title,
  options,
  more = [],
  moreLabel = 'Más opciones',
  value,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  options: readonly ChoiceOption[]
  more?: readonly ChoiceOption[]
  moreLabel?: string
  value: string
  onSelect: (key: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const pick = (key: string) => {
    onSelect(key)
    onClose()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].filter((el) => !el.closest('details:not([open])'))
    const from = items.indexOf(document.activeElement as HTMLElement)
    const next = rovingIndex({ key: e.key, index: from < 0 ? 0 : from, count: items.length, orientation: 'vertical' })
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }
  const all = [...options, ...more]
  const stopKey = all.some((o) => o.key === value) ? value : options[0]?.key
  const row = (o: ChoiceOption) => {
    const selected = o.key === value
    return (
      <button
        key={o.key}
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={o.key === stopKey ? 0 : -1}
        data-autofocus={selected ? '' : undefined}
        data-choice={o.key}
        onClick={() => pick(o.key)}
        className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-body transition-colors duration-state hover:bg-surface2 focus-visible:bg-surface2 ${selected ? 'font-semibold text-ink' : 'font-medium text-ink'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{o.label}</span>
          {o.hint ? <span className="block truncate text-label font-normal text-muted">{o.hint}</span> : null}
        </span>
        {selected ? <Icon name="check" size={18} className="shrink-0 text-accent" /> : null}
      </button>
    )
  }
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div ref={listRef} onKeyDown={onKeyDown} className="group/ch -mx-2" data-testid="chooser">
        <div
          role="radiogroup"
          aria-label={typeof title === 'string' ? title : undefined}
          className="max-h-[calc(45dvh-6.5rem)] min-h-[3rem] overflow-y-auto pb-1 group-has-[details[open]]/ch:max-h-[calc(45dvh-14rem)]"
        >
          {options.map(row)}
          {all.length === 0 ? <p className="px-3 py-3 text-body text-muted">Sin opciones.</p> : null}
        </div>
        {more.length ? (
          <div className="border-t border-line px-3">
            <Disclosure summary={moreLabel} defaultOpen={more.some((m) => m.key === value)}>
              <div className="-mx-3 max-h-[9.5rem] overflow-y-auto" role="radiogroup" aria-label={moreLabel}>
                {more.map(row)}
              </div>
            </Disclosure>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
