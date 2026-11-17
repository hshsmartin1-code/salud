import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useRepo } from '../../app/profile'
import type { MealKey } from '../../db/types'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import { describeQty, shortQty } from './food'
import { describeGap, foodIdeas, IDEAS_HISTORY_DAYS, type FoodIdea, type IdeasResult } from './ideas'
import { useIdeasHidden } from './prefs'
import { useMealSlots } from './useMealSlots'
import type { DayNutrition } from './useDayNutrition'
import { useRecentLogs } from './useQuickLog'

/** The one line a diary with no habits yet shows instead of ideas. Never a card. */
export const IDEAS_NEED_HISTORY = 'Cuando registres tus comidas, aparecerán aquí tus alimentos habituales.'

/** An empty or near-empty day: the only time the "need history" line is worth showing. */
export const NEAR_EMPTY_DAY_LOGS = 2

/**
 * Ideas for what is left of `date`, targeted at `meal`. Undefined while loading. Reads the day's targets
 * from the stored goal (kcal = the same budget the summary shows), 60 days of logs and the day mark.
 * Only the person's own habits count: there is no catalog fallback.
 */
export function useFoodIdeas(date: string, meal: MealKey, day: DayNutrition | undefined): IdeasResult | undefined {
  const r = useRepo()
  const history = useRecentLogs(date, IDEAS_HISTORY_DAYS)
  const complete = useLiveQuery(async () => (await r.onDate('dayMarks', date)).some((m) => m.complete), [r, date])
  return useMemo(() => {
    if (!day || !history || complete === undefined) return undefined
    const g = day.goal
    return foodIdeas({
      date,
      meal,
      today: day.logs,
      history,
      dayComplete: complete,
      targets: g ? { kcal: day.kcalBudget, protein: g.protein, carbs: g.carbs, fat: g.fat, fiber: g.fiber } : null,
    })
  }, [day, history, complete, date, meal])
}

/** One row per idea: name, usual quantity and the numbers; "+" logs the frozen snapshot. */
export function IdeaRows({ ideas, meal, onAdd }: { ideas: FoodIdea[]; meal: MealKey; onAdd: (idea: FoodIdea) => void }) {
  const mealName = useMealSlots().label(meal)
  return (
    <ul className="divide-rows" data-testid="idea-list">
      {ideas.map((idea) => (
        <li key={idea.key} className="flex min-h-[52px] items-center gap-3 py-1.5" data-testid="idea">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium">{idea.name}</span>
            {/* Two groups that wrap as wholes, so a wrapped line never starts with a separator. */}
            <span className="flex flex-wrap items-baseline gap-x-3 text-label text-muted">
              <span className="num min-w-0 max-w-full truncate">{shortQty(idea.snapshot)}</span>
              <span className="num whitespace-nowrap text-ink/80" data-testid="idea-reason">{idea.reason}</span>
            </span>
          </span>
          <button
            type="button"
            data-testid="idea-add"
            aria-label={`Agregar ${describeQty(idea.snapshot)} de ${idea.name} a ${mealName}`}
            title={`Agregar a ${mealName}`}
            onClick={() => onAdd(idea)}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-accent transition-colors duration-state hover:border-accent hover:bg-accent/10 active:scale-95"
          >
            <Icon name="plus" size={18} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function HowIdeasWork() {
  return (
    <Disclosure summary="¿Cómo se eligen?" testId="ideas-how">
      <p className="text-label text-muted">
        Solo alimentos que ya registras a menudo en esa comida, en la cantidad que sueles tomar. Se ordenan por cuánto cubren de lo que más te falta hoy,
        sin pasar la energía que te queda.
      </p>
    </Disclosure>
  )
}

/** The muted line. Shown only while there is too little history AND the day is empty or nearly so. */
export function IdeasNeedHistory({ result, dayLogs }: { result: IdeasResult | undefined; dayLogs: number }) {
  if (!result || !result.needsHistory || dayLogs >= NEAR_EMPTY_DAY_LOGS) return null
  return (
    <p className="py-3 text-label text-muted" data-testid="ideas-empty">
      {IDEAS_NEED_HISTORY}
    </p>
  )
}

/** Header shared by both placements: title, the gap in words, and "Ocultar por hoy". */
function IdeasHeader({ id, title, result, onHide }: { id: string; title: string; result: IdeasResult; onHide: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 id={id} className="text-body font-semibold text-ink">
          {title}
        </h2>
        <p className="text-label text-muted" data-testid="ideas-gap">
          {describeGap(result.gap!)}
        </p>
      </div>
      <button
        type="button"
        data-testid="ideas-hide"
        onClick={onHide}
        aria-label="Ocultar las ideas por hoy"
        title="Ocultar por hoy"
        className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-state hover:bg-surface2 hover:text-ink"
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  )
}

/**
 * Group on the search page, shown only when real ideas exist (otherwise nothing, or the muted line on the desktop pane).
 * On the phone it starts folded so the list stays near the top; on the desktop pane it is open.
 */
export function SearchIdeas({ result, meal, date, dayLogs, withNote = false, collapsed = false, onAdd }: { result: IdeasResult; meal: MealKey; date: string; dayLogs: number; withNote?: boolean; collapsed?: boolean; onAdd: (idea: FoodIdea) => void }) {
  const r = useRepo()
  const [hidden, setHidden] = useIdeasHidden(r.profileId, date)
  if (!result.gap || !result.ideas.length) return withNote ? <IdeasNeedHistory result={result} dayLogs={dayLogs} /> : null
  if (hidden) return null
  const body = (
    <>
      <IdeaRows ideas={result.ideas} meal={meal} onAdd={onAdd} />
      <HowIdeasWork />
    </>
  )
  if (collapsed)
    return (
      <section data-testid="search-ideas" aria-label="Ideas para lo que falta" className="border-b border-line">
        <Disclosure summary={<span className="text-body font-semibold text-ink">Ideas para lo que falta · {result.ideas.length}</span>}>
          <p className="text-label text-muted" data-testid="ideas-gap">
            {describeGap(result.gap)}
          </p>
          {body}
          <button type="button" data-testid="ideas-hide" className="btn-ghost -ml-2 px-2 text-label" onClick={() => setHidden(true)}>
            Ocultar por hoy
          </button>
        </Disclosure>
      </section>
    )
  return (
    <section data-testid="search-ideas" aria-labelledby="search-ideas-title">
      <IdeasHeader id="search-ideas-title" title="Ideas para lo que falta" result={result} onHide={() => setHidden(true)} />
      {body}
    </section>
  )
}
