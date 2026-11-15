/** Loads the private ICBF TCAC file (generated locally, never published) into this device. */
import { NUTRIENTS, type CatalogFoodFile, type NutrientCode } from '../../db/catalogTypes'
import { refFoods } from '../../db/shared'
import type { RefFood } from '../../db/types'
import { rowToNutrientMap } from '../../domain/nutrients'

export function parseTcac(text: string): CatalogFoodFile {
  let f: CatalogFoodFile
  try {
    f = JSON.parse(text) as CatalogFoodFile
  } catch {
    throw new Error('El archivo no es JSON válido.')
  }
  if (f?.format !== 'pho-catalog-foods' || f.source !== 'icbf_tcac2015' || !Array.isArray(f.foods)) {
    throw new Error('No es el archivo de la tabla ICBF (tcac2015.json) generado por el script de la app.')
  }
  const known = new Set(NUTRIENTS.map((n) => n.code))
  const unknown = f.nutrientOrder.filter((c) => !known.has(c))
  if (unknown.length) throw new Error(`Nutrientes no reconocidos: ${unknown.join(', ')}`)
  return f
}

export function tcacToRefFoods(f: CatalogFoodFile): RefFood[] {
  const order = f.nutrientOrder as NutrientCode[]
  const now = new Date().toISOString()
  return f.foods.map(([id, name, nameEs, brand, barcode, category, kind, basis, values, portions, synonyms, flags]) => ({
    id,
    source: 'icbf_tcac2015',
    name,
    nameEs,
    brand,
    barcode,
    category,
    kind,
    basis,
    nutrients: rowToNutrientMap(values, order),
    portions: portions ?? [],
    synonyms,
    flags: flags ? flags.split(';').filter(Boolean) : [],
    datasetVersion: f.datasetVersion,
    fetchedAt: now,
  }))
}

/** Replaces any previous TCAC load on this device. Food logs keep their own snapshots. */
export async function importTcac(f: CatalogFoodFile): Promise<number> {
  const rows = tcacToRefFoods(f)
  await refFoods.clearSource('icbf_tcac2015')
  await refFoods.bulkPut(rows)
  return rows.length
}
