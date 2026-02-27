import { useState, useEffect } from "react"

// Detects mobile phones in normal browsing mode.
// "Request Desktop Site" widens the viewport to ~980px, flipping this off.
// pointer:coarse ensures desktop browsers resized narrow don't false-positive.
const MOBILE_QUERY = "(max-width: 899px) and (pointer: coarse)"

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    setIsMobile(mql.matches)
    function onChange(e: MediaQueryListEvent): void {
      setIsMobile(e.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
