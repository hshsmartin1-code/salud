import { describe, expect, it } from 'vitest'
import { parseDecimal, textRangeError } from '../../domain/units'
import { amountError, maxAmount } from './amountRange'

describe('logged amount ranges', () => {
  it.each<[string, string, boolean]>([
    ['150', 'g', true],
    ['1.200', 'g', true],
    ['1.200', 'portion', false],
    ['1,5', 'portion', true],
    ['0', 'g', false],
    ['6.000', 'ml', false],
    ['2,5', 'kg', true],
    ['50', 'serving', true],
    ['51', 'serving', false],
  ])('%s %s usable: %s', (raw, unit, ok) => {
    expect(amountError(parseDecimal(raw), unit) === null).toBe(ok)
  })
  it('empty or non-numeric text is left to the field (null amount)', () => {
    expect(amountError(null, 'g')).toBeNull()
    expect(maxAmount(undefined)).toBe(50)
  })
  it('allows bulk recipe ingredients within the existing 50 kg recipe limit', () => {
    expect(amountError(10000, 'g', 'pick')).toBeNull()
    expect(amountError(10, 'kg', 'pick')).toBeNull()
    expect(amountError(50000, 'ml', 'pick')).toBeNull()
    expect(amountError(50001, 'g', 'pick')).not.toBeNull()
    expect(amountError(100, 'portion', 'pick')).toBeNull()
    expect(amountError(10000, 'g')).not.toBeNull()
  })
  it('accepts the same 5 kg boundary in ounces and pounds', () => {
    expect(amountError(5000 / 28.3495, 'oz')).toBeNull()
    expect(amountError(5000 / 453.592, 'lb')).toBeNull()
    expect(amountError(5001 / 28.3495, 'oz')).not.toBeNull()
  })
  it('textRangeError: empty is fine, text is parsed with the Spanish rule', () => {
    expect(textRangeError('', 5, 300, 'cm')).toBeNull()
    expect(textRangeError('abc', 5, 300, 'cm')).toBe('Número no válido')
    expect(textRangeError('1.200', 5, 300, 'cm')).toBe('Escribe un valor entre 5 y 300 cm.')
    expect(textRangeError('1,200', 5, 300, 'cm')).toBe('Escribe un valor entre 5 y 300 cm.')
    expect(textRangeError('85,5', 5, 300, 'cm')).toBeNull()
  })
})
