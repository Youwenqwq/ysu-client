import { useEffect, useState } from "react"

export const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)"

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return isMobile
}
