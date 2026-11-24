import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, onboard, test } from './helpers'

const HEVY = join(process.cwd(), 'e2e/fixtures/hevy-sintetico.csv')
const STRONG = join(process.cwd(), 'e2e/fixtures/strong-sintetico.csv')

test('export CSV downloads a UTF-8 file with the expected header', async ({ page }, info) => {
  await onboard(page)
  await page.goto('./#/respaldo')
  // Default: Spanish Excel (; and decimal comma).
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv-peso-medidas').click()])
  expect(dl.suggestedFilename()).toMatch(/^salud-peso-medidas-.*\.csv$/)
  const file = info.outputPath('peso.csv')
  await dl.saveAs(file)
  const text = await readFile(file, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.split('\r\n')[0]).toBe('﻿fecha;hora;peso_kg;grasa_pct;cintura_cm;cadera_cm;cuello_cm;pecho_cm;brazo_relajado_cm;brazo_contraido_cm;antebrazo_cm;muslo_cm;pantorrilla_cm;notas')
  await expect(page.getByTestId('export-csv-message')).toContainText('descargado')

  await page.getByRole('radio', { name: 'Estándar' }).click()
  await expect(page.getByTestId('csv-format-note')).toContainText('punto decimal')
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv-entrenamientos').click()])
  const f2 = info.outputPath('entreno.csv')
  await dl2.saveAs(f2)
  expect((await readFile(f2, 'utf8')).split('\r\n')[0]).toBe('﻿fecha,hora_inicio,sesion,ejercicio,id_ejercicio,orden_serie,tipo_serie,peso_kg,reps,rir,rpe,duracion_s,distancia_m,notas')
})

test('import a Hevy CSV: review, apply, shows in the history, re-import adds nothing, undo', async ({ page }) => {
  await onboard(page)
  await page.goto('./#/respaldo')
  await page.getByTestId('import-training-file').setInputFiles(HEVY)
  await expect(page.getByTestId('import-training-review')).toContainText('Hevy')
  await expect(page.getByTestId('import-unmatched')).toBeVisible()
  await expect(page.getByTestId('import-matched')).toBeVisible()
  await expect(page.getByTestId('count-new')).toHaveText('2')
  await expect(page.getByTestId('count-known')).toHaveText('0')
  await page.getByTestId('import-training-apply').click()
  await expect(page.getByTestId('import-training-result')).toContainText('2 sesiones')

  await page.goto('./#/entreno/historial')
  await expect(page.getByTestId('session-row')).toHaveCount(2)
  await expect(page.getByText('Empuje A').first()).toBeVisible()

  // Same file again: nothing new.
  await page.goto('./#/respaldo')
  await page.getByTestId('import-training-file').setInputFiles(HEVY)
  await expect(page.getByTestId('count-new')).toHaveText('0')
  await expect(page.getByTestId('count-known')).toHaveText('2')
  await expect(page.getByTestId('import-training-apply')).toBeDisabled()

  // Strong (; and decimal comma, unit not in the file): asks for the unit, imports, then undo removes only that import.
  await page.getByTestId('import-training-file').setInputFiles(STRONG)
  await expect(page.getByRole('radio', { name: 'Libras' })).toBeVisible()
  await expect(page.getByTestId('count-new')).toHaveText('1')
  await page.getByTestId('import-training-apply').click()
  await expect(page.getByTestId('import-training-result')).toContainText('1 sesiones')
  await page.getByTestId('import-training-undo').click()
  await expect(page.getByTestId('import-training-result')).toContainText('deshecha')
  await page.goto('./#/entreno/historial')
  await expect(page.getByTestId('session-row')).toHaveCount(2)
})
