import { describe, expect, it } from 'vitest'
import { dataUrlBytes, fitWithin, formatBytes } from './image'

describe('fitWithin', () => {
  it('downscales landscape and portrait keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 })
    expect(fitWithin(4000, 3000, 240)).toEqual({ width: 240, height: 180 })
  })
  it('never upscales', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1280, 1280, 1280)).toEqual({ width: 1280, height: 1280 })
  })
  it('keeps at least 1 px on extreme ratios and survives bad input', () => {
    expect(fitWithin(10000, 2, 1280)).toEqual({ width: 1280, height: 1 })
    expect(fitWithin(0, 100, 1280)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(100, 100, 0)).toEqual({ width: 1, height: 1 })
  })
})

describe('dataUrlBytes / formatBytes', () => {
  it('estimates the decoded size', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,QUJD')).toBe(3)
    expect(dataUrlBytes('data:image/jpeg;base64,QUI=')).toBe(2)
    expect(dataUrlBytes('data:image/jpeg;base64,QQ==')).toBe(1)
  })
  it('formats', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1572864)).toBe('1,5 MB')
  })
})
