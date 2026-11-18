import { useEffect, useRef, useState } from 'react'

export function useFoodSheetClose() {
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    leaving,
    close(after: () => void, animated = true) {
      if (timer.current !== undefined) return
      if (!animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        after()
        return
      }
      setLeaving(true)
      timer.current = setTimeout(() => {
        timer.current = undefined
        setLeaving(false)
        after()
      }, 150)
    },
  }
}
