import { describe, expect, it } from 'vitest'
import { adaptLegacyMedia, createMediaIndex, packFromManifest, packUrl, renderableCount, type LegacyFile } from './manifest'
import type { ExerciseMediaRecord, MediaPack } from './types'

const legacy: LegacyFile = {
  format: 'pho-exercise-media',
  version: 1,
  attribution: 'Exercise data by RepDB (repdb.co)',
  attributionUrl: 'https://repdb.co',
  licenseUrl: 'https://example.test/license',
  basePath: 'exercise-media/',
  items: {
    'fedb:A': { repdbId: 'a', confidence: 'high', thumb: 'a-thumb.webp', images: ['a-start.webp', 'a-peak.webp'], poses: ['start', 'peak'], nameEn: 'A' },
    'fedb:B': { repdbId: 'b', confidence: 'medium', thumb: 'b-thumb.webp', images: ['b-main.webp'], poses: ['main'], nameEn: 'B' },
  },
}

describe('legacy adapter', () => {
  const adapted = adaptLegacyMedia(legacy)
  it('maps to pack repdb-free with sizes, source, licence and availability', () => {
    expect(adapted.id).toBe('repdb-free')
    const a = adapted.records['fedb:A']!
    expect(a.exerciseId).toBe('fedb:A')
    expect(a.thumb).toMatchObject({ src: 'a-thumb.webp', width: 160, height: 160, format: 'webp' })
    expect(a.images.map((i) => [i.src, i.pose, i.width])).toEqual([['a-start.webp', 'start', 512], ['a-peak.webp', 'peak', 512]])
    expect(a.source).toBe('repdb-free')
    expect(a.license.status).toBe('free-with-attribution')
    expect(a.availability).toBe('bundled')
    expect(a.animation).toBeUndefined()
    expect(adapted.records['fedb:B']!.approximate).toBe(true)
  })
  it('packFromManifest accepts the legacy format and rejects junk', () => {
    expect(packFromManifest(legacy)?.id).toBe('repdb-free')
    expect(packFromManifest({ format: 'x' })).toBeNull()
    expect(packFromManifest(null)).toBeNull()
    expect(packFromManifest({ format: 'pho-media-pack', pack: {}, records: {} })).toBeNull()
  })
})

const rec = (id: string, over: Partial<ExerciseMediaRecord> = {}): ExerciseMediaRecord => ({
  exerciseId: id,
  thumb: { src: `${id}-t.webp`, width: 160, height: 160, format: 'webp' },
  images: [],
  source: 'lic',
  license: { status: 'licensed' },
  version: 1,
  availability: 'bundled',
  ...over,
})
const mkPack = (records: Record<string, ExerciseMediaRecord>, over: Partial<MediaPack> = {}): MediaPack => ({
  id: 'lic', style: 'test', attribution: 'x', license: { status: 'licensed' }, version: 1, basePath: 'm/', records, ...over,
})

describe('licence gating, active pack, availability', () => {
  it('renders licensed and free-with-attribution records', () => {
    const idx = createMediaIndex(mkPack({ a: rec('a'), b: rec('b', { license: { status: 'free-with-attribution' } }) }))
    expect(idx.lookup('a')).not.toBeNull()
    expect(idx.lookup('b')).not.toBeNull()
  })
  it('treats pending and unlicensed records as missing', () => {
    const idx = createMediaIndex(mkPack({ p: rec('p', { license: { status: 'pending' } }), u: rec('u', { license: { status: 'unlicensed' } }) }))
    expect(idx.lookup('p')).toBeNull()
    expect(idx.lookup('u')).toBeNull()
  })
  it('treats a pack that is not licensed as missing as a whole', () => {
    const idx = createMediaIndex(mkPack({ a: rec('a') }, { license: { status: 'pending' } }))
    expect(idx.lookup('a')).toBeNull()
    expect(renderableCount(idx)).toBe(0)
  })
  it('never mixes packs: a record from another source is missing', () => {
    const idx = createMediaIndex(mkPack({ a: rec('a'), foreign: rec('foreign', { source: 'repdb-free' }) }))
    expect(idx.lookup('a')).not.toBeNull()
    expect(idx.lookup('foreign')).toBeNull()
    expect(renderableCount(idx)).toBe(1)
  })
  it('availability missing hides the record; remote still resolves', () => {
    const idx = createMediaIndex(mkPack({ m: rec('m', { availability: 'missing' }), r: rec('r', { availability: 'remote' }) }))
    expect(idx.lookup('m')).toBeNull()
    expect(idx.lookup('r')?.availability).toBe('remote')
  })
  it('unknown, empty and nullish ids give null', () => {
    const idx = createMediaIndex(mkPack({ a: rec('a') }))
    expect(idx.lookup('zzz')).toBeNull()
    expect(idx.lookup('')).toBeNull()
    expect(idx.lookup(undefined)).toBeNull()
  })
})

describe('alias resolution', () => {
  it('a renamed id keeps its media (old -> new)', () => {
    const idx = createMediaIndex(mkPack({ 'fedb:New': rec('fedb:New') }), { 'fedb:Old': 'fedb:New' })
    expect(idx.lookup('fedb:Old')?.exerciseId).toBe('fedb:New')
    expect(idx.lookup('fedb:New')?.exerciseId).toBe('fedb:New')
  })
  it('follows chains and survives cycles', () => {
    const idx = createMediaIndex(mkPack({ c: rec('c') }), { a: 'b', b: 'c', x: 'y', y: 'x' })
    expect(idx.lookup('a')?.exerciseId).toBe('c')
    expect(idx.lookup('x')).toBeNull()
  })
  it('an alias to an unlicensed record still gives the placeholder', () => {
    const idx = createMediaIndex(mkPack({ n: rec('n', { license: { status: 'pending' } }) }), { o: 'n' })
    expect(idx.lookup('o')).toBeNull()
  })
})

describe('packUrl', () => {
  it('joins base url, base path and file; passes absolute urls through', () => {
    expect(packUrl({ basePath: 'exercise-media/' }, 'a.webp', '/salud/')).toBe('/salud/exercise-media/a.webp')
    expect(packUrl({ basePath: 'https://cdn.test/p/' }, 'a.webp', '/salud/')).toBe('https://cdn.test/p/a.webp')
    expect(packUrl({ basePath: 'm/' }, 'https://x.test/a.webp', '/')).toBe('https://x.test/a.webp')
  })
})
