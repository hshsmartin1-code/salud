/**
 * Starter programmes: code constants, not stored rows. Original, generic and conventional (sets, rep
 * ranges and rests of common beginner programmes); a starting point to adjust, not a promise of results.
 * Every exercise id exists in the bundled catalog and has an illustration (templates.test.ts checks it).
 */
import type { TrackingType } from '../../db/catalogTypes'
import type { Routine, RoutineExercise } from '../../db/types'
import { copyName, orderAfter, sortRoutines, type NewRoutine } from './routines'

export interface TemplateExercise {
  exerciseId: string
  name: string
  trackingType: TrackingType
  sets: number
  reps: string
  restSec: number
}
export interface TemplateRoutine {
  name: string
  notes: string
  exercises: TemplateExercise[]
}
export interface RoutineTemplate {
  id: string
  name: string
  description: string
  routines: TemplateRoutine[]
}

const x = (exerciseId: string, name: string, trackingType: TrackingType, sets: number, reps: string, restSec: number): TemplateExercise => ({ exerciseId, name, trackingType, sets, reps, restSec })

const GOBLET = x('fedb:Goblet_Squat', 'Sentadilla goblet', 'weight_reps', 3, '8-12', 90)
const DB_BENCH = x('fedb:Dumbbell_Bench_Press', 'Press de banca plano con mancuernas', 'weight_reps', 3, '8-10', 90)
const CABLE_ROW = x('fedb:Seated_Cable_Rows', 'Remo sentado en polea', 'weight_reps', 3, '10-12', 90)
const RDL = x('fedb:Romanian_Deadlift', 'Peso muerto rumano', 'weight_reps', 3, '8-10', 120)
const DB_PRESS = x('fedb:Dumbbell_Shoulder_Press', 'Press de hombros con mancuernas', 'weight_reps', 3, '8-12', 90)
const PLANK = x('fedb:Plank', 'Plancha', 'time', 3, '30-45 s', 60)
const PULLDOWN = x('fedb:Wide-Grip_Lat_Pulldown', 'Jalón al pecho', 'weight_reps', 3, '8-12', 90)
const CURL = x('fedb:Dumbbell_Bicep_Curl', 'Curl de bíceps con mancuernas', 'weight_reps', 3, '10-12', 60)
const PUSHDOWN = x('fedb:Triceps_Pushdown', 'Extensión de tríceps en polea', 'weight_reps', 3, '10-12', 60)

const LEGS: TemplateRoutine = {
  name: 'Pierna',
  notes: 'Piernas y glúteos. Empieza con pesos que te dejen 2 repeticiones en reserva.',
  exercises: [
    x('fedb:Barbell_Squat', 'Sentadilla con barra', 'weight_reps', 4, '6-8', 150),
    RDL,
    x('fedb:Leg_Press', 'Prensa de piernas', 'weight_reps', 3, '10-12', 90),
    x('fedb:Lying_Leg_Curls', 'Curl femoral acostado', 'weight_reps', 3, '10-12', 90),
    x('fedb:Standing_Calf_Raises', 'Elevación de talones de pie', 'weight_reps', 3, '12-15', 60),
    x('fedb:Cable_Crunch', 'Crunch en polea', 'weight_reps', 3, '12-15', 60),
  ],
}

export const TEMPLATES: RoutineTemplate[] = [
  {
    id: 'full-body',
    name: 'Cuerpo completo (3 días)',
    description: 'Una sola rutina para repetir 3 días a la semana con un día de descanso entre sesiones.',
    routines: [
      { name: 'Cuerpo completo', notes: 'Tres días a la semana, alternando con descanso. Sube el peso poco a poco cuando completes todas las repeticiones.', exercises: [GOBLET, DB_BENCH, CABLE_ROW, RDL, { ...DB_PRESS, sets: 2 }, PLANK] },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Torso / Pierna',
    description: 'Dos rutinas que se alternan, por ejemplo cuatro días a la semana.',
    routines: [
      { name: 'Torso', notes: 'Empuje y tracción del tren superior.', exercises: [DB_BENCH, PULLDOWN, DB_PRESS, CABLE_ROW, { ...CURL, sets: 2 }, { ...PUSHDOWN, sets: 2 }] },
      LEGS,
    ],
  },
  {
    id: 'push-pull-legs',
    name: 'Empuje / Tirón / Pierna',
    description: 'Tres rutinas que se reparten los grupos musculares; sirven para 3 a 6 días a la semana.',
    routines: [
      {
        name: 'Empuje',
        notes: 'Pecho, hombros y tríceps.',
        exercises: [DB_BENCH, x('fedb:Incline_Dumbbell_Press', 'Press inclinado con mancuernas', 'weight_reps', 3, '8-12', 90), DB_PRESS, x('fedb:Side_Lateral_Raise', 'Elevaciones laterales', 'weight_reps', 3, '12-15', 60), PUSHDOWN],
      },
      {
        name: 'Tirón',
        notes: 'Espalda y bíceps.',
        exercises: [x('fedb:Pullups', 'Dominadas', 'bodyweight_reps', 3, '6-10', 120), CABLE_ROW, x('fedb:Bent_Over_Two-Dumbbell_Row', 'Remo inclinado con dos mancuernas', 'weight_reps', 3, '10-12', 90), x('fedb:Face_Pull', 'Face pull', 'weight_reps', 3, '12-15', 60), CURL],
      },
      LEGS,
    ],
  },
  {
    id: 'home',
    name: 'En casa sin equipo',
    description: 'Una rutina corta con el peso del cuerpo, sin material.',
    routines: [
      {
        name: 'En casa',
        notes: 'Sin material. Para hacerlo más difícil, añade repeticiones o ve más despacio al bajar.',
        exercises: [
          x('fedb:Bodyweight_Squat', 'Sentadilla con peso corporal', 'bodyweight_reps', 3, '12-15', 60),
          x('fedb:Pushups', 'Flexiones de pecho', 'bodyweight_reps', 3, '8-15', 60),
          x('fedb:Bodyweight_Walking_Lunge', 'Zancadas caminando con peso corporal', 'bodyweight_reps', 3, '10-12', 60),
          x('fedb:Butt_Lift_Bridge', 'Puente de glúteos', 'bodyweight_reps', 3, '12-15', 60),
          x('fedb:Sit-Up', 'Abdominales (sit-up)', 'bodyweight_reps', 3, '12-15', 45),
          { ...PLANK, restSec: 45 },
        ],
      },
    ],
  },
]

export const templateSetCount = (r: TemplateRoutine) => r.exercises.reduce((a, e) => a + e.sets, 0)

/** "3 × 8–12 · 1:30" for the preview. */
export function templateLine(e: TemplateExercise): string {
  const rest = `${Math.floor(e.restSec / 60)}:${String(e.restSec % 60).padStart(2, '0')}`
  return `${e.sets} × ${e.reps.replace(/(\d)-(\d)/g, '$1–$2')} · ${rest}`
}

/**
 * The normal routines a template becomes. Names that already exist get " (copia)"; when the list is in
 * manual order the new routines go to the end.
 */
export function routinesFromTemplate(t: RoutineTemplate, existing: readonly Routine[], newKey: () => string): NewRoutine[] {
  const names = existing.map((r) => r.name)
  const base = orderAfter(sortRoutines(existing, new Map()), null)
  return t.routines.map((tr, i) => {
    const name = names.some((n) => n.toLowerCase() === tr.name.toLowerCase()) ? copyName(tr.name, names) : tr.name
    names.push(name)
    const exercises: RoutineExercise[] = tr.exercises.map((e) => ({ key: newKey(), exerciseId: e.exerciseId, name: e.name, trackingType: e.trackingType, targetSets: e.sets, targetReps: e.reps, restSec: e.restSec }))
    return { name, notes: tr.notes, exercises, ...(base !== undefined ? { order: base + i } : {}) }
  })
}
