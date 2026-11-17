import { describe, expect, it, vi } from 'vitest'
import type { NativeFilesApi } from '../../integrations/files/native'
import { replaceConfirmText, replaceWithSafetyCopy } from './replaceFlow'
import { chooseSaveMethod, chunkText, MAX_NATIVE_CHARS, saveJsonFile, savedMessage, shareSavedFile, type SaveEnv } from './saveFile'

/** In-memory stand-in for the Filesystem + Share plugins. `documentsFails` simulates scoped storage. */
function fakeFiles(over: { documentsFails?: boolean; failAppendAt?: number; shareError?: Error; permissionFixes?: boolean } = {}) {
  const store = new Map<string, string>()
  const calls: string[] = []
  let appends = 0
  let permitted = false
  const key = (dir: string, path: string) => `${dir}:${path}`
  const api: NativeFilesApi = {
    writeText: async (dir, path, text) => {
      calls.push(`write:${dir}`)
      if (dir === 'documents' && over.documentsFails && !(over.permissionFixes && permitted)) throw new Error('EACCES')
      store.set(key(dir, path), text)
      return { uri: `file:///${dir}/${path}` }
    },
    appendText: async (dir, path, text) => {
      calls.push(`append:${dir}`)
      if (over.failAppendAt !== undefined && ++appends === over.failAppendAt) throw new Error('disk full')
      store.set(key(dir, path), (store.get(key(dir, path)) ?? '') + text)
    },
    remove: async (dir, path) => {
      calls.push(`remove:${dir}`)
      store.delete(key(dir, path))
    },
    requestStoragePermission: async () => {
      calls.push('permission')
      permitted = true
    },
    shareFile: async (o) => {
      calls.push(`share:${o.uri}`)
      if (over.shareError) throw over.shareError
    },
  }
  return { api, store, calls }
}

function env(over: Partial<SaveEnv> = {}): SaveEnv & { download: ReturnType<typeof vi.fn> } {
  return {
    isNative: () => false,
    files: async () => fakeFiles().api,
    download: vi.fn(),
    ...over,
  } as never
}

describe('chooseSaveMethod', () => {
  it('web downloads; native uses the filesystem', () => {
    expect(chooseSaveMethod(false)).toBe('download')
    expect(chooseSaveMethod(true)).toBe('native')
  })
})

describe('chunkText', () => {
  it('splits without losing a character and never inside a surrogate pair', () => {
    const text = 'a'.repeat(9) + '😀' + 'b'.repeat(5) // the emoji sits at indices 9-10
    const parts = chunkText(text, 10)
    expect(parts.join('')).toBe(text)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(10)
    expect(parts[0]).toBe('a'.repeat(9)) // the pair moved whole to the next piece
    expect(chunkText('')).toEqual([''])
  })
})

describe('saveJsonFile', () => {
  it('web: hands a JSON blob to the download and reports ok', async () => {
    const e = env()
    const out = await saveJsonFile({ a: 1 }, 'x.json', e)
    expect(out).toEqual({ ok: true, method: 'download' })
    expect(e.download).toHaveBeenCalledOnce()
    const [blob, name] = e.download.mock.calls[0] as [Blob, string]
    expect(name).toBe('x.json')
    expect(await blob.text()).toBe('{"a":1}')
  })
  it('a failing web download is reported, not swallowed', async () => {
    const e = env({ download: vi.fn(() => { throw new Error('boom') }) })
    expect(await saveJsonFile({}, 'x.json', e)).toMatchObject({ ok: false, reason: 'error' })
  })

  it('native: writes Documents/Salud/<name> in chunks and returns the path', async () => {
    const f = fakeFiles()
    const e = env({ isNative: () => true, files: async () => f.api })
    const data = { rows: 'é😀'.repeat(50) }
    const out = await saveJsonFile(data, 'salud-respaldo.json', e, 64)
    expect(out).toMatchObject({ ok: true, method: 'documents', path: 'Documentos/Salud/salud-respaldo.json', fileName: 'salud-respaldo.json' })
    expect(f.store.get('documents:Salud/salud-respaldo.json')).toBe(JSON.stringify(data))
    expect(f.calls.filter((c) => c === 'append:documents').length).toBeGreaterThan(0)
    expect(e.download).not.toHaveBeenCalled()
    expect(f.calls.some((c) => c.startsWith('share'))).toBe(false) // sharing is never automatic
    expect(savedMessage(out as never)).toBe('Guardado en Documentos/Salud/salud-respaldo.json.')
  })
  it('native: asks for storage permission once and retries (Android 9 and older)', async () => {
    const f = fakeFiles({ documentsFails: true, permissionFixes: true })
    const out = await saveJsonFile({ a: 1 }, 'x.json', env({ isNative: () => true, files: async () => f.api }))
    expect(out).toMatchObject({ ok: true, method: 'documents' })
    expect(f.calls.filter((c) => c === 'permission')).toHaveLength(1)
  })
  it('native: Documents not writable falls back to cache + share sheet', async () => {
    const f = fakeFiles({ documentsFails: true })
    const out = await saveJsonFile({ a: 1 }, 'x.json', env({ isNative: () => true, files: async () => f.api }))
    expect(out).toMatchObject({ ok: true, method: 'share', fileName: 'x.json' })
    expect(f.store.get('cache:Salud/x.json')).toBe('{"a":1}')
    expect(f.calls).toContain('share:file:///cache/Salud/x.json')
  })
  it('native: a cancelled share is not a backup', async () => {
    const f = fakeFiles({ documentsFails: true, shareError: new Error('Share canceled') })
    expect(await saveJsonFile({}, 'x.json', env({ isNative: () => true, files: async () => f.api }))).toMatchObject({ ok: false, reason: 'cancelled' })
  })
  it('native: a write that fails midway removes the partial file, then the retry writes the whole file', async () => {
    const f = fakeFiles({ failAppendAt: 2 }) // the 2nd append fails once
    const data = { rows: 'x'.repeat(500) }
    const out = await saveJsonFile(data, 'x.json', env({ isNative: () => true, files: async () => f.api }), 64)
    expect(f.calls).toContain('remove:documents')
    expect(out).toMatchObject({ ok: true, method: 'documents' })
    expect(f.store.get('documents:Salud/x.json')).toBe(JSON.stringify(data)) // never a truncated file
  })
  it('native: errors in every route are honest failures', async () => {
    const f = fakeFiles({ documentsFails: true })
    f.api.writeText = async () => Promise.reject(new Error('EIO'))
    expect(await saveJsonFile({}, 'x.json', env({ isNative: () => true, files: async () => f.api }))).toMatchObject({ ok: false, reason: 'error' })
  })
  it('native: plugin unavailable is reported as unsupported', async () => {
    const e = env({ isNative: () => true, files: async () => Promise.reject(new Error('not implemented')) })
    expect(await saveJsonFile({}, 'x.json', e)).toMatchObject({ ok: false, reason: 'unsupported' })
  })
  it('native: an enormous backup is refused with a warning instead of exhausting memory', async () => {
    const f = fakeFiles()
    const huge = { toJSON: () => 'x'.repeat(MAX_NATIVE_CHARS + 1) }
    const out = await saveJsonFile(huge, 'x.json', env({ isNative: () => true, files: async () => f.api }))
    expect(out).toMatchObject({ ok: false, reason: 'too-large' })
    expect(f.calls).toEqual([])
  })
})

describe('shareSavedFile', () => {
  it('shares the file written to Documents on request', async () => {
    const f = fakeFiles()
    expect(await shareSavedFile('file:///a/x.json', 'x.json', env({ files: async () => f.api }))).toEqual({ ok: true })
    expect(f.calls).toEqual(['share:file:///a/x.json'])
  })
  it('a cancelled or failing share never throws', async () => {
    const cancelled = fakeFiles({ shareError: new Error('Share canceled') })
    expect(await shareSavedFile('u', 'x.json', env({ files: async () => cancelled.api }))).toEqual({ ok: false })
    const broken = fakeFiles({ shareError: new Error('no activity') })
    expect(await shareSavedFile('u', 'x.json', env({ files: async () => broken.api }))).toMatchObject({ ok: false, message: expect.any(String) })
  })
})

describe('replaceWithSafetyCopy', () => {
  const targets = [{ id: 'p1', name: 'Persona Uno' }, { id: 'p2', name: 'Persona Dos' }]
  it('imports only after every safety copy was saved', async () => {
    const order: string[] = []
    const out = await replaceWithSafetyCopy(targets, {
      saveSafetyCopy: async (t) => (order.push(`copy:${t.id}`), { ok: true, method: 'download' }),
      runImport: async () => (order.push('import'), 42),
    })
    expect(out).toEqual({ ok: true, result: 42 })
    expect(order).toEqual(['copy:p1', 'copy:p2', 'import'])
  })
  it('a failed copy aborts the replace with a clear message', async () => {
    const runImport = vi.fn(async () => 1)
    const out = await replaceWithSafetyCopy(targets, {
      saveSafetyCopy: async (t) => (t.id === 'p2' ? { ok: false, reason: 'unsupported', message: 'Sin archivo.' } : { ok: true, method: 'download' }),
      runImport,
    })
    expect(runImport).not.toHaveBeenCalled()
    expect(out).toEqual({ ok: false, message: expect.stringContaining('No se reemplazó nada') })
    expect(!out.ok && out.message).toContain('«Persona Dos»')
    expect(!out.ok && out.message).toContain('Sin archivo.')
  })
  it('an exception while exporting the copy also aborts', async () => {
    const runImport = vi.fn(async () => 1)
    const out = await replaceWithSafetyCopy([targets[0]], { saveSafetyCopy: async () => Promise.reject(new Error('cuota llena')), runImport })
    expect(runImport).not.toHaveBeenCalled()
    expect(!out.ok && out.message).toContain('cuota llena')
  })
  it('confirm text says the current data on this device will be replaced', () => {
    expect(replaceConfirmText(['Persona Uno'], 12)).toBe(
      'Los datos actuales de «Persona Uno» en este dispositivo se reemplazarán por los del archivo (solo en las tablas que trae el archivo). Se borran 12 registros actuales. Antes se guarda una copia de seguridad; si no se puede guardar, no se reemplaza nada.',
    )
    expect(replaceConfirmText([], null)).toContain('el perfil de destino')
  })
})
