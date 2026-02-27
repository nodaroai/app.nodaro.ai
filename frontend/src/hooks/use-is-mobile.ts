import { useState, useEffect } from "react"

const MOBILE_BREAKPOINT = "(max-width: 767px)"

function detectMobile(): boolean {
  if (typeof window === "undefined") return false
  // Primary: viewport width check
  if (window.matchMedia(MOBILE_BREAKPOINT).matches) return true
  // Fallback: touch-primary device with narrow-ish screen (tablets excluded)
  if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 1024) return true
  return false
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(detectMobile)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT)
    const coarseMql = window.matchMedia("(pointer: coarse)")

    function update(): void {
      setIsMobile(detectMobile())
    }

    update()
    mql.addEventListener("change", update)
    coarseMql.addEventListener("change", update)
    return () => {
      mql.removeEventListener("change", update)
      coarseMql.removeEventListener("change", update)
    }
  }, [])

  return isMobile
}
