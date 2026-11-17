import { ANA, expect, logFood, onboard, test } from './helpers'

/** Synthetic data only. Backup: confirm before replace, and the "last backup" date is set only after a real file. */

test('replace asks for confirmation and saves a safety copy before importing', async ({ page }, info) => {
  await onboard(page)
  await logFood(page, 'arroz cocido', '150')
  await page.goto('./#/respaldo')
  await expect(page.getByTestId('last-export')).toHaveText('nunca')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-profile').click()])
  const file = info.outputPath('respaldo.json')
  await download.saveAs(file)
  await expect(page.getByTestId('last-export')).not.toHaveText('nunca')

  await page.getByTestId('import-backup-file').setInputFiles(file)
  await page.getByRole('radio', { name: 'Reemplazar' }).click()
  await page.getByTestId('apply-import').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(`Los datos actuales de «${ANA.name}» en este dispositivo se reemplazarán`)
  // Cancel: nothing is imported and nothing is downloaded.
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByTestId('import-result')).toHaveCount(0)

  await page.getByTestId('apply-import').click()
  const [safety] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Reemplazar' }).click()])
  expect(safety.suggestedFilename()).toContain('antes-de-reemplazar')
  await expect(page.getByTestId('import-result')).toBeVisible()
})

test('native shell that cannot write or share files: no backup date, and replace aborts', async ({ page }, info) => {
  // First a real file from the web build, to have something to import.
  await onboard(page)
  await page.goto('./#/respaldo')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-profile').click()])
  const file = info.outputPath('respaldo.json')
  await download.saveAs(file)

  // Then behave like the Capacitor Android shell where neither Documents nor the share sheet works: the
  // Filesystem plugin's web storage ('Disc') is made unavailable and the Web Share API does not exist.
  await page.addInitScript(() => {
    ;(window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'android', plugins: {} }
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (name: string, version?: number) {
      if (name === 'Disc') throw new Error('storage unavailable')
      return open.call(this, name, version)
    }
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })
  await page.evaluate(async () => {
    await new Promise<void>((res, rej) => {
      const req = indexedDB.open('salud-pho')
      req.onsuccess = () => {
        const tx = req.result.transaction('meta', 'readwrite')
        tx.objectStore('meta').delete('lastExport')
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      }
      req.onerror = () => rej(req.error)
    })
  })
  await page.reload()
  await page.goto('./#/respaldo')
  await expect(page.getByTestId('last-export')).toHaveText('nunca')
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByTestId('export-profile').click()
  await expect(page.getByTestId('export-message')).toContainText('No se pudo entregar el archivo del respaldo')
  await expect(page.getByTestId('last-export')).toHaveText('nunca')

  await page.getByTestId('import-backup-file').setInputFiles(file)
  await page.getByRole('radio', { name: 'Reemplazar' }).click()
  await page.getByTestId('apply-import').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reemplazar' }).click()
  await expect(page.getByTestId('import-error')).toContainText('No se reemplazó nada')
  await expect(page.getByTestId('import-result')).toHaveCount(0)
  expect(downloads).toBe(0)
})

test('native shell that can write files: says where it went, records the date, offers Compartir', async ({ page }) => {
  await onboard(page)
  // The Filesystem plugin's web implementation (IndexedDB) stands in for Documents; the device itself is unverified.
  await page.addInitScript(() => {
    ;(window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = { name: 'android', plugins: {} }
  })
  await page.reload()
  await page.goto('./#/respaldo')
  await expect(page.getByTestId('last-export')).toHaveText('nunca')
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByTestId('export-profile').click()
  await expect(page.getByTestId('export-message')).toContainText('Guardado en Documentos/Salud/salud-respaldo-')
  await expect(page.getByTestId('last-export')).not.toHaveText('nunca')
  await expect(page.getByTestId('share-backup')).toBeVisible()
  expect(downloads).toBe(0)
})
