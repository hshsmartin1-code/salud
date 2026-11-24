/** Cheap, regex-only detection of free-text food descriptions. Kept apart from foodText.ts so the label parser (labelText) loads only when text is actually read. */
export const NUMBER = '[-−]?\\d+(?:[.,]\\d+)*'
export const MEASURE = '(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d*[½⅓⅔¼¾⅛]|\\d+(?:[.,]\\d+)*)'
export const MASS = '(?:kilogramos?|gramos?|kgs?|grs?|g)'
export const VOLUME = '(?:mililitros?|litros?|mL|cc|L)'
export const ENERGY = '(?:kilocalor[ií]as?|calor[ií]as?|kcals?|kJ)'
export const NUTRIENT_UNIT = `(?:${ENERGY}|mg|µg|mcg|g|gramos?|miligram[oa]s?)`
export const NUTRIENT = '(?:valor energ[eé]tico|energ[ií]a|calor[ií]as?|prote[ií]nas?|prot|carbohidratos?(?:\\s+totales)?|carbos?|hidratos de carbono|grasa(?:s)?(?:\\s+(?:totales?|saturadas?|trans))?|l[ií]pidos?|fibra(?: dietaria)?|az[uú]cares?(?:\\s+(?:totales?|a[nñ]adidos?))?|sodio|sal)'
export const FACT = new RegExp(`(?<![\\p{L}\\d])(?:(${NUTRIENT})\\s*[:=]?\\s*(${NUMBER})(?![\\d.,]\\d|\\d|\\s*%)(?:\\s*(${NUTRIENT_UNIT})(?![\\p{L}]))?|(${NUMBER})\\s*(${NUTRIENT_UNIT})(?![\\p{L}])(?:\\s+(?:de\\s+)?(${NUTRIENT})(?![\\p{L}:=]|\\s*\\d))?)`.replaceAll('\\s', '[^\\S\\r\\n]'), 'giu')
export const INTAKE_PREFIX = /^(?:(?:hoy\s+)?(?:me\s+)?(?:com[ií]|consum[ií]|tom[eé]|beb[ií]|registr[eé]|agrega(?:r)?)\s+|alimento\s*[:=]\s*)/i

export function sentenceFacts(text: string) {
  return [...text.matchAll(FACT)].flatMap((m) => {
    const [, label, value, unit, reversedValue, reversedUnit, reversedLabel] = m
    if (label) return [{ index: m.index, line: `${label}: ${value} ${unit ?? ''}` }]
    if (reversedLabel && !new RegExp(`^${ENERGY}$`, 'i').test(reversedUnit!))
      return [{ index: m.index, line: `${reversedLabel}: ${reversedValue} ${reversedUnit}` }]
    if (new RegExp(`^${ENERGY}$`, 'i').test(reversedUnit!))
      return [{ index: m.index, line: `Energía: ${reversedValue} ${reversedUnit}` }]
    return []
  })
}

export function isFoodNarrative(text: string) {
  const trimmed = text.trim()
  return /[\r\n]/.test(trimmed) || INTAKE_PREFIX.test(trimmed) || sentenceFacts(trimmed).length > 0
}
