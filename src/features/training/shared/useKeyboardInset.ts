import { useEffect, useState } from 'react'

/** Height of the on-screen keyboard (px) as seen by the visual viewport; 0 when it is closed. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const kb = Math.round(window.innerHeight - vv.height - vv.offsetTop)
      setInset(kb > 120 ? kb : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}
