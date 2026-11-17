/**
 * The one exercise thumbnail: a close-up of the app's own anatomical figure (see thumbView.ts). Cheap in
 * long lists: the two shaded base images are shared by URL (decoded once), the muscle outlines live once in
 * a hidden SVG sprite and every thumbnail is an <svg> with an <image> and a few <use> nodes.
 */
import { FIGURE, type FigureData } from '../muscleFigure'
import { thumbView, type ThumbView } from './thumbView'

const SPRITE_ID = 'salud-anatomy-sprite'
const TRAIN = 'rgb(var(--train))'
const BODY = 'rgb(var(--line-strong) / 0.3)'
const spriteId = (view: 'front' | 'back', part: string) => `mf-${view}-${part.replace(/\s+/g, '_')}`

function spriteMarkup(): string {
  const one = (view: 'front' | 'back', data: FigureData) => {
    const groups = new Map<string, string[]>()
    for (const s of data.shapes) {
      const list = groups.get(s.muscleId) ?? []
      list.push(`<path d="${s.d}" fill-rule="evenodd"/>`)
      groups.set(s.muscleId, list)
    }
    const sil = `<g id="${spriteId(view, 'body')}">${data.silhouette.map((d) => `<path d="${d}"/>`).join('')}</g>`
    return sil + [...groups].map(([id, paths]) => `<g id="${spriteId(view, id)}">${paths.join('')}</g>`).join('')
  }
  return `<svg id="${SPRITE_ID}" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${one('front', FIGURE.front)}${one('back', FIGURE.back)}</defs></svg>`
}

/** Adds the sprite to the document once (idempotent, no-op without a DOM). */
export function ensureAnatomySprite(): void {
  if (typeof document === 'undefined' || document.getElementById(SPRITE_ID)) return
  document.body.insertAdjacentHTML('afterbegin', spriteMarkup())
}

const viewCache = new Map<string, ThumbView>()
function viewFor(primary: readonly string[], secondary: readonly string[]): ThumbView {
  const key = `${primary.join(',')}|${secondary.join(',')}`
  let v = viewCache.get(key)
  if (!v) {
    v = thumbView(primary, secondary)
    if (viewCache.size > 3000) viewCache.clear()
    viewCache.set(key, v)
  }
  return v
}

export interface AnatomyThumbProps {
  primaryMuscles?: readonly string[]
  secondaryMuscles?: readonly string[]
  /** Side in px. */
  size?: number
  testId?: string
  className?: string
}

export function AnatomyThumb({ primaryMuscles = [], secondaryMuscles = [], size = 48, testId = 'exercise-thumb', className = '' }: AnatomyThumbProps) {
  ensureAnatomySprite()
  const v = viewFor(primaryMuscles, secondaryMuscles)
  const base = FIGURE[v.view].base
  const vb = FIGURE[v.view].viewBox
  const c = v.crop
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${c.x} ${c.y} ${c.w} ${c.h}`}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 rounded-lg ${className}`}
      style={{ backgroundColor: 'rgb(var(--train) / 0.1)' }}
      data-testid={testId}
      data-thumb="anatomy"
      data-view={v.view}
      data-region={v.region}
    >
      <use href={`#${spriteId(v.view, 'body')}`} fill={BODY} />
      {base ? <image href={`${import.meta.env.BASE_URL}${base.href}`} x={vb.x} y={vb.y} width={vb.w} height={vb.h} preserveAspectRatio="none" className="dark:brightness-[0.72]" /> : null}
      {v.highlights.map((h) =>
        h.role === 'primary' ? (
          <use key={h.muscleId} href={`#${spriteId(v.view, h.muscleId)}`} fill={TRAIN} style={{ mixBlendMode: 'multiply' }} className="opacity-[0.78] dark:opacity-100" />
        ) : (
          <use key={h.muscleId} href={`#${spriteId(v.view, h.muscleId)}`} fill={TRAIN} fillOpacity={0.34} />
        ),
      )}
    </svg>
  )
}
