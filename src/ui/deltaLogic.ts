export type DeltaDirection = 'up' | 'down' | 'flat'
export type DeltaTone = 'neutral' | 'good' | 'bad'

/** Direction of a change and whether it is good or bad. Without `goodWhen` the tone is always neutral. */
export function deltaState(value: number, goodWhen?: 'up' | 'down'): { dir: DeltaDirection; tone: DeltaTone } {
  const dir: DeltaDirection = !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down'
  if (!goodWhen || dir === 'flat') return { dir, tone: 'neutral' }
  return { dir, tone: dir === goodWhen ? 'good' : 'bad' }
}
