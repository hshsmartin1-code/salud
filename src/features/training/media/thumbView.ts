/**
 * Anatomical thumbnail model (pure). One thumbnail style for every exercise: a close-up of the app's own
 * muscle figure (muscleFigure.data.ts) on the region that holds the exercise's primary muscles, with the
 * primary muscles in the training accent and the secondary ones lighter.
 *
 * `thumbView(primary, secondary)` -> which view (front / back), which square crop of the figure's viewBox
 * and which muscles to highlight. No React, no DOM: AnatomyThumb.tsx draws the result.
 */
import { FIGURE, type FigureData } from '../muscleFigure'

export type FigureView = 'front' | 'back'
export type RegionId = 'front-upper' | 'front-core' | 'front-arms' | 'front-legs' | 'back-upper' | 'back-lumbar' | 'back-legs' | 'back-calves' | 'whole'

export interface Crop {
  x: number
  y: number
  w: number
  h: number
}
export interface Highlight {
  muscleId: string
  role: 'primary' | 'secondary'
}
export interface ThumbView {
  view: FigureView
  region: RegionId
  crop: Crop
  highlights: Highlight[]
}

/** Square windows on the figure's 338 x 800 viewBox (both views share it). Chosen so a muscle is >= 4 px at 32 px. */
export const REGION_CROP: Record<RegionId, Crop> = {
  'front-upper': { x: 49, y: 105, w: 240, h: 240 },
  'front-core': { x: 59, y: 190, w: 220, h: 220 },
  'front-arms': { x: 54, y: 215, w: 230, h: 230 },
  'front-legs': { x: 49, y: 370, w: 240, h: 240 },
  'back-upper': { x: 49, y: 115, w: 240, h: 240 },
  'back-lumbar': { x: 59, y: 190, w: 220, h: 220 },
  'back-legs': { x: 34, y: 330, w: 270, h: 270 },
  'back-calves': { x: 49, y: 520, w: 240, h: 240 },
  // The whole body centred in a square window (338 wide inside 800).
  whole: { x: -231, y: 0, w: 800, h: 800 },
}

const VIEW_OF: Record<RegionId, FigureView> = {
  'front-upper': 'front',
  'front-core': 'front',
  'front-arms': 'front',
  'front-legs': 'front',
  'back-upper': 'back',
  'back-lumbar': 'back',
  'back-legs': 'back',
  'back-calves': 'back',
  whole: 'front',
}

/** Home region of each catalog muscle id (muscles.ts). `shoulders` is decided by context, see below. */
const HOME: Record<string, RegionId> = {
  chest: 'front-upper',
  biceps: 'front-upper',
  neck: 'front-upper',
  shoulders: 'front-upper',
  traps: 'back-upper',
  lats: 'back-upper',
  'middle back': 'back-upper',
  triceps: 'back-upper',
  'lower back': 'back-lumbar',
  abdominals: 'front-core',
  quadriceps: 'front-legs',
  adductors: 'front-legs',
  abductors: 'back-legs',
  forearms: 'front-arms',
  glutes: 'back-legs',
  hamstrings: 'back-legs',
  calves: 'back-calves',
}

const BACK_CONTEXT = ['middle back', 'traps', 'lats', 'lower back']
const FRONT_CONTEXT = ['chest', 'biceps', 'neck']

/** Region of the shoulders: the back when only back muscles accompany them (rear delts), else the front. */
function shouldersRegion(others: readonly string[]): RegionId {
  const back = others.some((m) => BACK_CONTEXT.includes(m))
  const front = others.some((m) => FRONT_CONTEXT.includes(m))
  return back && !front ? 'back-upper' : 'front-upper'
}

// ───────────── bounding boxes of the drawn regions (for dropping shapes outside the crop) ─────────────
type Box = { x0: number; y0: number; x1: number; y1: number }
const boxCache = new Map<string, Box>()

function boxOf(view: FigureView, muscleId: string): Box | null {
  const key = `${view}:${muscleId}`
  const hit = boxCache.get(key)
  if (hit) return hit
  const data: FigureData = FIGURE[view]
  let b: Box | null = null
  for (const s of data.shapes) {
    if (s.muscleId !== muscleId) continue
    const n = s.d.match(/-?\d*\.?\d+/g)?.map(Number) ?? []
    for (let i = 0; i + 1 < n.length; i += 2) {
      const x = n[i]!
      const y = n[i + 1]!
      b = b ? { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) } : { x0: x, y0: y, x1: x, y1: y }
    }
  }
  if (b) boxCache.set(key, b)
  return b
}

const hits = (b: Box, c: Crop) => b.x1 > c.x && b.x0 < c.x + c.w && b.y1 > c.y && b.y0 < c.y + c.h

/** Whether the figure has a drawn region for the muscle in the view (and it falls inside the window). */
export function visibleIn(view: FigureView, muscleId: string, crop: Crop): boolean {
  const b = boxOf(view, muscleId)
  return !!b && hits(b, crop)
}

/**
 * Picks the crop for an exercise. Each primary muscle votes for its home region (the first listed muscle
 * wins ties); with no primary muscles the secondary ones vote instead. No muscle at all (or only unknown
 * ids) gives the whole neutral figure. Highlights are the primary muscles, then the secondary ones that
 * are not primary, restricted to regions drawn inside the chosen window.
 */
export function thumbView(primaryMuscles: readonly string[] = [], secondaryMuscles: readonly string[] = []): ThumbView {
  const primary = [...new Set(primaryMuscles)].filter((m) => m in HOME)
  const secondary = [...new Set(secondaryMuscles)].filter((m) => m in HOME && !primary.includes(m))
  const voters = primary.length ? primary : secondary
  if (!voters.length) return { view: 'front', region: 'whole', crop: REGION_CROP.whole, highlights: [] }

  const score = new Map<RegionId, number>()
  voters.forEach((m, i) => {
    const others = voters.filter((o) => o !== m)
    const region = m === 'shoulders' ? shouldersRegion([...others, ...(primary.length ? secondary : [])]) : HOME[m]!
    // Earlier muscles weigh a hair more so the first listed muscle breaks ties deterministically.
    score.set(region, (score.get(region) ?? 0) + 1 + (voters.length - i) * 0.001)
  })
  let region: RegionId = 'front-upper'
  let best = -1
  for (const [r, s] of score) if (s > best) ((best = s), (region = r))

  const view = VIEW_OF[region]
  const crop = REGION_CROP[region]
  const highlights: Highlight[] = []
  for (const m of primary) if (visibleIn(view, m, crop)) highlights.push({ muscleId: m, role: 'primary' })
  for (const m of secondary) if (visibleIn(view, m, crop)) highlights.push({ muscleId: m, role: 'secondary' })
  // Primary muscles that live in the other view (e.g. chest with lats) are simply not drawn here.
  return { view, region, crop, highlights }
}
