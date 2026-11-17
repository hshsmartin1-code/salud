import { glyphFor, type GlyphKey } from '../muscles'

// ───────────── fallback tile (no illustration) ─────────────
/** What the tile needs from an exercise. */
export interface TileExercise {
  equipment: string | null
  category: string
  /** Catalog muscle ids: the anatomical thumbnail highlights them (absent = looked up by id, or the neutral figure). */
  primaryMuscles?: readonly string[]
  secondaryMuscles?: readonly string[]
}

/** Simple line glyphs on a 24 x 24 grid, one per equipment / movement category. Drawn for Salud. */
function GlyphPaths({ kind }: { kind: GlyphKey }) {
  switch (kind) {
    case 'barbell':
      return (
        <>
          <path d="M2.5 12h19" />
          <path d="M6 7v10M9 9v6M15 9v6M18 7v10" />
        </>
      )
    case 'dumbbell':
      return (
        <>
          <path d="M8 12h8" />
          <rect x="3.5" y="8.5" width="4.5" height="7" rx="1.5" />
          <rect x="16" y="8.5" width="4.5" height="7" rx="1.5" />
        </>
      )
    case 'cable':
      return (
        <>
          <circle cx="12" cy="5.5" r="2.5" />
          <path d="M12 8v8" />
          <path d="M8.5 16h7M8.5 16v3.5M15.5 16v3.5" />
        </>
      )
    case 'machine':
      return (
        <>
          <rect x="4" y="3.5" width="6" height="17" rx="1.5" />
          <path d="M4 8h6M4 12h6M4 16h6" />
          <path d="M10 6h5.5a3 3 0 0 1 3 3v4M13 20.5h8" />
        </>
      )
    case 'bodyweight':
      return (
        <>
          <circle cx="12" cy="4.5" r="2" />
          <path d="M12 7.5v6M5 10l7-1.5 7 1.5M12 13.5l-3.5 7M12 13.5l3.5 7" />
        </>
      )
    case 'kettlebell':
      return (
        <>
          <path d="M8.5 9a3.5 3.5 0 0 1 7 0" />
          <circle cx="12" cy="15" r="6" />
        </>
      )
    case 'band':
      return <path d="M3 8c3-4 5 4 9 0s6 4 9 0M3 16c3-4 5 4 9 0s6 4 9 0" />
    case 'ball':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M4 10c5 2 11 2 16 0" />
        </>
      )
    case 'roller':
      return (
        <>
          <rect x="3" y="8" width="18" height="8" rx="4" />
          <path d="M8 8v8M12 8v8M16 8v8" />
        </>
      )
    case 'stretch':
      return (
        <>
          <circle cx="7" cy="5.5" r="2" />
          <path d="M7 8c0 4 2 6 5 7l8 1M7 8l5 2M12 15l-3 5" />
        </>
      )
    case 'cardio':
      return <path d="M2.5 12h4l2.5-6 4 12 2.5-6h6" />
    default:
      return (
        <>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </>
      )
  }
}

export function ExerciseGlyph({ kind, size = 24 }: { kind: GlyphKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <GlyphPaths kind={kind} />
    </svg>
  )
}

/**
 * Deliberate stand-in for exercises without an illustration: the training colour, a glyph for the
 * equipment (or the movement category for stretching and cardio) and, when there is room, the primary
 * muscle name. Without `exercise` it shows the generic dumbbell glyph.
 */
export function ExerciseTile({ exercise, muscle, size = 48, testId = 'exercise-thumb-fallback' }: { exercise?: TileExercise; muscle?: string; size?: number; testId?: string }) {
  const kind: GlyphKey = exercise ? glyphFor(exercise) : 'dumbbell'
  const showName = !!muscle && size >= 72
  return (
    <span
      className="flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg px-1 text-center text-[rgb(var(--train))]"
      style={{ width: size, height: size, backgroundColor: 'rgb(var(--train) / 0.12)' }}
      data-testid={testId}
      aria-hidden
    >
      <ExerciseGlyph kind={kind} size={Math.round(showName ? size * 0.4 : size * 0.5)} />
      {showName ? <span className="max-w-full truncate text-micro font-medium leading-none text-ink">{muscle}</span> : null}
    </span>
  )
}
