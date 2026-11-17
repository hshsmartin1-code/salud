/** Test-only helper: builds ZIP archives in memory (used by unit and e2e tests; never imported by the app). */
import { crc32 } from './zip'

export interface TestEntry {
  name: string
  data: Uint8Array
  method?: 0 | 8
  /** Override the declared uncompressed size (zip-bomb / mismatch tests). */
  declaredSize?: number
}

/** Builds a ZIP in memory (local headers + central directory + EOCD). Test helper, also used by other specs. */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function makeZip(entries: TestEntry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()
  for (const e of entries) {
    const method = e.method ?? 8
    const comp = method === 8 ? await deflateRaw(e.data) : e.data
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const size = e.declaredSize ?? e.data.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(8, method, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, comp.length, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, comp)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(10, method, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, comp.length, true)
    cen.setUint32(24, size, true)
    cen.setUint16(28, name.length, true)
    cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), name)
    offset += 30 + name.length + comp.length
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, entries.length, true)
  eocd.setUint16(10, entries.length, true)
  eocd.setUint32(12, cdSize, true)
  eocd.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}
