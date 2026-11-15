import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo } from 'react'
import { useRepo } from '../../app/profile'
import { refFoods } from '../../db/shared'
import { makeIndex, mergeIndexes, useFoodCatalog } from './catalog'
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
  const index = useMemo(() => (catalog ? mergeIndexes(makeIndex(dynamic), catalog.index) : makeIndex(dynamic)), [catalog, dynamic])
  const resolve = useCallback((ref: string): Food | undefined => dynamicMap.get(ref) ?? catalog?.byRef.get(ref), [dynamicMap, catalog])
  const byBarcode = useCallback(
    (code: string): Food | undefined => dynamic.find((f) => f.barcode === code) ?? catalog?.byBarcode.get(code),
    [dynamic, catalog],
  )
  return {
    ready: !!catalog && customs !== undefined && recipes !== undefined && refs !== undefined,
    catalogError: error,
    index,
    resolve,
    byBarcode,
    customs: customs ?? [],
    recipes: recipes ?? [],
    tcacCount: (refs ?? []).filter((x) => x.source === 'icbf_tcac2015').length,
  }
}
