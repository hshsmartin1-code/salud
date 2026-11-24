import { describe, expect, it } from 'vitest'
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, claimChunkReload, isChunkLoadError } from './errorBoundaryLogic'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('isChunkLoadError', () => {
  it.each([
    new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js'),
    new TypeError('Importing a module script failed.'),
    Object.assign(new Error('Loading chunk 12 failed.'), { name: 'ChunkLoadError' }),
  ])('recognises %s', (e) => expect(isChunkLoadError(e)).toBe(true))
  it('ignores ordinary errors and non-errors', () => {
    expect(isChunkLoadError(new Error('x is undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false)
  })
})

describe('claimChunkReload', () => {
  const err = new TypeError('Failed to fetch dynamically imported module: /a.js')
  it('allows one reload, then refuses inside the window (no loop)', () => {
    const s = mem()
    expect(claimChunkReload(err, s, 1_000_000)).toBe(true)
    expect(s.getItem(CHUNK_RELOAD_KEY)).toBe('1000000')
    expect(claimChunkReload(err, s, 1_000_000 + 5_000)).toBe(false)
  })
  it('allows another reload after the window (a later app update)', () => {
    const s = mem()
    claimChunkReload(err, s, 1_000_000)
    expect(claimChunkReload(err, s, 1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(true)
  })
  it('never reloads for other errors or when storage is unavailable', () => {
    expect(claimChunkReload(new Error('boom'), mem())).toBe(false)
    expect(claimChunkReload(err, null)).toBe(false)
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {},
    }
    expect(claimChunkReload(err, broken)).toBe(false)
  })
})
