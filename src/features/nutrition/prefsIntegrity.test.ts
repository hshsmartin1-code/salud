import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { readKeepAdding, useIdeasHidden, writeKeepAdding } from './prefs'

afterEach(() => vi.unstubAllGlobals())
it('scopes hide-for-today by both profile and diary date, and keep-adding by profile', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) })
  const read = (profile: string, date: string) => {
    let result!: ReturnType<typeof useIdeasHidden>
    renderToStaticMarkup(createElement(() => { result = useIdeasHidden(profile, date); return null }))
    return result
  }
  read('synthetic-a', '2026-11-10')[1](true)
  expect(read('synthetic-a', '2026-11-10')[0]).toBe(true)
  expect(read('synthetic-b', '2026-11-10')[0]).toBe(false)
  expect(read('synthetic-a', '2026-11-11')[0]).toBe(false)
  writeKeepAdding('synthetic-a', false)
  expect(readKeepAdding('synthetic-a')).toBe(false)
  expect(readKeepAdding('synthetic-b')).toBe(true)
})
