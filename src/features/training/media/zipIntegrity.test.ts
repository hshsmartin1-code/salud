import { expect, it } from 'vitest'
import { makeZip } from './testZip'
import { readZipDirectory } from './zip'

it('rejects a directory whose final bytes overlap the end-of-central-directory record', async () => {
  const zip = await makeZip([{ name: 'a.webp', data: new Uint8Array([7]), method: 0 }])
  const view = new DataView(zip.buffer)
  const end = zip.length - 22
  const cd = view.getUint32(end + 16, true)
  // A truncated per-entry comment is claimed to include the EOCD itself.
  view.setUint16(cd + 32, 22, true)
  view.setUint32(end + 12, view.getUint32(end + 12, true) + 22, true)
  await expect(readZipDirectory(new Blob([zip as BlobPart]))).rejects.toMatchObject({ code: 'truncated' })
})

it('rejects an entry count that hides a second central-directory record', async () => {
  const zip = await makeZip([
    { name: 'a.webp', data: new Uint8Array([7]), method: 0 },
    { name: 'a.webp', data: new Uint8Array([8]), method: 0 },
  ])
  const view = new DataView(zip.buffer)
  view.setUint16(zip.length - 22 + 8, 1, true)
  view.setUint16(zip.length - 22 + 10, 1, true)
  await expect(readZipDirectory(new Blob([zip as BlobPart]))).rejects.toMatchObject({ code: 'corrupt' })
})
