import { useEffect, useRef } from 'react'
import { useRepo } from '../../app/profile'
import { applyProposal, useAdaptiveEnergy } from './adaptive'

/**
 * Mounted only for a profile that explicitly chose the automatic mode. When the module returns
 * 'auto_apply' (enough data, confidence medium/high, cooldown over, no manual goal) the change is written
 * once; the new adjustment row starts the cooldown, so it cannot repeat. Renders nothing.
 */
export function AdaptiveAutoRunner() {
  const r = useRepo()
  const s = useAdaptiveEnergy()
  const ran = useRef<string | null>(null)
  useEffect(() => {
    if (!s || s.proposal?.status !== 'auto_apply' || s.settings.mode !== 'auto') return
    if (ran.current === s.today) return
    ran.current = s.today
    void applyProposal(r, s, 'auto')
  }, [r, s])
  return null
}
