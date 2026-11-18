import { useState } from 'react'
import type { Food } from './food'
import { FoodGlyph } from './FoodGlyph'
import { offImageUrl } from './off'

export function FoodThumbnail({ food }: { food: Food }) {
  const url = food.source === 'off' ? offImageUrl(food.imageUrl) : undefined
  const [failed, setFailed] = useState<string>()
  if (!url || url === failed) return <FoodGlyph food={food} size={40} />
  return (
    <img src={url} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer"
      onError={() => setFailed(url)} className="size-10 shrink-0 rounded-xl bg-surface2 object-contain" />
  )
}
