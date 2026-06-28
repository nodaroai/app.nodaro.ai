import { useCallback, useState, type SyntheticEvent } from "react"
import { useImageAspect } from "@/hooks/use-image-aspect"

/**
 * Resolve a studio asset card's container aspect ratio (width / height) from the
 * REAL media, so a full-body 9:16 shot, a landscape environment, or any provider
 * that returns an unexpected ratio is never cropped by a hardcoded container.
 *
 * - Images probe their intrinsic size via `useImageAspect`.
 * - Videos report their size through the returned `onVideoLoadedMetadata` handler
 *   (wire it to the `<video onLoadedMetadata={...}>`).
 *
 * Until the probe resolves, `fallback` (the asset-type default ratio) is returned
 * so the grid doesn't collapse to 0 height or jump noticeably.
 */
export function useMediaAspectRatio(
  url: string,
  kind: "image" | "video",
  fallback: number,
): {
  ratio: number
  onVideoLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => void
} {
  const imgAspect = useImageAspect(kind === "video" ? null : url)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  const onVideoLoadedMetadata = useCallback(
    (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setVideoAspect(v.videoWidth / v.videoHeight)
      }
    },
    [],
  )

  const ratio =
    kind === "video" ? videoAspect ?? fallback : imgAspect ?? fallback

  return { ratio: ratio > 0 ? ratio : fallback, onVideoLoadedMetadata }
}
