import { afterEach, describe, expect, it } from 'vitest'
import { createProfile } from '../db/profiles'
import { repo } from '../db/repo'
import { createDB, type SaludDB } from '../db/schema'
import type { ExerciseSet, FoodLog, Goal, Profile, Routine, TrainingSession } from '../db/types'
import { docKey, encodeRow } from './codec'
import { MAX_ROW_CHARS, resolveConflict, syncProfile } from './engine'
import { createProfileFromAccount, deleteCloudData, linkProfile, unlinkProfile } from './link'
import { MemoryServer } from './memoryRemote'

// Synthetic people, accounts and records only.
const ANA = { uid: 'uid-ana', email: 'ana@example.test', displayName: 'Ana Prueba' }
const BETO = { uid: 'uid-beto', email: 'beto@example.test', displayName: 'Beto Prueba' }

const dbs: SaludDB[] = []
let n = 0
async function device(): Promise<SaludDB> {
  const db = createDB(`integrity-test-${Date.now()}-${n++}`)
  await db.open()
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

const mkProfile = (db: SaludDB, name: string) =>
  createProfile({ name, sex: 'female', birthDate: '1990-01-01', heightCm: 165, activity: 'moderate', color: 'violet', settings: { addActivityKcal: false } }, db)

/** Everything except bookkeeping that legitimately differs per device (local profile id). */
const comparable = (rows: readonly object[]) =>
  (rows as Record<string, unknown>[])
    .map(({ profileId: _p, ...r }) => (void _p, r))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))

async function linkedPair() {
  const server = new MemoryServer()
  const a = await device()
  const pa = (await mkProfile(a, 'Ana')).id
  await linkProfile(a, pa, server.remote(ANA.uid), ANA)
  const b = await device()
  const { profileId: pb } = await createProfileFromAccount(b, server.remote(ANA.uid), ANA)
  const sync = (db: SaludDB, pid: string) => syncProfile(db, pid, server.remote(ANA.uid))
  return { server, a, b, pa, pb, sync }
}

describe('nutrition integrity across devices', () => {
  it('food logs arrive with every nutrient, missing list and snapshot field unchanged', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    const nutrients = { kcal: 247.5, protein: 46.5, carbs: 0, fat: 5.4, fiber: 0, sodium: 111, sugars: 0, satFat: 1.5, potassium: 384.6 }
    await repo(pa, a).add('foodLogs', {
      date: '2026-11-12', time: '12:40', meal: 'almuerzo', name: 'Pechuga de pollo cocida', foodRef: 'usda:171477', qty: 150, unit: 'g', grams: 150, ml: null,
      nutrients, missing: ['vitaminD'], source: 'usda_sr', datasetVersion: 'fdc-2026', note: 'sin piel',
    } as never)
    await repo(pa, a).add('foodLogs', { date: '2026-11-12', meal: 'onces', name: 'Galletas (etiqueta)', foodRef: 'label:x', qty: 2, unit: 'serving', grams: null, ml: null, nutrients: { kcal: 180 }, missing: ['fiber', 'sodium'], source: 'label' } as never)
    await sync(a, pa)
    await sync(b, pb)
    expect(comparable(await repo(pb, b).all('foodLogs'))).toEqual(comparable(await repo(pa, a).all('foodLogs')))
    const chicken = (await repo(pb, b).all('foodLogs')).find((f) => f.name.startsWith('Pechuga')) as FoodLog
    expect(chicken.nutrients).toEqual(nutrients) // exact numbers, no rounding or unit change
    expect(chicken.grams).toBe(150)
    expect(chicken.missing).toEqual(['vitaminD'])
  })
})

describe('training integrity across devices', () => {
  it('routines, sessions and their sets keep their links, order and values', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    const r = repo(pa, a)
    const routine = await r.add('routines', { name: 'Pierna A', exercises: [{ exerciseId: 'fedb:squat', name: 'Sentadilla', sets: 4, reps: '6-8', restSec: 150 }] } as never)
    const session = await r.add('trainingSessions', {
      date: '2026-11-12', name: 'Pierna A', routineId: routine.id, status: 'done', startedAt: '2026-11-12T18:00:00.000Z', endedAt: '2026-11-12T19:05:00.000Z', restEndsAt: null,
      exerciseOrder: [{ exerciseId: 'fedb:squat', name: 'Sentadilla', trackingType: 'weight_reps', restSec: 150 }], rpe: 8, durationMin: 65,
    } as never)
    for (let i = 0; i < 4; i++)
      await r.add('exerciseSets', { sessionId: session.id, date: '2026-11-12', exerciseId: 'fedb:squat', exerciseName: 'Sentadilla', setIndex: i, weight: 80 + i * 2.5, reps: 8 - i, durationSec: null, distanceM: null, rpe: 7 + i * 0.5, isWarmup: i === 0, done: true } as never)
    await sync(a, pa)
    await sync(b, pb)

    expect(comparable(await repo(pb, b).all('routines'))).toEqual(comparable(await r.all('routines')))
    expect(comparable(await repo(pb, b).all('trainingSessions'))).toEqual(comparable(await r.all('trainingSessions')))
    const sets = (await repo(pb, b).all('exerciseSets')) as ExerciseSet[]
    expect(comparable(sets)).toEqual(comparable(await r.all('exerciseSets')))
    const sessionB = (await repo(pb, b).get('trainingSessions', session.id)) as TrainingSession
    expect(sessionB.routineId).toBe(routine.id) // the session still points at the same routine
    expect(sets.every((s) => s.sessionId === session.id)).toBe(true)
    expect(sets.sort((x, y) => x.setIndex - y.setIndex).map((s) => [s.weight, s.reps, s.isWarmup])).toEqual([
      [80, 8, true],
      [82.5, 7, false],
      [85, 6, false],
      [87.5, 5, false],
    ])
    expect(((await repo(pb, b).get('routines', routine.id)) as Routine).exercises[0]).toMatchObject({ restSec: 150, reps: '6-8' })
  })

  it('a set edited offline on one device and a new set on the other both survive', async () => {
    const { a, b, pa, pb, sync, server } = await linkedPair()
    const session = await repo(pa, a).add('trainingSessions', { date: '2026-11-13', name: 'Empuje', routineId: null, status: 'done', startedAt: null, endedAt: null, restEndsAt: null, exerciseOrder: [] } as never)
    const set0 = await repo(pa, a).add('exerciseSets', { sessionId: session.id, date: '2026-11-13', exerciseId: 'fedb:bench', exerciseName: 'Press banca', setIndex: 0, weight: 60, reps: 10, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true } as never)
    await sync(a, pa)
    await sync(b, pb)
    server.offline = true
    await repo(pa, a).update('exerciseSets', set0.id, { weight: 62.5 } as never)
    await repo(pb, b).add('exerciseSets', { sessionId: session.id, date: '2026-11-13', exerciseId: 'fedb:bench', exerciseName: 'Press banca', setIndex: 1, weight: 60, reps: 9, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true } as never)
    server.offline = false
    await sync(a, pa)
    await sync(b, pb)
    await sync(a, pa)
    for (const [db, pid] of [[a, pa], [b, pb]] as const) {
      const sets = ((await repo(pid, db).all('exerciseSets')) as ExerciseSet[]).sort((x, y) => x.setIndex - y.setIndex)
      expect(sets.map((s) => [s.setIndex, s.weight, s.reps])).toEqual([
        [0, 62.5, 10],
        [1, 60, 9],
      ])
    }
  })

  it('a session edited on two devices is combined: one session, its sets once, both notes', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    const session = await repo(pa, a).add('trainingSessions', { date: '2026-11-14', name: 'Tirón', routineId: null, status: 'done', startedAt: null, endedAt: null, restEndsAt: null, exerciseOrder: [] } as never)
    await repo(pa, a).add('exerciseSets', { sessionId: session.id, date: '2026-11-14', exerciseId: 'fedb:row', exerciseName: 'Remo', setIndex: 0, weight: 50, reps: 10, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true } as never)
    await sync(a, pa)
    await sync(b, pb)
    await repo(pa, a).update('trainingSessions', session.id, { notes: 'desde A' } as never)
    await repo(pb, b).update('trainingSessions', session.id, { notes: 'desde B' } as never)
    await sync(a, pa)
    expect((await sync(b, pb)).conflicts).toBe(1)
    const [c] = await b.syncConflicts.toArray()
    await expect(resolveConflict(b, pb, c!.id, 'both')).rejects.toThrow() // no copies of a session any more
    await resolveConflict(b, pb, c!.id, 'merge')
    await sync(b, pb)
    await sync(a, pa)
    for (const [db, pid] of [[a, pa], [b, pb]] as const) {
      const sessions = (await repo(pid, db).all('trainingSessions')) as TrainingSession[]
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.id).toBe(session.id)
      expect(sessions[0]!.notes!.split('\n').sort()).toEqual(['desde A', 'desde B'])
      const sets = (await repo(pid, db).all('exerciseSets')) as ExerciseSet[]
      expect(sets.map((s) => s.sessionId)).toEqual([session.id])
      expect(await db.syncConflicts.count()).toBe(0)
    }
  })
})

describe('goals and preferences across devices', () => {
  it('goal history and profile settings (dashboard, step and water goals) persist and update', async () => {
    const { a, b, pa, pb, sync } = await linkedPair()
    const goal = { validFrom: '2026-11-01', goal: 'lose', method: 'manual', kcal: 1850, protein: 130, carbs: 190, fat: 60, fiber: 28, inputs: null, methodText: 'Manual', warnings: [], targetWeightKg: 62.5, source: 'manual' }
    await repo(pa, a).add('goals', goal as never)
    await repo(pa, a).add('goals', { ...goal, validFrom: '2026-11-10', kcal: 1900 } as never)
    const settings: Profile['settings'] = {
      addActivityKcal: true,
      weekStartsMonday: true,
      stepGoal: 9000,
      waterGoalMl: 2200,
      dashboard: { order: ['sleep', 'weight', 'steps'], hidden: ['pressure'], hideEmpty: true },
    }
    await a.profiles.update(pa, { settings, updatedAt: new Date().toISOString() })
    await sync(a, pa)
    await sync(b, pb)
    const goalsB = ((await repo(pb, b).all('goals')) as Goal[]).sort((x, y) => x.validFrom.localeCompare(y.validFrom))
    expect(goalsB.map((g) => [g.validFrom, g.kcal, g.targetWeightKg])).toEqual([
      ['2026-11-01', 1850, 62.5],
      ['2026-11-10', 1900, 62.5],
    ])
    expect((await b.profiles.get(pb))?.settings).toEqual(settings)
    expect((await b.profiles.get(pb))?.name).toBe('Ana')

    // A preference changed on the second device comes back to the first one.
    await b.profiles.update(pb, { settings: { ...settings, stepGoal: 10000 }, updatedAt: new Date().toISOString() })
    await sync(b, pb)
    await sync(a, pa)
    expect((await a.profiles.get(pa))?.settings.stepGoal).toBe(10000)
    expect((await a.profiles.get(pa))?.settings.dashboard).toEqual(settings.dashboard)
  })
})

describe('server refusals and unreadable documents (audit fixes)', () => {
  it('a row the server refuses does not block the rest of the queue', async () => {
    const { server, a, pa, sync } = await linkedPair()
    const r = repo(pa, a)
    const bad = await r.add('hydrationLogs', { date: '2026-11-12', time: '08:00', ml: 250 } as never)
    for (let i = 0; i < 3; i++) await r.add('hydrationLogs', { date: '2026-11-12', time: `1${i}:00`, ml: 300 } as never)
    const badKey = docKey('hydrationLogs', encodeRow('hydrationLogs', bad as never, pa).cloudId)
    server.refuseKeys.add(badKey)
    const res = await sync(a, pa)
    expect(res.rejected).toBe(1)
    expect(res.pushed).toBe(3)
    expect(res.pending).toBe(1)
    const link = await a.syncLinks.get(pa)
    expect(link?.lastErrorCode).toBe('partial')
    expect(link?.lastError).toContain('1 registro(s) no se pudieron subir')
    expect(link?.lastError).not.toContain('250') // never row contents
    // Once accepted, it goes up and the error clears.
    server.refuseKeys.clear()
    const again = await sync(a, pa)
    expect([again.pushed, again.rejected, again.pending]).toEqual([1, 0, 0])
    expect((await a.syncLinks.get(pa))?.lastErrorCode).toBeNull()
  })

  it('a batch where every row is refused is an account-level denial and stops', async () => {
    const { server, a, pa, sync } = await linkedPair()
    const row = await repo(pa, a).add('hydrationLogs', { date: '2026-11-12', time: '08:00', ml: 250 } as never)
    server.refuseKeys.add(docKey('hydrationLogs', encodeRow('hydrationLogs', row as never, pa).cloudId))
    await expect(sync(a, pa)).rejects.toMatchObject({ code: 'permission' })
    expect((await a.syncLinks.get(pa))?.lastErrorCode).toBe('permission')
  })

  it('an oversized row stays on the device instead of being sent forever', async () => {
    const { server, a, pa, sync } = await linkedPair()
    await repo(pa, a).add('foodLogs', { date: '2026-11-12', meal: 'cena', name: 'Enorme', foodRef: 'user:x', qty: 1, unit: 'g', grams: 1, ml: null, nutrients: {}, missing: [], source: 'user', note: 'x'.repeat(MAX_ROW_CHARS + 1) } as never)
    await repo(pa, a).add('foodLogs', { date: '2026-11-12', meal: 'cena', name: 'Normal', foodRef: 'user:y', qty: 1, unit: 'g', grams: 1, ml: null, nutrients: {}, missing: [], source: 'user' } as never)
    const before = server.calls.written
    const res = await sync(a, pa)
    expect([res.pushed, res.rejected, res.pending]).toEqual([1, 1, 1])
    expect(server.calls.written - before).toBe(1)
    expect(await repo(pa, a).count('foodLogs')).toBe(2)
  })

  it('an unreadable cloud document is skipped and the rest still arrives', async () => {
    const { server, a, b, pa, pb, sync } = await linkedPair()
    await repo(pa, a).add('hydrationLogs', { date: '2026-11-12', time: '08:00', ml: 250 } as never)
    await repo(pa, a).add('hydrationLogs', { date: '2026-11-12', time: '09:00', ml: 300 } as never)
    await sync(a, pa)
    const victim = [...server.docs(ANA.uid).values()].find((d) => d.t === 'hydrationLogs')!
    server.docs(ANA.uid).set(victim.key, { ...victim, rev: victim.rev + 1, d: '{not json', at: server.tick() })
    const res = await sync(b, pb)
    expect(res.unreadable).toBe(1)
    expect(await repo(pb, b).count('hydrationLogs')).toBe(1)
    expect((await b.syncLinks.get(pb))?.lastErrorCode).toBe('partial')
  })
})

describe('erase and recreate (audit fix: cloud epoch)', () => {
  it('a device stops when another device erased the cloud copy and linked it again', async () => {
    const { server, a, b, pa, pb, sync } = await linkedPair()
    await repo(pa, a).add('hydrationLogs', { date: '2026-11-12', time: '08:00', ml: 250 } as never)
    await sync(a, pa)
    await sync(b, pb)
    const epoch = (await b.syncLinks.get(pb))?.cloudEpoch
    expect(epoch).toEqual(expect.any(Number))

    await deleteCloudData(a, pa, server.remote(ANA.uid))
    await new Promise((r) => setTimeout(r, 5)) // a later createdAt
    await linkProfile(a, pa, server.remote(ANA.uid), ANA) // re-upload: revisions restart at 1
    expect(server.getMeta(ANA.uid)?.createdAt).not.toBe(epoch)

    await repo(pb, b).add('hydrationLogs', { date: '2026-11-13', time: '08:00', ml: 400 } as never)
    const written = server.calls.written
    await expect(sync(b, pb)).rejects.toMatchObject({ code: 'cloud-reset' })
    expect(server.calls.written).toBe(written) // nothing mixed into the new copy

    // Recovery: unlink and link again; the device merges into the new copy without losing anything.
    await unlinkProfile(b, pb)
    const { verify } = await linkProfile(b, pb, server.remote(ANA.uid), ANA)
    expect(verify.ok).toBe(true)
    expect(await repo(pb, b).count('hydrationLogs')).toBe(2)
    await sync(a, pa)
    expect(await repo(pa, a).count('hydrationLogs')).toBe(2)
  })
})

describe('account isolation with real-looking data on both sides', () => {
  it('two people on two devices never see each other rows', async () => {
    const server = new MemoryServer()
    const a1 = await device()
    const a2 = await device()
    const ana = (await mkProfile(a1, 'Ana')).id
    const beto = (await mkProfile(a1, 'Beto')).id
    await repo(ana, a1).add('hydrationLogs', { date: '2026-11-12', time: '08:00', ml: 111 } as never)
    await repo(beto, a1).add('hydrationLogs', { date: '2026-11-12', time: '08:00', ml: 222 } as never)
    await linkProfile(a1, ana, server.remote(ANA.uid), ANA)
    await linkProfile(a1, beto, server.remote(BETO.uid), BETO)
    const { profileId: beto2 } = await createProfileFromAccount(a2, server.remote(BETO.uid), BETO)
    const ml = async (db: SaludDB, pid: string) => ((await repo(pid, db).all('hydrationLogs')) as { ml: number }[]).map((h) => h.ml)
    expect(await ml(a2, beto2)).toEqual([222])
    expect([...server.docs(BETO.uid).values()].some((d) => d.d?.includes('111'))).toBe(false)
    expect([...server.docs(ANA.uid).values()].some((d) => d.d?.includes('222'))).toBe(false)
    expect((await a2.profiles.toArray()).map((p) => p.name)).toEqual(['Beto'])
  })
})
