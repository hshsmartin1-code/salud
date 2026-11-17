/** Fill fraction 0..1 (0 when there is no usable max). */
export function meterFraction(value: number | undefined, max: number | undefined): number {
  if (value === undefined || !max || max <= 0 || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value / max))
}

/** More than 5 % over the target is shown in the warning colour (never clipped silently). */
export function meterOver(value: number | undefined, max: number | undefined): boolean {
  return value !== undefined && !!max && max > 0 && value > max * 1.05
}

/** Number of lit segments for the 'segments' variant (max = segment count). */
export function litSegments(value: number | undefined, count: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.min(count, Math.max(0, Math.round(value)))
}
