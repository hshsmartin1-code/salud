/** Access to SHARED tables (no personal data): reference foods and app meta. */
import { db } from './schema'
import type { RefFood } from './types'

export const refFoods = {
  all: () => db.refFoods.toArray(),
  bySource: (source: RefFood['source']) => db.refFoods.where('source').equals(source).toArray(),
  byBarcode: (code: string) => db.refFoods.where('barcode').equals(code).first(),
  get: (id: string) => db.refFoods.get(id),
  put: (row: RefFood) => db.refFoods.put(row),
  bulkPut: (rows: RefFood[]) => db.refFoods.bulkPut(rows),
  count: (source?: RefFood['source']) => (source ? db.refFoods.where('source').equals(source).count() : db.refFoods.count()),
  clearSource: (source: RefFood['source']) => db.refFoods.where('source').equals(source).delete(),
}
