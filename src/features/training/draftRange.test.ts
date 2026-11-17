/** Set inputs follow the app's number rule and reject implausible values instead of storing them. */
import { describe, expect, it } from 'vitest'
import { parseSetField, SetDraftModel } from './draft'

const p = (field: Parameters<typeof parseSetField>[0], text: string, tracking: Parameters<typeof parseSetField>[2] = 'weight_reps') => parseSetField(field, text, tracking)

describe('set field numbers', () => {
  it('reads decimals with comma or dot, and "1.200" as 1200 (then rejected as a weight)', () => {
    expect(p('weight', '72,5')).toEqual({ ok: true, value: 72.5 })
    expect(p('weight', '102.5')).toEqual({ ok: true, value: 102.5 })
    expect(p('weight', '1.25')).toEqual({ ok: true, value: 1.25 })
    expect(p('weight', '0.500')).toEqual({ ok: true, value: 0.5 })
    expect(p('weight', '1.200')).toEqual({ ok: false }) // 1200 kg
    expect(p('weight', '1.500')).toEqual({ ok: false })
    expect(p('weight', '1000')).toEqual({ ok: true, value: 1000 })
    expect(p('weight', '1000,5')).toEqual({ ok: false })
  })

  it('rejects reps, distance, duration, RPE and RIR outside their ranges', () => {
    expect(p('reps', '1.200')).toEqual({ ok: false })
    expect(p('reps', '1000')).toEqual({ ok: true, value: 1000 })
    expect(p('reps', '1001')).toEqual({ ok: false })
    expect(p('distanceM', '300', 'distance')).toEqual({ ok: true, value: 300_000 })
    expect(p('distanceM', '300,5', 'distance')).toEqual({ ok: false })
    expect(p('distanceM', '1.500', 'distance')).toEqual({ ok: false }) // 1500 km
    expect(p('durationSec', '24:00:00', 'time')).toEqual({ ok: true, value: 86_400 })
    expect(p('durationSec', '24:00:01', 'time')).toEqual({ ok: false })
    expect(p('durationSec', '1441', 'distance')).toEqual({ ok: false }) // minutes
    expect(p('rpe', '0')).toEqual({ ok: false })
    expect(p('rpe', '10')).toEqual({ ok: true, value: 10 })
    expect(p('rpe', '10,5')).toEqual({ ok: false })
    expect(p('rir', '0')).toEqual({ ok: true, value: 0 })
    expect(p('rir', '11')).toEqual({ ok: false })
    expect(p('rir', '-1')).toEqual({ ok: false })
  })

  it('a rejected value shows the error, keeps the typed text and writes nothing', async () => {
    const writes: unknown[] = []
    const m = new SetDraftModel({
      fields: ['weight', 'reps'],
      tracking: 'weight_reps',
      initial: { weight: 60, reps: 8, durationSec: null, distanceM: null, rpe: null, rir: null },
      write: async (v) => void writes.push(v),
      onError: () => {},
    })
    m.change('weight', '1.200')
    expect(m.text.weight).toBe('1.200')
    expect(m.invalid().weight).toBe(true)
    expect(m.values.weight).toBe(60)
    await m.flush()
    expect(writes).toEqual([])
  })
})
