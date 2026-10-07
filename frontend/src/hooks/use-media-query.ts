import { useEffect, useState } from "react"

/**
 * Whether a CSS media query matches, following it as the window changes.
 * Where there is no `matchMedia` (a test DOM, a server render) it answers
 * `fallback`.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const read = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback)
  const [matches, setMatches] = useState(read)

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}

/** Tailwind's `sm` breakpoint and up (640 px). */
export const SM_UP = "(min-width: 640px)"
