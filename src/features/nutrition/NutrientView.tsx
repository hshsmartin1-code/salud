import { NUTRIENTS, type NutrientCode, type NutrientMap } from '../../db/catalogTypes'
import { formatNutrient } from '../../domain/nutrients'

const MACROS: { code: NutrientCode; es: string; color: string }[] = [
  { code: 'protein', es: 'Proteína', color: 'protein' },
  { code: 'carbs', es: 'Carbos', color: 'carbs' },
  { code: 'fat', es: 'Grasa', color: 'fat' },
]

/** Compact kcal + macro line. Unknown values render as "—", never 0. */
export function MacroLine({ n, partial = [] }: { n: NutrientMap; partial?: readonly NutrientCode[] }) {
  return (
    <span className="num inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
      <span className="font-semibold text-ink">
        {formatNutrient('kcal', n.kcal, false)} kcal{partial.includes('kcal') ? '*' : ''}
      </span>
      {MACROS.map((m) => (
        <span key={m.code} className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: `rgb(var(--${m.color}))` }} />
          {m.es[0]} {formatNutrient(m.code, n[m.code], false)}
          {partial.includes(m.code) ? '*' : ''}
        </span>
      ))}
    </span>
  )
}

const GROUPS: { title: string; codes: NutrientCode[] }[] = [
  { title: 'Energía y macronutrientes', codes: ['kcal', 'protein', 'carbs', 'carbsAvail', 'fiber', 'sugars', 'addedSugars', 'fat', 'satFat', 'monoFat', 'polyFat', 'transFat', 'cholesterol'] },
  { title: 'Minerales', codes: ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'phosphorus', 'zinc'] },
  { title: 'Vitaminas y agua', codes: ['vitA', 'vitC', 'vitD', 'vitE', 'vitB12', 'folate', 'water'] },
]
const ES = Object.fromEntries(NUTRIENTS.map((n) => [n.code, n.es])) as Record<NutrientCode, string>

export function NutrientTable({ n, partial = [], hideEmptyGroups = true }: { n: NutrientMap; partial?: readonly NutrientCode[]; hideEmptyGroups?: boolean }) {
  return (
    <div className="space-y-3">
      {GROUPS.map((g) => {
        const known = g.codes.filter((c) => n[c] !== undefined)
        if (hideEmptyGroups && known.length === 0 && g.title !== GROUPS[0].title) return null
        return (
          <div key={g.title}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{g.title}</div>
            <dl className="divide-y divide-line/60 rounded-xl border border-line">
              {g.codes.map((c) => (
                <div key={c} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <dt className={['satFat', 'monoFat', 'polyFat', 'transFat', 'sugars', 'addedSugars', 'fiber', 'carbsAvail'].includes(c) ? 'pl-3 text-muted' : ''}>{ES[c]}</dt>
                  <dd className={`num ${n[c] === undefined ? 'text-faint' : 'font-medium'}`}>
                    {formatNutrient(c, n[c])}
                    {partial.includes(c) ? <span title="Parcial: algún alimento no tiene este dato"> *</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )
      })}
      <p className="text-[11px] text-faint">«—» = dato desconocido (no se asume cero). «*» = total parcial.</p>
    </div>
  )
}
