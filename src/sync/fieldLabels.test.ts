import { describe, expect, it } from 'vitest'
import { choiceHelp, choiceLabel, conflictFields, conflictTitle, fieldLabel, fieldSpec, formatField, formatGeneric, HIDDEN_FIELDS, removalSentence, UNKNOWN_FIELD_LABEL } from './fieldLabels'
import { PROFILE_TABLE, SYNC_TABLES } from './syncTables'

/** Every stored field of every synced table (src/db/types.ts). A new field must get a label here. */
const FIELDS: Record<string, string[]> = {
  goals: ['validFrom', 'goal', 'method', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'inputs', 'methodText', 'warnings', 'targetWeightKg', 'notes', 'adaptive', 'origin', 'approx', 'excludeFromStats'],
  foodLogs: ['date', 'time', 'meal', 'note', 'name', 'brand', 'source', 'datasetVersion', 'kind', 'qty', 'unit', 'portionLabel', 'portionSource', 'portionVerification', 'portionEquivalentAmount', 'portionEquivalentUnit', 'grams', 'ml', 'nutrients', 'missing', 'origin', 'approx'],
  customFoods: ['source', 'name', 'brand', 'barcode', 'category', 'kind', 'basis', 'nutrients', 'portions', 'servingSize', 'servingUnit', 'notes', 'labelBasis', 'labelNutrients', 'servingLabel', 'servingsPerPackage', 'packageSize', 'packageUnit', 'entryMethod', 'sourceText', 'validation'],
  foodPortions: ['name', 'grams', 'ml', 'notes'],
  recipes: ['name', 'servings', 'cookedWeightG', 'ingredients', 'notes'],
  mealTemplates: ['name', 'meal', 'items'],
  favorites: ['name', 'source'],
  recents: ['name', 'source', 'lastUsedAt', 'count', 'lastQty', 'lastUnit', 'lastPortionLabel'],
  routines: ['name', 'notes', 'exercises', 'archived', 'order'],
  trainingSessions: ['date', 'name', 'status', 'startedAt', 'endedAt', 'exerciseOrder', 'notes', 'rpe', 'durationMin'],
  exerciseSets: ['date', 'exerciseName', 'setIndex', 'weight', 'reps', 'durationSec', 'distanceM', 'rpe', 'isWarmup', 'kind', 'rir', 'done', 'notes'],
  customExercises: ['nameEs', 'aliases', 'primaryMuscles', 'secondaryMuscles', 'equipment', 'category', 'trackingType', 'instructionsEs'],
  exerciseFavorites: ['name'],
  bodyMeasurements: ['date', 'time', 'weightKg', 'circumferences', 'skinfolds', 'protocol', 'derived', 'notes'],
  activityLogs: ['date', 'type', 'steps', 'activeKcal', 'minutes', 'distanceKm', 'notes'],
  sleepLogs: ['date', 'hours', 'bedtime', 'waketime', 'quality', 'notes'],
  recoveryLogs: ['date', 'energy', 'soreness', 'stress', 'mood', 'restingHr', 'notes'],
  habits: ['name', 'kind', 'dose', 'target', 'unit', 'active', 'order'],
  habitLogs: ['date', 'value', 'notes'],
  importedDaily: ['date', 'metric', 'value', 'valueText', 'unit', 'label'],
  dayMarks: ['date', 'complete'],
  energyAdjustments: ['date', 'fromKcal', 'toKcal', 'formulaTdee', 'observedTdee', 'blendedTdee', 'confidence', 'phase', 'ratePctPerWeek', 'applied', 'reason'],
  vitals: ['date', 'time', 'kind', 'systolic', 'diastolic', 'value', 'unit', 'context', 'notes'],
  hydrationLogs: ['date', 'time', 'ml', 'drink'],
  [PROFILE_TABLE]: ['name', 'sex', 'birthDate', 'heightCm', 'activity', 'color', 'settings'],
}

describe('field labels', () => {
  it('covers every synced table', () => {
    for (const t of SYNC_TABLES) expect(FIELDS[t], t).toBeDefined()
  })

  it('labels every field of every synced table in Spanish', () => {
    for (const [table, keys] of Object.entries(FIELDS)) {
      for (const k of keys) {
        expect(fieldSpec(table, k), `${table}.${k}`).not.toBeNull()
        expect(fieldLabel(table, k)).not.toBe(k)
      }
    }
  })

  it('unknown fields fall back to a neutral label', () => {
    expect(fieldLabel('vitals', 'zzzInternal')).toBe(UNKNOWN_FIELD_LABEL)
    const [f] = conflictFields('vitals', { zzzInternal: { a: 1 } }, { zzzInternal: { a: 2 } })
    expect(f).toMatchObject({ label: 'Otro dato', known: false, key: 'zzzInternal', local: '1 dato' })
  })

  it('formats values for people: dates, booleans, units, arrays, never JSON', () => {
    expect(formatField('trainingSessions', 'date', '2026-11-09')).toBe('9 nov 2026')
    expect(formatField('exerciseSets', 'done', true)).toBe('Sí')
    expect(formatField('exerciseSets', 'done', false)).toBe('No')
    expect(formatField('bodyMeasurements', 'weightKg', 72.5)).toBe('72,5 kg')
    expect(formatField('exerciseSets', 'weight', 80)).toBe('80 kg')
    expect(formatField('trainingSessions', 'durationMin', 62)).toBe('62 min')
    expect(formatField('hydrationLogs', 'ml', 1500)).toBe('1.500 ml')
    expect(formatField('goals', 'kcal', 2150)).toBe('2.150 kcal')
    expect(formatField('activityLogs', 'steps', 10000)).toBe('10.000 pasos')
    expect(formatField('vitals', 'value', 95, { unit: 'mg/dL' })).toBe('95 mg/dL')
    expect(formatField('vitals', 'kind', 'glucose')).toBe('Glucosa')
    expect(formatField('vitals', 'systolic', 120)).toBe('120 mmHg')
    expect(formatField('foodLogs', 'meal', 'media_manana')).toBe('Media mañana')
    expect(formatField('exerciseSets', 'setIndex', 0)).toBe('1')
    expect(formatField('sleepLogs', 'quality', 4)).toBe('4 de 5')
    expect(formatField(PROFILE_TABLE, 'sex', 'female')).toBe('Mujer')
    expect(formatField('trainingSessions', 'exerciseOrder', [{ name: 'Sentadilla' }, { name: 'Prensa' }])).toBe('2 ejercicios: Sentadilla, Prensa')
    expect(formatField('trainingSessions', 'exerciseOrder', [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toBe('4 ejercicios: A, B, C…')
    expect(formatField('recipes', 'ingredients', [])).toBe('Ninguno')
    expect(formatField('customFoods', 'nutrients', { kcal: 1, protein: 2 })).toBe('2 nutrientes')
    expect(formatField('trainingSessions', 'notes', null)).toBe('—')
    expect(formatField('trainingSessions', 'startedAt', '2026-11-09T23:30:00.000Z')).toMatch(/9 nov 2026.*18:30/)
    for (const v of [{ a: 1 }, [1, 2], 'x'.repeat(200)]) expect(formatGeneric(v)).not.toMatch(/[{}[\]"]/)
    expect(formatGeneric('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })

  it('diff hides bookkeeping fields and identical values, known fields first', () => {
    const local = { id: '1', profileId: 'p', updatedAt: 'a', weightKg: 70, mystery: 1, notes: 'x', date: '2026-11-09' }
    const remote = { id: '1', profileId: 'p', updatedAt: 'b', weightKg: 71, mystery: 2, notes: 'x', date: '2026-11-09' }
    const fields = conflictFields('bodyMeasurements', local, remote)
    expect(fields.map((f) => f.key)).toEqual(['weightKg', 'mystery'])
    expect(fields[0]).toMatchObject({ label: 'Peso', local: '70 kg', remote: '71 kg' })
    for (const k of ['id', 'profileId', 'updatedAt', 'createdAt', 'sessionId']) expect(HIDDEN_FIELDS.has(k)).toBe(true)
  })

  it('titles a card with name and date', () => {
    expect(conflictTitle('trainingSessions', { name: 'Pierna A', date: '2026-11-09' })).toBe('Pierna A · 9 nov 2026')
    expect(conflictTitle('vitals', { kind: 'glucose', date: '2026-11-09', time: '07:30' })).toBe('Glucosa · 9 nov 2026 · 07:30')
    expect(conflictTitle('hydrationLogs', { ml: 250, date: '2026-11-09' })).toBe('250 ml de agua · 9 nov 2026')
    expect(conflictTitle('x', null)).toBe('')
  })

  it('shows different nutrient values and their units even with equal key counts', () => {
    const [f] = conflictFields('customFoods', { nutrients: { sodium: 1200, protein: 12 } }, { nutrients: { sodium: 1.2, protein: 20 } })
    expect(f!.local).not.toBe(f!.remote)
    expect(f!.local).toContain('1.200 mg')
    expect(f!.remote).toContain('1,2 mg')
    expect(f!.local).toContain('12 g')
  })

  it('formats the actual food portion fields, including the equivalence unit', () => {
    const portion = { label: 'Medida sintética', equivalentAmount: 160, equivalentUnit: 'g', verification: 'custom' }
    expect(fieldLabel('foodPortions', 'equivalentAmount')).toBe('Equivalencia')
    expect(formatField('foodPortions', 'equivalentAmount', 160, portion)).toBe('160 g')
    expect(fieldLabel('foodPortions', 'verification')).not.toBe(UNKNOWN_FIELD_LABEL)
  })
})

describe('removal sentences', () => {
  const session = { name: 'Pierna A', date: '2026-11-09' }
  it('accepting a remote session deletion states the session and its set count', () => {
    expect(removalSentence({ table: 'trainingSessions', tableLabel: 'Sesiones de entreno', local: session, remote: null, setCount: 19 }, 'remote')).toBe(
      'Se eliminará la sesión «Pierna A» del 9 nov y sus 19 series en todos tus dispositivos. Los cambios que hiciste aquí se perderán.',
    )
    expect(removalSentence({ table: 'trainingSessions', tableLabel: 'S', local: session, remote: null, setCount: 1 }, 'remote')).toContain('y su serie ')
    expect(removalSentence({ table: 'trainingSessions', tableLabel: 'S', local: session, remote: null, setCount: 0 }, 'remote')).toContain('«Pierna A» del 9 nov en todos')
  })
  it('keeping a local session deletion says every set goes when the count is unknown', () => {
    expect(removalSentence({ table: 'trainingSessions', tableLabel: 'S', local: null, remote: session, setCount: null }, 'local')).toBe(
      'Se eliminará la sesión «Pierna A» del 9 nov y todas sus series en todos tus dispositivos, también la versión que se modificó en el otro.',
    )
  })
  it('other rows name the record and its table', () => {
    expect(removalSentence({ table: 'sleepLogs', tableLabel: 'Sueño', local: { date: '2026-11-09', hours: 7 }, remote: null }, 'remote')).toBe(
      'Se eliminará el registro «9 nov 2026» (Sueño) en todos tus dispositivos. Los cambios que hiciste aquí se perderán.',
    )
  })
  it('choices that delete nothing need no confirmation', () => {
    const both = { name: 'x' }
    for (const c of ['local', 'remote', 'both', 'merge'] as const) expect(removalSentence({ table: 'trainingSessions', tableLabel: 'S', local: both, remote: both }, c)).toBeNull()
    expect(removalSentence({ table: 'trainingSessions', tableLabel: 'S', local: session, remote: null }, 'local')).toBeNull()
    expect(removalSentence({ table: 'trainingSessions', tableLabel: 'S', local: null, remote: session }, 'remote')).toBeNull()
  })
  it('every choice has a label and a one-line explanation', () => {
    const r = { a: 1 }
    expect(choiceHelp('local', r, r)).toBe('Conservar la de este dispositivo: se enviará a la nube y reemplazará la otra.')
    expect(choiceHelp('merge', r, r)).toMatch(/^Combinar:/)
    expect(choiceLabel('remote', r, null)).toBe('Aceptar el borrado')
    expect(choiceLabel('local', null, r)).toBe('Mantener el borrado')
    expect(choiceLabel('remote', null, r)).toBe('Recuperar la de la nube')
  })
})

describe('profile settings with a weekly plan', () => {
  const base = { addActivityKcal: false, stepGoal: 8000 }
  const plan = { days: { '1': {}, '3': { routineId: 'r' }, '5': {} }, overrides: { '2026-11-19': { rest: true } }, reminder: { on: true, time: '07:00' } }
  it('says «Planificación semanal» with the days, so two devices that differ only there are readable', () => {
    const text = formatField(PROFILE_TABLE, 'settings', { ...base, training: { plan } })
    expect(text).toBe('3 preferencias · Planificación semanal (3 días: lun, mié, vie · 1 cambio puntual · recordatorio 07:00)')
    const rows = conflictFields(PROFILE_TABLE, { settings: { ...base, training: { plan } } }, { settings: { ...base, training: { plan: { ...plan, days: { '2': {} } } } } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.label).toBe('Preferencias')
    expect(rows[0]!.local).not.toBe(rows[0]!.remote)
    expect(`${rows[0]!.local}${rows[0]!.remote}`).not.toMatch(/[{}"]/) // never JSON
  })
  it('without a plan the text is exactly what it was', () => {
    expect(formatField(PROFILE_TABLE, 'settings', base)).toBe('2 preferencias')
    expect(formatField(PROFILE_TABLE, 'settings', { ...base, training: { effort: 'rir' } })).toBe('3 preferencias')
    expect(formatField(PROFILE_TABLE, 'settings', { ...base, training: { plan: { days: {} } } })).toBe('3 preferencias')
  })
  it('tolerates malformed stored plans', () => {
    for (const bad of [null, 'x', 3, [], { days: 'x', overrides: 4, reminder: 'y' }]) expect(() => formatField(PROFILE_TABLE, 'settings', { training: { plan: bad } })).not.toThrow()
    expect(formatField(PROFILE_TABLE, 'settings', null)).toBe('—')
  })
})

describe('custom meal names', () => {
  it('names a meal by its stored key in titles and fields, with the default as a fallback', () => {
    const names = { almuerzo: 'Comida fuerte' }
    expect(conflictTitle('foodLogs', { meal: 'almuerzo', date: '2026-11-12' }, names)).toBe('Comida fuerte · 12 nov 2026')
    expect(conflictTitle('foodLogs', { meal: 'cena', date: '2026-11-12' }, names)).toBe('Cena · 12 nov 2026')
    expect(conflictTitle('foodLogs', { meal: 'almuerzo', date: '2026-11-12' })).toBe('Almuerzo · 12 nov 2026')
    const f = conflictFields('foodLogs', { meal: 'almuerzo' }, { meal: 'cena' }, names)
    expect(f.find((x) => x.key === 'meal')).toMatchObject({ local: 'Comida fuerte', remote: 'Cena' })
  })
  it('keeps «Tiempos de comida» as the label of the setting', () => {
    expect(fieldLabel(PROFILE_TABLE, 'meals')).toBe('Tiempos de comida')
  })
})
