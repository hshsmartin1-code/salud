import type { NewRow, Repo } from '../../db/repo'
import type { CustomFood } from '../../db/types'

export type LabelFoodDraft = Omit<NewRow<CustomFood>, 'id'>

/** One mounted editor: coalesce pending saves and remember ids before live queries catch up. */
export function createLabelSaver() {
  type Form = { createdId?: string; pending: Map<string, Promise<CustomFood>> }
  let databases = new WeakMap<Repo['db'], Map<string, Form>>()
  return {
    reset() { databases = new WeakMap() },
    save(r: Repo, data: LabelFoodDraft, id?: string): Promise<CustomFood> {
      let profiles = databases.get(r.db)
      if (!profiles) databases.set(r.db, profiles = new Map())
      let form = profiles.get(r.profileId)
      if (!form) profiles.set(r.profileId, form = { pending: new Map() })
      const scope = form
      const target = id ?? scope.createdId
      const key = target ?? 'new'
      const pending = scope.pending.get(key)
      if (pending) return pending
      const write = target ? r.db.transaction('rw', r.db.customFoods, async () => {
        const current = await r.get('customFoods', target)
        if (!current) throw new Error('El alimento ya no existe en este perfil')
        return r.put('customFoods', { ...current, ...data })
      }) : r.add('customFoods', data)
      const result = write.then((row) => { scope.createdId = row.id; return row })
        .finally(() => { scope.pending.delete(key) })
      scope.pending.set(key, result)
      return result
    },
  }
}
