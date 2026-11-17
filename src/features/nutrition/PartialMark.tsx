import { useState } from 'react'
import type { NutrientCode } from '../../db/catalogTypes'
import type { FoodLog } from '../../db/types'
import { Sheet } from '../../ui/kit'
import { foodsLacking, nutrientName, partialSentence } from './incomplete'

/**
 * The "*" of a partial total as a real control: a small mark with a 44 px hit area. It opens a short explanation
 * and the foods that give no value for that nutrient. The total itself never changes (an unknown value is not 0).
 */
export function PartialMark({ code, logs }: { code: NutrientCode; logs: readonly Pick<FoodLog, 'name' | 'nutrients'>[] }) {
  const [open, setOpen] = useState(false)
  const name = nutrientName(code)
  const lacking = open ? foodsLacking(logs, code) : []
  return (
    <>
      <button
        type="button"
        data-no-swipe
        data-testid={`partial-${code}`}
        aria-label={`Total parcial de ${name}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="hit-44 inline-flex h-5 w-4 items-center justify-center rounded align-baseline text-inherit transition-colors duration-state hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        *
      </button>
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={`Total parcial de ${name}`}>
          <div className="space-y-3 pb-2" data-testid="partial-sheet">
            <p className="text-body">{partialSentence(code)}</p>
            {lacking.length ? (
              <ul className="divide-rows text-body" aria-label="Alimentos sin ese dato">
                {lacking.map((n) => (
                  <li key={n} className="py-2 font-medium">
                    {n}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </>
  )
}
