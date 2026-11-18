import { useEffect, useState } from 'react'
import type { CatalogFoodFile } from '../../db/catalogTypes'
import { fromCatalogRow, type Food } from './food'
import { barcodeKey, indexFoods, type FoodSearchIndex } from './foodSearchIndex'

export interface ManifestFile {
  path: string
  format: string
  source: string
  datasetVersion: string
  license: string
  attribution: string
  count: number
  bytes: number
  sha256: string
}

export interface FoodCatalog {
  foods: Food[]
  byRef: Map<string, Food>
  byBarcode: Map<string, Food>
  index: FoodSearchIndex
  files: ManifestFile[]
}

const BASE = import.meta.env.BASE_URL
const FALLBACK_FOOD_FILES = ['data/foods-usda.json', 'data/foods-off-co.json']

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`)
  return (await res.json()) as T
}

let manifestPromise: Promise<ManifestFile[]> | null = null
export function loadManifest(): Promise<ManifestFile[]> {
  manifestPromise ??= fetchJson<{ files: ManifestFile[] }>('data/catalog-manifest.json')
    .then((m) => m.files)
    .catch(() => [])
  return manifestPromise
}

let catalogPromise: Promise<FoodCatalog> | null = null
export function loadFoodCatalog(): Promise<FoodCatalog> {
  catalogPromise ??= (async () => {
    const manifest = await loadManifest()
    const foodFiles = manifest.filter((f) => f.format === 'pho-catalog-foods')
    const paths = foodFiles.length ? foodFiles.map((f) => f.path) : FALLBACK_FOOD_FILES
    const files = await Promise.all(paths.map((p) => fetchJson<CatalogFoodFile>(p).catch(() => null)))
    const foods: Food[] = []
    const infos: ManifestFile[] = []
    files.forEach((file, i) => {
      if (!file) return
      for (const row of file.foods) foods.push(fromCatalogRow(row, file.nutrientOrder, file.datasetVersion))
      infos.push(
        foodFiles[i] ?? {
          path: paths[i],
          format: file.format,
          source: String(file.source),
          datasetVersion: file.datasetVersion,
          license: file.license,
          attribution: file.attribution,
          count: file.foods.length,
          bytes: 0,
          sha256: '',
        },
      )
    })
    if (foods.length === 0) throw new Error('No se pudo cargar el catálogo de alimentos')
    const byRef = new Map(foods.map((f) => [f.ref, f]))
    const byBarcode = new Map<string, Food>()
    for (const f of foods) if (f.barcode) byBarcode.set(barcodeKey(f.barcode), f)
    return { foods, byRef, byBarcode, index: indexFoods(foods), files: infos }
  })()
  catalogPromise.catch(() => {
    catalogPromise = null
  })
  return catalogPromise
}

export function useFoodCatalog(): { catalog: FoodCatalog | null; error: string | null } {
  const [state, setState] = useState<{ catalog: FoodCatalog | null; error: string | null }>({ catalog: null, error: null })
  useEffect(() => {
    let alive = true
    loadFoodCatalog().then(
      (catalog) => alive && setState({ catalog, error: null }),
      (e: Error) => alive && setState({ catalog: null, error: e.message }),
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}
