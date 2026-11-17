import { describe, expect, it } from 'vitest'
import { applyMapping, buildDatasetIndex, mapEquipment, mapMuscle, matchExercise, normaliseName, parseCsv, toCsv } from '../../../../scripts/media-pack/mapping.mjs'

const ds = [
  { id: '0001', name: 'barbell bench press', equipment: 'barbell', target: 'pectorals' },
  { id: '0002', name: 'push-up', equipment: 'body weight', target: 'pectorals' },
  { id: '0003', name: 'cable fly', equipment: 'cable', target: 'pectorals' },
  { id: '0004', name: 'Cable Fly', equipment: 'cable', target: 'pectorals' },
  { id: '0005', name: 'plank', equipment: 'body weight', target: 'cardiovascular system' },
  { id: '0006', name: 'ez-bar curl', equipment: 'ez barbell', target: 'biceps' },
]
const index = buildDatasetIndex(ds)

describe('name normalisation', () => {
  it('ignores case, accents, hyphens, slashes and punctuation', () => {
    expect(normaliseName('Barbell Bench-Press')).toBe('barbell bench press')
    expect(normaliseName("  Farmer's  Walk / Carry ")).toBe('farmer walk carry')
    expect(normaliseName('Flexión (Ñandú)')).toBe('flexion nandu')
  })
  it('unifies spelling variants and plurals', () => {
    expect(normaliseName('Push-Ups')).toBe(normaliseName('pushup'))
    expect(normaliseName('Pull Up')).toBe(normaliseName('pull-ups'))
    expect(normaliseName('E-Z Bar Curl')).toBe(normaliseName('ez bar curl'))
    expect(normaliseName('Dumb Bell Row')).toBe('dumbbell row')
    expect(normaliseName('Lunges')).toBe(normaliseName('lunge'))
    expect(normaliseName('Glass')).toBe('glass')
  })
  it('keeps word order and digits (no fuzzy matching)', () => {
    expect(normaliseName('Dumbbell Bench Press')).not.toBe(normaliseName('Bench Press Dumbbell'))
    expect(normaliseName('3/4 Sit-Up')).toBe('3 4 sit up')
  })
})

describe('vocabulary mapping', () => {
  it('maps dataset equipment and targets to catalog ids', () => {
    expect(mapEquipment('body weight')).toBe('body only')
    expect(mapEquipment('ez barbell')).toBe('e-z curl bar')
    expect(mapEquipment('leverage machine')).toBe('machine')
    expect(mapEquipment('tire')).toBeNull()
    expect(mapMuscle('pectorals')).toBe('chest')
    expect(mapMuscle('delts')).toBe('shoulders')
    expect(mapMuscle('upper back')).toBe('middle back')
    expect(mapMuscle('cardiovascular system')).toBeNull()
  })
})

describe('strict matching', () => {
  it('is automatic only when name, equipment and primary muscle agree', () => {
    const m = matchExercise({ nameEn: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['chest'] }, index)
    expect(m).toMatchObject({ datasetId: '0001', matchRule: 'name+equipment+muscle', matchConfidence: 'high', needsReview: 'no' })
    expect(matchExercise({ nameEn: 'Push-Up', equipment: 'body only', primaryMuscles: ['chest', 'triceps'] }, index).needsReview).toBe('no')
  })
  it('a name-only match needs review (equipment or muscle disagree, or no mapping)', () => {
    expect(matchExercise({ nameEn: 'Barbell Bench Press', equipment: 'dumbbell', primaryMuscles: ['chest'] }, index)).toMatchObject({ matchRule: 'name-only', needsReview: 'yes', matchConfidence: 'low' })
    expect(matchExercise({ nameEn: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['triceps'] }, index).needsReview).toBe('yes')
    expect(matchExercise({ nameEn: 'Plank', equipment: 'body only', primaryMuscles: ['abdominals'] }, index).needsReview).toBe('yes')
    expect(matchExercise({ nameEn: 'EZ Bar Curl', equipment: null, primaryMuscles: ['biceps'] }, index).needsReview).toBe('yes')
  })
  it('several agreeing candidates are ambiguous and listed for review', () => {
    const m = matchExercise({ nameEn: 'Cable Fly', equipment: 'cable', primaryMuscles: ['chest'] }, index)
    expect(m).toMatchObject({ datasetId: '0003|0004', needsReview: 'yes' })
    expect(m.matchRule).toContain('ambiguous(2)')
  })
  it('leaves everything else empty', () => {
    expect(matchExercise({ nameEn: 'Something Else', equipment: 'barbell', primaryMuscles: ['chest'] }, index)).toEqual({ datasetId: '', datasetName: '', matchRule: '', matchConfidence: '', needsReview: '' })
    // Same equipment and muscle but a different name never matches.
    expect(matchExercise({ nameEn: 'Barbell Incline Press', equipment: 'barbell', primaryMuscles: ['chest'] }, index).datasetId).toBe('')
  })
})

describe('CSV round trip and hand decisions', () => {
  it('parses quotes, commas, BOM and CRLF, and writes them back', () => {
    const text = '﻿exerciseId,name,notes\r\nfedb:A,"Uno, dos","dijo ""hola"""\r\nfedb:B,Tres,\r\n'
    const csv = parseCsv(text)
    expect(csv.rows).toEqual([{ exerciseId: 'fedb:A', name: 'Uno, dos', notes: 'dijo "hola"' }, { exerciseId: 'fedb:B', name: 'Tres', notes: '' }])
    expect(parseCsv(toCsv(csv.header, csv.rows)).rows).toEqual(csv.rows)
  })
  it('keeps a row the owner cleared by hand and counts the rest', () => {
    const catalog = new Map([
      ['fedb:A', { nameEn: 'Barbell Bench Press', equipment: 'barbell', primaryMuscles: ['chest'] }],
      ['fedb:B', { nameEn: 'Plank', equipment: 'body only', primaryMuscles: ['abdominals'] }],
      ['fedb:C', { nameEn: 'Unknown Move', equipment: 'barbell', primaryMuscles: ['chest'] }],
    ])
    const csv = { header: ['exerciseId', 'needsReview', 'datasetId'], rows: [{ exerciseId: 'fedb:A', needsReview: 'yes', datasetId: '' }, { exerciseId: 'fedb:B', needsReview: 'no', datasetId: '0005' }, { exerciseId: 'fedb:C', needsReview: 'yes', datasetId: '' }] }
    const r = applyMapping(csv, catalog, index)
    expect(r.counts).toEqual({ automatic: 2, needsReview: 0, none: 1, keptByHand: 1 })
    expect(r.rows[1]).toMatchObject({ needsReview: 'no', datasetId: '0005', matchRule: 'name-only' })
    expect(r.rows[2]!.needsReview).toBe('')
  })
})
