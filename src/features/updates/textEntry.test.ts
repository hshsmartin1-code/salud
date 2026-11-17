import { describe, expect, it } from 'vitest'
import { isTextEntry } from './textEntry'

describe('isTextEntry (the soft keyboard is, or is about to be, open)', () => {
  it.each([
    [{ tagName: 'INPUT', type: 'text' }, true],
    [{ tagName: 'INPUT', type: 'search' }, true],
    [{ tagName: 'INPUT', type: 'number' }, true],
    [{ tagName: 'INPUT', type: 'email' }, true],
    [{ tagName: 'INPUT' }, true],
    [{ tagName: 'TEXTAREA' }, true],
    [{ tagName: 'DIV', isContentEditable: true }, true],
    [{ tagName: 'SELECT' }, true],
    [{ tagName: 'INPUT', type: 'checkbox' }, false],
    [{ tagName: 'INPUT', type: 'radio' }, false],
    [{ tagName: 'INPUT', type: 'button' }, false],
    [{ tagName: 'INPUT', type: 'range' }, false],
    [{ tagName: 'INPUT', type: 'text', readOnly: true }, false],
    [{ tagName: 'INPUT', type: 'text', disabled: true }, false],
    [{ tagName: 'BUTTON' }, false],
    [{ tagName: 'A' }, false],
    [{ tagName: 'DIV' }, false],
    [null, false],
    [undefined, false],
  ])('%j -> %s', (el, expected) => {
    expect(isTextEntry(el)).toBe(expected)
  })
})
