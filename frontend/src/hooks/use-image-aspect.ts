import { useEffect, useState } from "react"
import { optimizedImageUrl } from "@/lib/image"
import { getCachedImageAspect } from "@/components/ui/cached-image"

/**
 * Preload a small (320px) version of `src` purely to discover the image's
 * intrinsic aspect ratio. Used by fullscreen lightboxes to size their image
 * container BEFORE the placeholder paints, so the progressive load (low-res
 * placeholder → hi-res) does not resize the visible image. Both versions
 * share the same aspect, so once we know the aspect we can compute the
 * exact viewport-fit display size both will land at and render the
 * placeholder there from the very first paint.
 *
 * Short-circuits when `CachedImage`'s aspect cache already has the
 * dimensions for this URL — happens after any successful prior load
 * (thumbnail rendered in a node, hover-prefetch from CachedImage, or
 * explicit `prefetchFullSizeImage` call). In that case the hook returns
 * the cached value synchronously on first render and the lightbox renders
 * without any probe round-trip.
 *
 * Returns:
 *   - `null` while the dimension probe is in flight (caller should hide its
 *     container or render at 0×0)
 *   - `width / height` (a positive number) once decoded
 *   - `1` on probe error so the caller can still render something rather
 *     than hide indefinitely on a fluke CORS/network failure
 */
export function useImageAspect(src: string | null): number | null {
  const [aspect, setAspect] = useState<number | null>(() => getCachedImageAspect(src) ?? null)

  useEffect(() => {
    if (!src) {
      setAspect(null)
      return
    }
    // If the aspect was cached by a prior load/prefetch, skip the probe.
    const cached = getCachedImageAspect(src)
    if (cached !== undefined) {
      setAspect(cached)
      return
    }
    setAspect(null)
    let cancelled = false
    const img = new Image()
    const probeUrl = optimizedImageUrl(src, { width: 320 })
    if (probeUrl.includes("cdn.nodaro.ai")) img.crossOrigin = "anonymous"
    else img.referrerPolicy = "no-referrer"
    img.onload = () => {
      if (cancelled) return
      const { naturalWidth: w, naturalHeight: h } = img
      setAspect(w > 0 && h > 0 ? w / h : 1)
    }
    img.onerror = () => {
      if (!cancelled) setAspect(1)
    }
    img.src = probeUrl
    return () => {
      cancelled = true
    }
  }, [src])

  return aspect
}
