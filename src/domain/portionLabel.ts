/**
 * Portion labels for people (V3.1 contract 2). Catalog labels come out of USDA and Open Food Facts with
 * English leftovers, nested parentheses and several equivalences ("1 porción (14 crisps/crujientes (1 oz / 28 g))").
 * `normalizePortion` turns a raw label plus the gram/ml amount of ONE measure into `{ name, each }`, shown as
 * `name (each)`: one equivalence, no nested parentheses, no English. What cannot be translated safely is dropped,
 * never shown. Pure: stored logs keep their label; only their display goes through here.
 */

export type PortionAmountUnit = 'g' | 'ml'

export interface PortionName {
  /** Spanish name of the measure, lower case, singular/plural by its leading count: "tajada", "2 cucharadas". */
  name: string
  /** The only equivalence: "150 g", "2,5 ml". */
  each: string
}

/** Singular, plural pairs of the measure nouns the catalogs use. */
const NOUNS: readonly (readonly [string, string])[] = [
  ['porción', 'porciones'],
  ['unidad', 'unidades'],
  ['taza', 'tazas'],
  ['cucharada', 'cucharadas'],
  ['cucharadita', 'cucharaditas'],
  ['tajada', 'tajadas'],
  ['rebanada', 'rebanadas'],
  ['pieza', 'piezas'],
  ['lata', 'latas'],
  ['botella', 'botellas'],
  ['barra', 'barras'],
  ['galleta', 'galletas'],
  ['sobre', 'sobres'],
  ['paquete', 'paquetes'],
  ['envase', 'envases'],
  ['bolsa', 'bolsas'],
  ['bolsita', 'bolsitas'],
  ['tira', 'tiras'],
  ['onza', 'onzas'],
  ['onza líquida', 'onzas líquidas'],
  ['medida', 'medidas'],
  ['cucharón', 'cucharones'],
  ['palito', 'palitos'],
  ['huevo', 'huevos'],
  ['filete', 'filetes'],
  ['chuleta', 'chuletas'],
  ['bistec', 'bistecs'],
  ['sándwich', 'sándwiches'],
  ['crujiente', 'crujientes'],
  ['trozo', 'trozos'],
  ['bola', 'bolas'],
  ['fruta', 'frutas'],
  ['pechuga', 'pechugas'],
  ['medallón', 'medallones'],
  ['miniatura', 'miniaturas'],
  ['frasco', 'frascos'],
  ['vaso', 'vasos'],
  ['bebida', 'bebidas'],
  ['pizza', 'pizzas'],
  ['pancake', 'pancakes'],
  ['bagel', 'bagels'],
]
const PLURAL_OF = new Map(NOUNS.map(([s, p]) => [s, p]))
const SINGULAR_OF = new Map(NOUNS.map(([s, p]) => [p, s]))

/** English words of measures (as they appear alone or after a slash) and their Spanish noun. */
const EN_TO_ES: Record<string, string> = {
  portion: 'porción',
  portions: 'porción',
  serving: 'porción',
  servings: 'porción',
  slice: 'tajada',
  slices: 'tajada',
  cup: 'taza',
  cups: 'taza',
  tbsp: 'cucharada',
  tablespoon: 'cucharada',
  tablespoons: 'cucharada',
  tsp: 'cucharadita',
  teaspoon: 'cucharadita',
  teaspoons: 'cucharadita',
  piece: 'pieza',
  pieces: 'pieza',
  unit: 'unidad',
  units: 'unidad',
  container: 'envase',
  containers: 'envase',
  package: 'paquete',
  packages: 'paquete',
  pack: 'paquete',
  can: 'lata',
  cans: 'lata',
  bottle: 'botella',
  bottles: 'botella',
  bar: 'barra',
  bars: 'barra',
  scoop: 'medida',
  scoops: 'medida',
  stick: 'barra',
  sticks: 'barra',
  bag: 'bolsa',
  pouch: 'sobre',
  packet: 'sobre',
  cracker: 'galleta',
  crackers: 'galleta',
  cookie: 'galleta',
  cookies: 'galleta',
  large: 'grande',
  medium: 'mediano',
  small: 'pequeño',
  mini: 'mini',
  miniature: 'miniatura',
}

/** English words with no safe Spanish translation: they are dropped wherever they appear. */
const ENGLISH_NOISE = new Set([
  'crisps', 'crisp', 'chips', 'chip', 'ns', 'nfs', 'ne', 'as', 'to', 'size', 'sized', 'the', 'of', 'with', 'without', 'and', 'or', 'per', 'in', 'on', 'any',
  'fl', 'cooked', 'raw', 'excluding', 'refuse', 'yield', 'from', 'ready-to-cook', 'bite', 'single', 'prepackaged', 'standard', 'dipping-size',
  'school', 'thin', 'very', 'crust', 'not', 'eaten', 'ice', 'after', 'cooking', 'portion', 'serving', 'racc', 'nlea', 'diameter',
  'layer', 'cake', 'sandwich', 'submarine', 'fillet', 'fry', 'frankfurter', 'meatball', 'cocktail', 'pretzel', 'stick', 'baby', 'carrot', 'nut', 'cherry',
  'potato', 'root', 'tub', 'pat', 'rack', 'section', 'cracker-size', 'snack-tamaño', 'bag', 'chicken', 'breast', 'sauce', 'fish', 'meat', 'bread', 'roll',
  'beverage', 'hot', 'cereal', 'unthawed', 'packed', 'spaghetti', 'rinde', 'tamaño', 'cualquier',
])

/** Spanish qualifiers of the measure worth keeping ("taza, picado"). */
const KEEP_QUALIFIER = new Set([
  'cocido', 'cocida', 'crudo', 'cruda', 'picado', 'picada', 'rallado', 'rallada', 'en cubos', 'cubos', 'en rodajas', 'en puré', 'escurrido', 'escurrida',
  'seco', 'seca', 'molido', 'molida', 'en trozos', 'trozos', 'desmenuzado', 'desmenuzada', 'en tiras', 'en láminas', 'tajadas', 'en tajadas',
])

const MULTI_NOUN_RE = /^(onzas? líquidas?)\b/

/** "1,5", "1 1/2", "1/2", "10" → number; null when the text does not start with a count. */
function leadingCount(label: string): { count: number; text: string; rest: string } | null {
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(?=\D|$)/.exec(label)
  if (!m) return null
  const raw = m[1]!
  let count: number
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw)
  const frac = /^(\d+)\/(\d+)$/.exec(raw)
  if (mixed) count = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  else if (frac) count = Number(frac[1]) / Number(frac[2])
  else count = Number(raw.replace(',', '.'))
  if (!Number.isFinite(count) || count <= 0) return null
  return { count, text: raw.replace(/\s+/g, ' '), rest: label.slice(m[0].length).trim() }
}

/** Removes every parenthesised span, however nested. Returns the outside text and the inside texts. */
function splitParens(s: string): { outside: string; inside: string[] } {
  let depth = 0
  let outside = ''
  const inside: string[] = []
  let cur = ''
  for (const ch of s) {
    if (ch === '(') {
      depth++
      if (depth === 1) cur = ''
      else cur += ch
    } else if (ch === ')') {
      if (depth === 0) continue
      depth--
      if (depth === 0) inside.push(cur)
      else cur += ch
    } else if (depth > 0) cur += ch
    else outside += ch
  }
  if (depth > 0) inside.push(cur) // unbalanced: what was open still counts as inside
  return { outside, inside }
}

/** One slash-separated token ("crisps/crujientes", "trozo/tajada"): the first alternative that is not noise. */
function pickAlternative(token: string): string | null {
  for (const raw of token.split('/')) {
    const a = raw.trim().toLowerCase()
    if (!a || /^[\d.,]+$/.test(a)) continue
    const es = EN_TO_ES[a]
    if (es) return es
    if (!ENGLISH_NOISE.has(a)) return a
  }
  return null
}

/** Translates the known English words, drops the noise and the bare numbers, keeps everything else (heads are Spanish). */
function cleanWords(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const token = raw.replace(/^[,;:]+|[,;:]+$/g, '')
    if (!token) continue
    if (token.includes('/')) {
      const alt = pickAlternative(token)
      if (alt) out.push(alt)
      continue
    }
    if (/^[\d.,]+$/.test(token)) continue
    const es = EN_TO_ES[token]
    if (es) out.push(es)
    else if (!ENGLISH_NOISE.has(token)) out.push(token)
  }
  return out
}

const pluralize = (noun: string): string => {
  const known = PLURAL_OF.get(noun)
  if (known) return known
  const m = MULTI_NOUN_RE.exec(noun)
  if (m) return noun.replace(m[1]!, PLURAL_OF.get('onza líquida')!)
  const words = noun.split(' ')
  const head = words[0]!
  const p = PLURAL_OF.get(head)
  if (p && words.length > 1) return [p, ...words.slice(1)].join(' ')
  return noun
}
const singularize = (noun: string): string => {
  const known = SINGULAR_OF.get(noun)
  if (known) return known
  const words = noun.split(' ')
  const s = SINGULAR_OF.get(words[0]!)
  if (s && words.length > 1) return [s, ...words.slice(1)].join(' ')
  return noun
}

const num1 = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, ''))

/** "150 g", "2,5 ml". Grouped thousands never appear: 1.250 g is "1250 g". */
export function formatEach(amount: number, unit: PortionAmountUnit = 'g'): string {
  return `${num1(amount)} ${unit}`
}

const FALLBACK_NAME = 'porción'

/**
 * Raw label + the amount (g or ml) of ONE such measure → `{ name, each }`.
 * "1 porción (1 portion (150 g))", 150 → porción / 150 g · "1 tajada (25 g)", 25 → tajada / 25 g ·
 * "14 crisps/crujientes (1 oz / 28 g)", 28 → 14 crujientes / 28 g · "2 tajadas", 50 → 2 tajadas / 50 g.
 */
export function normalizePortion(label: string, amount: number, unit: PortionAmountUnit = 'g'): PortionName {
  const each = formatEach(amount, unit)
  const trimmed = (label ?? '').trim()
  if (!trimmed) return { name: FALLBACK_NAME, each }
  const lead = leadingCount(trimmed)
  const body = lead ? lead.rest : trimmed
  const { outside, inside } = splitParens(body)
  // "taza, cocido, en cubos": the measure, then qualifiers. Keep the first Spanish qualifier that says something.
  const [head = '', ...quals] = outside.split(',')
  const nameWords = cleanWords(head)
  // English adjective order leaks ("individual porción", "snack barra"): noun first.
  if (nameWords.length === 2 && (nameWords[0] === 'individual' || nameWords[0] === 'snack') && PLURAL_OF.has(nameWords[1]!)) nameWords.reverse()
  let name = nameWords.join(' ').trim()
  // A generic wrapper can contain the actual counted measure. Dropping it turns
  // "14 crujientes" into an unspecified serving, hiding what one measure means.
  if (lead?.count === 1 && name === 'porción') {
    for (const detail of inside) {
      const inner = leadingCount(detail)
      if (!inner) continue
      const [noun] = cleanWords(splitParens(inner.rest).outside.split(',')[0] ?? '')
      if (noun && (PLURAL_OF.has(noun) || SINGULAR_OF.has(noun))) return normalizePortion(detail, amount, unit)
    }
  }
  if (!name) {
    // Nothing safe in the head ("1 unidad (…)" cannot reach here; "1 NE"): fall back on the parenthesised noun or a generic.
    name = FALLBACK_NAME
  }
  const qual = quals.map((q) => q.trim().toLowerCase()).find((q) => KEEP_QUALIFIER.has(q))
  if (qual) name = `${name}, ${qual}`
  // Count: "1 x" is just "x"; "2 tajadas" keeps its count and the plural; "1/2 taza" stays a fraction.
  const count = lead?.count ?? 1
  if (lead && count !== 1) {
    const word = lead.text
    const [first, ...tail] = name.split(', ')
    const noun = count > 1 ? pluralize(first!) : first!
    name = [`${word} ${noun}`, ...tail].join(', ')
  } else {
    const [first, ...tail] = name.split(', ')
    name = [singularize(first!), ...tail].join(', ')
  }
  return { name: name.replace(/\s+/g, ' ').trim(), each }
}

/** `name (each)`. */
export function portionText(label: string, amount: number, unit: PortionAmountUnit = 'g'): string {
  const p = normalizePortion(label, amount, unit)
  return `${p.name} (${p.each})`
}

/** Collapses options whose displayed text is identical (same name and equivalence), keeping the first. */
export function dedupeByPortionText<T>(items: readonly T[], text: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const key = text(it).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}
