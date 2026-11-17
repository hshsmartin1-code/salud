/**
 * Placeholder while data loads. `lines` text bars (the last one shorter) or one block of `height` px.
 * The pulse only runs when the person has not asked for reduced motion (see `.skeleton` in index.css).
 */
export function Skeleton({ lines, height, label = 'Cargando' }: { lines?: number; height?: number; label?: string }) {
  const n = lines && lines > 0 ? Math.floor(lines) : 0
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {n > 0 ? (
        <div className="space-y-2.5" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="skeleton h-4" style={{ width: n > 1 && i === n - 1 ? '62%' : '100%' }} />
          ))}
        </div>
      ) : (
        <div className="skeleton w-full" style={{ height: height ?? 16 }} aria-hidden="true" />
      )}
    </div>
  )
}
