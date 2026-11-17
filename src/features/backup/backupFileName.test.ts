import { expect, it } from 'vitest'
import { backupFileName, type Backup } from '../../db/backup'

const b = (exportedAt: string) => ({ exportedAt, scope: 'profile', media: true }) as unknown as Backup

it('the backup file name carries the local (Bogotá) date of the export', () => {
  // 20:30 on 14 Nov in Bogotá is already 15 Nov in UTC.
  expect(backupFileName(b('2026-11-15T01:30:00.000Z'), 'Persona Prueba')).toBe('salud-respaldo-persona-prueba-2026-11-14.json')
  expect(backupFileName(b('2026-11-15T12:00:00.000Z'), 'Persona Prueba')).toBe('salud-respaldo-persona-prueba-2026-11-15.json')
})
