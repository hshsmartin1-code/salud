import { useEffect, useRef, useState } from 'react'
import { barcodeKey } from './foodSearchIndex'
import { offClient, type OffPage, type OffScope } from './offClient'

type State = OffPage & { key: string; page: number; busy: boolean; error?: string }
const empty = { foods: [], unavailable: [], hasMore: false, busy: false, page: 0 }

/** An explicit search is debounced and scoped to the displayed query. Typing alone stays offline. */
export function useOffSearch(query: string, scope: OffScope) {
  const key = `${scope}:${query}`
  const [state, setState] = useState<State | null>(null)
  const current = state?.key === key ? state : null
  const request = useRef<{ id: number; timer?: ReturnType<typeof setTimeout> }>({ id: 0 })
  useEffect(() => {
    setState((previous) => previous?.key === key ? previous : null)
    return () => {
      request.current.id++
      clearTimeout(request.current.timer)
    }
  }, [key])

  function search() {
    if (current?.busy) return
    const base = current ?? { ...empty, key }
    const page = base.page + 1
    const id = ++request.current.id
    clearTimeout(request.current.timer)
    setState({ ...base, busy: true, error: undefined })
    request.current.timer = setTimeout(async () => {
      const result = await offClient.search(query, page, scope)
      if (request.current.id !== id) return
      if ('error' in result) {
        setState({ ...base, busy: false, error: result.error })
        return
      }
      const foods = new Map(base.foods.map((f) => [barcodeKey(f.barcode ?? f.id), f]))
      const unavailable = new Map(base.unavailable.map((f) => [barcodeKey(f.code), f]))
      for (const f of result.foods) {
        const code = barcodeKey(f.barcode ?? f.id)
        if (!foods.has(code)) foods.set(code, f)
        unavailable.delete(code)
      }
      for (const f of result.unavailable) {
        const code = barcodeKey(f.code)
        if (!foods.has(code)) unavailable.set(code, f)
      }
      setState({ key, page, busy: false, hasMore: result.hasMore, foods: [...foods.values()], unavailable: [...unavailable.values()] })
    }, 350)
  }

  return { ...current, search }
}
