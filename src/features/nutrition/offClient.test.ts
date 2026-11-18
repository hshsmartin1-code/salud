import { describe, expect, it, vi } from 'vitest'
import { createOffClient } from './offClient'

const product = { code: '7702914111508', product_name: 'Ramito', countries_tags: ['en:colombia'],
  brands: 'Ramo', quantity: '250 g', nutriments: { 'energy-kcal_100g': 400 } }
const response = (status: number, data?: unknown, retryAfter: string | null = null) => ({ status, retryAfter, json: async () => data })

describe('Open Food Facts requests', () => {
  it('deduplicates a page and concurrent requests, caches pages and runs the correct country query', async () => {
    const get = vi.fn(async (_url: string) => response(200, { count: 24, products: [
      product, { ...product, code: `0${product.code}`, nutriments: {} },
      { ...product, code: '7702914598842', nutriments: {} },
    ] }))
    const client = createOffClient({ request: get })
    const [one, two] = await Promise.all([client.search('RÁMITO', 1, 'co'), client.search('ramito', 1, 'co')])
    expect(one).toEqual(two)
    expect(one).toMatchObject({ foods: [{ barcode: product.code, soldInColombia: true }], unavailable: [{ code: '7702914598842' }], hasMore: true })
    expect(await client.search('ramito', 1, 'co')).toEqual(one)
    expect(get).toHaveBeenCalledTimes(1)
    const request = new URL(get.mock.calls[0]![0])
    expect(request.searchParams.get('tag_0')).toBe('colombia')
    const second = await client.search('ramito', 2, 'world')
    expect(second).toMatchObject({ hasMore: false })
    expect(new URL(get.mock.calls[1]![0]).searchParams.get('tag_0')).toBeNull()
    expect(new URL(get.mock.calls[1]![0]).searchParams.get('page')).toBe('2')
  })

  it('handles no hits and invalid or mismatched codes', async () => {
    const get = vi.fn(async (url: string) => response(200, url.includes('/product/') ? { product } : { count: 0, products: [] }))
    const client = createOffClient({ request: get })
    expect(await client.search('zzzzzzzz', 1, 'world')).toEqual({ foods: [], unavailable: [], hasMore: false })
    expect(await client.barcode('bad code')).toHaveProperty('error')
    expect(await client.barcode('7702914598842')).toMatchObject({ error: expect.stringContaining('no coincide') })
    expect(await client.barcode(product.code)).toMatchObject({ food: { id: `off:${product.code}` } })
    expect(get).toHaveBeenCalledTimes(3)
  })

  it.each([429, 503])('honors Retry-After on %i and does not send retries until allowed', async (status) => {
    let time = 1_000
    const get = vi.fn().mockResolvedValueOnce(response(status, null, '4')).mockResolvedValue(response(200, { count: 0, products: [] }))
    const client = createOffClient({ request: get, now: () => time })
    expect(await client.search('ramo', 1, 'world')).toHaveProperty('error')
    time += 3_999
    expect(await client.search('ramito', 1, 'world')).toHaveProperty('error')
    expect(get).toHaveBeenCalledTimes(1)
    time += 1
    expect(await client.search('ramito', 1, 'world')).toHaveProperty('foods')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('enforces the local minute budget independently of barcode reads and expires the cache', async () => {
    let time = 10_000
    const get = vi.fn(async (url: string) => response(200, url.includes('/product/') ? { product } : { count: 0, products: [] }))
    const client = createOffClient({ request: get, now: () => time })
    for (let i = 0; i < 10; i++) expect(await client.search(`queso ${i}`, 1, 'world')).toHaveProperty('foods')
    expect(await client.search('queso 10', 1, 'world')).toHaveProperty('error')
    expect(await client.barcode(product.code)).toHaveProperty('food')
    time += 60_001
    await client.search('queso 0', 1, 'world')
    expect(get).toHaveBeenCalledTimes(11)
    time += 300_001
    await client.search('queso 0', 1, 'world')
    expect(get).toHaveBeenCalledTimes(12)
  })

  it('times out a late response and recovers from a network error', async () => {
    const get = vi.fn().mockImplementationOnce((_url: string, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })).mockRejectedValueOnce(new Error('network')).mockResolvedValue(response(200, { count: 0, products: [] }))
    const client = createOffClient({ request: get, timeout: 10 })
    expect(await client.search('ramo', 1, 'world')).toMatchObject({ error: expect.stringContaining('tardó demasiado') })
    expect(await client.search('ramo', 1, 'world')).toMatchObject({ error: expect.stringContaining('No se pudo') })
    expect(await client.search('ramo', 1, 'world')).toHaveProperty('foods')
  })
})
