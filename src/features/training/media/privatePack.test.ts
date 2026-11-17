import { describe, expect, it } from 'vitest'
import { createMediaIndex, licenseAllowsRender } from './manifest'
import { disallowedEntries, validatePrivateManifest } from './privateManifest'
import { pickActiveSource } from './store'
import { inspectPackZip } from './privateStore'
import { makeZip } from './testZip'

const FILES = new Set(['a/thumb.webp', 'a/one.webp', 'a/two.webp', 'a/clip.mp4', 'a/poster.webp'])
const still = (src: string, pose?: string) => ({ src, width: 64, height: 64, format: 'webp', ...(pose ? { pose } : {}) })
const record = (id: string, over: Record<string, unknown> = {}) => ({
  exerciseId: id,
  thumb: still('a/thumb.webp'),
  images: [still('a/one.webp', 'start'), still('a/two.webp', 'peak')],
  source: 'mi-paquete',
  license: { status: 'private-local' },
  version: 1,
  availability: 'bundled',
  label: 'Barbell Squat',
  ...over,
})
const manifest = (over: Record<string, unknown> = {}, records: Record<string, unknown> = { 'fedb:Barbell_Squat': record('fedb:Barbell_Squat') }) => ({
  format: 'pho-media-pack',
  version: 1,
  pack: { id: 'mi-paquete', style: 'Sintético', attribution: 'Material propio', license: { status: 'private-local' }, version: 1, basePath: '', ...over },
  records,
})

describe('private manifest validation', () => {
  it('accepts a well-formed private pack and reports what it uses', () => {
    const v = validatePrivateManifest(manifest(), FILES)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.files).toEqual(['a/one.webp', 'a/thumb.webp', 'a/two.webp'])
    expect(v.summary).toMatchObject({ name: 'mi-paquete', exercises: 1, files: 3, attribution: 'Material propio' })
  })
  it('accepts an animation with poster', () => {
    const r = record('fedb:X', { images: [], animation: { src: 'a/clip.mp4', format: 'mp4', width: 320, height: 320, poster: 'a/poster.webp' } })
    expect(validatePrivateManifest(manifest({}, { 'fedb:X': r }), FILES).ok).toBe(true)
  })
  const bad = (m: unknown, files = FILES) => {
    const v = validatePrivateManifest(m, files)
    return v.ok ? null : v.error
  }
  it('rejects wrong format, licence, ids, base path and missing attribution', () => {
    expect(bad({ format: 'other' })).toContain('formato')
    expect(bad(manifest({ license: { status: 'licensed' } }))).toContain('private-local')
    expect(bad(manifest({ id: 'repdb-free' }))).toContain('incluido')
    expect(bad(manifest({ id: 'Bad Id' }))).toContain('id')
    expect(bad(manifest({ basePath: 'x/' }))).toContain('basePath')
    expect(bad(manifest({ attribution: '' }))).toContain('atribución')
    expect(bad(manifest({ attributionUrl: 'javascript:alert(1)' }))).toContain('URL')
  })
  it('rejects records that are not private-local, belong to another pack or are not local', () => {
    const m = (over: Record<string, unknown>) => manifest({}, { 'fedb:Barbell_Squat': record('fedb:Barbell_Squat', over) })
    expect(bad(m({ license: { status: 'licensed' } }))).toContain('private-local')
    expect(bad(m({ source: 'repdb-free' }))).toContain('source')
    expect(bad(m({ availability: 'remote' }))).toContain('availability')
    expect(bad(m({ exerciseId: 'other' }))).toContain('exerciseId')
    expect(bad(manifest({}, {}))).toContain('no contiene')
  })
  it('rejects files missing from the zip, wrong extensions and mismatched formats', () => {
    expect(bad(manifest(), new Set(['a/thumb.webp']))).toContain('no está en el ZIP')
    const svg = record('fedb:Barbell_Squat', { thumb: { src: 'a/x.svg', width: 1, height: 1, format: 'svg' } })
    expect(bad(manifest({}, { 'fedb:Barbell_Squat': svg }), new Set([...FILES, 'a/x.svg']))).toContain('no permitido')
    const mism = record('fedb:Barbell_Squat', { thumb: { ...still('a/thumb.webp'), format: 'png' } })
    expect(bad(manifest({}, { 'fedb:Barbell_Squat': mism }))).toContain('formato')
    const noMedia = record('fedb:Barbell_Squat', { images: [] })
    expect(bad(manifest({}, { 'fedb:Barbell_Squat': noMedia }))).toContain('sin imágenes')
  })
  it('lists archive entries that are not media or the manifest', () => {
    expect(disallowedEntries(['manifest.json', 'a/b.webp', 'c.mp4', 'run.exe', 'x.svg', 'notes.txt'])).toEqual(['run.exe', 'x.svg', 'notes.txt'])
  })
})

describe('private-local records render only from the private cache', () => {
  const v = validatePrivateManifest(manifest(), FILES)
  if (!v.ok) throw new Error(v.error)
  it('licenseAllowsRender', () => {
    expect(licenseAllowsRender('private-local')).toBe(false)
    expect(licenseAllowsRender('private-local', true)).toBe(true)
    expect(licenseAllowsRender('licensed', true)).toBe(true)
  })
  it('a bundled index never renders a private-local record; the private index does', () => {
    expect(createMediaIndex(v.pack).lookup('fedb:Barbell_Squat')).toBeNull()
    expect(createMediaIndex(v.pack, {}, { privateCache: true }).lookup('fedb:Barbell_Squat')?.exerciseId).toBe('fedb:Barbell_Squat')
  })
  it('a private index does not render records of another licence or an uncovered exercise (no mixing)', () => {
    const idx = createMediaIndex(v.pack, {}, { privateCache: true })
    expect(idx.lookup('fedb:Other_Exercise')).toBeNull()
    const mixed = { ...v.pack, records: { x: { ...v.pack.records['fedb:Barbell_Squat']!, exerciseId: 'x', license: { status: 'licensed' as const } } } }
    expect(createMediaIndex(mixed, {}, { privateCache: true }).lookup('x')).toBeNull()
  })
})

describe('single active pack', () => {
  const pack = validatePrivateManifest(manifest(), FILES)
  const p = pack.ok ? pack.pack : null
  it('private only when imported, valid and switched on', () => {
    expect(pickActiveSource({ status: 'ready', pack: p, active: true })).toBe('private')
    expect(pickActiveSource({ status: 'ready', pack: p, active: false })).toBe('bundled')
    expect(pickActiveSource({ status: 'none', pack: null, active: true })).toBe('bundled')
    expect(pickActiveSource({ status: 'corrupt', pack: null, active: true })).toBe('bundled')
    expect(pickActiveSource({ status: 'unavailable', pack: p, active: true })).toBe('bundled')
  })
})

describe('inspectPackZip', () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
  const bytes = (n: number) => new Uint8Array(n).fill(7)
  const zipOf = async (m: unknown, extra: { name: string; data: Uint8Array }[] = []) =>
    new Blob([await makeZip([{ name: 'manifest.json', data: enc(m) }, ...['a/thumb.webp', 'a/one.webp', 'a/two.webp'].map((name) => ({ name, data: bytes(50), method: 0 as const })), ...extra]) as BlobPart])
  it('summarises a valid archive', async () => {
    const r = await inspectPackZip(await zipOf(manifest()))
    expect(r.validation.summary.exercises).toBe(1)
    expect(r.bytes).toBe(150)
    expect(r.ignored).toBe(0)
  })
  it('rejects archives with other file types, a missing manifest or a corrupt one', async () => {
    await expect(inspectPackZip(await zipOf(manifest(), [{ name: 'x.exe', data: bytes(3) }]))).rejects.toThrow(/no son imagen/)
    const noManifest = new Blob([await makeZip([{ name: 'a/thumb.webp', data: bytes(5) }]) as BlobPart])
    await expect(inspectPackZip(noManifest)).rejects.toThrow(/manifest\.json/)
    const broken = new Blob([await makeZip([{ name: 'manifest.json', data: new TextEncoder().encode('{nope') }]) as BlobPart])
    await expect(inspectPackZip(broken)).rejects.toThrow(/JSON/)
    await expect(inspectPackZip(await zipOf(manifest({ license: { status: 'licensed' } })))).rejects.toThrow(/private-local/)
  })
})

describe('stored packs', () => {
  it('a file missing from the cache does not invalidate the manifest (null skips the presence check)', () => {
    expect(validatePrivateManifest(manifest(), new Set(['a/thumb.webp']))).toMatchObject({ ok: false })
    expect(validatePrivateManifest(manifest(), null)).toMatchObject({ ok: true })
  })
})
