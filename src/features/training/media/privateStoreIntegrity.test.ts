import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPrivateSnapshot, importPackZip, inspectPackZip, loadPrivateState, PRIVATE_CACHE, privateFileUrl, removePrivatePack, setPrivateActive } from './privateStore'
import { pickActiveSource } from './store'
import { makeZip } from './testZip'

const cachesByName = new Map<string, Map<string, Response>>()
const key = (request: Request) => request.url
const manifest = {
  format: 'pho-media-pack', version: 1,
  pack: { id: 'synthetic-pack', style: 'Synthetic', attribution: 'Synthetic fixture', version: 1, basePath: '', license: { status: 'private-local' } },
  records: { 'synthetic:exercise': {
    exerciseId: 'synthetic:exercise', source: 'synthetic-pack', license: { status: 'private-local' }, version: 1, availability: 'bundled',
    thumb: { src: 'media/image.webp', width: 64, height: 64, format: 'webp' },
    images: [{ src: 'media/image.webp', width: 64, height: 64, format: 'webp' }],
  } },
}
beforeEach(async () => {
  cachesByName.clear()
  vi.stubGlobal('self', { location: { origin: 'https://synthetic.invalid' } })
  vi.stubGlobal('caches', {
    has: async (name: string) => cachesByName.has(name),
    delete: async (name: string) => cachesByName.delete(name),
    open: async (name: string) => {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map())
      const entries = cachesByName.get(name)!
      return { match: async (request: Request) => entries.get(key(request))?.clone(), put: async (request: Request, response: Response) => { entries.set(key(request), response.clone()) } }
    },
  })
  let serial = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:synthetic-${serial++}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  await removePrivatePack()
})
afterEach(async () => { await removePrivatePack(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function importSynthetic() {
  const bytes = await makeZip([
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)), method: 0 },
    { name: 'media/image.webp', data: new Uint8Array([7, 8, 9]), method: 0 },
  ])
  const archive = new Blob([bytes as BlobPart])
  await importPackZip(archive, await inspectPackZip(archive))
}

it('requires activation and revokes a cached blob URL when the private pack is removed', async () => {
  await importSynthetic()
  expect(pickActiveSource(getPrivateSnapshot())).toBe('bundled')
  await setPrivateActive(true)
  expect(pickActiveSource(getPrivateSnapshot())).toBe('private')
  const url = await privateFileUrl('media/image.webp')
  expect(url).toBe('blob:synthetic-0')
  expect(await privateFileUrl('media/image.webp')).toBe(url)
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  await removePrivatePack()
  await Promise.resolve()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  expect(pickActiveSource(getPrivateSnapshot())).toBe('bundled')
})

it('disables a corrupt stored manifest and selects the bundled pack', async () => {
  await importSynthetic()
  await setPrivateActive(true)
  const entries = cachesByName.get(PRIVATE_CACHE)!
  const manifestKey = [...entries.keys()].find((k) => k.endsWith('/manifest.json'))!
  entries.set(manifestKey, new Response('{broken'))
  const state = await loadPrivateState(true)
  expect(state.status).toBe('corrupt')
  expect(state.active).toBe(false)
  expect(state.pack).toBeNull()
  expect(pickActiveSource(state)).toBe('bundled')
})
