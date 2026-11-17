import { describe, expect, it } from 'vitest'
import { parseDecimal } from '../../domain/units'
import { parseAmount } from './amountParse'

describe('parseAmount', () => {
  it.each<[string, number | null]>([
    ['150', 150],
    ['0,5', 0.5],
    ['1,5', 1.5],
    ['2.5', 2.5],
    ['1.200', 1200],
    ['1/2', 0.5],
    ['1 / 2', 0.5],
    ['1 1/2', 1.5],
    ['2 3/4', 2.75],
    ['3/4', 0.75],
    ['1/3', 1 / 3],
    ['½', 0.5],
    ['1½', 1.5],
    ['2 ½', 2.5],
    ['', null],
    ['  ', null],
    ['abc', null],
    ['1/0', null],
    ['1 1/0', null],
    ['-1/2', null],
    ['-3', null],
    ['1//2', null],
    ['1/2/3', null],
    ['1,5/2', null],
  ])('%j → %j', (text, expected) => {
    const n = parseAmount(text)
    if (expected === null) expect(n).toBeNull()
    else expect(n).toBeCloseTo(expected, 10)
  })
  it('a fraction of zero parses to zero (the range check rejects it, not the parser)', () => {
    expect(parseAmount('0/2')).toBe(0)
  })
  it('reuses the number rule: the same result as parseDecimal for plain numbers', () => {
    for (const s of ['72,5', '0.500', '1.000', '10.000', '1.25', '1,200']) expect(parseAmount(s)).toBe(parseDecimal(s))
  })
})
