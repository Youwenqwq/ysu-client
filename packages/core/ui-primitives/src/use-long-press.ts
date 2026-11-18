import { useCallback, useEffect, useRef } from "react"

export function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const start = useCallback(() => {
    stop()
    timer.current = setTimeout(() => {
      timer.current = null
      onLongPress()
    }, ms)
  }, [onLongPress, ms, stop])

  useEffect(() => stop, [stop])

  return {
    onTouchStart: start,
    onTouchEnd: stop,
    onTouchCancel: stop,
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
  }
}
