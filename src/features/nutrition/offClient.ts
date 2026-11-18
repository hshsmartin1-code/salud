import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { APP_VERSION } from '../../db/backup'
import type { RefFood } from '../../db/types'
import { barcodeKey, foodBarcode, foodQuery } from './foodSearchIndex'
import { offToRefFood, type OffProduct, type OffResult } from './off'

const FIELDS = 'code,product_name,product_name_es,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments,categories_tags,countries_tags,product_quantity,product_quantity_unit,nutrition_data_per,image_front_small_url,rev'
const OFF = 'https://world.openfoodfacts.org'
// Names the app and its version only: the request must not point at the person who uses it.
const USER_AGENT = `Salud/${APP_VERSION} (personal nutrition diary; Android)`
const WINDOW = 60_000
const TTL = 5 * WINDOW
const TIMEOUT = 5_000
const PAGE_SIZE = 20
const MAX_PAGE = 10

export type OffScope = 'world' | 'co'
type UnavailableProduct = { code: string; name: string; issue: string }
export type OffPage = { foods: RefFood[]; unavailable: UnavailableProduct[]; hasMore: boolean }
type Failure = { error: string }
type Method = 'search' | 'barcode'
type Get = (url: string, signal: AbortSignal) => Promise<{ status: number; retryAfter: string | null; json: () => Promise<unknown> }>

async function get(url: string, signal: AbortSignal) {
  const headers = { Accept: 'application/json' }
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.get({ url, headers: { ...headers, 'User-Agent': USER_AGENT }, connectTimeout: TIMEOUT, readTimeout: TIMEOUT, responseType: 'json' })
    const retry = Object.keys(result.headers).find((h) => h.toLowerCase() === 'retry-after')
    return { status: result.status, retryAfter: retry ? result.headers[retry] : null, json: async () => result.data as unknown }
  }
  const result = await fetch(url, { signal, headers, credentials: 'omit', referrerPolicy: 'no-referrer' })
  return { status: result.status, retryAfter: result.headers.get('retry-after'), json: () => result.json() as Promise<unknown> }
}

export function createOffClient({ request = get, now = Date.now, timeout = TIMEOUT }: { request?: Get; now?: () => number; timeout?: number } = {}) {
  const cache = new Map<string, { value: unknown; expires: number }>()
  const inFlight = new Map<string, Promise<unknown>>()
  const budgets: Record<Method, { requests: number[]; until: number; max: number }> = {
    search: { requests: [], until: 0, max: 10 },
    barcode: { requests: [], until: 0, max: 15 },
  }

  async function load<T>(url: string, method: Method, decode: (body: unknown) => T): Promise<T | Failure> {
    const cached = cache.get(url)
    const time = now()
    if (cached && cached.expires > time) return cached.value as T
    const previous = inFlight.get(url)
    if (previous) return previous as Promise<T | Failure>
    if (globalThis.navigator?.onLine === false) return { error: 'Sin conexión. Puedes seguir usando el catálogo local.' }
    const budget = budgets[method]
    budget.requests = budget.requests.filter((t) => time - t < WINDOW)
    if (time < budget.until || budget.requests.length >= budget.max)
      return { error: 'Se alcanzó el límite de Open Food Facts. Vuelve a intentar en un momento.' }
    budget.requests.push(time)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, timeout)
    })
    const pending = Promise.race([deadline, (async () => {
      const res = await request(url, controller.signal)
      if (controller.signal.aborted) throw new Error('timeout')
      if (res.status === 429 || res.status === 503) {
        const seconds = res.retryAfter ? Number(res.retryAfter) : NaN
        const until = Number.isFinite(seconds) ? now() + seconds * 1000 : Date.parse(res.retryAfter ?? '')
        budget.until = Math.max(budget.until, Number.isFinite(until) && until > now() ? until : now() + WINDOW)
        return { error: res.status === 429 ? 'Open Food Facts limitó las consultas. Vuelve a intentar en un momento.' : 'Open Food Facts no está disponible temporalmente.' }
      }
      if (res.status === 404 && method === 'barcode') return decode(null)
      if (res.status < 200 || res.status >= 300) return { error: `Open Food Facts no respondió correctamente (${res.status}).` }
      const body = await res.json()
      if (controller.signal.aborted) throw new Error('timeout')
      const value = decode(body)
      if (cache.size >= 64) cache.delete(cache.keys().next().value!)
      cache.set(url, { value, expires: now() + TTL })
      return value
    })()]).catch((): Failure => ({
      error: controller.signal.aborted ? 'Open Food Facts tardó demasiado. Puedes seguir usando el catálogo local.' : 'No se pudo consultar Open Food Facts.',
    })).finally(() => {
      clearTimeout(timer)
      inFlight.delete(url)
    })
    inFlight.set(url, pending)
    return pending
  }

  return {
    search(query: string, page: number, scope: OffScope): Promise<OffPage | Failure> {
      const q = foodQuery(query).remote
      if (q.length < 3 || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) return Promise.resolve({ error: 'Consulta no válida.' })
      // Product Opener v2's JSON search ignores free text. The CGI endpoint works from a browser via CORS.
      const params = new URLSearchParams({ search_terms: q, search_simple: '1', action: 'process', json: '1',
        page: String(page), page_size: String(PAGE_SIZE), fields: FIELDS })
      if (scope === 'co') {
        params.set('tagtype_0', 'countries')
        params.set('tag_contains_0', 'contains')
        params.set('tag_0', 'colombia')
      }
      return load(`${OFF}/cgi/search.pl?${params}`, 'search', (data): OffPage => {
        const { count, products } = (data ?? {}) as { count?: number; products?: OffProduct[] }
        if (!Array.isArray(products)) throw new Error('Unexpected OFF search response')
        const foods = new Map<string, RefFood>()
        const unavailable = new Map<string, UnavailableProduct>()
        for (const product of products) {
          if (!product) continue
          const c = foodBarcode(String(product.code ?? ''))
          if (!c) continue
          const key = barcodeKey(c)
          const result = offToRefFood(product)
          if ('food' in result) {
            const previous = foods.get(key)
            if (!previous || Object.keys(result.food.nutrients).length > Object.keys(previous.nutrients).length) foods.set(key, result.food)
            unavailable.delete(key)
          } else if (!foods.has(key)) {
            unavailable.set(key, { code: c, name: product.product_name_es || product.product_name || c, issue: result.error })
          }
        }
        return { foods: [...foods.values()], unavailable: [...unavailable.values()],
          hasMore: page < MAX_PAGE && products.length > 0 && (Number.isFinite(Number(count)) ? page * PAGE_SIZE < Number(count) : products.length === PAGE_SIZE) }
      })
    },
    barcode(raw: string): Promise<OffResult> {
      const code = foodBarcode(raw)
      if (!code) return Promise.resolve({ error: 'Ingresa un código de 6 a 14 dígitos.' })
      return load(`${OFF}/api/v3/product/${code}?fields=${FIELDS}`, 'barcode', (data): OffResult => {
        const { product } = (data ?? {}) as { product?: OffProduct }
        if (!product) return { error: 'Producto no encontrado en Open Food Facts.' }
        if (product.code && barcodeKey(String(product.code)) !== barcodeKey(code)) return { error: 'El código recibido no coincide con el código consultado.' }
        return offToRefFood({ ...product, code: product.code ?? code })
      })
    },
  }
}

export const offClient = createOffClient()
