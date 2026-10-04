import { useEffect, useState, type RefObject } from "react"

/**
 * True once the element has been mostly on screen (and stays true). Where the
 * browser cannot tell, it counts as seen.
 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.6): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, inView, threshold])
  return inView
}
