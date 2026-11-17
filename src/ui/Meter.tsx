import { litSegments, meterFraction, meterOver } from './meterLogic'

/**
 * Progress against a target, one accessible meter with three looks:
 *  - bar: plain 6 px track;
 *  - scale: tape-measure ticks every 10 %, 10 px (the instrument look);
 *  - segments: `max` discrete segments, `value` of them lit (sets, glasses, days).
 * Above target by more than 5 % the fill turns to the warning colour; it is never clipped silently.
 * `colorVar` is a domain colour token name without the leading dashes (e.g. 'water', 'train').
 */
export function Meter({
  value,
  max,
  colorVar,
  variant,
  label,
  valueText,
}: {
  value: number | undefined
  max: number | undefined
  colorVar: string
  variant: 'bar' | 'scale' | 'segments'
  /** Accessible name, e.g. "Agua de hoy". */
  label: string
  /** Spoken value, e.g. "1,8 de 2,5 litros". Defaults to the numbers. */
  valueText?: string
}) {
  const fill = meterOver(value, max) ? 'rgb(var(--warn))' : `rgb(var(--${colorVar}))`
  const aria = {
    role: 'meter' as const,
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': max ?? 0,
    'aria-valuenow': value ?? 0,
    'aria-valuetext': valueText,
  }
  if (variant === 'segments') {
    const count = Math.max(1, Math.round(max ?? 1))
    const lit = litSegments(value, count)
    return (
      <div {...aria} className="flex w-full gap-1">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="h-2 min-w-0 flex-1 rounded-full bg-surface2 transition-colors duration-state"
            style={i < lit ? { background: fill } : undefined}
          />
        ))}
      </div>
    )
  }
  const pct = meterFraction(value, max) * 100
  const scale = variant === 'scale'
  return (
    <div
      {...aria}
      className={`relative w-full overflow-hidden ${scale ? 'scale-track h-2.5 rounded-[3px]' : 'h-1.5 rounded-full bg-surface2'}`}
    >
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-progress ease-out ${scale ? '' : 'rounded-full'}`}
        style={{ width: `${pct}%`, background: fill }}
      />
    </div>
  )
}
