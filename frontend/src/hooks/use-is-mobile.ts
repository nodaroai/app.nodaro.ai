import { useState, useEffect } from "react"

const MOBILE_BREAKPOINT = "(max-width: 767px)"

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_BREAKPOINT).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT)
    setIsMobile(mql.matches)
    function onChange(e: MediaQueryListEvent): void {
      setIsMobile(e.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
