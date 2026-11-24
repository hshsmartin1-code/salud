import type { NutrientMap } from '../../db/catalogTypes'
import { parseLabelText, type LabelColumnBasis, type ParsedLabel } from '../../domain/labelText'
import type { NutrientCode } from '../../db/catalogTypes'
import { parseAmount } from './amountParse'
import { INTAKE_PREFIX, MASS, MEASURE, VOLUME, sentenceFacts } from './foodNarrative'

export { isFoodNarrative } from './foodNarrative'

export type TextUnit = 'g' | 'ml' | 'serving'
export type TextBasis = LabelColumnBasis | 'consumed'

const BASIS = /\b(?:por\s+(?:cada\s+)?|(?:en\s+)?base\s*[:=]\s*)(100\s*(?:ml|g(?:r(?:amos?)?)?)\b|(?:una\s+)?porci[oó]n\b|(?:unidad|envase|paquete)\b|lo\s+que\s+(?:com[ií]|consum[ií]|tom[eé])(?!\p{L}))/giu

function basisOf(value: string): TextBasis {
  if (/^100\s*ml/i.test(value)) return '100ml'
  if (/^100/i.test(value)) return '100g'
  if (/envase|paquete/i.test(value)) return 'package'
  if (/^lo que/i.test(value)) return 'consumed'
  return 'serving'
}

function measure(qty: number, raw: string): { qty: number; unit: TextUnit } {
  const u = raw.toLowerCase()
  if (u.startsWith('kg') || u.startsWith('kilo')) return { qty: qty * 1000, unit: 'g' }
  if (u === 'l' || u.startsWith('litro')) return { qty: qty * 1000, unit: 'ml' }
  return { qty, unit: u === 'ml' || u === 'cc' || u.startsWith('mililitro') ? 'ml' : 'g' }
}

export function readFoodText(raw: string) {
  const text = raw.trim().slice(0, 20_000).normalize('NFC').replace(/\r\n/g, '\n')
  const original = parseLabelText(text)
  const bases = [...text.matchAll(BASIS)]
  const facts = sentenceFacts(text)
  const explicit = [...new Set(bases.map((b) => basisOf(b[1]!)))]
  const table = original.columns.length > 1 && !original.basisInferred
  const normalized = new Map<TextBasis | '', string[]>()
  for (const fact of facts) {
    const marker = bases.findLast((b) => b.index < fact.index)
    const key = marker ? basisOf(marker[1]!) : (explicit.length === 1 ? explicit[0]! : '')
    const group = normalized.get(key) ?? []
    group.push(fact.line)
    normalized.set(key, group)
  }
  const groups: { basis: TextBasis | ''; nutrients: NutrientMap; warnings: string[] }[] = []
  if (table || (original.nutrients.length && original.nutrients.length >= facts.length && !normalized.has('consumed'))) {
    for (const column of original.columns) {
      const nutrients = original.byBasis[column]
      if (nutrients && Object.keys(nutrients).length) groups.push({
        basis: original.basisInferred ? '' : column, nutrients,
        warnings: original.nutrients.filter((n) => n.basis === column && n.uncertain).map((n) => n.note ?? `Revisa ${n.sourceText}`),
      })
    }
  } else {
    for (const [basis, lines] of normalized) {
      const parsed = parseLabelText(lines.join('\n'))
      const values = parsed.byBasis[parsed.columns[0] ?? '100g']
      if (values && Object.keys(values).length) groups.push({ basis, nutrients: values,
        warnings: [...new Set([...parsed.nutrients.filter((n) => n.uncertain).map((n) => n.note ?? `Revisa ${n.sourceText}`),
          ...parsed.warnings.filter((warning) => /repet|contradic/i.test(warning))])],
      })
    }
  }

  const firstFact = Math.min(facts[0]?.index ?? Infinity, bases[0]?.index ?? Infinity)
  let head = text.slice(0, firstFact).split(/[\n.!?;](?!\d)/, 1)[0]!.trim().replace(INTAKE_PREFIX, '')
  if (/^(?:informaci[oó]n nutricional|tabla nutricional|tama[nñ]o de (?:la )?porci[oó]n|contenido neto)\b/i.test(head)) head = ''
  head = head.replace(/[,\s]+$/, '')
  let qty: number | null = null
  let unit: TextUnit = 'g'
  let portion: { qty: number; unit: 'g' | 'ml' } | null = null
  // The size following `de` is the whole serving, while a leading fraction says how much was eaten.
  const fraction = new RegExp(`^(media|medio|un cuarto de|${MEASURE})\\s+(?:de\\s+)?(.+?)\\s+de\\s+(${MEASURE})\\s*(${MASS}|${VOLUME})$`, 'iu').exec(head)
  const weight = new RegExp(`^(?:(${MEASURE})\\s*(${MASS}|${VOLUME})\\s+(?:de\\s+)?(.+)|(.+?)[,\\s]+(${MEASURE})\\s*(${MASS}|${VOLUME}))$`, 'iu').exec(head)
  const portions = new RegExp(`^(media|medio|un cuarto de|${MEASURE})\\s+(?:porciones?\\s+de\\s+|unidades?\\s+de\\s+|de\\s+)?(.+)$`, 'iu').exec(head)
  const count = (s: string) => /^medi[ao]$/i.test(s) ? .5 : /^un cuarto de$/i.test(s) ? .25 : parseAmount(s)
  if (fraction) {
    const whole = measure(parseAmount(fraction[3]!) ?? 0, fraction[4]!)
    if (whole.qty > 0 && whole.unit !== 'serving') portion = { qty: whole.qty, unit: whole.unit }
    qty = count(fraction[1]!)
    unit = 'serving'
    head = fraction[2]!
  } else if (weight) {
    const consumed = measure(parseAmount(weight[1] ?? weight[5]!) ?? 0, weight[2] ?? weight[6]!)
    qty = consumed.qty
    unit = consumed.unit
    head = weight[3] ?? weight[4]!
  } else if (portions) {
    qty = count(portions[1]!)
    unit = 'serving'
    head = portions[2]!
  }
  head = head.replace(/\s+(?:tiene|aporta|contiene|son|con|de)\s*$/i, '').replace(/[,.:;\s]+$/, '').trim()
  const name = /\p{L}/u.test(head) ? `${head[0]!.toLocaleUpperCase('es-CO')}${head.slice(1)}`.slice(0, 120) : ''
  return { name, qty, unit, portion, groups, original }
}

/** Product labels still use the column-aware reader. Explicit prose bases can supply additional rows. */
export function readPastedLabel(text: string): { parsed: ParsedLabel; name: string } {
  const { name, original, groups } = readFoodText(text)
  const explicit = groups.filter((g): g is typeof g & { basis: LabelColumnBasis } => !!g.basis && g.basis !== 'consumed')
  if (explicit.reduce((count, g) => count + Object.keys(g.nutrients).length, 0) <= original.nutrients.length) return { name, parsed: original }
  return {
    name,
    parsed: {
      ...original,
      columns: explicit.map((g) => g.basis), basisInferred: false,
      byBasis: Object.fromEntries(explicit.map((g) => [g.basis, g.nutrients])),
      nutrients: explicit.flatMap((g) => Object.entries(g.nutrients).map(([code, value]) => ({
        code: code as NutrientCode, value, basis: g.basis, sourceText: text,
        sourceUnit: null, converted: false, uncertain: !!g.warnings.length, note: g.warnings.join(' ') || undefined,
      }))),
      warnings: explicit.flatMap((g) => g.warnings),
    },
  }
}
