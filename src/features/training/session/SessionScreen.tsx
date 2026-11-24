import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useRepo } from '../../../app/profile'
import type { ExerciseSet } from '../../../db/types'
import { EmptyState, PageHeader } from '../../../ui/kit'
import { Skeleton } from '../../../ui/Skeleton'
import { useExercises } from '../exercises'
import { prsBySet } from '../sets'
import { DoneSession } from './DoneSession'
import { LiveSession } from './LiveSession'
import { recordTexts } from './records'

/** Route /entreno/sesion/:id: the live session while active, the summary once finished. */
export default function SessionScreen() {
  const { id = '' } = useParams()
  const r = useRepo()
  const ex = useExercises()
  const session = useLiveQuery(async () => (await r.get('trainingSessions', id)) ?? null, [r, id])
  const sets = useLiveQuery(() => r.byIndex('exerciseSets', 'sessionId', id), [r, id])
  const exerciseIds = session?.exerciseOrder.map((o) => o.exerciseId).join('|') ?? ''
  const doneKey = sets ? sets.filter((s) => s.done).map((s) => `${s.id}:${s.isWarmup ? 1 : 0}:${s.kind ?? ''}:${s.weight}:${s.reps}:${s.durationSec}:${s.distanceM}`).join('|') : ''
  // Each exercise's full history, to judge records set by set (only re-read when a done set changes).
  const history = useLiveQuery(async () => {
    const m = new Map<string, ExerciseSet[]>()
    for (const eid of exerciseIds.split('|').filter(Boolean)) m.set(eid, await r.byProfileIndex('exerciseSets', 'exerciseId', eid))
    return m
  }, [r, exerciseIds, doneKey])
  const prs = useMemo(() => {
    const out = new Map<string, string>()
    for (const [eid, hs] of history ?? []) {
      const byId = new Map(hs.map((h) => [h.id, h]))
      const tracking = session?.exerciseOrder.find((o) => o.exerciseId === eid)?.trackingType ?? 'weight_reps'
      for (const [sid, types] of prsBySet(hs, tracking)) out.set(sid, recordTexts(types, byId.get(sid)!, tracking))
    }
    return out
  }, [history, session])

  if (session === undefined || sets === undefined) return <Skeleton lines={6} label="Cargando sesión" />
  if (!session)
    return (
      <>
        <PageHeader title="Sesión" back="/entreno" />
        <EmptyState icon="dumbbell" title="Sesión no encontrada">
          Puede que se haya eliminado en otro dispositivo.
        </EmptyState>
      </>
    )
  return session.status === 'active' ? <LiveSession session={session} sets={sets} prs={prs} ex={ex} /> : <DoneSession session={session} sets={sets} prs={prs} ex={ex} />
}
