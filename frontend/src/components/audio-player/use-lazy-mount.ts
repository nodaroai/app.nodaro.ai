// frontend/src/components/audio-player/use-lazy-mount.ts
//
// Defers mounting a heavy child until its placeholder scrolls into view, so a
// canvas (or gallery list) full of audio nodes doesn't decode every clip at once.
// Falls back to immediate mount when IntersectionObserver is unavailable
// (e.g. jsdom in tests), and exposes mountNow() for explicit triggers (Play click).

import { useCallback, useEffect, useRef, useState } from "react"

export function useLazyMount(rootMargin = "200px") {
  const ref = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const mountNow = useCallback(() => setMounted(true), [])

  useEffect(() => {
    if (mounted) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setMounted(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [mounted, rootMargin])

  return { ref, mounted, mountNow }
}
