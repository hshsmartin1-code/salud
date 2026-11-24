/**
 * Human labels and value formatting for the sync conflict screen.
 *
 * A conflict holds two raw rows (this device and the cloud). People must never see internal field
 * names or JSON: every field that can appear in a synced table maps to a Spanish label and a value
 * formatter. Unknown fields fall back to «Otro dato» with the raw key kept as secondary text.
 */
import { formatDateEs, isCalendarDate, nowLocalTime, todayLocal } from '../domain/dates'
import { formatNumber } from '../domain/units'
import { PROFILE_TABLE } from './syncTables'
import { NUTRIENTS } from '../db/catalogTypes'

type Row = Record<string, unknown>
type Fmt = (v: unknown, row: Row | null) => string

export interface FieldSpec {
  label: string
  fmt?: Fmt
}

export const EMPTY = '—'
export const UNKNOWN_FIELD_LABEL = 'Otro dato'

/** Fields that never differ meaningfully for a person (identity and bookkeeping). */
export const HIDDEN_FIELDS: ReadonlySet<string> = new Set(['id', 'profileId', 'createdAt', 'updatedAt', 'sessionId', 'habitId', 'goalId', 'foodRef', 'exerciseId', 'routineId', 'labelImageId', 'portionId', 'lastPortionId', 'sourceRef', 'restEndsAt'])

const MEAL: Record<string, string> = { desayuno: 'Desayuno', media_manana: 'Media mañana', almuerzo: 'Almuerzo', onces: 'Onces', cena: 'Cena', otro: 'Otro' }
const SEX: Record<string, string> = { male: 'Hombre', female: 'Mujer' }
const ACTIVITY: Record<string, string> = { sedentary: 'Sedentaria', light: 'Ligera', moderate: 'Moderada', active: 'Alta', very_active: 'Muy alta' }
const GOAL: Record<string, string> = { lose: 'Perder grasa', maintain: 'Mantener', gain: 'Ganar masa', recomp: 'Recomposición' }
const PHYSIO: Record<string, string> = { none: 'Ninguno', pregnant: 'Embarazo', lactating: 'Lactancia' }
const VITAL: Record<string, string> = { bloodPressure: 'Presión arterial', restingHr: 'Pulso en reposo', spo2: 'Saturación de oxígeno', glucose: 'Glucosa', temperature: 'Temperatura' }
const TRACKING: Record<string, string> = { weight_reps: 'Peso × repeticiones', bodyweight_reps: 'Peso corporal × repeticiones', time: 'Tiempo', distance: 'Distancia' }
const SET_KIND: Record<string, string> = { warmup: 'Calentamiento', drop: 'Serie descendente', failure: 'Al fallo' }
const STATUS: Record<string, string> = { active: 'En curso', done: 'Terminada' }
const COLOR: Record<string, string> = { emerald: 'Verde', violet: 'Violeta', amber: 'Ámbar', sky: 'Celeste', rose: 'Rosa' }
const UNIT: Record<string, string> = { g: 'g', kg: 'kg', oz: 'oz', lb: 'lb', ml: 'ml', l: 'L', serving: 'porción', portion: 'porción' }
const PHASE: Record<string, string> = { deficit: 'Déficit', maintenance: 'Mantenimiento', surplus: 'Superávit' }
const CONFIDENCE: Record<string, string> = { none: 'Sin datos', low: 'Baja', medium: 'Media', high: 'Alta' }
const HABIT_KIND: Record<string, string> = { habit: 'Hábito', supplement: 'Suplemento' }
const METHOD: Record<string, string> = { calculated: 'Calculado', manual: 'Manual' }
const ENTRY: Record<string, string> = { manual: 'A mano', text: 'Texto pegado', ocr: 'Foto de la etiqueta' }
const FOOD_SOURCE: Record<string, string> = { user: 'Propio', label: 'Etiqueta', icbf_tcac2015: 'Tabla colombiana (ICBF)', off: 'Open Food Facts', recipe: 'Receta', usda_foundation: 'USDA', usda_sr: 'USDA', usda_fndds: 'USDA' }
const FOOD_KIND: Record<string, string> = { generic: 'Genérico', raw: 'Crudo', cooked: 'Cocido', prepared: 'Preparado', packaged: 'Empacado', recipe: 'Receta', user: 'Propio' }

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Generic, human formatting for a value whose field is unknown. Never JSON. */
export function formatGeneric(v: unknown): string {
  if (v === null || v === undefined || v === '') return EMPTY
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (isNum(v)) return formatNumber(v, 2)
  if (typeof v === 'string') {
    if (isCalendarDate(v)) return formatDateEs(v)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatInstant(v)
    return clip(v)
  }
  if (Array.isArray(v)) return count(v.length, 'elemento', 'elementos')
  if (typeof v === 'object') return count(Object.keys(v as object).length, 'dato', 'datos')
  return EMPTY
}

function count(n: number, one: string, many: string): string {
  return n === 0 ? 'Ninguno' : `${formatNumber(n, 0)} ${n === 1 ? one : many}`
}

/** An ISO instant shown as a local date and time in the app's time zone. */
export function formatInstant(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return clip(iso)
  return `${formatDateEs(todayLocal(d))}, ${nowLocalTime(d)}`
}

const num = (unit: string, decimals = 1): Fmt => (v) => (isNum(v) ? `${formatNumber(v, decimals)}${unit ? ` ${unit}` : ''}` : formatGeneric(v))
const plain = (decimals = 1): Fmt => (v) => (isNum(v) ? formatNumber(v, decimals) : formatGeneric(v))
const enumOf = (map: Record<string, string>): Fmt => (v) => (typeof v === 'string' ? (map[v] ?? clip(v)) : formatGeneric(v))
const date: Fmt = (v) => (typeof v === 'string' && isCalendarDate(v) ? formatDateEs(v) : formatGeneric(v))
const instant: Fmt = (v) => (typeof v === 'string' ? formatInstant(v) : formatGeneric(v))
const time: Fmt = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v) ? v.slice(0, 5) : formatGeneric(v))
const text: Fmt = (v) => (typeof v === 'string' ? (v.trim() ? clip(v.trim()) : EMPTY) : formatGeneric(v))
const yesNo: Fmt = (v) => (typeof v === 'boolean' ? (v ? 'Sí' : 'No') : formatGeneric(v))
const outOf5: Fmt = (v) => (isNum(v) ? `${formatNumber(v, 0)} de 5` : formatGeneric(v))
const names = (one: string, many: string, nameKey = 'name'): Fmt => (v) => {
  if (!Array.isArray(v)) return formatGeneric(v)
  const list = v.map((x) => (x && typeof x === 'object' ? (x as Row)[nameKey] : typeof x === 'string' ? x : null)).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  const head = count(v.length, one, many)
  if (!list.length) return head
  const shown = list.slice(0, 3).join(', ')
  return clip(`${head}: ${shown}${list.length > 3 ? '…' : ''}`, 100)
}
const counted = (one: string, many: string): Fmt => (v) => (Array.isArray(v) ? count(v.length, one, many) : v && typeof v === 'object' ? count(Object.keys(v).length, one, many) : formatGeneric(v))
const DAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
/** «3 días: lun, mié, vie · recordatorio 07:00» for a weekly training plan; null when there is none to show. */
function planText(plan: unknown): string | null {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null
  const p = plan as { days?: unknown; overrides?: unknown; reminder?: unknown }
  const days = p.days && typeof p.days === 'object' ? Object.keys(p.days).filter((k) => /^[1-7]$/.test(k)).sort() : []
  const changes = p.overrides && typeof p.overrides === 'object' ? Object.keys(p.overrides).length : 0
  if (!days.length && !changes) return null
  const r = p.reminder as { on?: unknown; time?: unknown } | undefined
  const parts = [days.length ? count(days.length, 'día', 'días') + ': ' + days.map((k) => DAY_SHORT[Number(k) - 1]).join(', ') : 'sin días fijos']
  if (changes) parts.push(count(changes, 'cambio puntual', 'cambios puntuales'))
  if (r?.on === true && typeof r.time === 'string') parts.push(`recordatorio ${r.time}`)
  return parts.join(' · ')
}
/** The profile preferences: how many there are, plus the weekly plan in words when it has one («Planificación semanal»). */
const settingsText: Fmt = (v, row) => {
  const base = counted('preferencia', 'preferencias')(v, row)
  const plan = v && typeof v === 'object' ? planText((v as { training?: { plan?: unknown } }).training?.plan) : null
  return plan ? `${base} · Planificación semanal (${plan})` : base
}
const strings: Fmt = (v) => (Array.isArray(v) ? (v.length ? clip(v.filter((x) => typeof x === 'string').join(', '), 100) : 'Ninguno') : formatGeneric(v))
/** A value whose unit is stored in the row's own `unit` field (vitals, imported values, habits). */
const withRowUnit: Fmt = (v, row) => {
  if (!isNum(v)) return formatGeneric(v)
  const u = typeof row?.unit === 'string' && row.unit ? ` ${row.unit}` : ''
  return `${formatNumber(v, 1)}${u}`
}
const derived: Fmt = (v) => {
  if (!v || typeof v !== 'object') return formatGeneric(v)
  const pct = (v as Row).bodyFatPct
  return isNum(pct) ? `${formatNumber(pct, 1)} % de grasa (estimado)` : 'Cálculo de composición'
}
const nutrientValues: Fmt = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return formatGeneric(v)
  const values = NUTRIENTS.flatMap((n) => {
    const value = (v as Row)[n.code]
    return isNum(value) ? [`${n.es}: ${formatNumber(value, 3)} ${n.unit}`] : []
  })
  return values.length ? values.join(' · ') : 'Ninguno'
}

/** Labels shared by every table. Table-specific entries below take precedence. */
const COMMON: Record<string, FieldSpec> = {
  date: { label: 'Fecha', fmt: date },
  time: { label: 'Hora', fmt: time },
  name: { label: 'Nombre', fmt: text },
  notes: { label: 'Notas', fmt: text },
  note: { label: 'Nota', fmt: text },
  title: { label: 'Título', fmt: text },
  brand: { label: 'Marca', fmt: text },
  barcode: { label: 'Código de barras', fmt: text },
  category: { label: 'Categoría', fmt: text },
  source: { label: 'Fuente', fmt: enumOf(FOOD_SOURCE) },
  origin: { label: 'Origen', fmt: enumOf({ app: 'Esta app', phase0: 'Importado' }) },
  approx: { label: 'Aproximado', fmt: yesNo },
  excludeFromStats: { label: 'Fuera de las estadísticas', fmt: yesNo },
  order: { label: 'Posición', fmt: plain(0) },
  archived: { label: 'Archivada', fmt: yesNo },
  active: { label: 'Activo', fmt: yesNo },
  unit: { label: 'Unidad', fmt: enumOf(UNIT) },
  // Food snapshot (food logs, recipe ingredients, templates).
  qty: { label: 'Cantidad', fmt: plain(2) },
  grams: { label: 'Gramos', fmt: num('g') },
  ml: { label: 'Mililitros', fmt: num('ml', 0) },
  meal: { label: 'Comida', fmt: enumOf(MEAL) },
  nutrients: { label: 'Nutrientes', fmt: counted('nutriente', 'nutrientes') },
  missing: { label: 'Nutrientes sin dato', fmt: counted('nutriente', 'nutrientes') },
  kind: { label: 'Tipo', fmt: text },
  portionLabel: { label: 'Porción', fmt: text },
  portionSource: { label: 'Fuente de la porción', fmt: enumOf(FOOD_SOURCE) },
  portionVerification: { label: 'Verificación de la porción', fmt: text },
  portionEquivalentAmount: { label: 'Equivalencia de la porción', fmt: plain(1) },
  portionEquivalentUnit: { label: 'Unidad de la equivalencia', fmt: enumOf(UNIT) },
  datasetVersion: { label: 'Versión de la base de datos', fmt: text },
  // Goals.
  validFrom: { label: 'Válido desde', fmt: date },
  goal: { label: 'Objetivo', fmt: enumOf(GOAL) },
  method: { label: 'Método', fmt: enumOf(METHOD) },
  kcal: { label: 'Calorías', fmt: num('kcal', 0) },
  protein: { label: 'Proteína', fmt: num('g', 0) },
  carbs: { label: 'Carbohidratos', fmt: num('g', 0) },
  fat: { label: 'Grasa', fmt: num('g', 0) },
  fiber: { label: 'Fibra', fmt: num('g', 0) },
  inputs: { label: 'Datos del cálculo', fmt: counted('dato', 'datos') },
  methodText: { label: 'Explicación del cálculo', fmt: text },
  warnings: { label: 'Avisos', fmt: counted('aviso', 'avisos') },
  targetWeightKg: { label: 'Peso objetivo', fmt: num('kg') },
  adaptive: { label: 'Ajuste adaptativo', fmt: yesNo },
  // Custom foods.
  basis: { label: 'Base de los valores', fmt: enumOf({ '100g': 'Por 100 g', '100ml': 'Por 100 ml', serving: 'Por porción' }) },
  portions: { label: 'Porciones', fmt: counted('porción', 'porciones') },
  servingSize: { label: 'Tamaño de la porción', fmt: withRowUnitKey('servingUnit') },
  servingUnit: { label: 'Unidad de la porción', fmt: enumOf(UNIT) },
  labelBasis: { label: 'Base de la etiqueta', fmt: enumOf({ serving: 'Por porción', '100g': 'Por 100 g', '100ml': 'Por 100 ml', package: 'Por paquete' }) },
  labelNutrients: { label: 'Valores de la etiqueta', fmt: counted('nutriente', 'nutrientes') },
  servingLabel: { label: 'Porción de la etiqueta', fmt: text },
  servingsPerPackage: { label: 'Porciones por paquete', fmt: plain(1) },
  packageSize: { label: 'Tamaño del paquete', fmt: withRowUnitKey('packageUnit') },
  packageUnit: { label: 'Unidad del paquete', fmt: enumOf(UNIT) },
  entryMethod: { label: 'Cómo se registró', fmt: enumOf(ENTRY) },
  sourceText: { label: 'Texto de la etiqueta', fmt: text },
  validation: { label: 'Validación', fmt: enumOf({ confirmed: 'Confirmada' }) },
  // Recipes and templates.
  servings: { label: 'Porciones', fmt: plain(1) },
  cookedWeightG: { label: 'Peso cocinado', fmt: num('g', 0) },
  ingredients: { label: 'Ingredientes', fmt: names('ingrediente', 'ingredientes') },
  items: { label: 'Alimentos', fmt: names('alimento', 'alimentos') },
  // Recents.
  lastUsedAt: { label: 'Último uso', fmt: instant },
  count: { label: 'Veces usado', fmt: plain(0) },
  lastQty: { label: 'Última cantidad', fmt: plain(2) },
  lastUnit: { label: 'Última unidad', fmt: enumOf(UNIT) },
  lastPortionLabel: { label: 'Última porción', fmt: text },
  // Training.
  exercises: { label: 'Ejercicios', fmt: names('ejercicio', 'ejercicios') },
  exerciseOrder: { label: 'Ejercicios', fmt: names('ejercicio', 'ejercicios') },
  status: { label: 'Estado', fmt: enumOf(STATUS) },
  startedAt: { label: 'Inicio', fmt: instant },
  endedAt: { label: 'Fin', fmt: instant },
  durationMin: { label: 'Duración', fmt: num('min', 0) },
  rpe: { label: 'Esfuerzo percibido (RPE)', fmt: plain(1) },
  rir: { label: 'Repeticiones en reserva', fmt: plain(0) },
  exerciseName: { label: 'Ejercicio', fmt: text },
  setIndex: { label: 'Número de serie', fmt: (v) => (isNum(v) ? formatNumber(v + 1, 0) : formatGeneric(v)) },
  weight: { label: 'Peso', fmt: num('kg', 2) },
  reps: { label: 'Repeticiones', fmt: plain(0) },
  durationSec: { label: 'Duración', fmt: num('s', 0) },
  distanceM: { label: 'Distancia', fmt: num('m', 0) },
  isWarmup: { label: 'Calentamiento', fmt: yesNo },
  done: { label: 'Hecha', fmt: yesNo },
  nameEs: { label: 'Nombre', fmt: text },
  aliases: { label: 'Otros nombres', fmt: strings },
  primaryMuscles: { label: 'Músculos principales', fmt: strings },
  secondaryMuscles: { label: 'Músculos secundarios', fmt: strings },
  equipment: { label: 'Equipo', fmt: text },
  trackingType: { label: 'Cómo se registra', fmt: enumOf(TRACKING) },
  instructionsEs: { label: 'Instrucciones', fmt: counted('paso', 'pasos') },
  // Body.
  weightKg: { label: 'Peso', fmt: num('kg', 1) },
  heightCm: { label: 'Estatura', fmt: num('cm', 0) },
  circumferences: { label: 'Perímetros', fmt: counted('medida', 'medidas') },
  skinfolds: { label: 'Pliegues', fmt: counted('pliegue', 'pliegues') },
  protocol: { label: 'Protocolo de pliegues', fmt: text },
  derived: { label: 'Composición corporal', fmt: derived },
  // Activity, sleep, recovery.
  type: { label: 'Actividad', fmt: text },
  steps: { label: 'Pasos', fmt: num('pasos', 0) },
  activeKcal: { label: 'Calorías activas', fmt: num('kcal', 0) },
  minutes: { label: 'Minutos', fmt: num('min', 0) },
  distanceKm: { label: 'Distancia', fmt: num('km', 2) },
  hours: { label: 'Horas de sueño', fmt: num('h', 1) },
  bedtime: { label: 'Hora de acostarse', fmt: time },
  waketime: { label: 'Hora de levantarse', fmt: time },
  quality: { label: 'Calidad', fmt: outOf5 },
  energy: { label: 'Energía', fmt: outOf5 },
  soreness: { label: 'Dolor muscular', fmt: outOf5 },
  stress: { label: 'Estrés', fmt: outOf5 },
  mood: { label: 'Ánimo', fmt: outOf5 },
  restingHr: { label: 'Pulso en reposo', fmt: num('lpm', 0) },
  // Habits.
  dose: { label: 'Dosis', fmt: text },
  target: { label: 'Meta diaria', fmt: withRowUnit },
  value: { label: 'Valor', fmt: withRowUnit },
  // Imported values, day marks, energy adjustments.
  metric: { label: 'Métrica', fmt: text },
  valueText: { label: 'Valor (texto)', fmt: text },
  label: { label: 'Etiqueta', fmt: text },
  complete: { label: 'Día completo', fmt: yesNo },
  fromKcal: { label: 'Calorías antes', fmt: num('kcal', 0) },
  toKcal: { label: 'Calorías después', fmt: num('kcal', 0) },
  formulaTdee: { label: 'Gasto estimado por fórmula', fmt: num('kcal', 0) },
  observedTdee: { label: 'Gasto observado', fmt: num('kcal', 0) },
  blendedTdee: { label: 'Gasto combinado', fmt: num('kcal', 0) },
  confidence: { label: 'Confianza', fmt: enumOf(CONFIDENCE) },
  phase: { label: 'Fase', fmt: enumOf(PHASE) },
  ratePctPerWeek: { label: 'Ritmo semanal', fmt: num('%', 2) },
  applied: { label: 'Aplicado', fmt: enumOf({ auto: 'Automáticamente', accepted: 'Aceptado por ti' }) },
  reason: { label: 'Motivo', fmt: text },
  // Vitals and hydration.
  systolic: { label: 'Sistólica', fmt: num('mmHg', 0) },
  diastolic: { label: 'Diastólica', fmt: num('mmHg', 0) },
  context: { label: 'Contexto', fmt: text },
  drink: { label: 'Bebida', fmt: text },
  // Profile.
  sex: { label: 'Sexo', fmt: enumOf(SEX) },
  birthDate: { label: 'Fecha de nacimiento', fmt: date },
  activity: { label: 'Nivel de actividad', fmt: enumOf(ACTIVITY) },
  color: { label: 'Color', fmt: enumOf(COLOR) },
  settings: { label: 'Preferencias', fmt: settingsText },
  physiologicalState: { label: 'Estado fisiológico', fmt: enumOf(PHYSIO) },
}

function withRowUnitKey(unitKey: string): Fmt {
  return (v, row) => {
    if (!isNum(v)) return formatGeneric(v)
    const u = typeof row?.[unitKey] === 'string' ? (UNIT[row[unitKey] as string] ?? String(row[unitKey])) : ''
    return `${formatNumber(v, 1)}${u ? ` ${u}` : ''}`
  }
}

/** Per-table meanings that differ from the common ones. */
const BY_TABLE: Record<string, Record<string, FieldSpec>> = {
  foodPortions: {
    quantity: { label: 'Cantidad de la medida', fmt: withRowUnit },
    equivalentAmount: { label: 'Equivalencia', fmt: withRowUnitKey('equivalentUnit') },
    equivalentUnit: { label: 'Unidad de la equivalencia', fmt: enumOf(UNIT) },
    verification: { label: 'Verificación', fmt: enumOf({ standard: 'De la fuente', derived: 'Calculada', custom: 'Personalizada' }) },
    kind: { label: 'Tipo de medida', fmt: enumOf({ household: 'Casera', serving: 'Porción', package: 'Envase', custom: 'Personalizada' }) },
    qualifier: { label: 'Detalle de la medida', fmt: text },
    foodKind: { label: 'Estado del alimento', fmt: enumOf(FOOD_KIND) },
  },
  vitals: { kind: { label: 'Signo vital', fmt: enumOf(VITAL) }, value: { label: 'Valor', fmt: withRowUnit } },
  exerciseSets: { kind: { label: 'Tipo de serie', fmt: enumOf(SET_KIND) } },
  habits: { kind: { label: 'Tipo', fmt: enumOf(HABIT_KIND) }, active: { label: 'Activo', fmt: yesNo } },
  habitLogs: { value: { label: 'Cantidad', fmt: plain(1) } },
  customFoods: { kind: { label: 'Tipo de alimento', fmt: enumOf(FOOD_KIND) }, source: { label: 'Origen', fmt: enumOf(FOOD_SOURCE) } },
  foodLogs: { kind: { label: 'Tipo de alimento', fmt: enumOf(FOOD_KIND) }, unit: { label: 'Unidad', fmt: enumOf(UNIT) } },
  routines: { archived: { label: 'Archivada', fmt: yesNo } },
  mealTemplates: { meal: { label: 'Comida', fmt: (v) => (v == null ? 'Cualquiera' : enumOf(MEAL)(v, null)) } },
  activityLogs: { type: { label: 'Actividad', fmt: text } },
  [PROFILE_TABLE]: { name: { label: 'Nombre del perfil', fmt: text }, meals: { label: 'Tiempos de comida', fmt: counted('tiempo', 'tiempos') } },
}

export interface FieldView {
  key: string
  label: string
  /** False → label is «Otro dato» and `key` should be shown as secondary text. */
  known: boolean
  local: string
  remote: string
}

export function fieldSpec(table: string, key: string): FieldSpec | null {
  return BY_TABLE[table]?.[key] ?? COMMON[key] ?? null
}

export function fieldLabel(table: string, key: string): string {
  return fieldSpec(table, key)?.label ?? UNKNOWN_FIELD_LABEL
}

/** Names of the person's meal slots by stored key (custom names from Ajustes → Tiempos de comida). */
export type MealNames = Readonly<Partial<Record<string, string>>>

export function formatField(table: string, key: string, value: unknown, row: Row | null = null, names?: MealNames): string {
  if (key === 'meal' && typeof value === 'string' && names?.[value]) return names[value]!
  const spec = fieldSpec(table, key)
  return spec?.fmt ? spec.fmt(value, row) : formatGeneric(value)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Rows of the diff table: only fields that differ, hidden bookkeeping fields excluded, known fields first. */
export function conflictFields(table: string, local: Row | null, remote: Row | null, names?: MealNames): FieldView[] {
  const keys = [...new Set([...Object.keys(local ?? {}), ...Object.keys(remote ?? {})])].filter((k) => !HIDDEN_FIELDS.has(k) && !same(local?.[k], remote?.[k]))
  const views = keys.map((key) => {
    const spec = fieldSpec(table, key)
    // Counts hide the actual difference when both nutrient maps have the same keys.
    const fmt = key === 'nutrients' || key === 'labelNutrients' ? nutrientValues : (v: unknown, row: Row | null) => formatField(table, key, v, row, names)
    return { key, label: spec?.label ?? UNKNOWN_FIELD_LABEL, known: spec !== null, local: fmt(local?.[key], local), remote: fmt(remote?.[key], remote) }
  })
  return [...views.filter((v) => v.known), ...views.filter((v) => !v.known)]
}

/** «Pierna A · 9 nov 2026» style title for a conflict card. */
export function conflictTitle(table: string, row: Row | null, names?: MealNames): string {
  if (!row) return ''
  const nameRaw = row.name ?? row.exerciseName ?? row.title ?? row.label ?? row.type
  let name = typeof nameRaw === 'string' ? nameRaw.trim() : ''
  if (!name && table === 'vitals' && typeof row.kind === 'string') name = VITAL[row.kind] ?? ''
  if (!name && table === 'hydrationLogs' && isNum(row.ml)) name = `${formatNumber(row.ml, 0)} ml de agua`
  if (!name && table === 'foodLogs' && typeof row.meal === 'string') name = names?.[row.meal] ?? MEAL[row.meal] ?? ''
  const when = typeof row.date === 'string' && isCalendarDate(row.date) ? formatDateEs(row.date) : ''
  const at = typeof row.time === 'string' && /^\d{1,2}:\d{2}/.test(row.time) ? row.time.slice(0, 5) : ''
  return [name, when, at].filter(Boolean).join(' · ')
}

/** Short date for sentences: «9 nov». */
function shortDate(row: Row | null): string {
  if (!row || typeof row.date !== 'string' || !isCalendarDate(row.date)) return ''
  return formatDateEs(row.date).replace(/\s\d{4}$/, '')
}

const quoted = (s: string) => `«${s}»`

export type ConflictKind = 'edit' | 'deletedHere' | 'deletedElsewhere'
export function conflictKind(local: Row | null, remote: Row | null): ConflictKind {
  return !local ? 'deletedHere' : !remote ? 'deletedElsewhere' : 'edit'
}

export interface RemovalInput {
  table: string
  tableLabel: string
  local: Row | null
  remote: Row | null
  /** Set rows of the session on this device that the choice will delete (sessions only). */
  setCount?: number | null
  /** Custom meal names, when available. */
  mealNames?: MealNames
}

/** «la sesión «Pierna A» del 9 nov» / «el registro «…» (Sueño)». */
function subject({ table, tableLabel, local, remote, mealNames }: RemovalInput): string {
  const row = local ?? remote
  const nameRaw = row?.name
  const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : ''
  const day = shortDate(row)
  if (table === 'trainingSessions') return `la sesión${name ? ` ${quoted(name)}` : ''}${day ? ` del ${day}` : ''}`
  const title = conflictTitle(table, row, mealNames)
  return `el registro${title ? ` ${quoted(title)}` : ''} (${tableLabel})`
}

function setsPhrase(n: number | null | undefined): string {
  if (n === null || n === undefined) return ' y todas sus series'
  if (n === 0) return ''
  return n === 1 ? ' y su serie' : ` y sus ${formatNumber(n, 0)} series`
}

/**
 * The exact sentence shown before a choice that deletes something, or null when the choice deletes
 * nothing. `local`: keep this device (a deletion here is pushed); `remote`: take the cloud version (a
 * deletion elsewhere is applied here).
 */
export function removalSentence(input: RemovalInput, choice: 'local' | 'remote' | 'both' | 'merge'): string | null {
  const kind = conflictKind(input.local, input.remote)
  const isSession = input.table === 'trainingSessions'
  if (kind === 'deletedElsewhere' && choice === 'remote') {
    return `Se eliminará ${subject(input)}${isSession ? setsPhrase(input.setCount) : ''} en todos tus dispositivos. Los cambios que hiciste aquí se perderán.`
  }
  if (kind === 'deletedHere' && choice === 'local') {
    return `Se eliminará ${subject(input)}${isSession ? setsPhrase(input.setCount) : ''} en todos tus dispositivos, también la versión que se modificó en el otro.`
  }
  return null
}

/** Choosing one edited version discards the other; keeping both or merging does not. */
export function discardSentence(input: RemovalInput, choice: 'local' | 'remote' | 'both' | 'merge'): string | null {
  if (!input.local || !input.remote || (choice !== 'local' && choice !== 'remote')) return null
  const kept = choice === 'local' ? 'este dispositivo' : 'la nube'
  const discarded = choice === 'local' ? 'la nube' : 'este dispositivo'
  return `Se conservará la versión de ${kept} de ${subject(input)}. Se descartarán los cambios de ${discarded}.`
}

/** One line under each button: what the choice does. */
export function choiceHelp(choice: 'local' | 'remote' | 'both' | 'merge', local: Row | null, remote: Row | null): string {
  const kind = conflictKind(local, remote)
  if (choice === 'merge') return 'Combinar: se unen las dos versiones sin perder series; en lo demás gana el cambio más reciente.'
  if (choice === 'both') return 'Conservar ambos: la versión de este dispositivo se guarda como un registro nuevo y la de la nube conserva el original.'
  if (choice === 'local') {
    return kind === 'deletedHere'
      ? 'Mantener el borrado: también se borrará en la nube y en tus otros dispositivos.'
      : 'Conservar la de este dispositivo: se enviará a la nube y reemplazará la otra.'
  }
  return kind === 'deletedElsewhere'
    ? 'Aceptar el borrado: se borrará también en este dispositivo.'
    : kind === 'deletedHere'
      ? 'Recuperar la de la nube: vuelve a este dispositivo la versión modificada en el otro.'
      : 'Conservar la de la nube: reemplazará la de este dispositivo.'
}

export function choiceLabel(choice: 'local' | 'remote' | 'both' | 'merge', local: Row | null, remote: Row | null): string {
  const kind = conflictKind(local, remote)
  if (choice === 'merge') return 'Combinar'
  if (choice === 'both') return 'Conservar ambos'
  if (choice === 'local') return kind === 'deletedHere' ? 'Mantener el borrado' : 'Conservar la de este dispositivo'
  return kind === 'deletedElsewhere' ? 'Aceptar el borrado' : kind === 'deletedHere' ? 'Recuperar la de la nube' : 'Conservar la de la nube'
}
