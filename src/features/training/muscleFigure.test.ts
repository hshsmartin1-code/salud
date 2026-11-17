import { describe, expect, it } from 'vitest'
import { BODYPARTS3D_ATTRIBUTION, FIGURE, type FigureData } from './muscleFigure'
import dataSource from './muscleFigure.data.ts?raw'
import { MUSCLE_IDS } from './muscles'

const views: [string, FigureData][] = [['front', FIGURE.front], ['back', FIGURE.back]]
const ids = (v: FigureData) => new Set(v.shapes.map((s) => s.muscleId))

describe('muscle figure data contract', () => {
  it('has a shape for every muscle id of muscles.ts', () => {
    const drawn = new Set(views.flatMap(([, v]) => [...ids(v)]))
    expect(MUSCLE_IDS.filter((id) => !drawn.has(id))).toEqual([])
  })
  it('draws each id in the views where it is anatomically visible', () => {
    // Documented in docs/V3_MUSCLE_RECOVERY.md ("Figura anatómica"): ids visible from one side only.
    const FRONT_ONLY = ['chest', 'abdominals', 'biceps', 'neck']
    const BACK_ONLY = ['lats', 'middle back', 'lower back', 'glutes']
    const front = ids(FIGURE.front)
    const back = ids(FIGURE.back)
    for (const id of MUSCLE_IDS) {
      if (!BACK_ONLY.includes(id)) expect(front.has(id), `front: ${id}`).toBe(true)
      if (!FRONT_ONLY.includes(id)) expect(back.has(id), `back: ${id}`).toBe(true)
    }
  })
  it('references only known muscle ids', () => {
    const known = new Set(MUSCLE_IDS)
    expect(views.flatMap(([v, d]) => d.shapes.filter((s) => !known.has(s.muscleId)).map((s) => `${v}:${s.muscleId}`))).toEqual([])
  })
  it('uses closed absolute paths, a valid viewBox and valid sides', () => {
    for (const [, v] of views) {
      expect(v.viewBox.w).toBeGreaterThan(0)
      expect(v.viewBox.h).toBeGreaterThan(0)
      expect(v.silhouette.length).toBeGreaterThan(0)
      for (const d of [...v.shapes.map((x) => x.d), ...v.silhouette]) {
        expect(d).toMatch(/^M[\d.\s-]+/)
        expect(d.trim().endsWith('Z')).toBe(true)
        expect(d).not.toMatch(/[mlhvcsqtaz]/)
      }
      for (const l of v.lines ?? []) expect(l).toMatch(/^M[\d.\s-]+$/)
      for (const s of v.shapes) expect([undefined, 'left', 'right']).toContain(s.side)
    }
  })
  it('keeps the path data under 60 KB for both views', () => {
    const bytes = views.reduce((a, [, v]) => a + [...v.shapes.map((s) => s.d), ...(v.lines ?? []), ...v.silhouette].join('').length, 0)
    expect(bytes).toBeLessThan(60_000)
  })
  it('carries the BodyParts3D attribution in the generated file header', () => {
    const header = dataSource.slice(0, dataSource.indexOf('*/'))
    expect(header).toContain(BODYPARTS3D_ATTRIBUTION)
    expect(header).toContain('CC BY 4.0')
    expect(header).toContain('scripts/muscle-figure')
  })
})
