import { describe, expect, it } from 'vitest'
import { makeZip } from './testZip'
import { DEFAULT_ZIP_LIMITS, readZipDirectory, readZipEntry, safeZipPath, ZipError } from './zip'

const blob = (b: Uint8Array) => new Blob([b as BlobPart])
const text = (s: string) => new TextEncoder().encode(s)
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ZipError | null)?.code

describe('ZIP reader', () => {
  it('reads stored and deflated entries and checks size and CRC', async () => {
    const big = text('abcdefgh'.repeat(500))
    const zip = blob(await makeZip([{ name: 'a.txt', data: text('hello'), method: 0 }, { name: 'dir/b.bin', data: big, method: 8 }]))
    const entries = await readZipDirectory(zip)
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([['a.txt', 0, 5], ['dir/b.bin', 8, big.length]])
    expect(new TextDecoder().decode(await readZipEntry(zip, entries[0]!))).toBe('hello')
    expect(await readZipEntry(zip, entries[1]!)).toEqual(big)
  })
  it('skips directory entries and rejects duplicates', async () => {
    const z = await makeZip([{ name: 'd/', data: new Uint8Array(0), method: 0 }, { name: 'd/x.png', data: text('x'), method: 0 }])
    expect((await readZipDirectory(blob(z))).map((e) => e.name)).toEqual(['d/x.png'])
    expect(await code(readZipDirectory(blob(await makeZip([{ name: 'x', data: text('1') }, { name: 'x', data: text('2') }]))))).toBe('duplicate')
  })
  it('rejects path traversal and unsafe names', async () => {
    for (const name of ['../evil.png', 'a/../../b.png', '/abs.png', 'C:/x.png', 'a\\b.png', 'a//b.png', './a.png']) {
      expect(await code(readZipDirectory(blob(await makeZip([{ name, data: text('x'), method: 0 }])))), name).toBe('bad-path')
    }
    expect(safeZipPath('media/ok/a.webp')).toBe('media/ok/a.webp')
    expect(safeZipPath('a\u0000b')).toBeNull()
  })
  it('enforces the per-file, total, entry count and archive limits', async () => {
    const z = blob(await makeZip([{ name: 'a.bin', data: new Uint8Array(100), method: 0 }, { name: 'b.bin', data: new Uint8Array(100), method: 0 }]))
    expect(await code(readZipDirectory(z, { ...DEFAULT_ZIP_LIMITS, maxFileBytes: 99 }))).toBe('file-too-large')
    expect(await code(readZipDirectory(z, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 150 }))).toBe('too-large')
    expect(await code(readZipDirectory(z, { ...DEFAULT_ZIP_LIMITS, maxEntries: 1 }))).toBe('too-many')
    expect(await code(readZipDirectory(z, { ...DEFAULT_ZIP_LIMITS, maxArchiveBytes: 50 }))).toBe('too-large')
  })
  it('does not let a deflated entry expand past its declared size', async () => {
    const data = new Uint8Array(100000)
    const z = blob(await makeZip([{ name: 'bomb.bin', data, declaredSize: 10 }]))
    const [entry] = await readZipDirectory(z)
    expect(await code(readZipEntry(z, entry!))).toBe('size-mismatch')
  })
  it('detects corrupt data through the CRC', async () => {
    const bytes = await makeZip([{ name: 'a.txt', data: text('hello world'), method: 0 }])
    bytes[30 + 5] ^= 0xff // flip a data byte
    const z = blob(bytes)
    const [entry] = await readZipDirectory(z)
    expect(await code(readZipEntry(z, entry!))).toBe('crc')
  })
  it('rejects truncated and non-zip input', async () => {
    const full = await makeZip([{ name: 'a.bin', data: new Uint8Array(2000).map((_, i) => i * 7), method: 8 }])
    expect(await code(readZipDirectory(blob(full.slice(0, full.length - 10))))).toBe('not-zip')
    expect(await code(readZipDirectory(blob(text('this is not a zip file at all, really'))))).toBe('not-zip')
    expect(await code(readZipDirectory(blob(new Uint8Array(5))))).toBe('not-zip')
    // Directory intact but the entry data cut off: the central directory points past the end.
    const entries = await makeZip([{ name: 'a.bin', data: new Uint8Array(500), method: 0 }])
    const cdStart = 30 + 5 + 500
    const cut = new Uint8Array(entries.length - 400)
    cut.set(entries.slice(0, 30 + 5 + 100))
    cut.set(entries.slice(cdStart), 30 + 5 + 100)
    const view = new DataView(cut.buffer)
    view.setUint32(cut.length - 22 + 16, 30 + 5 + 100, true)
    const z = blob(cut)
    const [entry] = await readZipDirectory(z)
    expect(await code(readZipEntry(z, entry!))).toBe('truncated')
  })
  it('rejects encrypted entries and unsupported methods', async () => {
    const enc = await makeZip([{ name: 'a.bin', data: text('x'), method: 0 }])
    const cen = 30 + 5 + 1
    enc[cen + 8] = 1 // general purpose flag bit 0
    expect(await code(readZipDirectory(blob(enc)))).toBe('encrypted')
    const odd = await makeZip([{ name: 'a.bin', data: text('x'), method: 0 }])
    odd[cen + 10] = 9
    expect(await code(readZipDirectory(blob(odd)))).toBe('unsupported')
  })
})
