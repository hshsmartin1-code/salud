import type { IconName } from '../../ui/Icon'
import type { VitalKind } from '../../db/types'
import type { QuickKind } from '../health/QuickLog'

/** In-place logs: each opens the matching Salud quick sheet without leaving the screen. */
export const QUICK_SHEETS: readonly { kind: QuickKind; label: string; icon: IconName; vital?: VitalKind }[] = [
  { kind: 'weight', label: 'Peso', icon: 'scale' },
  { kind: 'sleep', label: 'Sueño', icon: 'bed' },
  { kind: 'bloodPressure', label: 'Presión arterial', icon: 'heart' },
  { kind: 'glucose', label: 'Glucosa', icon: 'clipboard' },
  { kind: 'activity', label: 'Actividad', icon: 'activity' },
  { kind: 'vital', vital: 'restingHr', label: 'Otros signos', icon: 'flame' },
]

/** Less frequent entries that need a full form: links to their screens. */
export const QUICK_LINKS: readonly { to: string; label: string; icon: IconName }[] = [
  { to: '/cuerpo/nueva', label: 'Medidas corporales', icon: 'ruler' },
  { to: '/habitos', label: 'Hábitos', icon: 'pill' },
  { to: '/comida/recetas', label: 'Receta', icon: 'book' },
  { to: '/comida/etiqueta', label: 'Etiqueta', icon: 'tag' },
  { to: '/fotos', label: 'Foto de progreso', icon: 'camera' },
]
