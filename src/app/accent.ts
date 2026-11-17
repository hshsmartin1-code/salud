import type { ProfileColor } from '../db/types'

/**
 * Per-profile accent colours. The active profile tints navigation, focus rings and selections so it
 * is always obvious whose data is on screen. Light values keep ≥ 4.5:1 contrast on white; dark values
 * keep ≥ 4.5:1 on the dark surface. RGB triplets match the CSS token format.
 */
export const PROFILE_ACCENTS: Record<ProfileColor, { light: string; dark: string; swatch: string; es: string }> = {
  emerald: { light: '15 121 84', dark: '78 211 160', swatch: '#14996b', es: 'Verde' },
  violet: { light: '106 69 209', dark: '169 147 255', swatch: '#7c5ce6', es: 'Violeta' },
  amber: { light: '156 89 0', dark: '242 180 90', swatch: '#d98a10', es: 'Ámbar' },
  sky: { light: '11 107 168', dark: '108 192 245', swatch: '#1a86c9', es: 'Azul' },
  rose: { light: '192 48 94', dark: '243 139 170', swatch: '#d9416f', es: 'Rosa' },
}

export function applyAccent(color: ProfileColor | null | undefined): void {
  const a = PROFILE_ACCENTS[color ?? 'emerald'] ?? PROFILE_ACCENTS.emerald
  const root = document.documentElement.style
  root.setProperty('--accent-light', a.light)
  root.setProperty('--accent-dark', a.dark)
}
