import type { NutrientCode } from '../../db/catalogTypes'
import { evaluateAmdr, evaluateIntake, type DriSet, type Reference, type Status, type Tone } from '../../domain/dri'
import { energyPercent, type NutrientReport } from '../../domain/nutrientReport'
import { formatNutrient } from '../../domain/nutrients'
import { formatNumber } from '../../domain/units'

/** Everything the Nutrientes screen needs to draw one row. Pure, so the rules are tested without React. */
export interface NutrientRow {
  code: NutrientCode
  label: string
  /** Unit or form the figure is expressed in, when it is not obvious ("RAE", "folato total, no DFE"). */
  qualifier?: string
  amountText: string
  refText: string
  status: Status
  /** Bar geometry as fractions 0..1 of the bar width. Null = no bar. */
  bar: { fill: number; mark: number | null; ulMark: number | null; band: [number, number] | null } | null
  /** Domain colour token for the fill when the tone is neutral. */
  colorVar: string
  /** Partial data: "datos en 54 % de la energía". */
  coverageHint: string | null
  /** Extra short lines (UL note for supplements, RDA of a macro...). */
  notes: string[]
}

export interface NutrientSection {
  id: 'macros' | 'minerales' | 'vitaminas' | 'limites'
  title: string
  hint?: string
  rows: NutrientRow[]
}

const LABEL: Partial<Record<NutrientCode, { label: string; qualifier?: string }>> = {
  kcal: { label: 'Energía' },
  protein: { label: 'Proteína' },
  carbs: { label: 'Carbohidratos' },
  fat: { label: 'Grasa total' },
  fiber: { label: 'Fibra dietaria' },
  sugars: { label: 'Azúcares totales' },
  monoFat: { label: 'Grasa monoinsaturada' },
  polyFat: { label: 'Grasa poliinsaturada' },
  water: { label: 'Agua de los alimentos', qualifier: 'solo humedad de los alimentos' },
  calcium: { label: 'Calcio' },
  iron: { label: 'Hierro' },
  magnesium: { label: 'Magnesio' },
  phosphorus: { label: 'Fósforo' },
  potassium: { label: 'Potasio' },
  zinc: { label: 'Zinc' },
  vitA: { label: 'Vitamina A', qualifier: 'µg RAE' },
  vitC: { label: 'Vitamina C' },
  vitD: { label: 'Vitamina D' },
  vitE: { label: 'Vitamina E', qualifier: 'α-tocoferol' },
  vitB12: { label: 'Vitamina B12' },
  folate: { label: 'Folato', qualifier: 'folato total, no DFE' },
  sodium: { label: 'Sodio' },
  satFat: { label: 'Grasa saturada' },
  addedSugars: { label: 'Azúcares añadidos' },
  transFat: { label: 'Grasa trans' },
  cholesterol: { label: 'Colesterol' },
}

const MACRO_COLOR: Partial<Record<NutrientCode, string>> = { protein: 'protein', carbs: 'carbs', fat: 'fat', fiber: 'fiber', kcal: 'energy' }

const SECTIONS: { id: NutrientSection['id']; title: string; hint?: string; codes: NutrientCode[] }[] = [
  { id: 'macros', title: 'Energía y macronutrientes', codes: ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'monoFat', 'polyFat', 'water'] },
  { id: 'minerales', title: 'Minerales', codes: ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc'] },
  { id: 'vitaminas', title: 'Vitaminas', codes: ['vitA', 'vitC', 'vitD', 'vitE', 'vitB12', 'folate'] },
  { id: 'limites', title: 'Límites', hint: 'Mejor por debajo', codes: ['sodium', 'satFat', 'addedSugars', 'transFat', 'cholesterol'] },
]

const pct1 = (n: number) => `${formatNumber(n, 1)} %`
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const COVERAGE_HINT_BELOW = 0.8

export function coverageHint(coverage: number, hasValue: boolean): string | null {
  return hasValue && coverage < COVERAGE_HINT_BELOW ? `datos en ${Math.round(coverage * 100)} % de la energía` : null
}

function refLabel(ref: Reference): string {
  if (ref.kind === 'none') return ref.code === 'transFat' ? 'Lo más bajo posible' : 'Sin valor de referencia'
  if (ref.kind === 'limit-energy') return `Límite: menos de ${ref.pctEnergyMax} % de la energía`
  const k = ref.kind === 'CDRR' ? 'CDRR' : ref.kind
  const num = (v: number) => formatNutrient(ref.code, v, false)
  const base =
    ref.value !== null
      ? `${num(ref.value)} ${ref.unit}`
      : ref.range
        ? `${num(ref.range[0])}–${num(ref.range[1])} ${ref.unit} según sexo`
        : ''
  if (ref.code === 'fiber') {
    const abs = ref.alt ? ` (${ref.alt.label} ${num(ref.alt.value)} g)` : ''
    return ref.value !== null && ref.alt ? `AI 14 g/1000 kcal = ${base}${abs}` : `AI ${base}${ref.alt ? '' : ' (14 g/1000 kcal con tu meta)'}`
  }
  let out = `${k} ${base}`
  if (ref.alt) out += ` · ${ref.alt.label} ${num(ref.alt.value)} ${ref.unit}`
  if (ref.code === 'sodium') out += ` · OMS < ${num(2000)} ${ref.unit}`
  if (ref.ul !== null && !ref.ulSupplementOnly && ref.value !== null && ref.ul <= ref.value * 3) out += ` · UL ${num(ref.ul)} ${ref.unit}`
  return out
}

function barFor(ref: Reference, amount: number | null): NutrientRow['bar'] {
  if (amount === null || ref.value === null || ref.kind === 'none' || ref.kind === 'limit-energy') return null
  const ulShown = ref.ul !== null && !ref.ulSupplementOnly && ref.ul <= ref.value * 3 ? ref.ul : null
  const scale = Math.max(ref.value * 1.25, amount * 1.05, (ulShown ?? 0) * 1.05)
  return { fill: clamp01(amount / scale), mark: ref.value / scale, ulMark: ulShown === null ? null : ulShown / scale, band: null }
}

/** Builds the four sections. `goalKcal` is the energy goal of the selected day (null = none). */
export function buildSections(report: NutrientReport, dri: DriSet, goalKcal: number | null): NutrientSection[] {
  return SECTIONS.map((sec) => ({
    id: sec.id,
    title: sec.title,
    ...(sec.hint ? { hint: sec.hint } : {}),
    rows: sec.codes.map((code) => {
      const stat = report.stats[code]
      const amount = stat.value
      const ref = dri.refs[code]
      const lab = LABEL[code] ?? { label: code }
      const hint = coverageHint(stat.coverage, amount !== null)
      const notes: string[] = []
      let status: Status
      let refText = refLabel(ref)
      let bar: NutrientRow['bar'] = barFor(ref, amount)

      if (code === 'kcal') {
        if (goalKcal !== null && amount !== null) {
          const p = (amount / goalKcal) * 100
          status = { text: `${Math.round(p)} % de la meta`, tone: 'muted', pct: p, overUl: false }
          const scale = Math.max(goalKcal * 1.25, amount * 1.05)
          bar = { fill: clamp01(amount / scale), mark: goalKcal / scale, ulMark: null, band: null }
        } else status = { text: amount === null ? 'Sin dato' : 'Sin meta', tone: 'muted', pct: null, overUl: false }
        refText = goalKcal !== null ? `Meta ${formatNumber(goalKcal, 0)} kcal` : 'Define una meta en el perfil'
      } else if ((code === 'protein' || code === 'carbs' || code === 'fat') && dri.amdr) {
        const range = dri.amdr[code]
        const e = energyPercent(code, stat)
        if (e === null) status = { text: amount === null ? 'Sin dato' : 'Sin energía', tone: 'muted', pct: null, overUl: false }
        else {
          const st = evaluateAmdr(e, range)
          const tone: Tone = st === 'within' ? 'good' : 'warn'
          status = { text: `${pct1(e)} · ${st === 'within' ? 'dentro del rango' : st === 'below' ? 'por debajo' : 'por encima'}`, tone, pct: e, overUl: false }
          const scale = Math.max(range[1] * 1.2, e * 1.05)
          bar = { fill: clamp01(e / scale), mark: null, ulMark: null, band: [range[0] / scale, range[1] / scale] }
        }
        refText = `AMDR ${range[0]}–${range[1]} % de la energía`
        if ((code === 'protein' || code === 'carbs') && ref.value !== null && amount !== null) {
          notes.push(`${ref.kind} ${formatNutrient(code, ref.value)}: ${Math.round((amount / ref.value) * 100)} %`)
        } else if (ref.range && (code === 'protein' || code === 'carbs')) notes.push(`${ref.kind} ${refLabel(ref).replace(/^RDA /, '')}`)
      } else if (ref.kind === 'limit-energy') {
        const e = energyPercent(code, stat)
        status = evaluateIntake(ref, amount, e)
        if (e !== null && ref.pctEnergyMax !== null) {
          const scale = Math.max(ref.pctEnergyMax * 1.25, e * 1.05)
          bar = { fill: clamp01(e / scale), mark: ref.pctEnergyMax / scale, ulMark: null, band: null }
          refText += ` · tú ${pct1(e)}`
        }
      } else {
        status = evaluateIntake(ref, amount)
        if (code === 'water' && ref.value !== null) refText = `AI de agua total ${formatNumber(ref.value / 1000, 1)} L (bebidas y alimentos)`
        if (ref.ulSupplementOnly && ref.ul !== null && amount !== null && amount > ref.ul) {
          notes.push(`Supera el UL de ${formatNutrient(code, ref.ul)}, que aplica solo a suplementos o fortificantes: no es exceso por alimentos.`)
        }
        if (ref.kind === 'CDRR' && ref.value !== null && amount !== null) {
          const scale = Math.max(ref.value * 1.25, amount * 1.05)
          bar = { fill: clamp01(amount / scale), mark: ref.value / scale, ulMark: null, band: null }
        }
      }
      return {
        code,
        label: lab.label,
        ...(lab.qualifier ? { qualifier: lab.qualifier } : {}),
        amountText: amount === null ? '—' : formatNutrient(code, amount),
        refText,
        status,
        bar: amount === null ? null : bar,
        colorVar: MACRO_COLOR[code] ?? 'accent',
        coverageHint: hint,
        notes,
      }
    }),
  }))
}
