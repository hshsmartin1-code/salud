import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { repo } from '../../db/repo'
import { createDB, type SaludDB } from '../../db/schema'
import type { SyncConflict } from '../../db/types'
import { resolveConflict, type ConflictChoice } from '../../sync/engine'
import { ConflictRow, ConflictSummary } from './AccountPage'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('../../ui/Confirm', () => ({ useConfirm: () => confirm }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => 0 }))
vi.mock('../../sync/config', () => ({ SYNC_CONFIG: null }))
vi.mock('../../sync/service', () => ({ refreshScheduler: vi.fn(), remoteFor: vi.fn(), runSync: vi.fn() }))

let db: SaludDB
let conflict: SyncConflict
beforeEach(async () => {
  confirm.mockReset()
  db = createDB(`conflict-choice-${crypto.randomUUID()}`)
  await db.open()
  const row = await repo('profile-a', db).add('bodyMeasurements', {
    date: '2026-11-01', weightKg: 70, circumferences: {}, skinfolds: {}, protocol: null, derived: null, notes: 'Local', origin: 'app',
  })
  conflict = {
    id: 'conflict-a', profileId: row.profileId, key: 'bodyMeasurements|measurement-a', table: 'bodyMeasurements', rowId: row.id,
    local: { ...row }, remote: null, remoteRev: 2, detectedAt: '2026-11-16T12:00:00Z',
  }
  await db.syncConflicts.add(conflict)
})
afterEach(async () => { await db.delete() })

// Traverse the actual component's React elements and invoke its button handler; no browser/server.
function button(node: ReactNode, choice: ConflictChoice): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) return node.map((child) => button(child, choice)).find(Boolean)
  if (!isValidElement<{ 'data-testid'?: string; onClick?: () => Promise<void>; children?: ReactNode }>(node)) return undefined
  if (node.props['data-testid'] === `conflict-${choice}`) return node.props.onClick
  return button(node.props.children, choice)
}

async function click(choice: ConflictChoice) {
  let resolution: Promise<void> | undefined
  const choose = vi.fn((selected: ConflictChoice) => { resolution = resolveConflict(db, conflict.profileId, conflict.id, selected) })
  const view = ConflictRow({ c: conflict, dependents: 0, disabled: false, onChoose: choose })
  const handler = button(view, choice)
  expect(handler).toBeTypeOf('function')
  await handler!()
  await resolution
  return choose
}

it('cancel in the deletion confirmation preserves both the row and the conflict; accept deletes exactly once', async () => {
  confirm.mockResolvedValueOnce(false)
  expect(await click('remote')).not.toHaveBeenCalled()
  expect(await db.bodyMeasurements.get(conflict.rowId)).toBeDefined()
  expect(await db.syncConflicts.get(conflict.id)).toEqual(conflict)
  confirm.mockResolvedValueOnce(true)
  expect(await click('remote')).toHaveBeenCalledOnce()
  expect(await db.bodyMeasurements.get(conflict.rowId)).toBeUndefined()
  expect(await db.syncConflicts.get(conflict.id)).toBeUndefined()
  expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'Eliminar', tone: 'danger' }))
})

it.each(['local', 'remote'] as const)('requires confirmation before %s discards an edited version', async (choice) => {
  conflict = { ...conflict, remote: { ...conflict.local, notes: 'Remota', weightKg: 75 } }
  await db.syncConflicts.put(conflict)
  confirm.mockResolvedValueOnce(false)
  expect(await click(choice)).not.toHaveBeenCalled()
  expect(confirm).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
    confirmLabel: 'Conservar versión',
    body: expect.stringContaining(`Se descartarán los cambios de ${choice === 'local' ? 'la nube' : 'este dispositivo'}.`),
  }))
  expect(await db.syncConflicts.get(conflict.id)).toEqual(conflict)
  expect((await db.bodyMeasurements.get(conflict.rowId))?.weightKg).toBe(70)
  confirm.mockResolvedValueOnce(true)
  expect(await click(choice)).toHaveBeenCalledOnce()
  expect((await db.bodyMeasurements.get(conflict.rowId))?.weightKg).toBe(choice === 'local' ? 70 : 75)
})

it('cancel also preserves a remote edited version when keeping a local deletion', async () => {
  conflict = { ...conflict, remote: conflict.local, local: null }
  await db.bodyMeasurements.delete(conflict.rowId)
  await db.syncConflicts.put(conflict)
  confirm.mockResolvedValueOnce(false)
  expect(await click('local')).not.toHaveBeenCalled()
  expect(await db.syncConflicts.get(conflict.id)).toEqual(conflict)
  confirm.mockResolvedValueOnce(true)
  expect(await click('local')).toHaveBeenCalledOnce()
  expect(await db.syncConflicts.get(conflict.id)).toBeUndefined()
})

it('keeping both edited versions does not ask to discard either', async () => {
  conflict = { ...conflict, remote: { ...conflict.local, weightKg: 75 } }
  await db.syncConflicts.put(conflict)
  expect(await click('both')).toHaveBeenCalledOnce()
  expect(confirm).not.toHaveBeenCalled()
  expect((await db.bodyMeasurements.toArray()).map((row) => row.weightKg).sort()).toEqual([70, 75])
})

it('shows every differing field before a person chooses which version to discard', () => {
  const local = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`extra${i}`, `Local ${i}`]))
  const remote = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`extra${i}`, `Remoto ${i}`]))
  const html = renderToStaticMarkup(ConflictRow({ c: { ...conflict, local, remote }, dependents: 0, disabled: false, onChoose: vi.fn() }))
  for (let i = 0; i < 12; i++) {
    expect(html).toContain(`Local ${i}<`)
    expect(html).toContain(`Remoto ${i}<`)
  }
})

it('summarises every table including dependent sets once, using the V3 section and rows', () => {
  const conflicts = [conflict, { ...conflict, id: 'other' },
    { ...conflict, id: 'session', table: 'trainingSessions', rowId: 'session-a' },
    { ...conflict, id: 'set', table: 'exerciseSets', local: { sessionId: 'session-a' } },
  ]
  const html = renderToStaticMarkup(ConflictSummary({ conflicts }))
  expect(html).toContain('aria-label="Conflictos por tipo de registro"')
  expect(html).toMatch(/Mediciones<\/span>.*?>2<\/span>/)
  expect(html).toContain('Sesiones de entreno')
  expect(html).toContain('Series')
  expect(html).toContain('Registros con dos versiones (3)')
  expect(html).toContain('se resuelven junto con ella')
})
