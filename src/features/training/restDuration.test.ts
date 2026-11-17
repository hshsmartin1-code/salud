import { describe, expect, it } from 'vitest'
import { parseRestDuration } from './restTimer'

describe('parseRestDuration', () => {
  it('reads plain seconds and m:ss', () => {
    expect(parseRestDuration('90')).toBe(90)
    expect(parseRestDuration('1:30')).toBe(90)
    expect(parseRestDuration('2:00')).toBe(120)
    expect(parseRestDuration('0:45')).toBe(45)
    expect(parseRestDuration(' 120 s ')).toBe(120)
    expect(parseRestDuration('60:00')).toBe(3600)
  })
  it('accepts exactly 5 s to 60 min', () => {
    expect(parseRestDuration('5')).toBe(5)
    expect(parseRestDuration('0:05')).toBe(5)
    expect(parseRestDuration('4')).toBeNull()
    expect(parseRestDuration('0:04')).toBeNull()
    expect(parseRestDuration('3600')).toBe(3600)
    expect(parseRestDuration('3601')).toBeNull()
    expect(parseRestDuration('60:01')).toBeNull()
  })
  it('rejects anything that is not a duration', () => {
    for (const bad of ['', '  ', 'abc', '1:60', '1:5', '1,5', '-30', '1:30:00', '1.5', ':30', '9999999']) expect(parseRestDuration(bad), bad).toBeNull()
  })
})
