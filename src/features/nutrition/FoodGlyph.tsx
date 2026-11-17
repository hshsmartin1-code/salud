import type { ReactNode } from 'react'
import { foodGlyph, type GlyphInput, type GlyphKind } from './glyphKind'

/**
 * Simple original line glyphs on a 24 px grid, one per kind. They are decoration (aria-hidden): the row's
 * text already says what the food is. Drawn for this app; no icon pack, no third-party artwork.
 */
const PATHS: Record<GlyphKind, ReactNode> = {
  // wheat ear: stem and three pairs of grains
  grain: <path d="M12 21V9M12 9c-2.2-.4-3.4-1.9-3.4-4 2.2.2 3.4 1.7 3.4 4zm0 0c2.2-.4 3.4-1.9 3.4-4-2.2.2-3.4 1.7-3.4 4zm0 5c-2.4 0-4-1.3-4.4-3.4 2.4-.1 4 1.1 4.4 3.4zm0 0c2.4 0 4-1.3 4.4-3.4-2.4-.1-4 1.1-4.4 3.4zm0 4.5c-2 0-3.5-1-4-2.8 2-.1 3.4.8 4 2.8zm0 0c2 0 3.5-1 4-2.8-2-.1-3.4.8-4 2.8zM12 5V3" />,
  // steak with a marbling line
  meat: <path d="M5 12.5C4 8.5 7.5 5 12 5.2c4.5.2 7.5 2.6 7 6.6-.5 4-4.2 6.8-8 6.6-3-.2-5.2-2.2-6-5.9zM9 11.5c1.5 1.6 3.2 1.6 4.2.6 1-1 1.4-2.2 3.2-2" />,
  // drumstick
  poultry: <><path d="M10.2 13.8C8.200 10.400 9.400 6.200 12.800 4.800c3.200-1.300 7 .5 7.100 4.200.1 3.700-3.500 6.500-6.900 6.300-1 0-2-.4-2.800-1.200z" /><path d="M10.200 13.800 6.800 17.200" /><circle cx="5.300" cy="17.300" r="1.500" /><circle cx="7.100" cy="19.100" r="1.500" /></>,
  // fish body, tail and eye
  fish: <path d="M3 12c2.4-4 6-6 10-5.5 2 .3 4 1.4 5.5 3.1L21.5 7v10l-3-3.1c-1.5 1.7-3.5 2.800-5.5 3.100C9 17.500 5.400 15.800 3 12zM8 11.200h.01" />,
  // egg
  egg: <path d="M12 3.500c3.300 0 6 5.200 6 9.200a6 6 0 0 1-12 0c0-4 2.700-9.200 6-9.200zM9.500 14.200a2.700 2.700 0 0 0 2.300 2.300" />,
  // glass of milk
  dairy: <path d="M7 3.500h10l-1.200 16.200a1.300 1.300 0 0 1-1.300 1.200H9.500a1.300 1.300 0 0 1-1.300-1.200zM7.400 9h9.200M8.700 14.500h6.600" />,
  // apple with leaf
  fruit: <path d="M12 8.200c-1.200-1-2.600-1.400-4-1.100-2.200.5-3.500 2.700-3.200 5.300.4 3.600 2.700 7.100 5 7.100.9 0 1.400-.5 2.200-.5s1.300.5 2.200.5c2.300 0 4.600-3.500 5-7.100.3-2.600-1-4.800-3.200-5.300-1.400-.3-2.800.1-4 1.100zM12 8.200c0-2 .8-3.600 2.600-4.500M12 8.200" />,
  // broccoli: three florets on a stem
  vegetable: <path d="M8 13.5a3.5 3.5 0 1 1 1.2-6.8 3.5 3.5 0 0 1 5.6 0A3.5 3.5 0 1 1 16 13.5M10 13.5V20h4v-6.5M10 16.5h4" />,
  // bean
  legume: <path d="M17.800 5.200c2.200 2 1.700 5.300-.6 8.200-2.700 3.300-6.700 5.800-9.200 4.700-2.400-1.100-2.200-4.600.2-7.700 2.600-3.400 7.400-7.300 9.600-5.200zM9.800 12.500c1.100.2 2.100-.3 2.800-1.100" />,
  // almond / seed
  nut: <path d="M12 3c3.700 3.100 6 6.600 6 10.200A6 6 0 0 1 12 20a6 6 0 0 1-6-6.800C6 9.600 8.300 6.100 12 3zM12 8.500v8" />,
  // oil drop
  fat: <path d="M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11zM9 14.500a3 3 0 0 0 2.500 2.800" />,
  // cookie with chips
  sweet: <path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5zM9 9h.01M8.500 14h.01M13.500 13h.01M12.500 17.500h.01M16.500 14.500h.01" />,
  // cup with straw
  drink: <path d="M6 8h12l-1.200 11.300A1.500 1.500 0 0 1 15.300 20.700H8.700a1.500 1.500 0 0 1-1.500-1.400zM6.400 12h11.200M13 8l1.500-5H18" />,
  // bowl with steam
  dish: <path d="M3.500 12h17a8.500 8.500 0 0 1-17 0zM9 20.500h6M8.500 3.500c-1 1-1 2 0 3s1 2 0 3M12.500 3.500c-1 1-1 2 0 3s1 2 0 3M16.500 3.500c-1 1-1 2 0 3s1 2 0 3" />,
  // box with a barcode
  packaged: <path d="M4 7.500 12 3.500l8 4v9l-8 4-8-4zM4 7.500l8 4 8-4M12 11.500v9M7.800 5.500l8 4" />,
  // open recipe book
  recipe: <path d="M12 6.500C10.300 5.200 8 4.800 4.500 5v13c3.500-.2 5.800.2 7.500 1.500 1.700-1.300 4-1.700 7.500-1.500V5c-3.500-.2-5.800.2-7.500 1.500zM12 6.500v13" />,
  // plate between a fork and a knife
  generic: <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM3.5 4v5.5a1.5 1.5 0 0 0 3 0V4M5 4v16M20.5 20V4c-1.8 1.3-2.5 3.5-2.5 6.5h2.5" />,
}

/** Colour variable (a domain colour of the design tokens) tinting the tile of each kind. */
const TINT: Record<GlyphKind, string> = {
  grain: 'carbs',
  meat: 'heart',
  poultry: 'energy',
  fish: 'water',
  egg: 'carbs',
  dairy: 'protein',
  fruit: 'fat',
  vegetable: 'fiber',
  legume: 'move',
  nut: 'carbs',
  fat: 'energy',
  sweet: 'body',
  drink: 'train',
  dish: 'energy',
  packaged: 'sleep',
  recipe: 'accent',
  generic: 'muted',
}

/** A category glyph in a tinted rounded tile. `size` is the tile's side in px. */
export function FoodGlyph({ food, kind, size = 40 }: { food?: GlyphInput; kind?: GlyphKind; size?: number }) {
  const k = kind ?? (food ? foodGlyph(food) : 'generic')
  const c = TINT[k]
  return (
    <span
      aria-hidden
      data-glyph={k}
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: `rgb(var(--${c}) / 0.14)`, color: `rgb(var(--${c}))` }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[k]}
      </svg>
    </span>
  )
}
