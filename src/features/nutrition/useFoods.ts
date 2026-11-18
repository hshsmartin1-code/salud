import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo } from 'react'
import { useRepo } from '../../app/profile'
import { refFoods } from '../../db/shared'
import { useFoodCatalog } from './catalog'
import { barcodeKey, indexFoods } from './foodSearchIndex'
import { fromCustomFood, fromRecipe, fromRefFood, type Food } from './food'

/** Every food the active profile can log: public catalog + device reference foods + own foods + own recipes. */
export function useFoods() {
  const r = useRepo()
  const { catalog, error } = useFoodCatalog()
  const refs = useLiveQuery(() => refFoods.all(), [])
  const customs = useLiveQuery(() => r.all('customFoods'), [r])
  const recipes = useLiveQuery(() => r.all('recipes'), [r])
  const dynamic = useMemo<Food[]>(
    () => [
      ...(customs ?? []).map(fromCustomFood),
      ...(recipes ?? []).map(fromRecipe),
      ...(refs ?? []).map(fromRefFood),
    ],
    [customs, recipes, refs],
  )
  const dynamicMap = useMemo(() => new Map(dynamic.map((f) => [f.ref, f])), [dynamic])
  const indexes = useMemo(() => {
    const local = indexFoods(dynamic)
    return catalog ? [local, catalog.index] : [local]
  }, [catalog, dynamic])
  const resolve = useCallback((ref: string): Food | undefined => dynamicMap.get(ref) ?? catalog?.byRef.get(ref), [dynamicMap, catalog])
  const byBarcode = useCallback(
    (code: string): Food | undefined => {
      const key = barcodeKey(code)
      return dynamic.find((f) => f.barcode && barcodeKey(f.barcode) === key) ?? catalog?.byBarcode.get(key)
    },
    [dynamic, catalog],
  )
  return {
    ready: !!catalog && customs !== undefined && recipes !== undefined && refs !== undefined,
    catalogError: error,
    indexes,
    resolve,
    byBarcode,
    customs: customs ?? [],
    recipes: recipes ?? [],
    tcacCount: (refs ?? []).filter((x) => x.source === 'icbf_tcac2015').length,
  }
}
