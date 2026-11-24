import { describe, expect, it } from 'vitest'
import type { BodyMeasurement, ExerciseSet, FoodLog, TrainingSession } from '../../../db/types'
import { BOM, FORMAT_EXCEL_ES, FORMAT_STANDARD, detectDelimiter, numText, parseCsv, parseLooseNumber, toCsv, toRecords } from './csv'
import { BODY_HEADER, FOOD_HEADER, TRAINING_HEADER, bodyRows, buildBodyCsv, buildFoodCsv, buildTrainingCsv, csvFileName, foodRows, localTime, trainingRows } from './exportCsv'

describe('csv writer/reader', () => {
  it('escapes quotes, separators and newlines (RFC 4180) and round-trips', () => {
    const rows = [['a', 'b;c', 'd,e'], ['he said "hi"', 'línea 1\nlínea 2', ''], [1.5, null, undefined]]
    for (const fmt of [FORMAT_STANDARD, FORMAT_EXCEL_ES]) {
      const text = toCsv(rows, fmt)
      expect(text.startsWith(BOM)).toBe(true)
      expect(text.endsWith('\r\n')).toBe(true)
      const back = parseCsv(text, fmt.delimiter)
      expect(back[0]).toEqual(['a', 'b;c', 'd,e'])
      expect(back[1]).toEqual(['he said "hi"', 'línea 1\nlínea 2', ''])
      expect(back[2]![0]).toBe(fmt.decimal === ',' ? '1,5' : '1.5')
    }
    expect(toCsv([['x', 'y,z', 'q"r']], FORMAT_STANDARD, false)).toBe('x,"y,z","q""r"\r\n')
  })
  it('formats numbers with the chosen decimal mark and never as exponent', () => {
    expect(numText(80.5, ',')).toBe('80,5')
    expect(numText(0.0000001)).toBe('0')
    expect(numText(null)).toBe('')
    expect(numText(Number.NaN)).toBe('')
    expect(numText(1234.5678, '.')).toBe('1234.5678')
  })
  it('detects the delimiter ignoring quoted text and handles CRLF, BOM and blank lines', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('"a;b",c\n')).toBe(',')
    expect(detectDelimiter('a\tb\n')).toBe('\t')
    expect(parseCsv(`${BOM}a,b\r\n1,2\r\n\r\n3,"x\r\ny"\r\n`)).toEqual([['a', 'b'], ['1', '2'], ['3', 'x\r\ny']])
    const { headers, records } = toRecords(parseCsv('a,b\n1\n'))
    expect(headers).toEqual(['a', 'b'])
    expect(records[0]).toEqual({ a: '1', b: '' })
  })
  it('reads numbers with either decimal mark', () => {
    expect(parseLooseNumber('100,5')).toBe(100.5)
    expect(parseLooseNumber('100.5')).toBe(100.5)
    expect(parseLooseNumber('1.234,5')).toBe(1234.5)
    expect(parseLooseNumber('1,234.5')).toBe(1234.5)
    expect(parseLooseNumber('')).toBeNull()
    expect(parseLooseNumber('abc')).toBeNull()
  })
})

const base = { profileId: 'p', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }
const session: TrainingSession = { ...base, id: 's1', date: '2026-11-16', name: 'Empuje, A', routineId: null, status: 'done', startedAt: '2026-11-16T23:30:00.000Z', endedAt: null, restEndsAt: null, exerciseOrder: [{ exerciseId: 'fedb:Bench', name: 'Press', trackingType: 'weight_reps', restSec: 90 }] }
const mkSet = (extra: Partial<ExerciseSet>): ExerciseSet => ({ ...base, id: 'x', sessionId: 's1', date: '2026-11-16', exerciseId: 'fedb:Bench', exerciseName: 'Press de banca', setIndex: 0, weight: 80, reps: 8, durationSec: null, distanceM: null, rpe: null, isWarmup: false, done: true, ...extra })

describe('exports', () => {
  it('training: one row per done set, local time, set type, empty (not 0) when absent', () => {
    const rows = trainingRows([session], [mkSet({ id: 'a', setIndex: 1, isWarmup: false, kind: 'failure', rir: 1, notes: 'dura\nmucho' }), mkSet({ id: 'b', setIndex: 0, isWarmup: true, weight: null, reps: 10 }), mkSet({ id: 'c', done: false }), mkSet({ id: 'd', sessionId: 'other' })])
    expect(rows[0]).toEqual(TRAINING_HEADER)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(['2026-11-16', '18:30', 'Empuje, A', 'Press de banca', 'fedb:Bench', 1, 'Calentamiento', null, 10, null, null, null, null, ''])
    expect(rows[2]![5]).toBe(2)
    expect(rows[2]![6]).toBe('Al fallo')
    const text = buildTrainingCsv([session], [mkSet({ notes: 'a;b' })], FORMAT_EXCEL_ES)
    expect(text).toContain(';Empuje, A;') // a comma is harmless when the separator is ';'
    expect(text.split('\r\n')[1]).toContain(';80;8;;;;;"a;b"')
  })
  it('food: unknown nutrients are empty, never 0', () => {
    const log: FoodLog = { ...base, id: 'f', date: '2026-11-16', time: '08:10', meal: 'media_manana', foodRef: 'x', name: 'Arepa', source: 'user', qty: 1, unit: 'serving', grams: 90, ml: null, nutrients: { kcal: 210, protein: 5.5, sodium: 0 }, missing: [] }
    const rows = foodRows([log])
    expect(rows[0]).toEqual(FOOD_HEADER)
    const r = rows[1]!
    expect(r.slice(0, 4)).toEqual(['2026-11-16', '08:10', 'Media mañana', 'Arepa'])
    expect(r[FOOD_HEADER.indexOf('kcal')]).toBe(210)
    expect(r[FOOD_HEADER.indexOf('carbohidratos_g')]).toBeNull()
    expect(r[FOOD_HEADER.indexOf('sodio_mg')]).toBe(0) // a real recorded 0
    expect(buildFoodCsv([log], FORMAT_STANDARD)).toContain(',210,5.5,,,,0,')
  })
  it('body: weight, body fat and the circumferences present', () => {
    const m: BodyMeasurement = { ...base, id: 'm', date: '2026-11-16', weightKg: 70.4, circumferences: { waist: 80 }, skinfolds: {}, protocol: null, derived: null }
    const rows = bodyRows([m, { ...m, id: 'n', date: '2026-11-10', weightKg: null }])
    expect(rows[0]).toEqual(BODY_HEADER)
    expect(rows[1]![0]).toBe('2026-11-10')
    expect(rows[2]!.slice(2, 5)).toEqual([70.4, null, 80])
    expect(buildBodyCsv([m], FORMAT_EXCEL_ES)).toContain('70,4')
  })
  it('helpers', () => {
    expect(localTime('2026-11-16T23:30:00.000Z')).toBe('18:30')
    expect(localTime(null)).toBe('')
    expect(csvFileName('comida', 'Ana María', '2026-11-18')).toBe('salud-comida-ana-maria-2026-11-18.csv')
  })
})
