/**
 * Muscle map: front and back body figure. It renders ANY figure data that follows the contract of
 * muscleFigure.ts (viewBox, neutral silhouette, one closed path per muscle region) without knowing the
 * artwork.
 *
 * Two modes:
 *  - exercise mode (default, `primary` / `secondary`): primary muscles solid, secondary hatched, with a
 *    text legend so colour is never the only cue (ExerciseDetail, RoutineDetail);
 *  - recovery mode (`recovery`): one-hue sequential ramp of recency (most recent = strongest), each state
 *    also with its own pattern or outline and a legend that is always visible. Regions are tappable when
 *    `onSelectMuscle` is given; the caller must also offer a list with the same information.
 */
import { useId, useState, type MouseEvent, type ReactNode } from 'react'
import { Icon } from '../../ui/Icon'
import { Sheet } from '../../ui/kit'
import { FIGURE, type FigureData } from './muscleFigure'
import { RECOVERY_LEGEND, STATE_LABEL, type RecoveryState } from './recovery/recovery'

const NEUTRAL_BODY = 'rgb(var(--line-strong) / 0.28)'
const INACTIVE = 'rgb(var(--line-strong) / 0.62)'
const TRAIN = 'rgb(var(--train))'

type Role = 'primary' | 'secondary' | null
type ViewName = 'front' | 'back'
const BOTH: readonly ViewName[] = ['front', 'back']

/** Enlarged view: as tall as the sheet allows (up to the 720 px source); both views side by side when
 *  that keeps at least 80 % of the single-view height, otherwise one view at a time with a switch. */
function bigLayout(vb: { w: number; h: number }): { height: number; views: readonly ViewName[]; single: boolean } {
  const ratio = vb.w / vb.h
  const contentW = Math.min(window.innerWidth, 672) - 40
  const byHeight = window.innerHeight * 0.92 - 250
  const one = Math.min(720, byHeight, contentW / ratio)
  const two = Math.min(720, byHeight, (contentW - 16) / 2 / ratio)
  const single = two < 0.8 * one
  return { height: Math.max(200, Math.floor(single ? one : two)), views: single ? ['front'] : BOTH, single }
}

function recoveryPaint(state: RecoveryState | undefined, ids: { hatch: string; dots: string }): { fill: string; stroke?: string; dash?: string } {
  switch (state) {
    case 'recent':
      return { fill: TRAIN }
    case 'recovering':
      return { fill: `url(#${ids.hatch})` }
    case 'ready':
      return { fill: `url(#${ids.dots})` }
    default:
      return { fill: INACTIVE }
  }
}

function View({
  data,
  label,
  height,
  paint,
  title,
  ground,
  onSelect,
  selected,
}: {
  data: FigureData
  label: string
  height: number
  paint: (muscleId: string) => { fill: string; stroke?: string; dash?: string }
  title: (muscleId: string, region?: string) => string
  ground: string
  onSelect?: (muscleId: string) => void
  selected?: string | null
}) {
  const vb = data.viewBox
  const width = (height * vb.w) / vb.h
  const px = vb.h / height // user units per CSS pixel
  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`
  const base = data.base
  const testId = `figure-${label === 'Frente' ? 'front' : 'back'}`
  const shapes = data.shapes.map((s, i) => {
    const p = paint(s.muscleId)
    const isSel = selected === s.muscleId
    const neutral = p.fill === INACTIVE
    // Over the shaded base, colour is multiplied into the shading and untrained muscles stay transparent
    // (the base already shows them as neutral anatomy). Without a base the shapes carry the whole drawing.
    const fill = base && neutral ? 'transparent' : p.fill
    const stroke = isSel ? 'rgb(var(--ink))' : base ? (p.stroke && !neutral ? p.stroke : 'none') : (p.stroke ?? ground)
    return (
      <path
        key={i}
        d={s.d}
        data-muscle={s.muscleId}
        fill={fill}
        fillRule="evenodd"
        stroke={stroke}
        strokeWidth={(isSel ? 1.8 : p.stroke ? 1.1 : 0.9) * px}
        strokeDasharray={!isSel && p.dash ? p.dash.split(' ').map((n) => +n * px).join(' ') : undefined}
        strokeLinejoin="round"
        style={base && !neutral && !isSel ? { mixBlendMode: 'multiply' } : undefined}
        onClick={onSelect ? () => onSelect(s.muscleId) : undefined}
        // Light theme: the multiplied colour is lightened so the anatomy shading stays visible through it.
        className={`${onSelect ? 'cursor-pointer ' : ''}${base && !neutral ? 'opacity-[0.68] dark:opacity-100' : ''}`}
      >
        <title>{title(s.muscleId, s.region)}</title>
      </path>
    )
  })
  return (
    <figure className="flex flex-col items-center gap-1">
      <div className="relative isolate" style={{ width, height }}>
        <svg viewBox={viewBox} height={height} width={width} aria-hidden="true" className="absolute inset-0">
          {data.silhouette.map((d, i) => (
            <path key={`b${i}`} d={d} fill={NEUTRAL_BODY} />
          ))}
        </svg>
        {base ? (
          <img
            src={`${import.meta.env.BASE_URL}${base.href}`}
            alt=""
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none dark:brightness-[0.72]"
          />
        ) : null}
        <svg viewBox={viewBox} height={height} width={width} aria-hidden="true" className="absolute inset-0" data-testid={testId}>
          {shapes}
          {base && data.lines?.length ? (
            <path d={data.lines.join('')} fill="none" stroke="rgb(0 0 0 / 0.22)" strokeWidth={0.6 * px} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          ) : null}
        </svg>
      </div>
      <figcaption className="text-label text-muted">{label}</figcaption>
    </figure>
  )
}

export function MuscleMap({
  primary = [],
  secondary = [],
  labels,
  height = 210,
  recovery,
  onSelectMuscle,
  selected = null,
  figure = FIGURE,
  ground = 'rgb(var(--bg))',
  showLegend = true,
  aside,
  expandable = false,
  views = BOTH,
}: {
  primary?: readonly string[]
  secondary?: readonly string[]
  /** Spanish names by catalog id. */
  labels: Record<string, string>
  height?: number
  /** Recovery mode: state per muscle id. When given, `primary` / `secondary` are ignored. */
  recovery?: ReadonlyMap<string, RecoveryState>
  onSelectMuscle?: (muscleId: string) => void
  selected?: string | null
  /** Swappable figure data (see muscleFigure.ts). */
  figure?: { front: FigureData; back: FigureData }
  /** Colour behind the figure: used for the hairlines that separate muscles. */
  ground?: string
  /** Recovery mode: hide the legend (empty profile). */
  showLegend?: boolean
  /** Recovery mode: content under the legend; on wide screens legend and content sit beside the figures. */
  aside?: ReactNode
  /** Adds an "Ampliar" button (and tap on the figure background) that opens the figure large in a sheet. */
  expandable?: boolean
  /** Which views to draw (the enlarged view on narrow screens shows one at a time). */
  views?: readonly ViewName[]
}) {
  const [big, setBig] = useState<{ height: number; views: readonly ViewName[]; single: boolean } | null>(null)
  const openBig = () => setBig(bigLayout(figure.front.viewBox))
  const onFigureClick = (e: MouseEvent) => {
    if (!expandable) return
    if (onSelectMuscle && (e.target as Element).closest('[data-muscle]')) return
    openBig()
  }
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  // Patterns in CSS pixels: the legend swatches use them as is; the figure scales them by its user units
  // per CSS pixel so the hatch and the dots keep the same on-screen size whatever the viewBox is.
  const ids = { hatch: `hatch-${uid}`, dots: `dots-${uid}` }
  const figIds = { hatch: `fhatch-${uid}`, dots: `fdots-${uid}` }
  const figPx = figure.front.viewBox.h / height
  const name = (m: string) => labels[m] ?? m
  const prim = new Set(primary)
  const sec = new Set(secondary.filter((m) => !prim.has(m)))
  const role = (m: string): Role => (prim.has(m) ? 'primary' : sec.has(m) ? 'secondary' : null)

  let paint: (m: string) => { fill: string; stroke?: string; dash?: string }
  let title: (m: string, region?: string) => string
  let summary: string
  if (recovery) {
    paint = (m) => recoveryPaint(recovery.get(m), figIds)
    title = (m, region) => `${name(m)}${region ? ` (${region})` : ''}: ${STATE_LABEL[recovery.get(m) ?? 'none']}`
    const parts = RECOVERY_LEGEND.map((st) => {
      const ms = [...recovery.entries()].filter(([, s]) => s === st).map(([m]) => name(m))
      return ms.length ? `${STATE_LABEL[st]}: ${ms.join(', ')}.` : ''
    }).filter(Boolean)
    summary = `Mapa muscular orientativo. ${parts.join(' ') || 'Sin músculos trabajados en tus sesiones registradas.'}`
  } else {
    paint = (m) => {
      const r = role(m)
      return r === 'primary' ? { fill: TRAIN } : r === 'secondary' ? { fill: `url(#${figIds.hatch})`, stroke: TRAIN, dash: '2 1.2' } : { fill: INACTIVE }
    }
    title = (m, region) => `${name(m)}${region ? ` (${region})` : ''}`
    const principal = [...prim].map(name).join(', ')
    const secundario = [...sec].map(name).join(', ')
    summary = `Mapa muscular. Principal: ${principal || 'sin datos'}.${secundario ? ` Secundario: ${secundario}.` : ''}`
  }
  const principal = [...prim].map(name).join(', ')
  const secundario = [...sec].map(name).join(', ')

  const legend = recovery && showLegend ? (
        <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-label text-muted ${aside !== undefined ? 'justify-center lg:justify-start' : 'mt-3 justify-center'}`} data-testid="recovery-legend">
          {RECOVERY_LEGEND.map((st) => {
            const p = recoveryPaint(st, ids)
            return (
              <li key={st} className="flex items-center gap-2">
                <svg width="14" height="14" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill={p.fill} stroke={p.stroke ?? 'none'} strokeDasharray={p.dash ? '2 1.5' : undefined} />
                </svg>
                {st === 'rested' ? 'Más de 7 días o sin registros' : STATE_LABEL[st]}
              </li>
            )
          })}
        </ul>
  ) : null

  const figures = (
    <div className="relative mx-auto flex w-fit shrink-0 flex-col items-center lg:mx-0">
      <div role="img" aria-label={summary} className={`flex justify-center gap-4${expandable ? ' cursor-zoom-in' : ''}`} onClick={onFigureClick} data-testid="figure-views">
        <svg width="0" height="0" aria-hidden="true" className="absolute">
          <defs>
            <pattern id={ids.hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill="rgb(var(--train) / 0.25)" />
              <rect width="1.8" height="4" fill={TRAIN} />
            </pattern>
            <pattern id={ids.dots} width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="rgb(var(--train) / 0.2)" />
              <circle cx="2" cy="2" r="0.9" fill="rgb(var(--train) / 0.9)" />
            </pattern>
            <pattern id={figIds.hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={`scale(${figPx}) rotate(45)`}>
              <rect width="4" height="4" fill="rgb(var(--train) / 0.25)" />
              <rect width="1.8" height="4" fill={TRAIN} />
            </pattern>
            <pattern id={figIds.dots} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform={`scale(${figPx})`}>
              <rect width="4" height="4" fill="rgb(var(--train) / 0.2)" />
              <circle cx="2" cy="2" r="0.9" fill="rgb(var(--train) / 0.9)" />
            </pattern>
          </defs>
        </svg>
        {views.includes('front') ? (
          <View data={figure.front} label="Frente" height={height} paint={paint} title={title} ground={ground} onSelect={onSelectMuscle} selected={selected} />
        ) : null}
        {views.includes('back') ? (
          <View data={figure.back} label="Espalda" height={height} paint={paint} title={title} ground={ground} onSelect={onSelectMuscle} selected={selected} />
        ) : null}
      </div>
      {expandable ? (
        // Beside the "Espalda" caption, so it costs no extra row.
        <button
          type="button"
          aria-label="Ampliar"
          title="Ampliar"
          className="absolute -bottom-2 left-full ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          onClick={openBig}
          data-testid="figure-expand"
        >
          <Icon name="search" size={18} />
        </button>
      ) : null}
    </div>
  )

  const bigSheet = expandable ? (
    <Sheet open={!!big} onClose={() => setBig(null)} title="Mapa muscular" wide>
      {big ? (
        <div data-testid="figure-big">
          {big.single ? (
            <div className="mb-3 flex justify-center gap-2" role="group" aria-label="Vista">
              {BOTH.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={big.views.includes(v)}
                  className={`min-h-[44px] rounded-full px-4 text-label font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${big.views.includes(v) ? 'bg-ink text-bg' : 'border border-line text-muted'}`}
                  onClick={() => setBig({ ...big, views: [v] })}
                  data-testid={`figure-big-${v}`}
                >
                  {v === 'front' ? 'Frente' : 'Espalda'}
                </button>
              ))}
            </div>
          ) : null}
          <MuscleMap
            primary={primary}
            secondary={secondary}
            labels={labels}
            height={big.height}
            recovery={recovery}
            onSelectMuscle={onSelectMuscle}
            selected={selected}
            figure={figure}
            ground={ground}
            showLegend={showLegend}
            views={big.views}
          />
        </div>
      ) : null}
    </Sheet>
  ) : null

  return (
    <div data-testid="muscle-map" className={recovery && aside !== undefined ? 'lg:flex lg:items-start lg:gap-8' : undefined}>
      {figures}
      {recovery ? (
        aside !== undefined ? (
          <div className="mt-1 min-w-0 flex-1 lg:mt-0">
            {legend}
            {aside}
          </div>
        ) : (
          legend
        )
      ) : (
        <dl className="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-label" data-testid="muscle-legend">
          <dt className="flex items-center gap-2 text-muted">
            <svg width="14" height="14" aria-hidden="true">
              <rect width="14" height="14" rx="3" fill={TRAIN} />
            </svg>
            Principal
          </dt>
          <dd className="min-w-0 font-medium text-ink">{principal || '—'}</dd>
          {secundario ? (
            <>
              <dt className="flex items-center gap-2 text-muted">
                <svg width="14" height="14" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill={`url(#${ids.hatch})`} stroke={TRAIN} strokeDasharray="2 1.2" />
                </svg>
                Secundario
              </dt>
              <dd className="min-w-0 text-ink">{secundario}</dd>
            </>
          ) : null}
        </dl>
      )}
      {bigSheet}
    </div>
  )
}
