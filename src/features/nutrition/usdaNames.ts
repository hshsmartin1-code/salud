// Reviewed against the exact FDC description. If USDA changes the description,
// fall back to the catalog and review the row again before changing this map.
const names: Record<string, [original: string, display: string, aliases: string]> = {
  'usda_foundation:2646170': ['Chicken, breast, boneless, skinless, raw', 'Pechuga de pollo cruda, sin piel ni hueso', 'filete de pechuga'],
  'usda_foundation:334194': ['Fish, tuna, light, canned in water, drained solids', 'Atún claro en agua, escurrido', 'atun de lata enlatado'],
  'usda_sr:171986': ['Fish, tuna, light, canned in water, without salt, drained solids', 'Atún claro en agua sin sal, escurrido', 'atun de lata enlatado'],
  'usda_foundation:746782': ['Milk, whole, 3.25% milkfat, with added vitamin D', 'Leche entera con vitamina D añadida (3,25 % de grasa)', 'leche de vaca'],
  'usda_sr:172217': ['Milk, whole, 3.25% milkfat, without added vitamin A and vitamin D', 'Leche entera sin vitaminas A y D añadidas (3,25 % de grasa)', 'leche de vaca'],
  'usda_sr:172470': ['Peanut butter, smooth style, without salt', 'Mantequilla de maní cremosa, sin sal', 'crema de mani'],
}

export function reviewedUsdaName(ref: string, original: string) {
  const row = names[ref]
  return row?.[0] === original ? { display: row[1], aliases: row[2] } : null
}
