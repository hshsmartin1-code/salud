/**
 * Synthetic demo dataset ("Perfil Demo") in the app's own backup format. Used by unit tests and by the
 * screenshot tool (e2e/v3-capture.mjs). Everything is deterministic: a seeded PRNG, every date derived
 * from the `today` and `now` arguments (no clock reads), ids derived from stable string seeds.
 *
 * Nothing in the seed is later than `now`: on the last day every time of day, timestamp (createdAt,
 * updatedAt, lastUsedAt, exportedAt) and cumulative counter (steps, glasses of water) is capped at the
 * moment the seed is built for. Days before `today` do not depend on `now`.
 *
 * Synthetic data only: no real person, no real measurements.
 */
import type { Backup } from '../../db/backup'
import type { NutrientCode, NutrientMap } from '../../db/catalogTypes'
import type {
  ActivityLog,
  BodyMeasurement,
  DayMark,
  ExerciseFavorite,
  ExerciseSet,
  Favorite,
  FoodLog,
  FoodSnapshot,
  Goal,
  Habit,
  HabitLog,
  HydrationLog,
  MealKey,
  MealTemplate,
  PersonalRow,
  Profile,
  Recent,
  Recipe,
  RecipeIngredient,
  RecoveryLog,
  Routine,
  SleepLog,
  TrainingSession,
  VitalSign,
} from '../../db/types'
import { computeBodyComp, type SkinfoldSite } from '../../domain/bodycomp'
import { addDays } from '../../domain/dates'
import { ageFromBirthDate, computeTargets } from '../../domain/energy'
import { CORE_NUTRIENTS } from '../../domain/nutrients'

export const DEMO_PROFILE_NAME = 'Perfil Demo'
export const DEMO_DAYS = 90

// ───────────── deterministic helpers ─────────────
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
/** mulberry32 */
function prng(seed: string) {
  let a = hashSeed(seed)
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    between: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
  }
}
/** UUID-shaped id from a string seed. */
function hashId(seed: string): string {
  const parts: string[] = []
  for (let i = 0; i < 4; i++) parts.push(hashSeed(`${i}:${seed}`).toString(16).padStart(8, '0'))
  const hex = parts.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(Math.round(mins % 60))}`

// ───────────── food catalog (fixed values per 100 g) ─────────────
interface DemoFood {
  ref: string
  name: string
  kind: 'raw' | 'cooked' | 'generic'
  per100: NutrientMap
  /** Core nutrients this entry does not know (they stay out of `nutrients`, so the day shows "parcial"). */
  unknown?: NutrientCode[]
  portion?: { label: string; grams: number }
}
const nut = (kcal: number, protein: number, carbs: number, fat: number, fiber: number, sugars: number, satFat: number, sodium: number): NutrientMap => ({
  kcal, protein, carbs, fat, fiber, sugars, satFat, sodium,
})
const FOODS = {
  arroz: { ref: 'usda_sr:168878', name: 'Arroz blanco cocido', kind: 'cooked', per100: nut(130, 2.69, 28.17, 0.28, 0.4, 0.05, 0.08, 1) },
  huevos: { ref: 'usda_sr:172187', name: 'Huevos revueltos', kind: 'cooked', per100: nut(149, 9.99, 1.61, 10.98, 0, 1.2, 3.3, 145), portion: { label: '1 grande', grams: 61 } },
  avena: { ref: 'usda_sr:173905', name: 'Avena cocida en agua', kind: 'cooked', per100: nut(71, 2.54, 12, 1.52, 1.7, 0.3, 0.3, 4) },
  banano: { ref: 'usda_sr:173944', name: 'Banano', kind: 'raw', per100: nut(89, 1.09, 22.84, 0.33, 2.6, 12.2, 0.1, 1) },
  pollo: { ref: 'usda_sr:171477', name: 'Pechuga de pollo asada, sin piel', kind: 'cooked', per100: nut(165, 31.02, 0, 3.57, 0, 0, 1, 74) },
  brocoli: { ref: 'usda_sr:169967', name: 'Brócoli cocido', kind: 'cooked', per100: nut(35, 2.38, 7.18, 0.41, 3.3, 1.4, 0.1, 41) },
  yogur: { ref: 'usda_sr:170894', name: 'Yogur griego natural descremado', kind: 'generic', per100: nut(59, 10.19, 3.6, 0.39, 0, 3.2, 0.1, 36) },
  aguacate: { ref: 'usda_sr:171705', name: 'Aguacate', kind: 'raw', per100: nut(160, 2, 8.53, 14.66, 6.7, 0.7, 2.1, 7) },
  pan: { ref: 'usda_sr:172689', name: 'Pan integral tostado', kind: 'cooked', per100: nut(306, 16.27, 51.16, 4.07, 7.4, 5.5, 0.9, 520) },
  leche: { ref: 'usda_sr:171265', name: 'Leche entera', kind: 'generic', per100: nut(61, 3.15, 4.8, 3.25, 0, 5.05, 1.87, 43) },
  atun: { ref: 'usda_sr:173709', name: 'Atún en agua (lata, escurrido)', kind: 'generic', per100: nut(86, 19.44, 0, 0.96, 0, 0, 0.2, 247) },
  papa: { ref: 'usda_sr:170440', name: 'Papa cocida sin cáscara', kind: 'cooked', per100: nut(86, 1.71, 20.01, 0.1, 1.8, 0.9, 0, 4) },
  manzana: { ref: 'usda_sr:171688', name: 'Manzana con cáscara', kind: 'raw', per100: nut(52, 0.26, 13.81, 0.17, 2.4, 10.4, 0, 1) },
  almendras: { ref: 'usda_sr:170567', name: 'Almendras', kind: 'generic', per100: nut(579, 21.15, 21.55, 49.93, 12.5, 4.35, 3.8, 1) },
  pasta: { ref: 'usda_sr:169737', name: 'Pasta cocida', kind: 'cooked', per100: nut(158, 5.8, 30.86, 0.93, 1.8, 0.56, 0.2, 1) },
  lentejas: { ref: 'usda_sr:172421', name: 'Lenteja cocida', kind: 'cooked', per100: nut(116, 9.02, 20.13, 0.38, 7.9, 1.8, 0.05, 2) },
  salmon: { ref: 'usda_sr:175168', name: 'Salmón asado (de cultivo)', kind: 'cooked', per100: nut(206, 22.1, 0, 12.35, 0, 0, 2.5, 61) },
  // Entries with unknown core nutrients → "parcial".
  platano: { ref: 'usda_sr:169131', name: 'Plátano maduro asado', kind: 'cooked', per100: { kcal: 155, protein: 1.52, carbs: 41.37, fat: 0.16, fiber: 2.2 }, unknown: ['sugars', 'satFat', 'sodium'] },
  queso: { ref: 'usda_sr:172223', name: 'Queso fresco / campesino', kind: 'generic', per100: { kcal: 299, protein: 18.09, carbs: 2.98, fat: 23.82 }, unknown: ['fiber', 'sugars', 'satFat'] },
} as const satisfies Record<string, DemoFood>
type FoodKey = keyof typeof FOODS

function snapshot(key: FoodKey, grams: number, asPortions = false): FoodSnapshot {
  const f: DemoFood = FOODS[key]
  const factor = grams / 100
  const nutrients: NutrientMap = {}
  for (const [code, v] of Object.entries(f.per100) as [NutrientCode, number][]) nutrients[code] = r1(v * factor)
  const portion = asPortions && f.portion ? f.portion : null
  return {
    foodRef: f.ref,
    name: f.name,
    brand: null,
    source: 'usda_sr',
    datasetVersion: null,
    kind: f.kind,
    qty: portion ? r2(grams / portion.grams) : grams,
    unit: portion ? 'portion' : 'g',
    portionLabel: portion ? portion.label : null,
    grams,
    ml: null,
    nutrients,
    missing: CORE_NUTRIENTS.filter((c) => nutrients[c] === undefined),
  }
}

type MenuItem = [FoodKey, number, boolean?]
const MENUS: Record<MealKey, MenuItem[][]> = {
  desayuno: [
    [['huevos', 122, true], ['pan', 50], ['banano', 100]],
    [['avena', 250], ['leche', 150], ['banano', 90]],
    [['yogur', 170], ['almendras', 20], ['manzana', 150]],
    [['huevos', 122, true], ['platano', 105], ['queso', 40]],
  ],
  media_manana: [[['manzana', 150]], [['almendras', 25]], [['yogur', 170]]],
  almuerzo: [
    [['arroz', 180], ['pollo', 150], ['brocoli', 100], ['aguacate', 50]],
    [['lentejas', 200], ['arroz', 150], ['platano', 105], ['queso', 40]],
    [['pasta', 220], ['atun', 80], ['brocoli', 80]],
    [['salmon', 140], ['papa', 200], ['brocoli', 100]],
  ],
  onces: [[['banano', 120]], [['yogur', 170], ['almendras', 15]], [['pan', 30], ['queso', 40]]],
  cena: [
    [['huevos', 122, true], ['pan', 60], ['aguacate', 40]],
    [['pollo', 130], ['papa', 180], ['brocoli', 100]],
    [['atun', 90], ['arroz', 120], ['aguacate', 40]],
  ],
  otro: [],
}
const MEAL_TIME: Record<MealKey, number> = { desayuno: 7 * 60 + 30, media_manana: 10 * 60 + 15, almuerzo: 12 * 60 + 45, onces: 16 * 60 + 30, cena: 19 * 60 + 40, otro: 21 * 60 }
const MEAL_PROB: Record<MealKey, number> = { desayuno: 0.95, media_manana: 0.45, almuerzo: 0.97, onces: 0.55, cena: 0.85, otro: 0 }
const MEAL_ORDER: MealKey[] = ['desayuno', 'media_manana', 'almuerzo', 'onces', 'cena']

// ───────────── training catalog (ids exist in public/data/exercises.json) ─────────────
type Tracking = 'weight_reps' | 'bodyweight_reps' | 'time'
interface DemoExercise {
  id: string
  name: string
  tracking: Tracking
  sets: number
  reps: string
  rest: number
  /** First-week working weight (kg) for weight_reps. */
  w0?: number
  /** kg gained per week. */
  dw?: number
  repsBase?: number
}
const X = {
  squat: { id: 'fedb:Barbell_Squat', name: 'Sentadilla con barra', tracking: 'weight_reps', sets: 4, reps: '6-8', rest: 150, w0: 60, dw: 1.25, repsBase: 8 },
  rdl: { id: 'fedb:Romanian_Deadlift', name: 'Peso muerto rumano', tracking: 'weight_reps', sets: 3, reps: '8-10', rest: 120, w0: 60, dw: 1.25, repsBase: 9 },
  legPressNarrow: { id: 'fedb:Narrow_Stance_Leg_Press', name: 'Prensa de piernas con postura estrecha', tracking: 'weight_reps', sets: 3, reps: '10-12', rest: 90, w0: 110, dw: 2.5, repsBase: 11 },
  legCurlStanding: { id: 'fedb:Standing_Leg_Curl', name: 'Curl de pierna de pie', tracking: 'weight_reps', sets: 3, reps: '10-12', rest: 75, w0: 20, dw: 0.5, repsBase: 11 },
  calf: { id: 'fedb:Standing_Calf_Raises', name: 'Elevación de talones de pie', tracking: 'weight_reps', sets: 3, reps: '12-15', rest: 60, w0: 50, dw: 1, repsBase: 14 },
  plank: { id: 'fedb:Plank', name: 'Plancha', tracking: 'time', sets: 3, reps: '30-60 s', rest: 60 },
  bench: { id: 'fedb:Barbell_Bench_Press_-_Medium_Grip', name: 'Press de banca plano con barra', tracking: 'weight_reps', sets: 4, reps: '6-8', rest: 150, w0: 55, dw: 1.25, repsBase: 8 },
  row: { id: 'fedb:Bent_Over_Barbell_Row', name: 'Remo con barra', tracking: 'weight_reps', sets: 4, reps: '8-10', rest: 120, w0: 50, dw: 1.25, repsBase: 9 },
  ohp: { id: 'fedb:Dumbbell_Shoulder_Press', name: 'Press de hombros con mancuernas', tracking: 'weight_reps', sets: 3, reps: '8-10', rest: 90, w0: 16, dw: 0.5, repsBase: 9 },
  pullups: { id: 'fedb:Pullups', name: 'Dominadas', tracking: 'bodyweight_reps', sets: 3, reps: '6-10', rest: 90, repsBase: 5 },
  inclineDb: { id: 'fedb:Incline_Dumbbell_Bench_With_Palms_Facing_In', name: 'Press inclinado con mancuernas y palmas hacia adentro', tracking: 'weight_reps', sets: 3, reps: '10-12', rest: 90, w0: 18, dw: 0.5, repsBase: 11 },
  curl: { id: 'fedb:Barbell_Curl', name: 'Curl de bíceps con barra', tracking: 'weight_reps', sets: 3, reps: '10-12', rest: 75, w0: 25, dw: 0.5, repsBase: 11 },
  goblet: { id: 'fedb:Goblet_Squat', name: 'Sentadilla goblet', tracking: 'weight_reps', sets: 3, reps: '10-12', rest: 90, w0: 20, dw: 0.5, repsBase: 11 },
  pushups: { id: 'fedb:Push-Ups_With_Feet_Elevated', name: 'Flexiones con pies elevados', tracking: 'bodyweight_reps', sets: 3, reps: '10-15', rest: 75, repsBase: 10 },
  lunges: { id: 'fedb:Dumbbell_Lunges', name: 'Zancadas con mancuernas', tracking: 'weight_reps', sets: 3, reps: '10', rest: 90, w0: 12, dw: 0.5, repsBase: 10 },
  dbRow: { id: 'fedb:Bent_Over_Two-Dumbbell_Row', name: 'Remo inclinado con dos mancuernas', tracking: 'weight_reps', sets: 3, reps: '10-12', rest: 90, w0: 16, dw: 0.5, repsBase: 11 },
  crunch: { id: 'fedb:Crunches', name: 'Crunch abdominal', tracking: 'bodyweight_reps', sets: 3, reps: '15-20', rest: 60, repsBase: 15 },
} as const satisfies Record<string, DemoExercise>

const ROUTINES: { key: string; name: string; notes: string; exercises: DemoExercise[] }[] = [
  { key: 'pierna', name: 'Pierna A', notes: 'Dominante de rodilla y cadena posterior.', exercises: [X.squat, X.rdl, X.legPressNarrow, X.legCurlStanding, X.calf, X.plank] },
  { key: 'torso', name: 'Torso A', notes: 'Empuje y tracción.', exercises: [X.bench, X.row, X.ohp, X.pullups, X.inclineDb, X.curl] },
  { key: 'completo', name: 'Cuerpo completo', notes: 'Sesión corta de mantenimiento.', exercises: [X.goblet, X.pushups, X.lunges, X.dbRow, X.crunch, X.plank] },
]

// ───────────── builder ─────────────
/** Local clock (UTC-5, the zone every demo time is written in) as minutes since midnight of `today`. */
function minutesIntoDay(today: string, now: string | number | Date): number {
  return Math.floor((new Date(now).getTime() - Date.parse(`${today}T00:00:00-05:00`)) / 60_000)
}

/**
 * `today` is the local date (YYYY-MM-DD) and `now` the instant the data is built for (default: the end of
 * `today`, i.e. practically no cap). Entries of `today` that would be later than `now` are moved back to
 * dropped (meals, weigh-ins, readings, water, a sleep that ends after `now`), capped (timestamps) or scaled
 * (step and glass counters).
 */
export function buildDemoBackup(today: string, now: string | number | Date = `${today}T23:59:00-05:00`): Backup {
  const pid = hashId('demo:profile')
  const day = (offset: number) => addDays(today, -offset) // offset 0 = today
  const nowMin = Math.max(0, Math.min(1439, minutesIntoDay(today, now)))
  /** Latest minute of today an entry may have: two minutes before `now`, so "now" itself is always newer. */
  const capMin = Math.max(0, nowMin - 2)
  const capMs = Date.parse(`${today}T00:00:00-05:00`) + capMin * 60_000
  /** Share of today already elapsed, for cumulative counters (steps, glasses of water). */
  const dayFraction = (nowMin + 1) / 1440
  /** True when something at this local time of `date` would be later than now (only possible today): it does not exist yet. */
  const later = (date: string, minutes: number) => date === today && minutes > capMin
  /** A local time of day on `date` (minutes), never later than the cap when `date` is today (for timestamps only). */
  const at = (date: string, minutes: number) => (date === today ? Math.min(minutes, capMin) : minutes)
  const stamp = (date: string, time = '12:00') => new Date(Math.min(Date.parse(`${date}T${time}:00.000Z`), date === today ? capMs : Infinity)).toISOString()
  const base = (kind: string, key: string, date: string): PersonalRow => ({
    id: hashId(`${kind}:${key}`),
    profileId: pid,
    createdAt: stamp(date),
    updatedAt: stamp(date),
  })
  /** Local (UTC-5) time on `date` as an ISO instant. */
  const instant = (date: string, minutes: number) => new Date(`${date}T${hhmm(at(date, minutes))}:00-05:00`).toISOString()
  const first = day(DEMO_DAYS - 1)
  const birthDate = '1990-06-15'
  const heightCm = 178

  const profile: Profile = {
    id: pid,
    name: DEMO_PROFILE_NAME,
    sex: 'male',
    birthDate,
    heightCm,
    activity: 'moderate',
    color: 'emerald',
    settings: { addActivityKcal: false, skinfoldProtocol: 'jp3_male', weekStartsMonday: true, stepGoal: 8000, waterGoalMl: 2500 },
    createdAt: stamp(first),
    updatedAt: stamp(first),
  }

  // ── Goal
  const t = computeTargets({ weightKg: 84.6, heightCm, ageYears: ageFromBirthDate(birthDate, first), sex: 'male', activity: 'moderate', goal: 'lose' })
  const goals: Goal[] = [
    {
      ...base('goal', 'main', first),
      validFrom: first,
      goal: 'lose',
      method: 'calculated',
      kcal: t.kcal,
      protein: t.protein,
      carbs: t.carbs,
      fat: t.fat,
      fiber: t.fiber,
      inputs: { ...t.inputs },
      methodText: t.method,
      warnings: t.warnings,
      targetWeightKg: 78,
      origin: 'app',
    },
  ]

  // ── Food logs (≈ 80 % of days, with a few forced gaps), recents, favorites, day marks
  const rf = prng('food')
  const foodLogs: FoodLog[] = []
  const dayMarks: DayMark[] = []
  const recentAgg = new Map<string, { snap: FoodSnapshot; usedAt: string; count: number }>()
  const gapOffsets = new Set([26, 27, 28, 55, 56, 70]) // multi-day gaps on top of the random ones
  for (let off = DEMO_DAYS - 1; off >= 0; off--) {
    const date = day(off)
    const isToday = off === 0
    const logged = isToday || (!gapOffsets.has(off) && rf.chance(0.84))
    if (!logged) continue
    let n = 0
    const partialDay = !isToday && rf.chance(0.12) // only the first meals were logged
    for (const meal of MEAL_ORDER) {
      if (isToday && meal !== 'desayuno' && meal !== 'almuerzo') continue
      if (!isToday && partialDay && (meal === 'cena' || meal === 'onces')) continue
      if (!isToday && !rf.chance(MEAL_PROB[meal])) continue
      const options = MENUS[meal]
      const menu = isToday ? options[meal === 'desayuno' ? 1 : 0]! : rf.pick(options)
      const mins = MEAL_TIME[meal] + rf.int(-15, 20)
      menu.forEach(([key, grams, asPortions], i) => {
        const snap = snapshot(key, asPortions ? grams : Math.round((grams * 1.35) / 5) * 5, asPortions) // generous portions, so the day lands near the kcal goal
        if (later(date, mins + i)) return // not eaten yet
        const time = hhmm(mins + i)
        foodLogs.push({
          ...base('foodlog', `${date}:${meal}:${i}`, date),
          ...snap,
          date,
          time,
          meal,
          origin: 'app',
        })
        const prev = recentAgg.get(snap.foodRef)
        recentAgg.set(snap.foodRef, { snap, usedAt: instant(date, mins + i), count: (prev?.count ?? 0) + 1 })
        n++
      })
    }
    if (!isToday && n > 0) dayMarks.push({ ...base('daymark', date, date), date, complete: !partialDay })
  }
  const recents: Recent[] = [...recentAgg.values()].map(({ snap, usedAt, count }) => ({
    ...base('recent', snap.foodRef, today),
    id: `${pid}|${snap.foodRef}`,
    foodRef: snap.foodRef,
    name: snap.name,
    source: snap.source,
    lastUsedAt: usedAt,
    count,
    lastQty: snap.qty,
    lastUnit: snap.unit,
    lastPortionLabel: snap.portionLabel ?? null,
    lastPortionId: null,
  }))
  const favorites: Favorite[] = (['pollo', 'arroz', 'huevos', 'yogur', 'almendras'] as FoodKey[]).map((k) => ({
    ...base('fav', k, first),
    id: `${pid}|${FOODS[k].ref}`,
    foodRef: FOODS[k].ref,
    name: FOODS[k].name,
    source: 'usda_sr',
  }))
  const ing = (key: FoodKey, grams: number): RecipeIngredient => ({ ...snapshot(key, grams), key: hashId(`ing:${key}:${grams}`).slice(0, 8) })
  const recipes: Recipe[] = [
    { ...base('recipe', 'bowl', first), name: 'Bowl de pollo, arroz y brócoli', servings: 2, cookedWeightG: 880, ingredients: [ing('pollo', 300), ing('arroz', 360), ing('brocoli', 200), ing('aguacate', 100)], notes: 'Receta de demostración.' },
    { ...base('recipe', 'avena', first), name: 'Avena con banano y almendras', servings: 2, cookedWeightG: null, ingredients: [ing('avena', 500), ing('banano', 180), ing('almendras', 30)] },
  ]
  const templates: MealTemplate[] = [
    { ...base('tpl', 'desayuno', first), name: 'Desayuno de huevos', meal: 'desayuno', items: [snapshot('huevos', 122, true), snapshot('pan', 50), snapshot('banano', 100)] },
    { ...base('tpl', 'almuerzo', first), name: 'Almuerzo base', meal: 'almuerzo', items: [snapshot('arroz', 180), snapshot('pollo', 150), snapshot('brocoli', 100)] },
  ]

  // ── Body measurements
  const rb = prng('body')
  const bodyMeasurements: BodyMeasurement[] = []
  const skinfoldDays: Record<number, Partial<Record<SkinfoldSite, number>>> = {
    85: { chest: 12, abdominal: 24, thigh: 20 },
    45: { chest: 11, abdominal: 22, thigh: 18.5 },
    5: { chest: 10, abdominal: 20, thigh: 17 },
  }
  for (let off = DEMO_DAYS - 1; off >= 0; off--) {
    const date = day(off)
    const elapsed = DEMO_DAYS - 1 - off
    const weekly = elapsed % 7 === 2
    const hasSkin = off in skinfoldDays
    const hasWeight = hasSkin || weekly || rb.chance(4 / 7)
    if (!hasWeight && !weekly) continue
    const weightKg = r1(84.6 - elapsed * 0.036 + rb.between(-0.35, 0.35))
    const circumferences = weekly ? { waist: r1(93.5 - (elapsed / 7) * 0.25 + rb.between(-0.4, 0.4)) } : {}
    let skinfolds: Partial<Record<SkinfoldSite, number>> = {}
    let derived: BodyMeasurement['derived'] = null
    let protocol: BodyMeasurement['protocol'] = null
    if (hasSkin) {
      skinfolds = skinfoldDays[off]!
      protocol = 'jp3_male'
      const ageYears = ageFromBirthDate(birthDate, date)
      const res = computeBodyComp({ protocol, sex: 'male', ageYears, skinfolds, weightKg, heightCm })
      derived = {
        estimated: true,
        protocol,
        equation: res.equation,
        method: res.method,
        sum: res.sum,
        ...(res.density !== undefined ? { density: res.density } : {}),
        ...(res.bodyFatPct !== undefined ? { bodyFatPct: res.bodyFatPct } : {}),
        ...(res.fatMassKg !== undefined ? { fatMassKg: res.fatMassKg } : {}),
        ...(res.leanMassKg !== undefined ? { leanMassKg: res.leanMassKg } : {}),
        inputs: { sex: 'male', ageYears, weightKg, heightCm },
        computedAt: stamp(date, '08:05'),
      }
    }
    if (later(date, 7 * 60 + 10)) continue // not weighed yet today
    bodyMeasurements.push({
      ...base('body', date, date),
      date,
      time: '07:10',
      weightKg: hasWeight ? weightKg : null,
      circumferences: hasSkin && !weekly ? {} : circumferences,
      skinfolds,
      protocol,
      derived,
      origin: 'app',
    })
  }

  // ── Activity, sleep, recovery
  const ra = prng('activity')
  const activityLogs: ActivityLog[] = []
  const rs = prng('sleep')
  const sleepLogs: SleepLog[] = []
  const rr = prng('recovery')
  const recoveryLogs: RecoveryLog[] = []
  for (let off = DEMO_DAYS - 1; off >= 0; off--) {
    const date = day(off)
    if (ra.chance(0.87) || off === 0) {
      const fullDaySteps = ra.int(3800, 12600)
      const steps = off === 0 ? Math.round((fullDaySteps * dayFraction) / 10) * 10 : fullDaySteps
      const withWorkout = ra.chance(0.35)
      const type = withWorkout ? ra.pick(['Caminata', 'Carrera', 'Bicicleta'] as const) : 'Caminata'
      const minutes = withWorkout ? ra.int(25, 70) : null
      activityLogs.push({
        ...base('act', date, date),
        date,
        type,
        steps,
        activeKcal: withWorkout ? ra.int(180, 520) : null,
        minutes,
        distanceKm: withWorkout ? r2((minutes as number) * (type === 'Bicicleta' ? 0.35 : type === 'Carrera' ? 0.17 : 0.09)) : null,
        origin: 'app',
      })
    }
    if (rs.chance(0.86)) {
      const hours = r1(rs.between(5.6, 8.6))
      const bed = 22 * 60 + rs.int(0, 150) // 22:00–00:30
      const wakesAt = (bed + Math.round(hours * 60)) % 1440
      const quality = hours > 7.3 ? rs.int(4, 5) : hours > 6.3 ? rs.int(3, 4) : rs.int(1, 3)
      // Last night's sleep is logged on waking: before that moment it does not exist yet.
      if (off !== 0 || wakesAt <= capMin) sleepLogs.push({
        ...base('sleep', date, date),
        date,
        hours,
        bedtime: hhmm(bed),
        waketime: hhmm(bed + Math.round(hours * 60)),
        quality,
        origin: 'app',
      })
    }
    if (rr.chance(0.5)) {
      recoveryLogs.push({
        ...base('rec', date, date),
        date,
        energy: rr.int(2, 5),
        soreness: rr.int(1, 4),
        stress: rr.int(1, 4),
        mood: rr.int(3, 5),
        restingHr: rr.int(54, 62),
        origin: 'app',
      })
    }
  }

  // ── Vitals
  const rv = prng('vitals')
  const vitals: VitalSign[] = []
  const vital = (date: string, time: string, v: Omit<VitalSign, keyof PersonalRow | 'date' | 'time'>, key: string): void => {
    if (later(date, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))) return
    vitals.push({ ...base('vital', `${date}:${key}`, date), date, time, ...v, origin: 'app' })
  }
  for (let off = DEMO_DAYS - 1; off >= 0; off--) {
    const date = day(off)
    const elapsed = DEMO_DAYS - 1 - off
    if (rv.chance(2 / 7)) {
      vital(date, '07:25', { kind: 'bloodPressure', systolic: rv.int(112, 128), diastolic: rv.int(70, 82), value: null, unit: 'mmHg', context: 'reposo' }, 'bp')
    }
    if (elapsed % 7 === 1) {
      vital(date, '07:20', { kind: 'restingHr', value: rv.int(54, 62), unit: 'lpm', context: 'reposo' }, 'hr')
    }
    if (elapsed % 11 === 4) {
      const ayunas = rv.chance(0.6)
      vital(date, ayunas ? '07:00' : '14:30', { kind: 'glucose', value: ayunas ? rv.int(80, 96) : rv.int(105, 132), unit: 'mg/dL', context: ayunas ? 'ayunas' : 'posprandial' }, 'glu')
    }
  }
  vital(day(30), '21:10', { kind: 'spo2', value: 98, unit: '%', context: 'reposo' }, 'spo2')
  vital(day(12), '20:00', { kind: 'temperature', value: 36.6, unit: '°C', context: null }, 'temp')

  // ── Hydration
  const rh = prng('water')
  const hydrationLogs: HydrationLog[] = []
  for (let off = DEMO_DAYS - 1; off >= 0; off--) {
    const date = day(off)
    if (off !== 0 && !rh.chance(0.85)) continue
    const n = off === 0 ? 3 : rh.int(4, 8)
    for (let i = 0; i < n; i++) {
      const mins = 8 * 60 + i * rh.int(75, 110)
      const ml = rh.pick([250, 330, 500, 600] as const)
      if (later(date, mins)) continue
      hydrationLogs.push({ ...base('water', `${date}:${i}`, date), date, time: hhmm(mins), ml, drink: 'Agua' })
    }
  }

  // ── Habits
  const habitDefs: { key: string; name: string; kind: Habit['kind']; dose: string | null; target: number; unit: string | null; p: number }[] = [
    { key: 'estirar', name: 'Estiramiento 10 min', kind: 'habit', dose: null, target: 1, unit: null, p: 0.6 },
    { key: 'caminar', name: 'Caminata de 30 min', kind: 'habit', dose: null, target: 1, unit: null, p: 0.7 },
    { key: 'vasos', name: 'Vasos de agua', kind: 'habit', dose: null, target: 8, unit: 'vasos', p: 0.75 },
    { key: 'creatina', name: 'Creatina', kind: 'supplement', dose: '5 g', target: 1, unit: null, p: 0.8 },
  ]
  const habits: Habit[] = habitDefs.map((h, i) => ({
    ...base('habit', h.key, first),
    name: h.name,
    kind: h.kind,
    dose: h.dose,
    target: h.target,
    unit: h.unit,
    active: true,
    order: i,
  }))
  const rhb = prng('habits')
  const habitLogs: HabitLog[] = []
  for (let off = DEMO_DAYS - 1; off >= 0; off--) {
    const date = day(off)
    habitDefs.forEach((h, i) => {
      if (!rhb.chance(h.p) || (off >= 40 && off <= 42)) return
      habitLogs.push({
        ...base('hlog', `${h.key}:${date}`, date),
        habitId: habits[i]!.id,
        date,
        value: h.target > 1 ? (off === 0 ? Math.min(h.target, Math.max(0, Math.round(rhb.int(4, 8) * dayFraction))) : rhb.int(4, 8)) : 1,
      })
    })
  }

  // ── Routines, sessions, sets (12 weeks × 3 sessions, gradual progression)
  const routines: Routine[] = ROUTINES.map((rt) => ({
    ...base('routine', rt.key, first),
    name: rt.name,
    notes: rt.notes,
    exercises: rt.exercises.map((e, i) => ({
      key: hashId(`rx:${rt.key}:${i}`).slice(0, 8),
      exerciseId: e.id,
      name: e.name,
      trackingType: e.tracking,
      targetSets: e.sets,
      targetReps: e.reps,
      restSec: e.rest,
    })),
  }))
  const rt = prng('training')
  const trainingSessions: TrainingSession[] = []
  const exerciseSets: ExerciseSet[] = []
  const WEEKS = 12
  for (let w = 0; w < WEEKS; w++) {
    ROUTINES.forEach((def, slot) => {
      // Weekly rhythm: day 0, 2 and 4 of the week, one day later now and then (never after yesterday).
      const offsetFromFirst = w * 7 + slot * 2 + (rt.chance(0.2) ? 1 : 0)
      const date = day(WEEKS * 7 - 1 - offsetFromFirst) // first session 83 days ago, last one yesterday at the latest
      const routine = routines[slot]!
      const sid = hashId(`session:${w}:${def.key}`)
      const startMin = 18 * 60 + rt.int(0, 60)
      const durationMin = rt.int(48, 72)
      def.exercises.forEach((ex, exIdx) => {
        const repsBase = ex.repsBase ?? 8
        let idx = 0
        const addSet = (p: Partial<ExerciseSet>) => {
          exerciseSets.push({
            ...base('set', `${sid}:${ex.id}:${idx}`, date),
            sessionId: sid,
            date,
            exerciseId: ex.id,
            exerciseName: ex.name,
            setIndex: idx++,
            weight: null,
            reps: null,
            durationSec: null,
            distanceM: null,
            rpe: null,
            isWarmup: false,
            done: true,
            origin: 'app',
            ...p,
          })
        }
        if (ex.tracking === 'weight_reps') {
          const work = Math.round(((ex.w0 ?? 20) + (ex.dw ?? 0) * w) / 0.5) * 0.5
          if (exIdx === 0) {
            addSet({ weight: Math.round((work * 0.5) / 2.5) * 2.5, reps: 8, isWarmup: true })
            addSet({ weight: Math.round((work * 0.75) / 2.5) * 2.5, reps: 5, isWarmup: true })
          }
          for (let s = 0; s < ex.sets; s++) {
            const reps = Math.max(5, repsBase + (w % 3 === 2 ? 1 : 0) - (s >= 2 ? 1 : 0) - (s === ex.sets - 1 && rt.chance(0.4) ? 1 : 0))
            addSet({ weight: work, reps, rpe: s === ex.sets - 1 ? rt.pick([8, 8.5, 9] as const) : rt.chance(0.3) ? 7.5 : null })
          }
        } else if (ex.tracking === 'bodyweight_reps') {
          const top = repsBase + Math.floor(w * (ex.id.endsWith('Pullups') ? 0.35 : 0.5))
          for (let s = 0; s < ex.sets; s++) addSet({ reps: Math.max(3, top - s - (rt.chance(0.3) ? 1 : 0)), rpe: s === ex.sets - 1 ? 9 : null })
        } else {
          for (let s = 0; s < ex.sets; s++) addSet({ durationSec: 40 + w * 4 - s * 5 + rt.int(-3, 3) })
        }
      })
      trainingSessions.push({
        ...base('session', `${w}:${def.key}`, date),
        id: sid,
        date,
        name: def.name,
        routineId: routine.id,
        status: 'done',
        startedAt: instant(date, startMin),
        endedAt: instant(date, startMin + durationMin),
        restEndsAt: null,
        exerciseOrder: def.exercises.map((e) => ({ exerciseId: e.id, name: e.name, trackingType: e.tracking, restSec: e.rest })),
        rpe: rt.pick([7, 7.5, 8, 8.5] as const),
        durationMin,
        origin: 'app',
      })
    })
  }
  const exerciseFavorites: ExerciseFavorite[] = [X.squat, X.bench, X.pullups].map((e) => ({
    ...base('exfav', e.id, first),
    id: `${pid}|${e.id}`,
    exerciseId: e.id,
    name: e.name,
  }))

  const tables = {
    goals,
    foodLogs,
    recipes,
    mealTemplates: templates,
    favorites,
    recents,
    routines,
    trainingSessions,
    exerciseSets,
    bodyMeasurements,
    activityLogs,
    sleepLogs,
    recoveryLogs,
    habits,
    habitLogs,
    dayMarks,
    vitals,
    hydrationLogs,
    exerciseFavorites,
  }
  return {
    format: 'pho-backup',
    schemaVersion: 2,
    appVersion: '2.2.1',
    exportedAt: stamp(today, '12:00'),
    scope: 'profile',
    profiles: [profile],
    includedTables: Object.keys(tables) as Backup['includedTables'],
    media: false,
    tables: tables as unknown as Backup['tables'],
  }
}
