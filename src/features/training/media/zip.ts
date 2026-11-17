/**
 * Minimal ZIP reader for the private media pack importer (no dependencies). It reads the central directory
 * from the end of a Blob/File (slices only, the archive is never loaded whole), validates every entry name
 * and size against the limits, and inflates one entry at a time with `DecompressionStream('deflate-raw')`
 * while counting the real output bytes (a lying header cannot expand past the limit) and checking the CRC.
 * Not supported on purpose: ZIP64, encryption, multi-disk archives, methods other than stored / deflate.
 */

export type ZipErrorCode =
  | 'not-zip'
  | 'truncated'
  | 'corrupt'
  | 'unsupported'
  | 'encrypted'
  | 'bad-path'
  | 'duplicate'
  | 'too-many'
  | 'file-too-large'
  | 'too-large'
  | 'size-mismatch'
  | 'crc'
  | 'no-inflate'

export class ZipError extends Error {
  readonly code: ZipErrorCode
  constructor(code: ZipErrorCode, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export interface ZipLimits {
  maxEntries: number
  /** Uncompressed size of one file. */
  maxFileBytes: number
  /** Sum of the uncompressed sizes. */
  maxTotalBytes: number
  /** Size of the .zip file itself. */
  maxArchiveBytes: number
}

const MB = 1024 * 1024
export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 5000, maxFileBytes: 30 * MB, maxTotalBytes: 400 * MB, maxArchiveBytes: 450 * MB }

export interface ZipEntry {
  name: string
  method: 0 | 8
  compressedSize: number
  size: number
  crc: number
  offset: number
}

/** What the reader needs from a File / Blob. */
export interface ZipSource {
  readonly size: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50

/** Normalised relative path, or null when it is unsafe (absolute, drive letter, `..`, backslash, control chars, empty segment). */
export function safeZipPath(name: string): string | null {
  if (!name || name.length > 240) return null
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (c < 32 || c === 127 || c === 92) return null
  }
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null
  const parts = name.replace(/\/$/, '').split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null
  return parts.join('/')
}

let crcTable: Uint32Array | null = null
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function readRange(src: ZipSource, start: number, end: number): Promise<DataView> {
  if (start < 0 || end > src.size || end < start) throw new ZipError('truncated', 'El archivo ZIP está incompleto.')
  const buf = await src.slice(start, end).arrayBuffer()
  if (buf.byteLength !== end - start) throw new ZipError('truncated', 'El archivo ZIP está incompleto.')
  return new DataView(buf)
}

/** Lists the files of the archive (directories are skipped). Validates names, sizes and limits. */
export async function readZipDirectory(src: ZipSource, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ZipEntry[]> {
  if (src.size > limits.maxArchiveBytes) throw new ZipError('too-large', 'El archivo ZIP es demasiado grande.')
  if (src.size < 22) throw new ZipError('not-zip', 'No es un archivo ZIP.')
  const tailStart = Math.max(0, src.size - (22 + 0xffff))
  const tail = await readRange(src, tailStart, src.size)
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('not-zip', 'No es un archivo ZIP (o está incompleto).')
  const disk = tail.getUint16(eocd + 4, true)
  const cdDisk = tail.getUint16(eocd + 6, true)
  const diskCount = tail.getUint16(eocd + 8, true)
  const count = tail.getUint16(eocd + 10, true)
  const cdSize = tail.getUint32(eocd + 12, true)
  const cdOffset = tail.getUint32(eocd + 16, true)
  if (disk !== 0 || cdDisk !== 0 || diskCount !== count) throw new ZipError('unsupported', 'Los ZIP en varias partes no se admiten.')
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('unsupported', 'ZIP64 no se admite.')
  if (count > limits.maxEntries) throw new ZipError('too-many', 'El ZIP tiene demasiados archivos.')
  if (cdOffset + cdSize > tailStart + eocd) throw new ZipError('truncated', 'El archivo ZIP está incompleto.')
  const cd = await readRange(src, cdOffset, cdOffset + cdSize)
  const out: ZipEntry[] = []
  const seen = new Set<string>()
  const dec = new TextDecoder('utf-8')
  let pos = 0
  let total = 0
  for (let n = 0; n < count; n++) {
    if (pos + 46 > cd.byteLength || cd.getUint32(pos, true) !== SIG_CEN) throw new ZipError('corrupt', 'El directorio del ZIP está dañado.')
    const flags = cd.getUint16(pos + 8, true)
    const method = cd.getUint16(pos + 10, true)
    const crc = cd.getUint32(pos + 16, true)
    const compressedSize = cd.getUint32(pos + 20, true)
    const size = cd.getUint32(pos + 24, true)
    const nameLen = cd.getUint16(pos + 28, true)
    const extraLen = cd.getUint16(pos + 30, true)
    const commentLen = cd.getUint16(pos + 32, true)
    const offset = cd.getUint32(pos + 42, true)
    const end = pos + 46 + nameLen + extraLen + commentLen
    if (end > cd.byteLength) throw new ZipError('corrupt', 'El directorio del ZIP está dañado.')
    const rawName = dec.decode(new Uint8Array(cd.buffer, pos + 46, nameLen))
    pos = end
    const isDir = rawName.endsWith('/')
    const name = safeZipPath(rawName)
    if (name === null) throw new ZipError('bad-path', `Ruta no permitida dentro del ZIP: ${rawName.slice(0, 80)}`)
    if (isDir) continue
    if (flags & 1) throw new ZipError('encrypted', 'El ZIP está cifrado.')
    if (method !== 0 && method !== 8) throw new ZipError('unsupported', `Método de compresión no admitido en ${name}.`)
    if (method === 0 && compressedSize !== size) throw new ZipError('corrupt', `Tamaños incoherentes en ${name}.`)
    if (size > limits.maxFileBytes) throw new ZipError('file-too-large', `El archivo ${name} supera el máximo permitido.`)
    total += size
    if (total > limits.maxTotalBytes) throw new ZipError('too-large', 'El contenido del ZIP supera el máximo permitido.')
    if (seen.has(name)) throw new ZipError('duplicate', `Archivo repetido en el ZIP: ${name}`)
    seen.add(name)
    out.push({ name, method, compressedSize, size, crc, offset })
  }
  if (pos !== cd.byteLength) throw new ZipError('corrupt', 'El directorio del ZIP está dañado.')
  return out
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') throw new ZipError('no-inflate', 'Este navegador no puede descomprimir el ZIP.')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const out = new Uint8Array(expected)
  let got = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (got + value.byteLength > expected) {
        await reader.cancel().catch(() => undefined)
        throw new ZipError('size-mismatch', 'Un archivo del ZIP se expande más de lo declarado.')
      }
      out.set(value, got)
      got += value.byteLength
    }
  } catch (e) {
    if (e instanceof ZipError) throw e
    throw new ZipError('corrupt', 'Un archivo del ZIP está dañado.')
  }
  if (got !== expected) throw new ZipError('size-mismatch', 'Un archivo del ZIP no tiene el tamaño declarado.')
  return out
}

/** Reads and verifies (size and CRC) one entry. */
export async function readZipEntry(src: ZipSource, entry: ZipEntry, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<Uint8Array> {
  if (entry.size > limits.maxFileBytes) throw new ZipError('file-too-large', `El archivo ${entry.name} supera el máximo permitido.`)
  const head = await readRange(src, entry.offset, entry.offset + 30)
  if (head.getUint32(0, true) !== SIG_LOC) throw new ZipError('corrupt', `Cabecera dañada en ${entry.name}.`)
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
  const end = start + entry.compressedSize
  if (end > src.size) throw new ZipError('truncated', 'El archivo ZIP está incompleto.')
  const raw = new Uint8Array((await readRange(src, start, end)).buffer)
  const bytes = entry.method === 0 ? raw : await inflateRaw(raw, entry.size)
  if (bytes.byteLength !== entry.size) throw new ZipError('size-mismatch', `Tamaño incorrecto en ${entry.name}.`)
  if (crc32(bytes) !== entry.crc) throw new ZipError('crc', `Datos dañados en ${entry.name}.`)
  return bytes
}
